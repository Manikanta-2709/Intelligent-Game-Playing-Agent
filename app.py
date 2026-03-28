"""Flask web app for playing Tic-Tac-Toe against the computer."""

import json
import random
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from game_logic import (
    check_winner,
    get_available_moves,
    get_best_move,
    get_winning_line,
    is_draw,
    make_move,
)

HUMAN = "X"
COMPUTER = "O"
VALID_MARKERS = {"", HUMAN, COMPUTER}
FIRST_PLAYER_OPTIONS = {"human", "computer"}
DIFFICULTY_OPTIONS = {"easy", "medium", "hard"}
DATABASE_FILE = Path(__file__).with_name("game_history.db")
LEGACY_SAVE_FILE = Path(__file__).with_name("saved_game.json")
IST = timezone(timedelta(hours=5, minutes=30))

app = Flask(__name__, template_folder=".", static_folder=".", static_url_path="")


@app.errorhandler(HTTPException)
def handle_http_exception(error):
    """Return JSON errors for API routes instead of HTML error pages."""
    if request.path.startswith("/api/"):
        return jsonify({"error": error.description}), error.code
    return error


@app.errorhandler(Exception)
def handle_unexpected_exception(error):
    """Return JSON for unexpected API errors so the frontend can display them."""
    if request.path.startswith("/api/"):
        return jsonify({"error": str(error)}), 500
    raise error


def _normalize_first_player(value):
    """Return a safe first-player setting."""
    return value if value in FIRST_PLAYER_OPTIONS else "human"


def _normalize_difficulty(value):
    """Return a safe AI difficulty setting."""
    return value if value in DIFFICULTY_OPTIONS else "hard"


def _to_non_negative_int(value):
    """Safely convert a value to a non-negative integer."""
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _normalize_scoreboard(scoreboard):
    """Return a sanitized scoreboard dictionary."""
    scoreboard = scoreboard if isinstance(scoreboard, dict) else {}
    return {
        "human": _to_non_negative_int(scoreboard.get("human", 0)),
        "computer": _to_non_negative_int(scoreboard.get("computer", 0)),
        "draws": _to_non_negative_int(scoreboard.get("draws", 0)),
    }


def _normalize_analysis(analysis):
    """Return sanitized AI-analysis counters."""
    analysis = analysis if isinstance(analysis, dict) else {}
    total_moves = _to_non_negative_int(analysis.get("totalMoves", 0))
    optimal_moves = _to_non_negative_int(analysis.get("optimalMoves", 0))
    return {
        "optimalMoves": min(optimal_moves, total_moves),
        "totalMoves": total_moves,
    }


def _summarize_analysis(scoreboard, analysis):
    """Return derived AI accuracy and AI performance information."""
    total_moves = analysis["totalMoves"]
    completed_rounds = scoreboard["human"] + scoreboard["computer"] + scoreboard["draws"]
    accuracy_score = round((analysis["optimalMoves"] / total_moves) * 100, 1) if total_moves else 0.0
    performance_points = scoreboard["computer"] + (scoreboard["draws"] * 0.5)
    performance_score = round((performance_points / completed_rounds) * 100, 1) if completed_rounds else 0.0
    return {
        **analysis,
        "accuracyScore": accuracy_score,
        "performanceScore": performance_score,
        "record": f'{scoreboard["computer"]}W {scoreboard["draws"]}D {scoreboard["human"]}L',
    }


def _build_game_state(
    board,
    status,
    *,
    winner=None,
    scoreboard=None,
    analysis=None,
    first_player="human",
    difficulty="hard",
):
    """Create the JSON payload returned to the browser."""
    draw = is_draw(board)
    payload = {
        "board": board,
        "status": status,
        "winner": winner,
        "winningLine": get_winning_line(board, winner) if winner else None,
        "draw": draw,
        "gameOver": winner is not None or draw,
        "firstPlayer": _normalize_first_player(first_player),
        "difficulty": _normalize_difficulty(difficulty),
    }

    if scoreboard is not None and analysis is not None:
        safe_scoreboard = _normalize_scoreboard(scoreboard)
        safe_analysis = _normalize_analysis(analysis)
        payload["scoreboard"] = safe_scoreboard
        payload["analysis"] = _summarize_analysis(safe_scoreboard, safe_analysis)

    return payload


def _timestamp():
    """Return a readable Indian Standard Time timestamp for persisted history entries."""
    return datetime.now(IST).strftime("%d-%m-%Y %I:%M:%S %p IST")


def _history_entry(state, event, entry_id):
    """Create one persisted history record."""
    return {
        "entryId": entry_id,
        "savedAt": _timestamp(),
        "event": event,
        "state": state,
    }


def _normalize_storage(payload):
    """Normalize legacy JSON storage into current-state plus full history."""
    if not isinstance(payload, dict):
        return {"currentState": None, "history": []}

    if "currentState" not in payload and "history" not in payload:
        current_state = _validate_saved_state(payload)
        return {
            "currentState": current_state,
            "history": [_history_entry(current_state, "migrated", 1)],
        }

    raw_current_state = payload.get("currentState")
    current_state = _validate_saved_state(raw_current_state) if isinstance(raw_current_state, dict) else None
    history = []

    raw_history = payload.get("history")
    if isinstance(raw_history, list):
        for entry in raw_history:
            if not isinstance(entry, dict):
                continue

            raw_state = entry.get("state")
            if not isinstance(raw_state, dict):
                continue

            history.append(
                {
                    "entryId": len(history) + 1,
                    "savedAt": str(entry.get("savedAt") or _timestamp()),
                    "event": str(entry.get("event") or "autosave"),
                    "state": _validate_saved_state(raw_state),
                }
            )

    if current_state is None and history:
        current_state = history[-1]["state"]

    if current_state is not None and not history:
        history.append(_history_entry(current_state, "migrated", 1))

    return {
        "currentState": current_state,
        "history": history,
    }


def _serialize_board(board):
    """Store the board in a compact readable px3 text form."""
    rows = ["".join(cell or "-" for cell in board[index:index + 3]) for index in range(0, 9, 3)]
    return "/".join(rows)


def _deserialize_board(board_text):
    """Convert the stored board text back into a list of cells."""
    if not isinstance(board_text, str):
        return [""] * 9

    compact = board_text.replace("/", "")
    if len(compact) != 9:
        return [""] * 9

    return [cell if cell in {HUMAN, COMPUTER} else "" for cell in compact]


def _serialize_winning_line(winning_line):
    """Store a winning line as readable comma-separated indexes."""
    if not winning_line:
        return ""
    return ",".join(str(index) for index in winning_line)


def _deserialize_winning_line(winning_line_text):
    """Parse a stored winning line back into a list."""
    if not isinstance(winning_line_text, str) or not winning_line_text:
        return None

    try:
        indexes = [int(part) for part in winning_line_text.split(",")]
    except ValueError:
        return None

    if len(indexes) != 3 or any(index < 0 or index > 8 for index in indexes):
        return None

    return indexes


def _empty_scoreboard():
    """Return an empty overall scoreboard."""
    return {"human": 0, "computer": 0, "draws": 0}


def _empty_analysis():
    """Return empty AI analysis counters."""
    return {
        "optimalMoves": 0,
        "totalMoves": 0,
        "accuracyScore": 0.0,
        "performanceScore": 0.0,
        "record": "0W 0D 0L",
    }


def _connect_db():
    """Open a connection to the local SQLite database."""
    connection = sqlite3.connect(DATABASE_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def _create_game_history_table(connection):
    """Create the readable per-game SQLite schema."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            saved_at TEXT NOT NULL,
            result TEXT NOT NULL,
            winner TEXT,
            status TEXT NOT NULL,
            final_board TEXT NOT NULL,
            winning_line TEXT,
            first_player TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            game_ai_optimal_moves INTEGER NOT NULL,
            game_ai_total_moves INTEGER NOT NULL,
            game_ai_accuracy REAL NOT NULL,
            game_ai_performance REAL NOT NULL,
            overall_human_wins INTEGER NOT NULL,
            overall_computer_wins INTEGER NOT NULL,
            overall_draws INTEGER NOT NULL,
            overall_ai_accuracy REAL NOT NULL,
            overall_ai_performance REAL NOT NULL,
            overall_record TEXT NOT NULL
        )
        """
    )


def _game_result_from_state(state):
    """Return the completed-game result label from a final state."""
    if state.get("winner") == HUMAN:
        return "human_win"
    if state.get("winner") == COMPUTER:
        return "computer_win"
    return "draw"


def _performance_for_result(result):
    """Return the AI performance score for one completed game."""
    if result == "computer_win":
        return 100.0
    if result == "draw":
        return 50.0
    return 0.0


def _get_overall_metrics(connection):
    """Return overall totals and averages across all stored completed games."""
    row = connection.execute(
        """
        SELECT
            COUNT(*) AS total_games,
            COALESCE(SUM(CASE WHEN result = 'human_win' THEN 1 ELSE 0 END), 0) AS human_wins,
            COALESCE(SUM(CASE WHEN result = 'computer_win' THEN 1 ELSE 0 END), 0) AS computer_wins,
            COALESCE(SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END), 0) AS draws,
            COALESCE(AVG(game_ai_accuracy), 0) AS overall_ai_accuracy,
            COALESCE(AVG(game_ai_performance), 0) AS overall_ai_performance
        FROM game_history
        """
    ).fetchone()

    scoreboard = {
        "human": row["human_wins"],
        "computer": row["computer_wins"],
        "draws": row["draws"],
    }
    analysis = {
        "optimalMoves": 0,
        "totalMoves": row["total_games"],
        "accuracyScore": round(float(row["overall_ai_accuracy"] or 0), 1),
        "performanceScore": round(float(row["overall_ai_performance"] or 0), 1),
        "record": f'{scoreboard["computer"]}W {scoreboard["draws"]}D {scoreboard["human"]}L',
    }
    return scoreboard, analysis


def _insert_completed_game(connection, state, round_analysis, saved_at=None):
    """Insert one completed game row with per-game and overall stats."""
    normalized_state = _validate_saved_state(state)
    normalized_round_analysis = _normalize_analysis(round_analysis)
    result = _game_result_from_state(normalized_state)
    game_ai_accuracy = round(
        (normalized_round_analysis["optimalMoves"] / normalized_round_analysis["totalMoves"]) * 100,
        1,
    ) if normalized_round_analysis["totalMoves"] else 0.0
    game_ai_performance = _performance_for_result(result)

    prior_scoreboard, prior_overall_analysis = _get_overall_metrics(connection)
    overall_scoreboard = {
        "human": prior_scoreboard["human"] + (1 if result == "human_win" else 0),
        "computer": prior_scoreboard["computer"] + (1 if result == "computer_win" else 0),
        "draws": prior_scoreboard["draws"] + (1 if result == "draw" else 0),
    }
    prior_total_games = prior_scoreboard["human"] + prior_scoreboard["computer"] + prior_scoreboard["draws"]
    overall_total_games = prior_total_games + 1
    overall_ai_accuracy = round(
        (
            (prior_overall_analysis["accuracyScore"] * prior_total_games) + game_ai_accuracy
        ) / overall_total_games,
        1,
    )
    overall_ai_performance = round(
        (
            (prior_overall_analysis["performanceScore"] * prior_total_games) + game_ai_performance
        ) / overall_total_games,
        1,
    )
    overall_record = f'{overall_scoreboard["computer"]}W {overall_scoreboard["draws"]}D {overall_scoreboard["human"]}L'

    connection.execute(
        """
        INSERT INTO game_history (
            saved_at,
            result,
            winner,
            status,
            final_board,
            winning_line,
            first_player,
            difficulty,
            game_ai_optimal_moves,
            game_ai_total_moves,
            game_ai_accuracy,
            game_ai_performance,
            overall_human_wins,
            overall_computer_wins,
            overall_draws,
            overall_ai_accuracy,
            overall_ai_performance,
            overall_record
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            saved_at or _timestamp(),
            result,
            normalized_state["winner"] or "",
            normalized_state["status"],
            _serialize_board(normalized_state["board"]),
            _serialize_winning_line(normalized_state["winningLine"]),
            normalized_state["firstPlayer"],
            normalized_state["difficulty"],
            normalized_round_analysis["optimalMoves"],
            normalized_round_analysis["totalMoves"],
            game_ai_accuracy,
            game_ai_performance,
            overall_scoreboard["human"],
            overall_scoreboard["computer"],
            overall_scoreboard["draws"],
            overall_ai_accuracy,
            overall_ai_performance,
            overall_record,
        ),
    )


def _migrate_json_blob_table(connection):
    """Convert the older JSON-blob SQLite schema into readable completed-game rows."""
    connection.execute("ALTER TABLE game_history RENAME TO game_history_legacy")
    _create_game_history_table(connection)

    rows = connection.execute(
        "SELECT saved_at, event, state_json, is_current FROM game_history_legacy ORDER BY id"
    ).fetchall()

    for row in rows:
        try:
            payload = json.loads(row["state_json"])
        except json.JSONDecodeError:
            continue

        normalized_state = _validate_saved_state(payload)
        if not normalized_state["gameOver"]:
            continue

        _insert_completed_game(connection, normalized_state, normalized_state["analysis"], row["saved_at"])

    connection.execute("DROP TABLE game_history_legacy")


def _migrate_snapshot_table(connection):
    """Convert the older readable snapshot schema into per-game rows."""
    connection.execute("ALTER TABLE game_history RENAME TO game_history_snapshot_legacy")
    _create_game_history_table(connection)

    rows = connection.execute(
        """
        SELECT
            saved_at,
            board,
            status,
            winner,
            winning_line,
            game_over,
            first_player,
            difficulty,
            ai_optimal_moves,
            ai_total_moves
        FROM game_history_snapshot_legacy
        ORDER BY id
        """
    ).fetchall()

    for row in rows:
        if not row["game_over"]:
            continue

        state = {
            "board": _deserialize_board(row["board"]),
            "status": row["status"],
            "winner": row["winner"] or None,
            "winningLine": _deserialize_winning_line(row["winning_line"]),
            "gameOver": bool(row["game_over"]),
            "firstPlayer": row["first_player"],
            "difficulty": row["difficulty"],
            "scoreboard": _empty_scoreboard(),
            "analysis": {
                "optimalMoves": row["ai_optimal_moves"],
                "totalMoves": row["ai_total_moves"],
            },
        }
        _insert_completed_game(connection, state, state["analysis"], row["saved_at"])

    connection.execute("DROP TABLE game_history_snapshot_legacy")


def _init_db():
    """Create or migrate the SQLite schema as needed."""
    with _connect_db() as connection:
        columns = [row["name"] for row in connection.execute("PRAGMA table_info(game_history)").fetchall()]

        if not columns:
            _create_game_history_table(connection)
            return

        if "state_json" in columns:
            _migrate_json_blob_table(connection)
            return

        if "event" in columns or "board" in columns or "is_current" in columns:
            _migrate_snapshot_table(connection)


def _database_has_rows():
    """Return True when the SQLite history table already contains data."""
    _init_db()
    with _connect_db() as connection:
        row = connection.execute("SELECT COUNT(*) AS total FROM game_history").fetchone()
    return bool(row["total"])


def _migrate_legacy_json_if_needed():
    """Import completed games from any existing JSON save data into SQLite."""
    if _database_has_rows() or not LEGACY_SAVE_FILE.exists():
        return

    try:
        legacy_payload = json.loads(LEGACY_SAVE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return

    storage = _normalize_storage(legacy_payload)
    history = storage["history"]
    current_state = storage["currentState"]

    if not history and current_state is not None:
        history = [_history_entry(current_state, "migrated", 1)]

    if not history:
        return

    with _connect_db() as connection:
        for entry in history:
            normalized_state = _validate_saved_state(entry["state"])
            if not normalized_state["gameOver"]:
                continue

            _insert_completed_game(
                connection,
                normalized_state,
                normalized_state["analysis"],
                entry["savedAt"],
            )


def _persist_completed_game(state, round_analysis):
    """Persist one completed game to the database."""
    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        _insert_completed_game(connection, state, round_analysis)


def _load_latest_completed_game():
    """Load the most recently completed game from SQLite."""
    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM game_history
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()

    if row is None:
        return None

    scoreboard = {
        "human": row["overall_human_wins"],
        "computer": row["overall_computer_wins"],
        "draws": row["overall_draws"],
    }
    state = _build_game_state(
        _deserialize_board(row["final_board"]),
        row["status"],
        winner=row["winner"] or None,
        scoreboard=scoreboard,
        analysis={
            "optimalMoves": 0,
            "totalMoves": scoreboard["human"] + scoreboard["computer"] + scoreboard["draws"],
        },
        first_player=row["first_player"],
        difficulty=row["difficulty"],
    )

    state["winningLine"] = _deserialize_winning_line(row["winning_line"])
    state["analysis"] = _get_overall_analysis()
    return state


def _get_overall_scoreboard():
    """Return the overall scoreboard across all completed games."""
    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        scoreboard, _ = _get_overall_metrics(connection)
    return scoreboard


def _get_overall_analysis():
    """Return the overall AI analysis across all completed games."""
    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        _, analysis = _get_overall_metrics(connection)
    return analysis


def _validate_board(board, first_player):
    """Validate the incoming board for a human turn request."""
    if not isinstance(board, list) or len(board) != 9:
        return "Board must contain exactly 9 cells."

    if any(cell not in VALID_MARKERS for cell in board):
        return "Board contains invalid cell values."

    x_count = board.count(HUMAN)
    o_count = board.count(COMPUTER)
    expected_difference = 0 if first_player == "human" else 1

    if o_count - x_count != expected_difference:
        return "Board is out of sync for the current turn order."

    if check_winner(board, HUMAN) or check_winner(board, COMPUTER) or is_draw(board):
        return "This round is already complete."

    return None


def _validate_saved_state(payload):
    """Validate and normalize a state object for saving or loading."""
    payload = payload if isinstance(payload, dict) else {}
    board = payload.get("board")
    first_player = _normalize_first_player(payload.get("firstPlayer"))
    difficulty = _normalize_difficulty(payload.get("difficulty"))
    legacy_state = "difficulty" not in payload

    if not isinstance(board, list) or len(board) != 9 or any(cell not in VALID_MARKERS for cell in board):
        board = [""] * 9

    winning_line = payload.get("winningLine")
    if not isinstance(winning_line, list) or len(winning_line) != 3 or any(
        not isinstance(index, int) or not 0 <= index < 9 for index in winning_line
    ):
        winning_line = None

    safe_scoreboard = _normalize_scoreboard(payload.get("scoreboard"))
    safe_analysis = _normalize_analysis({} if legacy_state else payload.get("analysis"))
    winner = COMPUTER if check_winner(board, COMPUTER) else HUMAN if check_winner(board, HUMAN) else None
    draw = is_draw(board)

    return {
        "board": board,
        "status": str(payload.get("status", "Your turn")),
        "winner": winner,
        "draw": draw,
        "gameOver": bool(payload.get("gameOver", False)) or winner is not None or draw,
        "winningLine": winning_line,
        "firstPlayer": first_player,
        "difficulty": difficulty,
        "scoreboard": safe_scoreboard,
        "analysis": _summarize_analysis(safe_scoreboard, safe_analysis),
    }


def _choose_computer_move(board, difficulty):
    """Choose the AI move based on the selected difficulty."""
    available_moves = get_available_moves(board)
    if not available_moves:
        return None, None

    best_move = get_best_move(board.copy(), COMPUTER)
    fallback_moves = [move for move in available_moves if move != best_move]

    if best_move is None or not fallback_moves:
        return best_move, best_move

    if difficulty == "easy" and random.random() < 0.65:
        return random.choice(fallback_moves), best_move

    if difficulty == "medium" and random.random() < 0.3:
        return random.choice(fallback_moves), best_move

    return best_move, best_move


@app.get("/")
def index():
    """Serve the main application page."""
    return render_template("index.html")


@app.post("/api/new-game")
def new_game():
    """Start a new round and optionally let the computer open."""
    payload = request.get_json(silent=True) or {}
    first_player = _normalize_first_player(payload.get("firstPlayer"))
    difficulty = _normalize_difficulty(payload.get("difficulty"))
    analysis = _normalize_analysis(payload.get("analysis"))
    scoreboard = _get_overall_scoreboard()
    board = [""] * 9
    status = "Your turn"

    if first_player == "computer":
        opening_move, best_move = _choose_computer_move(board, difficulty)
        if opening_move is not None:
            make_move(board, opening_move, COMPUTER)
            analysis["totalMoves"] += 1
            if opening_move == best_move:
                analysis["optimalMoves"] += 1
        status = "Computer opens. Your turn."

    state = _build_game_state(
        board,
        status,
        scoreboard=scoreboard,
        analysis=analysis,
        first_player=first_player,
        difficulty=difficulty,
    )
    return jsonify(state)


@app.post("/api/move")
def play_move():
    """Apply the human move, answer with the computer move, and return the new state."""
    payload = request.get_json(silent=True) or {}
    board = payload.get("board")
    move = payload.get("move")
    first_player = _normalize_first_player(payload.get("firstPlayer"))
    difficulty = _normalize_difficulty(payload.get("difficulty"))
    analysis = _normalize_analysis(payload.get("analysis"))
    scoreboard = _get_overall_scoreboard()

    error = _validate_board(board, first_player)
    if error:
        return jsonify({"error": error}), 400

    if not isinstance(move, int) or not 0 <= move < 9:
        return jsonify({"error": "Move must be an index from 0 to 8."}), 400

    next_board = board.copy()

    if not make_move(next_board, move, HUMAN):
        return jsonify({"error": "That cell is already taken."}), 400

    if check_winner(next_board, HUMAN):
        state = _build_game_state(
            next_board,
            "You win this round!",
            winner=HUMAN,
            scoreboard=scoreboard,
            analysis=analysis,
            first_player=first_player,
            difficulty=difficulty,
        )
        _persist_completed_game(state, analysis)
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    if is_draw(next_board):
        state = _build_game_state(
            next_board,
            "It is a draw.",
            scoreboard=scoreboard,
            analysis=analysis,
            first_player=first_player,
            difficulty=difficulty,
        )
        _persist_completed_game(state, analysis)
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    computer_move, best_move = _choose_computer_move(next_board, difficulty)
    if computer_move is None:
        state = _build_game_state(
            next_board,
            "It is a draw.",
            scoreboard=scoreboard,
            analysis=analysis,
            first_player=first_player,
            difficulty=difficulty,
        )
        _persist_completed_game(state, analysis)
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    make_move(next_board, computer_move, COMPUTER)
    analysis["totalMoves"] += 1
    if computer_move == best_move:
        analysis["optimalMoves"] += 1

    if check_winner(next_board, COMPUTER):
        state = _build_game_state(
            next_board,
            "Computer wins this round.",
            winner=COMPUTER,
            scoreboard=scoreboard,
            analysis=analysis,
            first_player=first_player,
            difficulty=difficulty,
        )
        _persist_completed_game(state, analysis)
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    if is_draw(next_board):
        state = _build_game_state(
            next_board,
            "It is a draw.",
            scoreboard=scoreboard,
            analysis=analysis,
            first_player=first_player,
            difficulty=difficulty,
        )
        _persist_completed_game(state, analysis)
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    state = _build_game_state(
        next_board,
        "Your turn",
        scoreboard=scoreboard,
        analysis=analysis,
        first_player=first_player,
        difficulty=difficulty,
    )
    return jsonify(state)


@app.get("/api/load")
def load_game():
    """Load the most recently completed game from the database."""
    current_state = _load_latest_completed_game()
    if current_state is None:
        return jsonify({"error": "No saved game was found."}), 404

    return jsonify(current_state)


@app.post("/api/reset-data")
def reset_data():
    """Clear all stored database history and reset the app data."""
    _init_db()
    with _connect_db() as connection:
        connection.execute("DELETE FROM game_history")

    if LEGACY_SAVE_FILE.exists():
        LEGACY_SAVE_FILE.unlink()

    return jsonify({"message": "All stored data was cleared."})


if __name__ == "__main__":
    app.run(debug=True)
