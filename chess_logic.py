"""Core chess helpers powered by python-chess."""

import random

import chess

PLAYER_COLOR_OPTIONS = {"white", "black"}
DIFFICULTY_OPTIONS = {"easy", "medium", "hard"}

PIECE_ICONS = {
    "P": "\u2659",
    "N": "\u2658",
    "B": "\u2657",
    "R": "\u2656",
    "Q": "\u2655",
    "K": "\u2654",
    "p": "\u265F",
    "n": "\u265E",
    "b": "\u265D",
    "r": "\u265C",
    "q": "\u265B",
    "k": "\u265A",
}

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}

CHECKMATE_SCORE = 100000


def normalize_player_color(value):
    """Return a safe player-color setting."""
    return value if value in PLAYER_COLOR_OPTIONS else "white"


def normalize_difficulty(value):
    """Return a safe chess difficulty setting."""
    return value if value in DIFFICULTY_OPTIONS else "medium"


def create_board():
    """Return a new chess board in the standard opening position."""
    return chess.Board()


def load_board(fen=None):
    """Return a board loaded from FEN, falling back to the standard opening."""
    try:
        return chess.Board(fen or chess.STARTING_FEN)
    except ValueError as error:
        raise ValueError("Invalid chess position.") from error


def serialize_move(move):
    """Return a JSON-safe move representation."""
    if move is None:
        return None

    payload = {
        "uci": move.uci(),
        "from": chess.square_name(move.from_square),
        "to": chess.square_name(move.to_square),
    }

    if move.promotion:
        payload["promotion"] = chess.piece_symbol(move.promotion)

    return payload


def serialize_board(board):
    """Return a JSON-safe representation of the 8x8 board."""
    cells = []

    for rank in range(7, -1, -1):
        for file_index in range(8):
            square = chess.square(file_index, rank)
            piece = board.piece_at(square)
            square_name = chess.square_name(square)
            cells.append(
                {
                    "square": square_name,
                    "piece": piece.symbol() if piece else "",
                    "icon": PIECE_ICONS.get(piece.symbol(), "") if piece else "",
                    "color": "white" if piece and piece.color == chess.WHITE else "black" if piece else "",
                    "isLight": (file_index + rank) % 2 == 1,
                }
            )

    return cells


def list_legal_moves(board, player_color):
    """Group legal destination squares by origin square for the human player."""
    active_color = chess.WHITE if player_color == "white" else chess.BLACK
    if board.turn != active_color or board.is_game_over(claim_draw=True):
        return {}

    legal_moves = {}
    for move in board.legal_moves:
        from_square = chess.square_name(move.from_square)
        legal_moves.setdefault(from_square, [])
        move_payload = {"to": chess.square_name(move.to_square)}
        if move.promotion:
            move_payload["promotion"] = chess.piece_symbol(move.promotion)
        legal_moves[from_square].append(move_payload)

    return legal_moves


def get_winner(board):
    """Return the winner as white/black, or None for draws and ongoing games."""
    outcome = board.outcome(claim_draw=True)
    if outcome is None or outcome.winner is None:
        return None
    return "white" if outcome.winner == chess.WHITE else "black"


def build_game_state(board, status, *, player_color="white", difficulty="medium", scoreboard=None, last_move=None, move_quality=None):
    """Return the chess game state payload for the frontend."""
    player_color = normalize_player_color(player_color)
    difficulty = normalize_difficulty(difficulty)
    scoreboard = scoreboard if isinstance(scoreboard, dict) else {"human": 0, "computer": 0, "draws": 0}

    return {
        "game": "chess",
        "board": serialize_board(board),
        "fen": board.fen(),
        "status": status,
        "winner": get_winner(board),
        "gameOver": board.is_game_over(claim_draw=True),
        "turn": "white" if board.turn == chess.WHITE else "black",
        "playerColor": player_color,
        "difficulty": difficulty,
        "scoreboard": scoreboard,
        "legalMoves": list_legal_moves(board, player_color),
        "lastMove": serialize_move(last_move),
        "moveQuality": move_quality,
        "isCheck": board.is_check(),
        "moveCount": len(board.move_stack),
    }


def apply_human_move(board, from_square, to_square, player_color, promotion="q"):
    """Apply a validated human move to the board and return the move."""
    player_color = normalize_player_color(player_color)
    active_color = chess.WHITE if player_color == "white" else chess.BLACK

    if board.turn != active_color:
        raise ValueError("It is not your turn.")

    try:
        from_index = chess.parse_square(from_square)
        to_index = chess.parse_square(to_square)
    except ValueError as error:
        raise ValueError("Choose a valid chess move.") from error

    piece = board.piece_at(from_index)
    if piece is None:
        raise ValueError("Select one of your pieces first.")

    if piece.color != active_color:
        raise ValueError("You can only move your own pieces.")

    move = chess.Move(from_index, to_index)
    if piece.piece_type == chess.PAWN and chess.square_rank(to_index) in {0, 7}:
        promotion_map = {
            "q": chess.QUEEN,
            "r": chess.ROOK,
            "b": chess.BISHOP,
            "n": chess.KNIGHT,
        }
        move.promotion = promotion_map.get(str(promotion).lower(), chess.QUEEN)

    if move not in board.legal_moves:
        raise ValueError("That chess move is not legal.")

    # Classify before pushing
    quality = _classify_move(board, move)
    board.push(move)
    return move, quality


def _classify_move(board, move):
    """Return 'best', 'great', 'good', 'inaccuracy', or 'blunder'."""
    try:
        best_move = choose_computer_move(board, "medium")
        if move == best_move:
            return "best"
        
        perspective = board.turn
        score_before = _minimax(board, depth=1, alpha=float("-inf"), beta=float("inf"), maximizing_player=True, perspective=perspective)
        
        board.push(move)
        score_after = -_minimax(board, depth=1, alpha=float("-inf"), beta=float("inf"), maximizing_player=True, perspective=not perspective)
        board.pop()
        
        diff = score_after - score_before
        if diff <= -200:
            return "blunder"
        if diff <= -50:
            return "inaccuracy"
        if diff >= 100:
            return "great"
        return "good"
    except Exception:
        return "good"


def choose_computer_move(board, difficulty):
    """Return a computer move based on the selected difficulty."""
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None

    if difficulty == "easy":
        return random.choice(legal_moves)

    perspective = board.turn
    search_depth = 1 if difficulty == "medium" else 2
    scored_moves = []

    for move in legal_moves:
        capture_bonus = _capture_bonus(board, move)
        check_bonus = 35 if board.gives_check(move) else 0
        castle_bonus = 20 if board.is_castling(move) else 0

        board.push(move)
        score = _minimax(
            board,
            depth=search_depth,
            alpha=float("-inf"),
            beta=float("inf"),
            maximizing_player=False,
            perspective=perspective,
        )
        board.pop()

        scored_moves.append((score + capture_bonus + check_bonus + castle_bonus, move))

    scored_moves.sort(key=lambda item: item[0], reverse=True)

    if difficulty == "medium":
        top_slice = scored_moves[: min(3, len(scored_moves))]
        return random.choice(top_slice)[1]

    return scored_moves[0][1]


def _capture_bonus(board, move):
    """Return a small tactical bonus for immediate captures."""
    if not board.is_capture(move):
        return 0

    captured_piece = board.piece_at(move.to_square)
    if captured_piece is None and board.is_en_passant(move):
        captured_piece = chess.Piece(chess.PAWN, not board.turn)

    if captured_piece is None:
        return 0

    return PIECE_VALUES.get(captured_piece.piece_type, 0) * 0.35


def _minimax(board, depth, alpha, beta, maximizing_player, perspective):
    """Evaluate the chess position using a small minimax search."""
    if depth == 0 or board.is_game_over(claim_draw=True):
        return _evaluate_board(board, perspective)

    legal_moves = list(board.legal_moves)

    if maximizing_player:
        value = float("-inf")
        for move in legal_moves:
            board.push(move)
            value = max(value, _minimax(board, depth - 1, alpha, beta, False, perspective))
            board.pop()
            alpha = max(alpha, value)
            if beta <= alpha:
                break
        return value

    value = float("inf")
    for move in legal_moves:
        board.push(move)
        value = min(value, _minimax(board, depth - 1, alpha, beta, True, perspective))
        board.pop()
        beta = min(beta, value)
        if beta <= alpha:
            break
    return value


def _evaluate_board(board, perspective):
    """Return a static evaluation from the perspective color."""
    if board.is_checkmate():
        return -CHECKMATE_SCORE if board.turn == perspective else CHECKMATE_SCORE

    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    outcome = board.outcome(claim_draw=True)
    if outcome is not None and outcome.winner is None:
        return 0

    opponent = not perspective
    score = 0

    for piece_type, value in PIECE_VALUES.items():
        score += len(board.pieces(piece_type, perspective)) * value
        score -= len(board.pieces(piece_type, opponent)) * value

    mobility = len(list(board.legal_moves))
    score += mobility * 2 if board.turn == perspective else -mobility * 2

    if board.is_check():
        score += -25 if board.turn == perspective else 25

    return score
