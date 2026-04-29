"""Flask web app for Tic-Tac-Toe and chess against the computer."""

import json
import os
import random
import sqlite3
import socket
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session, redirect
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash, check_password_hash

from chess_logic import (
    apply_human_move as apply_chess_human_move,
    build_game_state as build_chess_game_state,
    choose_computer_move as choose_chess_computer_move,
    create_board as create_chess_board,
    get_winner as get_chess_winner,
    load_board as load_chess_board,
    normalize_difficulty as normalize_chess_difficulty,
    normalize_player_color,
)
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
AI_MOVE_DELAY_SECONDS = 2
IST = timezone(timedelta(hours=5, minutes=30))


def _get_data_directory():
    """Return the directory used for writable app data."""
    data_dir = os.getenv("APP_DATA_DIR", "").strip()
    if data_dir:
        return Path(data_dir)
    return Path(__file__).resolve().parent


DATA_DIR = _get_data_directory()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_FILE = DATA_DIR / "game_history.db"
LEGACY_SAVE_FILE = DATA_DIR / "saved_game.json"

app = Flask(__name__, template_folder=".", static_folder=".", static_url_path="")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-12345")


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
    _ensure_users_table(connection)
    # Create game history table with user_id link
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
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
            overall_record TEXT NOT NULL,
            game_mode TEXT DEFAULT 'tictactoe',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )


def _ensure_users_table(connection):
    """Create users table if needed and migrate older auth schemas safely."""
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            security_question TEXT NOT NULL,
            security_answer_hash TEXT NOT NULL,
            current_streak INTEGER DEFAULT 0,
            best_streak INTEGER DEFAULT 0,
            achievements TEXT DEFAULT '[]'
        )
        """
    )

    user_columns = [row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()]
    if "password_hash" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "password" in user_columns:
            rows = connection.execute("SELECT id, password FROM users").fetchall()
            for row in rows:
                legacy_password = row["password"] or ""
                connection.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (generate_password_hash(legacy_password), row["id"]),
                )

    if "security_question" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN security_question TEXT DEFAULT ''")
    if "security_answer_hash" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN security_answer_hash TEXT DEFAULT ''")
    if "current_streak" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN current_streak INTEGER DEFAULT 0")
    if "best_streak" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN best_streak INTEGER DEFAULT 0")
    if "achievements" not in user_columns:
        connection.execute("ALTER TABLE users ADD COLUMN achievements TEXT DEFAULT '[]'")

    connection.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
    connection.execute("UPDATE users SET security_question = '' WHERE security_question IS NULL")
    connection.execute("UPDATE users SET security_answer_hash = '' WHERE security_answer_hash IS NULL")
    connection.execute("UPDATE users SET current_streak = 0 WHERE current_streak IS NULL")
    connection.execute("UPDATE users SET best_streak = 0 WHERE best_streak IS NULL")
    connection.execute("UPDATE users SET achievements = '[]' WHERE achievements IS NULL")


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
    """Return overall totals and averages for the current user across all stored games."""
    user_id = session.get("user_id")
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
        WHERE user_id = ?
        """,
        (user_id,)
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


def _insert_completed_game(connection, state, round_analysis, game_mode, saved_at=None):
    """Insert one completed game row linked to current user, and update user statistics."""
    user_id = session.get("user_id")
    normalized_state = _validate_saved_state(state)
    normalized_round_analysis = _normalize_analysis(round_analysis)
    result = _game_result_from_state(normalized_state)
    
    # Update user streaks
    if user_id:
        user = connection.execute("SELECT current_streak, best_streak FROM users WHERE id = ?", (user_id,)).fetchone()
        if user:
            cur, best = user["current_streak"], user["best_streak"]
            if result == "human_win":
                cur += 1
            elif result == "computer_win":
                cur = 0
            # draws don't break/increment streak
            best = max(best, cur)
            connection.execute("UPDATE users SET current_streak = ?, best_streak = ? WHERE id = ?", (cur, best, user_id))

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
            user_id,
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
            overall_record,
            game_mode
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
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
            game_mode
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

        _insert_completed_game(connection, normalized_state, normalized_state["analysis"], "tictactoe", saved_at=row["saved_at"])

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
        _insert_completed_game(connection, state, state["analysis"], "tictactoe", saved_at=row["saved_at"])

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
            return

        if "user_id" not in columns:
            connection.execute("ALTER TABLE game_history ADD COLUMN user_id INTEGER REFERENCES users(id)")
        
        if "game_mode" not in columns:
            connection.execute("ALTER TABLE game_history ADD COLUMN game_mode TEXT DEFAULT 'tictactoe'")

        _ensure_users_table(connection)


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
                "tictactoe",
                saved_at=entry["savedAt"],
            )


def _persist_completed_game(state, round_analysis, game_mode):
    """Persist one completed game to the database."""
    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        _insert_completed_game(connection, state, round_analysis, game_mode)


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


def _pause_before_ai_move():
    """Add a small delay so computer moves feel paced for the player."""
    time.sleep(AI_MOVE_DELAY_SECONDS)


def _normalize_chess_scoreboard(scoreboard):
    """Return a sanitized scoreboard for chess mode."""
    return _normalize_scoreboard(scoreboard)


def _chess_player_color_from_first_player(first_player):
    """Return the human color based on who opens the chess game."""
    return "white" if first_player == "human" else "black"


def _chess_turn_from_color(color):
    """Return True for white and False for black."""
    return color == "white"


def _chess_result_status(board, player_color):
    """Return a human-readable final chess status string."""
    winner = get_chess_winner(board)

    if winner is None:
        return "Draw by stalemate, repetition, or insufficient material."

    if winner == player_color:
        return "Checkmate. You win."

    return "Checkmate. Computer wins."


def _update_chess_scoreboard(scoreboard, board, player_color):
    """Return the updated chess scoreboard after a completed game."""
    safe_scoreboard = _normalize_chess_scoreboard(scoreboard)
    winner = get_chess_winner(board)

    if winner is None:
        safe_scoreboard["draws"] += 1
    elif winner == player_color:
        safe_scoreboard["human"] += 1
    else:
        safe_scoreboard["computer"] += 1

    return safe_scoreboard


def _get_server_config():
    """Return host, port, and debug settings for the Flask server."""
    host = os.getenv("FLASK_HOST", "0.0.0.0").strip() or "0.0.0.0"

    try:
        port = int(os.getenv("PORT") or os.getenv("FLASK_PORT", "5000"))
    except ValueError:
        port = 5000

    debug = os.getenv("FLASK_DEBUG", "1").strip().lower() in {"1", "true", "yes", "on"}
    return host, port, debug


def _get_lan_ip():
    """Best-effort lookup for the machine's LAN IP address."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


@app.get("/")
def index():
    """Serve the home page."""
    return render_template(
        "home.html", 
        logged_in=bool(session.get("user_id")), 
        username=session.get("username")
    )


@app.get("/login")
def login_page():
    """Serve the login page."""
    if session.get("user_id"):
        return redirect("/")
    return render_template("login.html")


@app.get("/register")
def register_page():
    """Serve the register page."""
    if session.get("user_id"):
        return redirect("/")
    return render_template("register.html")


@app.get("/play")
def play():
    """Serve the main game application if logged in."""
    if not session.get("user_id"):
        return redirect("/login")
    return render_template("play.html")


# --- AUTH API ---

@app.post("/api/auth/register")
def register():
    _init_db()
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    question = payload.get("security_question", "").strip()
    answer = payload.get("security_answer", "").strip().lower() # lowercase for verification

    if not username or not password or not question or not answer:
        return jsonify({"error": "All fields are required."}), 400

    try:
        with _connect_db() as connection:
            connection.execute(
                "INSERT INTO users (username, password_hash, security_question, security_answer_hash) VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password), question, generate_password_hash(answer))
            )
            user_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
            session["user_id"] = user_id
            session["username"] = username
            return jsonify({"message": "User registered successfully."})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists."}), 400


@app.post("/api/auth/login")
def login():
    _init_db()
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")

    with _connect_db() as connection:
        user = connection.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,)).fetchone()
        if user:
            stored_password = user["password_hash"] or ""
            password_ok = False
            try:
                password_ok = check_password_hash(stored_password, password)
            except ValueError:
                # Backward compatibility for legacy plaintext passwords.
                password_ok = stored_password == password
            if password_ok:
                session["user_id"] = user["id"]
                session["username"] = username
                return jsonify({"message": "Login successful."})
    
    return jsonify({"error": "Invalid username or password."}), 401


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"message": "Logged out."})


@app.get("/api/auth/question")
def get_security_question():
    username = request.args.get("username", "").strip()
    with _connect_db() as connection:
        user = connection.execute("SELECT security_question FROM users WHERE username = ?", (username,)).fetchone()
        if user:
            return jsonify({"question": user["security_question"]})
    return jsonify({"error": "User not found."}), 404


@app.post("/api/auth/forgot-password")
def forgot_password():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    answer = payload.get("security_answer", "").strip().lower()
    new_password = payload.get("new_password", "")

    with _connect_db() as connection:
        user = connection.execute("SELECT id, security_answer_hash FROM users WHERE username = ?", (username,)).fetchone()
        if user and check_password_hash(user["security_answer_hash"], answer):
            connection.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (generate_password_hash(new_password), user["id"])
            )
            return jsonify({"message": "Password updated successfully."})
    
    return jsonify({"error": "Incorrect security answer."}), 401


@app.get("/api/user/profile")
def get_profile():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    
    try:
        with _connect_db() as connection:
            user = connection.execute("SELECT username, current_streak, best_streak, achievements FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                return jsonify({"error": "User not found"}), 404
            scoreboard, analysis = _get_overall_metrics(connection)
            
        return jsonify({
            "username": user["username"],
            "current_streak": user["current_streak"],
            "best_streak": user["best_streak"],
            "achievements": json.loads(user["achievements"] or "[]"),
            "scoreboard": scoreboard,
            "analysis": analysis
        })
    except Exception as e:
        app.logger.error(f"Profile error: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.post("/api/user/achievements")
def update_achievements():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    
    payload = request.get_json(silent=True) or {}
    achievements = payload.get("achievements", [])
    
    with _connect_db() as connection:
        connection.execute("UPDATE users SET achievements = ? WHERE id = ?", (json.dumps(achievements), user_id))
    
    return jsonify({"message": "Achievements updated."})


@app.get("/api/history")
def get_history():
    """Return a list of recently completed games for the current user."""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"games": []})

    _init_db()
    _migrate_legacy_json_if_needed()
    with _connect_db() as connection:
        rows = connection.execute(
            """
            SELECT saved_at, result, difficulty, game_mode 
            FROM game_history 
            WHERE user_id = ?
            ORDER BY id DESC 
            LIMIT 50
            """,
            (user_id,)
        ).fetchall()
        
    games = [
        {
            "saved_at": row["saved_at"],
            "result": row["result"],
            "difficulty": row["difficulty"],
            "game_mode": row["game_mode"] or "tictactoe"
        }
        for row in rows
    ]
    return jsonify({"games": games})


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
        _pause_before_ai_move()
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
        _persist_completed_game(state, analysis, "tictactoe")
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
        _persist_completed_game(state, analysis, "tictactoe")
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
        _persist_completed_game(state, analysis, "tictactoe")
        state["scoreboard"] = _get_overall_scoreboard()
        state["analysis"] = _get_overall_analysis()
        return jsonify(state)

    _pause_before_ai_move()
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
        _persist_completed_game(state, analysis, "tictactoe")
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
        _persist_completed_game(state, analysis, "tictactoe")
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


@app.post("/api/chess/new-game")
def new_chess_game():
    """Start a new chess game and optionally let the computer move first."""
    payload = request.get_json(silent=True) or {}
    first_player = _normalize_first_player(payload.get("firstPlayer"))
    difficulty = normalize_chess_difficulty(payload.get("difficulty"))
    player_color = _chess_player_color_from_first_player(first_player)
    scoreboard = _normalize_chess_scoreboard(payload.get("scoreboard"))
    board = create_chess_board()
    last_move = None
    status = "Your turn."

    if first_player == "computer":
        _pause_before_ai_move()
        computer_move = choose_chess_computer_move(board, difficulty)
        if computer_move is not None:
            board.push(computer_move)
            last_move = computer_move
        status = "Computer opens. Your turn."

    state = build_chess_game_state(
        board,
        status,
        player_color=player_color,
        difficulty=difficulty,
        scoreboard=scoreboard,
        last_move=last_move,
    )
    return jsonify(state)


@app.post("/api/chess/move")
def play_chess_move():
    """Apply the human chess move, answer with the computer move, and return the new state."""
    payload = request.get_json(silent=True) or {}
    difficulty = normalize_chess_difficulty(payload.get("difficulty"))
    player_color = normalize_player_color(payload.get("playerColor"))
    scoreboard = _normalize_chess_scoreboard(payload.get("scoreboard"))

    try:
        board = load_chess_board(payload.get("fen"))
        human_move = apply_chess_human_move(
            board,
            payload.get("fromSquare"),
            payload.get("toSquare"),
            player_color,
            payload.get("promotion", "q"),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if board.is_game_over(claim_draw=True):
        final_scoreboard = _update_chess_scoreboard(scoreboard, board, player_color)
        state = build_chess_game_state(
            board,
            _chess_result_status(board, player_color),
            player_color=player_color,
            difficulty=difficulty,
            scoreboard=final_scoreboard,
            last_move=human_move,
        )
        _persist_completed_game(state, {"optimalMoves": 0, "totalMoves": len(board.move_stack)}, "chess")
        return jsonify(state)

    if board.turn != _chess_turn_from_color(player_color):
        _pause_before_ai_move()
        computer_move = choose_chess_computer_move(board, difficulty)
        if computer_move is not None:
            board.push(computer_move)
        else:
            computer_move = human_move
    else:
        computer_move = human_move

    if board.is_game_over(claim_draw=True):
        final_scoreboard = _update_chess_scoreboard(scoreboard, board, player_color)
        status = _chess_result_status(board, player_color)
        state = build_chess_game_state(
            board,
            status,
            player_color=player_color,
            difficulty=difficulty,
            scoreboard=final_scoreboard,
            last_move=computer_move,
        )
        _persist_completed_game(state, {"optimalMoves": 0, "totalMoves": len(board.move_stack)}, "chess")
        return jsonify(state)

    state = build_chess_game_state(
        board,
        "Computer moved. Your turn." if computer_move != human_move else "Your turn.",
        player_color=player_color,
        difficulty=difficulty,
        scoreboard=scoreboard,
        last_move=computer_move,
    )
    return jsonify(state)


@app.get("/api/load")
def load_game():
    """Load the most recently completed game from the database."""
    current_state = _load_latest_completed_game()
    if current_state is None:
        return jsonify({"error": "No saved game was found."}), 404

    return jsonify(current_state)


@app.get("/api/health")
def health_check():
    """Return basic server status for remote connectivity checks."""
    host, port, _ = _get_server_config()
    return jsonify(
        {
            "status": "ok",
            "serverHost": host,
            "serverPort": port,
            "lanUrl": f"http://{_get_lan_ip()}:{port}",
        }
    )


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
    host, port, debug = _get_server_config()
    lan_ip = _get_lan_ip()

    print(f"Server starting on http://127.0.0.1:{port}")
    print(f"LAN access available at http://{lan_ip}:{port}")

    app.run(host=host, port=port, debug=debug)
