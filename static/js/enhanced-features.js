/* ============================================================
   BOARD GAMES HUB — ENHANCED FEATURES
   Additional features: Hints, Statistics, Leaderboard, Puzzles
   ============================================================ */

/* ========== HINT SYSTEM ========== */
const HintSystem = (function() {
    let hintCooldown = false;
    let currentHint = null;

    // Helper function to make API calls
    async function postJson(url, data) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });
        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");
        const payload = isJson ? await response.json() : null;

        if (!response.ok) {
            if (payload && payload.error) {
                throw new Error(payload.error);
            }
            const fallbackText = await response.text();
            throw new Error(fallbackText.trim() || "Request failed.");
        }

        if (!isJson) {
            const fallbackText = await response.text();
            throw new Error(fallbackText.trim() || "The server did not return JSON.");
        }

        return payload;
    }

    // Get the current TTT board state from the DOM
    function getCurrentTTTBoard() {
        const cells = document.querySelectorAll("#ttt-board .cell");
        const board = [];
        cells.forEach(cell => {
            const value = cell.dataset.value || cell.textContent || "";
            board.push(value === "X" ? "X" : value === "O" ? "O" : "");
        });
        return board;
    }

    async function getHint() {
        if (hintCooldown) {
            showTransientStatus("Please wait before requesting another hint.");
            return;
        }

        if (window.gameOver || window.boardLocked) {
            showTransientStatus("Cannot show hint right now.");
            return;
        }

        if (!window.gameMode) {
            showTransientStatus("Please select a game first.");
            return;
        }

        try {
            hintCooldown = true;

            if (window.gameMode === "chess") {
                // For chess, use the current FEN to get hint
                const fen = window.chessFen || "";
                if (!fen) {
                    showTransientStatus("Chess game not started yet.");
                    hintCooldown = false;
                    return;
                }
                
                const payload = await postJson("/api/chess/hint", { fen: fen });
                
                if (payload.move) {
                    showTransientStatus(
                        `♟️ Chess Hint: ${payload.move} - ${payload.explanation || "Best move based on analysis"}`,
                        statusElement.textContent
                    );
                    
                    if (payload.uci) {
                        const fromSq = payload.uci.substring(0, 2);
                        const toSq = payload.uci.substring(2, 4);
                        document.querySelectorAll(".chess-cell").forEach(cell => {
                            if (cell.dataset.square === fromSq || cell.dataset.square === toSq) {
                                cell.classList.add("hint-glow");
                                cell.style.animation = "hintPulse 0.5s ease-in-out 3";
                            }
                        });
                    }
                }
            } else if (window.gameMode === "tictactoe") {
                // For Tic-Tac-Toe, get board from DOM
                const currentBoard = getCurrentTTTBoard();
                
                const payload = await postJson("/api/hint", {
                    board: currentBoard
                });

                currentHint = payload;
                
                // Highlight the hinted cell
                highlightHintCell(payload.move);
                
                // Show hint info
                const confidenceEmoji = {
                    high: "✅",
                    medium: "⚡",
                    low: "💡"
                };
                
                showTransientStatus(
                    `${confidenceEmoji[payload.confidence] || "💡"} Hint: ${payload.coordinate} - ${payload.explanation}`,
                    statusElement.textContent
                );
            } else {
                showTransientStatus("Hints not available for this game mode.");
            }

            if (window.SoundFX) window.SoundFX.hint();

            setTimeout(() => {
                hintCooldown = false;
                clearHintHighlight();
            }, 5000);

        } catch (error) {
            console.error("Hint error:", error);
            showTransientStatus("Unable to get hint: " + (error.message || "Unknown error"));
            hintCooldown = false;
        }
    }

    function highlightHintCell(index) {
        const cells = document.querySelectorAll("#ttt-board .cell");
        if (cells[index]) {
            cells[index].classList.add("hint-glow");
            // Also add a subtle pulse animation
            cells[index].style.animation = "hintPulse 0.5s ease-in-out 3";
        }
    }

    function clearHintHighlight() {
        document.querySelectorAll(".hint-glow").forEach(el => {
            el.classList.remove("hint-glow");
            el.style.animation = "";
        });
    }

    return { getHint, clearHintHighlight };
})();

/* ========== STATISTICS SYSTEM ========== */
const StatisticsSystem = (function() {
    async function loadStatistics() {
        const content = document.getElementById("stats-content");
        if (!content) return;

        content.innerHTML = '<div class="stats-loading">Loading statistics...</div>';
        document.getElementById("statistics-overlay").classList.remove("is-hidden");

        try {
            const response = await fetch("/api/statistics");
            const data = await response.json();

            if (data.error) {
                content.innerHTML = `<p style="color:var(--muted);text-align:center;">${data.error}</p>`;
                return;
            }

            renderStatistics(data, content);
        } catch (error) {
            content.innerHTML = '<p style="color:var(--muted);text-align:center;">Error loading statistics.</p>';
        }
    }

    function renderStatistics(data, container) {
        const overall = data.overall;
        const byMode = data.by_game_mode;
        const byDiff = data.by_difficulty;
        const recentForm = data.recent_form || [];
        const trends = data.trends || [];

        // Form display
        const formDisplay = recentForm.length > 0 
            ? recentForm.map(r => `<span class="form-badge ${r.toLowerCase()}">${r}</span>`).join("")
            : '<span class="form-badge">—</span>';

        // Difficulty breakdown
        let diffHTML = "";
        for (const [diff, stats] of Object.entries(byDiff)) {
            if (stats.total > 0) {
                diffHTML += `
                    <div class="stat-row">
                        <span class="stat-label">${diff.charAt(0).toUpperCase() + diff.slice(1)}</span>
                        <span class="stat-value">${stats.win_rate}% (${stats.wins}/${stats.total})</span>
                    </div>
                `;
            }
        }

        // Trends
        let trendsHTML = "";
        if (trends.length > 0) {
            trendsHTML = `
                <div class="stats-section">
                    <h4>Recent Trends</h4>
                    <div class="trends-list">
                        ${trends.map(t => `
                            <div class="trend-item">
                                <span class="trend-date">${t.date || "Today"}</span>
                                <span class="trend-record">${t.wins}/${t.games} wins</span>
                                <div class="trend-bar">
                                    <div class="trend-fill" style="width:${t.win_rate}%"></div>
                                </div>
                                <span class="trend-rate">${t.win_rate}%</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="stats-overall">
                <div class="stat-card main-stat">
                    <span class="stat-number">${overall.total_games}</span>
                    <span class="stat-desc">Total Games</span>
                </div>
                <div class="stat-card win-stat">
                    <span class="stat-number">${overall.wins}</span>
                    <span class="stat-desc">Wins</span>
                </div>
                <div class="stat-card rate-stat">
                    <span class="stat-number">${overall.win_rate}%</span>
                    <span class="stat-desc">Win Rate</span>
                </div>
                <div class="stat-card streak-stat">
                    <span class="stat-number">🔥${overall.best_streak}</span>
                    <span class="stat-desc">Best Streak</span>
                </div>
            </div>

            <div class="stats-section">
                <h4>Recent Form</h4>
                <div class="form-display">${formDisplay}</div>
            </div>

            <div class="stats-grid">
                <div class="stats-section">
                    <h4>By Game Mode</h4>
                    <div class="stat-row">
                        <span class="stat-label">Tic-Tac-Toe</span>
                        <span class="stat-value">${byMode.tictactoe.win_rate}% (${byMode.tictactoe.wins}/${byMode.tictactoe.total})</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Chess</span>
                        <span class="stat-value">${byMode.chess.win_rate}% (${byMode.chess.wins}/${byMode.chess.total})</span>
                    </div>
                </div>

                <div class="stats-section">
                    <h4>By Difficulty</h4>
                    ${diffHTML || '<p style="color:var(--muted);font-size:0.85rem;">No data yet</p>'}
                </div>
            </div>

            ${trendsHTML}
        `;
    }

    return { loadStatistics };
})();

/* ========== LEADERBOARD SYSTEM ========== */
const LeaderboardSystem = (function() {
    async function loadLeaderboard() {
        const content = document.getElementById("leaderboard-content");
        if (!content) return;

        content.innerHTML = '<div class="stats-loading">Loading leaderboard...</div>';
        document.getElementById("leaderboard-overlay").classList.remove("is-hidden");

        try {
            const response = await fetch("/api/leaderboard");
            const data = await response.json();

            if (data.error) {
                content.innerHTML = `<p style="color:var(--muted);text-align:center;">${data.error}</p>`;
                return;
            }

            renderLeaderboard(data.leaderboard, content);
        } catch (error) {
            content.innerHTML = '<p style="color:var(--muted);text-align:center;">Error loading leaderboard.</p>';
        }
    }

    function renderLeaderboard(leaderboard, container) {
        if (leaderboard.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);text-align:center;">No players yet. Be the first!</p>';
            return;
        }

        const medals = ["🥇", "🥈", "🥉"];

        container.innerHTML = `
            <div class="leaderboard-list">
                ${leaderboard.map((entry, index) => {
                    const medal = index < 3 ? medals[index] : `#${entry.rank}`;
                    const isCurrentUser = entry.is_current_user;
                    
                    return `
                        <div class="leaderboard-entry ${isCurrentUser ? 'current-user' : ''}">
                            <span class="lb-rank">${medal}</span>
                            <span class="lb-username ${isCurrentUser ? 'highlight' : ''}">${entry.username}</span>
                            <span class="lb-rating">${entry.rating}</span>
                            <span class="lb-stats">
                                <span class="lb-wins">${entry.wins}W</span>
                                <span class="lb-rate">${entry.win_rate}%</span>
                            </span>
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    return { loadLeaderboard };
})();

/* ========== PUZZLES SYSTEM ========== */
const PuzzlesSystem = (function() {
    // Puzzle definitions
    const PUZZLES = {
        tictactoe: [
            {
                id: "ttt_win_2",
                name: "Win in 2 Moves",
                difficulty: "easy",
                description: "Find the winning sequence",
                board: ["X", "O", "X", "", "O", "", "", "", ""],
                solution: [6, 8] // Indices to click
            },
            {
                id: "ttt_block",
                name: "Block & Counter",
                difficulty: "medium",
                description: "Block opponent and set up win",
                board: ["X", "", "", "O", "X", "O", "", "", ""],
                solution: [6, 2]
            },
            {
                id: "ttt_perfect",
                name: "Perfect Endgame",
                difficulty: "hard",
                description: "Find the only winning path",
                board: ["X", "O", "", "", "X", "", "", "", "O"],
                solution: [2, 6, 8]
            }
        ],
        chess: [
            {
                id: "chess_mate_1",
                name: "Checkmate in 1",
                difficulty: "easy",
                description: "Find the checkmating move",
                fen: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1"
            },
            {
                id: "chess_mate_2",
                name: "Checkmate in 2",
                difficulty: "medium",
                description: "Force checkmate in 2 moves",
                fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1"
            },
            {
                id: "chess_best",
                name: "Find the Best Move",
                difficulty: "hard",
                description: "Find the strongest continuation",
                fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/3P1N2/PPP2PPP/RNB1K2R w KQkq - 0 1"
            }
        ]
    };

    function showPuzzles() {
        document.getElementById("puzzles-overlay").classList.remove("is-hidden");
    }

    function startPuzzle(puzzleId, gameMode) {
        // Close puzzle modal
        document.getElementById("puzzles-overlay").classList.add("is-hidden");
        
        // Switch to the game mode if needed
        if (window.gameMode !== gameMode) {
            // Would need to trigger game mode switch
            showTransientStatus("Switching to " + gameMode + " mode...");
        }
        
        showTransientStatus("Puzzle loaded! Good luck!");
    }

    return { showPuzzles, startPuzzle, PUZZLES };
})();

/* ========== VISUAL ENHANCEMENTS ========== */
const VisualEnhancements = (function() {
    // Board themes
    const THEMES = {
        classic: {
            light: "#ebecd0",
            dark: "#779556",
            name: "Classic Green"
        },
        blue: {
            light: "#dee3e6",
            dark: "#8ca2ad",
            name: "Ocean Blue"
        },
        brown: {
            light: "#f0d9b5",
            dark: "#b58863",
            name: "Wood Brown"
        },
        purple: {
            light: "#e8e0f0",
            dark: "#9b59b6",
            name: "Royal Purple"
        }
    };

    let currentTheme = "classic";

    function setTheme(themeName) {
        if (!THEMES[themeName]) return;
        currentTheme = themeName;
        
        const theme = THEMES[themeName];
        document.documentElement.style.setProperty("--chess-light", theme.light);
        document.documentElement.style.setProperty("--chess-dark", theme.dark);
        
        localStorage.setItem("board-theme", themeName);
    }

    function loadTheme() {
        const saved = localStorage.getItem("board-theme");
        if (saved && THEMES[saved]) {
            setTheme(saved);
        }
    }

    function getThemes() {
        return THEMES;
    }

    return { setTheme, loadTheme, getThemes };
})();

/* ========== INITIALIZATION ========== */
document.addEventListener("DOMContentLoaded", function() {
    // Hint button
    const hintBtn = document.getElementById("hint-btn");
    if (hintBtn) {
        hintBtn.addEventListener("click", () => {
            HintSystem.getHint();
        });
    }

    // Statistics button
    const statsBtn = document.getElementById("stats-btn");
    if (statsBtn) {
        statsBtn.addEventListener("click", () => {
            StatisticsSystem.loadStatistics();
        });
    }

    // Leaderboard button
    const leaderboardBtn = document.getElementById("leaderboard-btn");
    if (leaderboardBtn) {
        leaderboardBtn.addEventListener("click", () => {
            LeaderboardSystem.loadLeaderboard();
        });
    }

    // Puzzles button
    const puzzlesBtn = document.getElementById("puzzles-btn");
    if (puzzlesBtn) {
        puzzlesBtn.addEventListener("click", () => {
            PuzzlesSystem.showPuzzles();
        });
    }

    // Close buttons for modals
    document.getElementById("close-stats")?.addEventListener("click", () => {
        document.getElementById("statistics-overlay").classList.add("is-hidden");
    });

    document.getElementById("close-leaderboard")?.addEventListener("click", () => {
        document.getElementById("leaderboard-overlay").classList.add("is-hidden");
    });

    document.getElementById("close-puzzles")?.addEventListener("click", () => {
        document.getElementById("puzzles-overlay").classList.add("is-hidden");
    });

    // Close modals on overlay click
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.classList.add("is-hidden");
            }
        });
    });

    // Add click handlers to puzzle items
    document.querySelectorAll(".puzzle-item").forEach((item, index) => {
        item.addEventListener("click", () => {
            const puzzleName = item.querySelector(".puzzle-name")?.textContent || "Puzzle";
            const difficulty = item.querySelector(".puzzle-difficulty")?.textContent?.toLowerCase() || "medium";
            
            // Determine game mode based on category
            const category = item.closest(".puzzle-category");
            const isChess = category?.querySelector("h3")?.textContent?.toLowerCase().includes("chess");
            const gameMode = isChess ? "chess" : "tictactoe";
            
            // Close modal and show message
            document.getElementById("puzzles-overlay").classList.add("is-hidden");
            
            // Show puzzle start message
            showTransientStatus(`🧩 Starting puzzle: ${puzzleName} (${difficulty})`);
            
            // If not in the right game mode, switch to it
            if (window.gameMode !== gameMode) {
                const gameCard = document.querySelector(`[data-mode="${gameMode}"]`);
                if (gameCard) {
                    gameCard.click();
                }
            }
            
            // Start a new game with the appropriate difficulty
            setTimeout(() => {
                if (window.gameMode === gameMode) {
                    // Set difficulty based on puzzle
                    const diffMap = { 'easy': 'easy', 'medium': 'medium', 'hard': 'hard' };
                    const diffSelect = document.getElementById("difficulty");
                    if (diffSelect && diffMap[difficulty]) {
                        diffSelect.value = diffMap[difficulty];
                    }
                    // Start new round
                    document.getElementById("restart")?.click();
                }
            }, 300);
        });
    });

    // Load saved theme
    VisualEnhancements.loadTheme();

    // Expose to window for access from other scripts
    window.HintSystem = HintSystem;
    window.StatisticsSystem = StatisticsSystem;
    window.LeaderboardSystem = LeaderboardSystem;
    window.PuzzlesSystem = PuzzlesSystem;
    window.VisualEnhancements = VisualEnhancements;
});

/* ========== ADDITIONAL CSS STYLES ========== */
const additionalStyles = document.createElement("style");
additionalStyles.textContent = `
    /* Secondary actions row */
    .secondary-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 12px;
    }
    
    .secondary-actions .secondary-button {
        flex: 1;
        min-width: 120px;
        font-size: 0.9rem;
        padding: 12px 16px;
    }

    /* Stats content */
    .stats-content {
        margin-top: 20px;
    }

    .stats-loading {
        text-align: center;
        color: var(--muted);
        padding: 40px;
    }

    .stats-overall {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 24px;
    }

    .stat-card {
        background: rgba(255,255,255,0.05);
        border-radius: 12px;
        padding: 16px;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.1);
    }

    .stat-number {
        display: block;
        font-size: 1.8rem;
        font-weight: 700;
        color: #fff;
    }

    .stat-desc {
        font-size: 0.75rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .stats-section {
        margin-bottom: 20px;
    }

    .stats-section h4 {
        margin: 0 0 12px;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--accent);
    }

    .stat-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .stat-label {
        color: var(--text);
        font-weight: 500;
    }

    .stat-value {
        color: var(--muted);
        font-size: 0.9rem;
    }

    .form-display {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .form-badge {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.85rem;
    }

    .form-badge.w {
        background: rgba(52, 211, 153, 0.2);
        color: #34d399;
    }

    .form-badge.d {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
    }

    .form-badge.l {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    .trends-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .trend-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
    }

    .trend-date {
        font-size: 0.8rem;
        color: var(--muted);
        min-width: 60px;
    }

    .trend-record {
        font-size: 0.85rem;
        color: var(--text);
    }

    .trend-bar {
        flex: 1;
        height: 6px;
        background: rgba(255,255,255,0.1);
        border-radius: 3px;
        overflow: hidden;
    }

    .trend-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent), var(--human));
        border-radius: 3px;
        transition: width 0.5s ease;
    }

    .trend-rate {
        font-size: 0.8rem;
        color: var(--muted);
        min-width: 40px;
        text-align: right;
    }

    /* Leaderboard */
    .leaderboard-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 16px;
    }

    .leaderboard-entry {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(255,255,255,0.03);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
    }

    .leaderboard-entry.current-user {
        background: rgba(99, 102, 241, 0.1);
        border-color: rgba(99, 102, 241, 0.3);
    }

    .lb-rank {
        font-size: 1.2rem;
        min-width: 36px;
        text-align: center;
    }

    .lb-username {
        flex: 1;
        font-weight: 600;
        color: var(--text);
    }

    .lb-username.highlight {
        color: var(--accent);
    }

    .lb-rating {
        font-weight: 700;
        color: var(--accent);
        min-width: 50px;
        text-align: right;
    }

    .lb-stats {
        display: flex;
        gap: 8px;
        font-size: 0.85rem;
        color: var(--muted);
    }

    /* Puzzles */
    .puzzles-content {
        margin-top: 20px;
    }

    .puzzle-category {
        margin-bottom: 24px;
    }

    .puzzle-category h3 {
        margin: 0 0 12px;
        font-size: 1rem;
        color: var(--accent);
    }

    .puzzle-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .puzzle-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: rgba(255,255,255,0.03);
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.08);
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .puzzle-item:hover {
        background: rgba(255,255,255,0.08);
        border-color: var(--accent);
        transform: translateX(4px);
    }

    .puzzle-name {
        font-weight: 600;
        color: var(--text);
    }

    .puzzle-difficulty {
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
    }

    .puzzle-difficulty.easy {
        background: rgba(52, 211, 153, 0.2);
        color: #34d399;
    }

    .puzzle-difficulty.medium {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
    }

    .puzzle-difficulty.hard {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    /* Stats grid */
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
    }

    /* Hint glow effect */
    .hint-glow {
        box-shadow: 0 0 15px rgba(99, 102, 241, 0.8), 0 0 30px rgba(99, 102, 241, 0.4) !important;
        border-color: rgba(99, 102, 241, 0.8) !important;
    }

    @keyframes hintPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
    }

    @media (max-width: 560px) {
        .stats-overall {
            grid-template-columns: repeat(2, 1fr);
        }
        
        .stats-grid {
            grid-template-columns: 1fr;
        }
        
        .secondary-actions {
            flex-direction: column;
        }
        
        .secondary-actions .secondary-button {
            width: 100%;
        }
    }
`;
document.head.appendChild(additionalStyles);
