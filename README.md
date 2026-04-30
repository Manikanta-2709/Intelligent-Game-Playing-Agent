# Intelligent Game Playing Agent

A feature-rich Flask web application for playing Tic-Tac-Toe and Chess against an intelligent AI opponent.

## 🎮 Features

### Core Games
- **Tic-Tac-Toe** - Classic 3x3 game with AI opponent
- **Chess** - Full chess game with legal move validation

### 🆕 Premium Features

#### AI & Strategy
- **6 Difficulty Levels**: Beginner, Easy, Medium, Hard, Expert, Grandmaster
- **AI Move Hints**: Get suggestions for optimal moves with explanations
- **Performance Analysis**: Detailed accuracy tracking and move quality assessment

#### Statistics & Analytics
- **Comprehensive Statistics Dashboard**: Win rates, recent form, trends
- **Game History**: Track all your games with detailed records
- **Leaderboard System**: Compete with other players (ELO-style rating)

#### Learning & Challenges
- **Puzzle Mode**: Daily challenges for both Tic-Tac-Toe and Chess
- **Move-by-move Analysis**: Review your games with AI commentary
- **Achievement System**: Unlock badges for various accomplishments

#### User Experience
- **User Authentication**: Secure login/register with password recovery
- **Win Streaks**: Track your best winning streaks
- **Sound Effects**: Immersive audio feedback
- **Responsive Design**: Works on desktop, tablet, and mobile

## 🚀 Quick Start

### Prerequisites
- Python 3.7+
- pip (Python package manager)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Manikanta-2709/Intelligent-Game-Playing-Agent.git
cd Intelligent-Game-Playing-Agent
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the application:
```bash
python app.py
```

4. Open your browser and navigate to:
```
http://127.0.0.1:5000
```

### LAN Access
The server automatically provides a LAN URL for access from other devices on the same network. Check the terminal output for the LAN address (e.g., `http://192.168.1.10:5000`).

## 📋 API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/question` - Get security question for password recovery
- `POST /api/auth/forgot-password` - Reset password

### Game Play
- `POST /api/new-game` - Start a new Tic-Tac-Toe round
- `POST /api/move` - Play a move in Tic-Tac-Toe
- `POST /api/chess/new-game` - Start a new Chess match
- `POST /api/chess/move` - Play a move in Chess

### Features
- `POST /api/hint` - Get AI hint for best move (Tic-Tac-Toe)
- `GET /api/statistics` - Get comprehensive player statistics
- `GET /api/leaderboard` - Get leaderboard rankings
- `GET /api/game-replay/<game_id>` - Get game data for replay
- `GET /api/history` - Get game history
- `GET /api/load` - Load the most recent completed game

### System
- `GET /api/health` - Check server status
- `POST /api/reset-data` - Clear all stored data

## 🎯 Difficulty Levels

| Level | Description | AI Accuracy |
|-------|-------------|-------------|
| Beginner | Mostly random moves | ~15% optimal |
| Easy | Some strategic play | ~35% optimal |
| Medium | Balanced gameplay | ~70% optimal |
| Hard | Strong opponent | ~90% optimal |
| Expert | Very challenging | ~95% optimal |
| Grandmaster | Near-perfect play | ~100% optimal |

## 🏆 Achievement System

Unlock achievements by:
- 🏆 **First Win** - Win your first game
- 🔥 **Hat Trick** - Win 3 games in a row
- 🎯 **Perfect Game** - 100% move accuracy in Tic-Tac-Toe
- ♟️ **Chess Master** - Beat the AI on Hard difficulty
- ⚡ **Speed Demon** - Win a chess game in under 20 moves
- 🤝 **Peacemaker** - Draw 3 games
- 💪 **Come Back** - Win after a loss
- 🕊️ **The Pacifist** - Win without letting AI get 2 in a row
- ⚔️ **The Executioner** - Capture opponent's queen in first 15 moves
- 🛡️ **Unyielding** - Win on Hard difficulty in 40+ moves

## 🛠️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASK_HOST` | `0.0.0.0` | Server host address |
| `FLASK_PORT` | `5000` | Server port |
| `FLASK_DEBUG` | `1` | Debug mode (1=on, 0=off) |
| `FLASK_SECRET_KEY` | `dev-secret-key-12345` | Session secret key |
| `APP_DATA_DIR` | (project root) | Directory for database storage |

### Example with custom settings:
```bash
FLASK_PORT=8080 FLASK_DEBUG=0 python app.py
```

## 📁 Project Structure

```
Intelligent-Game-Playing-Agent/
├── app.py              # Main Flask application
├── game_logic.py       # Tic-Tac-Toe game logic with AI
├── chess_logic.py      # Chess game logic with AI
├── templates/          # HTML templates
│   ├── home.html       # Landing page
│   ├── login.html      # Login page
│   ├── register.html   # Registration page
│   └── play.html       # Main game interface
├── static/
│   ├── css/
│   │   └── styles.css  # Main stylesheet
│   ├── js/
│   │   ├── app.js      # Main game logic
│   │   ├── auth.js     # Authentication handling
│   │   ├── features.js # UI features & effects
│   │   └── enhanced-features.js # Premium features
│   └── images/         # Game assets
├── requirements.txt    # Python dependencies
└── render.yaml         # Render deployment config
```

## 🌐 Deployment

### Render Deployment
This project includes a `render.yaml` configuration for easy deployment to Render:

1. Push your code to GitHub
2. Import the repository in Render as a Web Service
3. Render will automatically detect the configuration
4. Deploy!

### Other Platforms
The app can be deployed to any platform that supports Python/Flask:
- Heroku
- AWS Elastic Beanstalk
- Google Cloud Run
- DigitalOcean App Platform

## 📊 Database

The application uses SQLite for data persistence:
- User accounts and authentication
- Game history and statistics
- Achievements and streaks
- Leaderboard data

## 🔒 Security

- Password hashing with Werkzeug
- Session-based authentication
- CSRF protection via Flask sessions
- Input validation and sanitization
- Security questions for password recovery

## 📱 Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Mobile browsers

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - Feel free to use and modify for your projects.

## 🙏 Acknowledgments

- Chess piece images from Chess.com
- Flask framework and community
- python-chess library for chess logic

## 📧 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Enjoy playing!** 🎮