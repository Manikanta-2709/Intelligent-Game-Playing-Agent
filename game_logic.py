"""Core Tic-Tac-Toe game logic."""

WINNING_COMBINATIONS = [
    (0, 1, 2),
    (3, 4, 5),
    (6, 7, 8),
    (0, 3, 6),
    (1, 4, 7),
    (2, 5, 8),
    (0, 4, 8),
    (2, 4, 6),
]

MOVE_PRIORITY = (4, 0, 2, 6, 8, 1, 3, 5, 7)


def create_board():
    """Return a new empty Tic-Tac-Toe board."""
    return [""] * 9


def is_valid_move(board, index):
    """Return True if index is on the board and the cell is empty."""
    return 0 <= index < 9 and board[index] == ""


def make_move(board, index, player):
    """Place player on the board if the move is valid."""
    if is_valid_move(board, index):
        board[index] = player
        return True
    return False


def check_winner(board, player):
    """Return True if player has any winning combination."""
    for combo in WINNING_COMBINATIONS:
        if all(board[index] == player for index in combo):
            return True
    return False


def get_winning_line(board, player):
    """Return the winning line for player, or None if there is no winner."""
    for combo in WINNING_COMBINATIONS:
        if all(board[index] == player for index in combo):
            return list(combo)
    return None


def is_draw(board):
    """Return True if the board is full and there is no winner."""
    return "" not in board and not check_winner(board, "X") and not check_winner(board, "O")


def get_available_moves(board):
    """Return a list of indexes for all empty cells."""
    return [index for index in MOVE_PRIORITY if board[index] == ""]


def _get_opponent(player):
    """Return the opposing player marker."""
    return "O" if player == "X" else "X"


def _minimax(board, current_player, maximizing_player, alpha, beta, depth):
    """Evaluate the board using minimax with alpha-beta pruning."""
    opponent = _get_opponent(maximizing_player)

    if check_winner(board, maximizing_player):
        return 10 - depth
    if check_winner(board, opponent):
        return depth - 10
    if is_draw(board):
        return 0

    available_moves = get_available_moves(board)

    if current_player == maximizing_player:
        best_score = float("-inf")
        for move in available_moves:
            board[move] = current_player
            score = _minimax(
                board,
                _get_opponent(current_player),
                maximizing_player,
                alpha,
                beta,
                depth + 1,
            )
            board[move] = ""
            best_score = max(best_score, score)
            alpha = max(alpha, best_score)
            if beta <= alpha:
                break
        return best_score

    best_score = float("inf")
    for move in available_moves:
        board[move] = current_player
        score = _minimax(
            board,
            _get_opponent(current_player),
            maximizing_player,
            alpha,
            beta,
            depth + 1,
        )
        board[move] = ""
        best_score = min(best_score, score)
        beta = min(beta, best_score)
        if beta <= alpha:
            break
    return best_score


def get_best_move(board, player):
    """Return the strongest available move for player."""
    if check_winner(board, "X") or check_winner(board, "O") or is_draw(board):
        return None

    best_score = float("-inf")
    best_move = None

    for move in get_available_moves(board):
        board[move] = player
        score = _minimax(
            board,
            _get_opponent(player),
            player,
            float("-inf"),
            float("inf"),
            1,
        )
        board[move] = ""

        if score > best_score:
            best_score = score
            best_move = move

    return best_move


def print_board(board):
    """Print the board in a simple 3x3 layout for debugging."""
    for row_start in range(0, 9, 3):
        row = board[row_start:row_start + 3]
        print(" | ".join(cell if cell else " " for cell in row))
        if row_start < 6:
            print("-" * 9)

