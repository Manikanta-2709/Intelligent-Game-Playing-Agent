"""WebSocket-based multiplayer functionality for real-time game play."""

from flask import Flask, session, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import json
import time
from datetime import datetime

# Initialize Socket.IO
socketio = SocketIO(cors_allowed_origins="*", async_mode="threading")

# Store active games and players
active_games = {}
player_sessions = {}
game_queue = []

def init_socketio(app):
    """Initialize Socket.IO with the Flask app."""
    socketio.init_app(app, cors_allowed_origins="*")
    return socketio


@socketio.on('connect')
def handle_connect():
    """Handle client connection."""
    print(f"Client connected: {request.sid}")
    emit('connected', {'sid': request.sid})


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    print(f"Client disconnected: {request.sid}")
    
    # Remove from player sessions
    if request.sid in player_sessions:
        game_id = player_sessions[request.sid].get('game_id')
        if game_id and game_id in active_games:
            # Notify opponent
            opponent_sid = get_opponent_sid(request.sid, game_id)
            if opponent_sid:
                emit('opponent_disconnected', room=opponent_sid)
            # Clean up game
            del active_games[game_id]
        del player_sessions[request.sid]


@socketio.on('join_queue')
def handle_join_queue(data):
    """Add player to matchmaking queue."""
    user_id = session.get('user_id')
    username = session.get('username', 'Anonymous')
    
    player_info = {
        'sid': request.sid,
        'user_id': user_id,
        'username': username,
        'rating': data.get('rating', 1200),
        'game_mode': data.get('game_mode', 'tictactoe'),
        'joined_at': time.time()
    }
    
    game_queue.append(player_info)
    player_sessions[request.sid] = {'status': 'queueing', 'info': player_info}
    
    # Try to find a match
    find_match()


@socketio.on('leave_queue')
def handle_leave_queue():
    """Remove player from matchmaking queue."""
    global game_queue
    game_queue = [p for p in game_queue if p['sid'] != request.sid]
    if request.sid in player_sessions:
        player_sessions[request.sid]['status'] = 'idle'


@socketio.on('make_move')
def handle_make_move(data):
    """Handle a player's move in an active game."""
    game_id = data.get('game_id')
    move = data.get('move')
    
    if game_id not in active_games:
        emit('error', {'message': 'Game not found'})
        return
    
    game = active_games[game_id]
    
    # Verify it's the player's turn
    if game['current_turn'] != request.sid:
        emit('error', {'message': 'Not your turn'})
        return
    
    # Update game state
    game['moves'].append({
        'player': request.sid,
        'move': move,
        'timestamp': time.time()
    })
    
    # Switch turns
    game['current_turn'] = get_opponent_sid(request.sid, game_id)
    
    # Broadcast move to both players
    emit('move_made', {
        'game_id': game_id,
        'move': move,
        'player': request.sid,
        'board': game['board']
    }, room=game_id)
    
    # Check for game end
    if check_game_over(game):
        winner = determine_winner(game)
        game['status'] = 'completed'
        game['winner'] = winner
        
        emit('game_over', {
            'game_id': game_id,
            'winner': winner,
            'board': game['board']
        }, room=game_id)


@socketio.on('offer_draw')
def handle_draw_offer(data):
    """Handle a draw offer."""
    game_id = data.get('game_id')
    
    if game_id not in active_games:
        return
    
    game = active_games[game_id]
    opponent_sid = get_opponent_sid(request.sid, game_id)
    
    if opponent_sid:
        emit('draw_offer', {
            'game_id': game_id,
            'from_player': request.sid
        }, room=opponent_sid)


@socketio.on('accept_draw')
def handle_accept_draw(data):
    """Accept a draw offer."""
    game_id = data.get('game_id')
    
    if game_id not in active_games:
        return
    
    game = active_games[game_id]
    game['status'] = 'completed'
    game['winner'] = 'draw'
    
    emit('game_over', {
        'game_id': game_id,
        'winner': 'draw',
        'board': game['board']
    }, room=game_id)


@socketio.on('resign')
def handle_resign(data):
    """Handle player resignation."""
    game_id = data.get('game_id')
    
    if game_id not in active_games:
        return
    
    game = active_games[game_id]
    game['status'] = 'completed'
    game['winner'] = get_opponent_sid(request.sid, game_id)
    
    emit('game_over', {
        'game_id': game_id,
        'winner': game['winner'],
        'board': game['board'],
        'reason': 'resignation'
    }, room=game_id)


@socketio.on('chat_message')
def handle_chat(data):
    """Handle chat messages in a game room."""
    game_id = data.get('game_id')
    message = data.get('message')
    
    if game_id in active_games:
        emit('chat_message', {
            'game_id': game_id,
            'from': request.sid,
            'message': message,
            'timestamp': time.time()
        }, room=game_id)


@socketio.on('get_game_state')
def handle_get_game_state(data):
    """Send current game state to a player."""
    game_id = data.get('game_id')
    
    if game_id in active_games:
        game = active_games[game_id]
        emit('game_state', {
            'game_id': game_id,
            'board': game['board'],
            'current_turn': game['current_turn'],
            'players': game['players'],
            'moves': game['moves']
        })


# Helper functions

def find_match():
    """Try to find matching players in the queue."""
    global game_queue
    
    if len(game_queue) < 2:
        return
    
    # Simple matching: first two players with same game mode
    for i, p1 in enumerate(game_queue):
        for j, p2 in enumerate(game_queue[i+1:], i+1):
            if p1['game_mode'] == p2['game_mode']:
                # Found a match!
                create_game(p1, p2)
                game_queue = [p for p in game_queue if p['sid'] not in [p1['sid'], p2['sid']]]
                return


def create_game(player1, player2):
    """Create a new game between two players."""
    import uuid
    
    game_id = str(uuid.uuid4())
    
    # Determine who goes first (lower rating goes first for fairness)
    first_player = player1 if player1['rating'] <= player2['rating'] else player2
    second_player = player2 if first_player == player1 else player1
    
    game = {
        'id': game_id,
        'mode': player1['game_mode'],
        'players': {
            player1['sid']: {'username': player1['username'], 'rating': player1['rating']},
            player2['sid']: {'username': player2['username'], 'rating': player2['rating']}
        },
        'board': [] if player1['game_mode'] == 'tictactoe' else None,  # Will be initialized
        'current_turn': first_player['sid'],
        'moves': [],
        'status': 'active',
        'winner': None,
        'created_at': time.time()
    }
    
    active_games[game_id] = game
    
    # Update player sessions
    for p in [player1, player2]:
        player_sessions[p['sid']] = {
            'status': 'playing',
            'game_id': game_id,
            'info': p
        }
    
    # Join room
    join_room(game_id)
    
    # Notify both players
    emit('game_found', {
        'game_id': game_id,
        'opponent': {
            'sid': player2['sid'] if player1['sid'] == request.sid else player1['sid'],
            'username': player2['username'] if player1['sid'] == request.sid else player1['username']
        },
        'you_are': first_player['sid'],
        'game_mode': player1['game_mode']
    }, room=player1['sid'])
    
    emit('game_found', {
        'game_id': game_id,
        'opponent': {
            'sid': player1['sid'],
            'username': player1['username']
        },
        'you_are': second_player['sid'],
        'game_mode': player1['game_mode']
    }, room=player2['sid'])


def get_opponent_sid(player_sid, game_id):
    """Get the opponent's socket ID."""
    if game_id not in active_games:
        return None
    
    game = active_games[game_id]
    for sid in game['players']:
        if sid != player_sid:
            return sid
    return None


def check_game_over(game):
    """Check if the game has ended."""
    # This would integrate with game_logic.py for actual win/draw detection
    # Simplified for now
    return False


def determine_winner(game):
    """Determine the winner of the game."""
    # This would integrate with game_logic.py
    return None


# API endpoints for multiplayer

def create_multiplayer_routes(app):
    """Create Flask routes for multiplayer features."""
    
    @app.route('/api/multiplayer/status')
    def multiplayer_status():
        """Get current multiplayer status."""
        return jsonify({
            'online_players': len(player_sessions),
            'active_games': len(active_games),
            'queue_length': len(game_queue)
        })
    
    @app.route('/api/multiplayer/games')
    def get_active_games():
        """Get list of active games (for spectating)."""
        games = []
        for game_id, game in active_games.items():
            if game['status'] == 'active':
                games.append({
                    'id': game_id,
                    'mode': game['mode'],
                    'players': list(game['players'].values()),
                    'moves_count': len(game['moves'])
                })
        return jsonify({'games': games})