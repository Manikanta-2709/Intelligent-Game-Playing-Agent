const HUMAN = "X";
const COMPUTER = "O";
const TICTACTOE_MOVE_ENDPOINT = "/api/move";
const TICTACTOE_NEW_GAME_ENDPOINT = "/api/new-game";
const CHESS_MOVE_ENDPOINT = "/api/chess/move";
const CHESS_NEW_GAME_ENDPOINT = "/api/chess/new-game";
const RESET_DATA_ENDPOINT = "/api/reset-data";
const CHESS_SCORE_STORAGE_KEY = "board-games-chess-scoreboard";

let twoPlayerMode = false;
let chessLastHumanMoveAlg = "";
let chessLastComputerMoveAlg = "";
let chessMovePairPending = false;

const MODE_CONFIG = {
    tictactoe: {
        title: "Tic-Tac-Toe",
        subtitle: "Claim three in a row before the computer does. Your game auto-saves as you play, and you can choose who starts and how challenging the computer should be.",
        hint: "Progress auto-saves after every move and every new round.",
        restartLabel: "New Round",
        resetLabel: "Reset All Data",
    },
    chess: {
        title: "Chess",
        subtitle: "Play a full chess match against the computer. Choose who moves first, set the AI difficulty, and click one of your pieces to reveal its legal targets.",
        hint: "Chess scores are saved in your browser for this device. Click a piece, then click a highlighted target square to move.",
        restartLabel: "New Match",
        resetLabel: "Reset Chess Score",
    },
};

const gamePickerElement = document.getElementById("game-picker");
const gameViewElement = document.getElementById("game-view");
// board element is determined per-mode (chess vs ttt)
let boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");
const scoreElement = document.getElementById("score");
const restartButton = document.getElementById("restart");
const changeGameButton = document.getElementById("change-game");
const resetScoreButton = document.getElementById("reset-score");
const firstPlayerSelect = document.getElementById("first-player");
window.difficultySelect = document.getElementById("difficulty");
const sideCardElement = document.getElementById("side-card");
const sideIndicatorElement = document.getElementById("side-indicator");
const sideHelperElement = document.getElementById("side-helper");
const gameTitleElement = document.getElementById("game-title");
const gameSubtitleElement = document.getElementById("game-subtitle");
const setupHintElement = document.getElementById("setup-hint");
const gameCardButtons = document.querySelectorAll("[data-mode]");
const twoPlayerToggle = document.getElementById("two-player-toggle");
const hintBtn = document.getElementById("hint-btn");
const moveHistoryPanel = document.getElementById("move-history-panel");
const chessCoordsEl = document.getElementById("chess-coords");
const tttBoardWrap = document.getElementById("ttt-board-wrap");

function createEmptyScoreboard() {
    return {
        human: 0,
        computer: 0,
        draws: 0,
    };
}

function getTTTCoord(index) {
    const labels = ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3"];
    return labels[index] || index;
}

window.syncGameScoreboard = function(profile) {
    if (profile && profile.scoreboard) {
        sessions.tictactoe.scoreboard = profile.scoreboard;
        // Only update UI if a game mode is already active
        if (window.gameMode) {
            updateScore();
        }
    }
};


function createEmptyAnalysis() {
    return {
        optimalMoves: 0,
        totalMoves: 0,
        accuracyScore: 0,
        performanceScore: 0,
        record: "0W 0D 0L",
    };
}

function loadChessScoreboard() {
    try {
        const saved = window.localStorage.getItem(CHESS_SCORE_STORAGE_KEY);
        if (!saved) {
            return createEmptyScoreboard();
        }

        const parsed = JSON.parse(saved);
        return {
            ...createEmptyScoreboard(),
            ...parsed,
        };
    } catch (error) {
        return createEmptyScoreboard();
    }
}

function saveChessScoreboard() {
    window.localStorage.setItem(CHESS_SCORE_STORAGE_KEY, JSON.stringify(sessions.chess.scoreboard));
}

const sessions = {
    tictactoe: {
        scoreboard: createEmptyScoreboard(),
        analysis: createEmptyAnalysis(),
    },
    chess: {
        scoreboard: loadChessScoreboard(),
    },
};

window.gameMode = null;
let board = [];
window.gameOver = false;
window.boardLocked = false;
let previousCells = [];
let winningLine = null;
let activeRequestToken = 0;
let statusFlashTimer = null;
window.chessFen = "";
let chessTurn = "white";
let chessPlayerColor = "white";
let chessLegalMoves = {};
let chessSelectedSquare = null;
let chessLastMove = null;
window.moveCount = 0;

function getActiveSession() {
    return sessions[window.gameMode];
}

function updateModePresentation() {
    const config = MODE_CONFIG[window.gameMode];
    document.title = `${config.title} | Board Games Hub`;
    document.body.classList.toggle("mode-chess", window.gameMode === "chess");
    gameTitleElement.textContent = config.title;
    gameSubtitleElement.textContent = config.subtitle;
    setupHintElement.textContent = config.hint;
    restartButton.textContent = config.restartLabel;
    resetScoreButton.textContent = config.resetLabel;
    sideCardElement.classList.toggle("is-hidden", window.gameMode !== "chess");

    // Show/hide chess-specific UI
    const isChess = window.gameMode === "chess";
    if (chessCoordsEl) chessCoordsEl.classList.toggle("is-hidden", !isChess);
    if (tttBoardWrap) tttBoardWrap.classList.toggle("is-hidden", isChess);
    if (moveHistoryPanel) moveHistoryPanel.classList.remove("is-hidden"); // Always show history

    const historyEyebrow = document.querySelector("#move-history-panel .eyebrow");
    if (historyEyebrow) historyEyebrow.textContent = isChess ? "Chess Notation" : "Move Sequence";

    // Reassign board element for correct mode
    boardElement = isChess
        ? document.getElementById("board")
        : document.getElementById("ttt-board");
}

function setGameMode(mode) {
    window.gameMode = mode in MODE_CONFIG ? mode : "tictactoe";
    updateModePresentation();
    createBoard();
    updateScore();
}

function showGamePicker() {
    activeRequestToken += 1;
    window.gameMode = null;
    document.body.classList.remove("mode-chess");
    board = [];
    window.gameOver = false;
    window.boardLocked = false;
    winningLine = null;
    previousCells = [];
    chessSelectedSquare = null;
    chessLastMove = null;
    moveCount = 0;
    document.title = "Board Games Hub";
    gamePickerElement.classList.remove("is-hidden");
    gameViewElement.classList.add("is-hidden");
}

async function enterGame(mode) {
    setGameMode(mode);
    gamePickerElement.classList.add("is-hidden");
    gameViewElement.classList.remove("is-hidden");
    await startRound();
}

function createBoard() {
    boardElement.innerHTML = "";
    boardElement.className = `board ${window.gameMode === "chess" ? "chess-board" : "tictactoe-board"}`;

    const totalCells = window.gameMode === "chess" ? 64 : 9;
    for (let index = 0; index < totalCells; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `cell ${gameMode === "chess" ? "chess-cell" : "tic-cell"}`;
        button.setAttribute("role", "gridcell");
        button.dataset.index = String(index);
        button.setAttribute("aria-label", window.gameMode === "chess" ? `Chess square ${index + 1}` : `Cell ${index + 1}`);
        button.addEventListener("click", () => {
            if (window.gameMode === "chess") {
                const square = button.dataset.square || "";
                void handleChessSelection(square);
                return;
            }

            if (twoPlayerMode) {
                void handleTwoPlayerMove(index);
                return;
            }
            void handleHumanMove(index);
        });
        boardElement.appendChild(button);
    }
}

function updateScore() {
    const session = getActiveSession();
    if (!session) return;
    const scoreboard = session.scoreboard;
    if (scoreElement) {
        scoreElement.textContent = `You ${scoreboard.human} - ${scoreboard.computer} Computer | Draws ${scoreboard.draws}`;
    }
}

function updateStatus(message) {
    statusElement.textContent = message;
}

function showTransientStatus(message, restoreMessage = statusElement.textContent) {
    if (statusFlashTimer !== null) {
        window.clearTimeout(statusFlashTimer);
    }

    updateStatus(message);
    statusFlashTimer = window.setTimeout(() => {
        if (statusElement.textContent === message) {
            updateStatus(restoreMessage);
        }
    }, 1800);
}

function hasRoundStarted() {
    if (window.gameMode === "chess") {
        return window.moveCount > 0;
    }

    return board.some((cell) => cell !== "");
}

function updateControlStates() {
    const lockSetup = hasRoundStarted() && !window.gameOver;
    firstPlayerSelect.disabled = lockSetup;
    difficultySelect.disabled = lockSetup;
}

function getChessCell(square) {
    return board.find((cell) => cell.square === square);
}

function orientChessBoard(cells, playerColor) {
    const safeCells = Array.isArray(cells) ? [...cells] : [];
    return playerColor === "black" ? safeCells.reverse() : safeCells;
}

function updateSideIndicator() {
    if (window.gameMode !== "chess") {
        sideCardElement.classList.add("is-hidden");
        return;
    }

    const playerSide = chessPlayerColor === "black" ? "Black" : "White";
    const computerSide = chessPlayerColor === "black" ? "White" : "Black";
    sideCardElement.classList.remove("is-hidden");
    sideIndicatorElement.textContent = `You are ${playerSide}`;
    sideHelperElement.textContent = `Your side stays at the bottom. ${computerSide} is shown at the top, and the last move is highlighted.`;
}

function renderBoard() {
    const cells = boardElement.querySelectorAll(".cell");

    if (window.gameMode === "chess") {
        const targetSquares = new Set(
            chessSelectedSquare ? (chessLegalMoves[chessSelectedSquare] || []).map((move) => move.to) : []
        );
        const recentMoveSquares = new Set(chessLastMove ? [chessLastMove.from, chessLastMove.to] : []);

        cells.forEach((cell, index) => {
            const value = board[index] || {};
            const icon = value.icon || "";
            const piece = value.piece || "";
            const isWhitePiece = value.color === "white";
            const isBlackPiece = value.color === "black";

            cell.textContent = icon;
            cell.dataset.square = value.square || "";
            cell.dataset.value = piece;
            cell.classList.toggle("light", Boolean(value.isLight));
            cell.classList.toggle("dark", !value.isLight);
            cell.classList.toggle("piece-white", isWhitePiece);
            cell.classList.toggle("piece-black", isBlackPiece);
            cell.classList.toggle("selected", value.square === chessSelectedSquare);
            cell.classList.toggle("target", targetSquares.has(value.square));
            cell.classList.toggle("recent-move", recentMoveSquares.has(value.square));
            cell.disabled = window.gameOver || window.boardLocked;
        });

        previousCells = board.map((cell) => cell.piece || "");
        updateSideIndicator();
        updateControlStates();
        return;
    }

    cells.forEach((cell, index) => {
        const value = board[index] || "";
        cell.textContent = value;
        cell.dataset.value = value;
        cell.disabled = window.gameOver || window.boardLocked || value !== "" || (twoPlayerMode ? false : false);
        cell.classList.remove("winning");
        window._currentTTTBoard = [...board];

        if (value !== "" && value !== previousCells[index]) {
            cell.classList.add("pop-in");
            window.setTimeout(() => cell.classList.remove("pop-in"), 180);
        }
    });

    if (winningLine) {
        winningLine.forEach((index) => {
            cells[index].classList.add("winning");
        });
    }

    previousCells = [...board];
    sideCardElement.classList.add("is-hidden");
    updateControlStates();
}

function applySessionData(payload) {
    const session = getActiveSession();

    if (payload.scoreboard) {
        session.scoreboard = {
            ...createEmptyScoreboard(),
            ...payload.scoreboard,
        };
    }

    if (window.gameMode === "tictactoe" && payload.analysis) {
        session.analysis = {
            ...createEmptyAnalysis(),
            ...payload.analysis,
        };
    }

    if (window.gameMode === "chess") {
        saveChessScoreboard();
    }

    updateScore();
}

function applyRoundData(payload) {
    if (window.gameMode === "chess") {
        chessPlayerColor = typeof payload.playerColor === "string" ? payload.playerColor : "white";
        board = orientChessBoard(payload.board, chessPlayerColor);
        window.gameOver = Boolean(payload.gameOver);
        window.chessFen = typeof payload.fen === "string" ? payload.fen : "";
        chessTurn = typeof payload.turn === "string" ? payload.turn : "white";
        chessLegalMoves = payload.legalMoves && typeof payload.legalMoves === "object" ? payload.legalMoves : {};
        chessLastMove = payload.lastMove && typeof payload.lastMove === "object" ? payload.lastMove : null;
        if (payload.moveQuality) {
            sessions.chess.moveQualities = sessions.chess.moveQualities || [];
            sessions.chess.moveQualities.push(payload.moveQuality);
        }
        if (typeof window.buildChessCoords === "function") window.buildChessCoords(chessPlayerColor);
        chessSelectedSquare = null;
        window.moveCount = Number.isInteger(payload.moveCount) ? payload.moveCount : 0;
        winningLine = null;
    } else {
        board = Array.isArray(payload.board) ? [...payload.board] : Array(9).fill("");
        window.gameOver = Boolean(payload.gameOver);
        winningLine = Array.isArray(payload.winningLine) ? payload.winningLine : null;

        if (typeof payload.firstPlayer === "string") {
            firstPlayerSelect.value = payload.firstPlayer;
        }

        if (typeof payload.difficulty === "string") {
            difficultySelect.value = payload.difficulty;
        }
    }

    renderBoard();
    updateStatus(payload.status || "Your turn");
    updateSideIndicator();

    if (payload.gameOver) {
        window.setTimeout(() => {
            if (typeof window.showGameOverModal === "function") {
                window.showGameOverModal(payload, window.gameMode, twoPlayerMode);
            }
        }, 300);
    } else if (window.gameMode === "chess" && payload.isCheck) {
        updateStatus("⚠️ Check! " + (payload.status || ""));
        if (typeof window.SoundFX !== "undefined") window.SoundFX.check();
    }
}

function syncBoardLock(payload) {
    if (window.gameMode === "chess") {
        window.boardLocked = !payload.gameOver && payload.turn !== payload.playerColor;
        return;
    }

    window.boardLocked = false;
}

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

// Two-player local mode
let twoPlayerTurn = "X";
async function handleTwoPlayerMove(index) {
    if (window.gameOver || board[index] !== "") return;
    board[index] = twoPlayerTurn;
    winningLine = null;
    renderBoard();
    if (window.SoundFX) window.SoundFX.move();
    window._currentTTTBoard = [...board];

    // Check win/draw
    const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const winner = WINS.some(c=>c.every(i=>board[i]===twoPlayerTurn)) ? twoPlayerTurn : null;
    const isDraw = !winner && board.every(c=>c!=="");
    if (winner || isDraw) {
        window.gameOver = true;
        if (winner) {
            const wLabel = twoPlayerTurn === "X" ? "Player 1 wins!" : "Player 2 wins!";
            updateStatus(wLabel);
            const line = WINS.find(c=>c.every(i=>board[i]===twoPlayerTurn));
            winningLine = line || null;
            renderBoard();
            if (typeof window.showGameOverModal === "function") {
                const fakePayload = { status: wLabel, gameOver:true, draw:false, analysis:{accuracyScore:50,totalMoves:board.filter(c=>c).length} };
                setTimeout(() => window.showGameOverModal(fakePayload, window.gameMode, true), 300);
            }
        } else {
            updateStatus("It's a draw!");
            if (typeof window.showGameOverModal === "function") {
                const fakePayload = { status:"It's a draw!", gameOver:true, draw:true, analysis:{accuracyScore:50,totalMoves:9} };
                setTimeout(() => window.showGameOverModal(fakePayload, window.gameMode, true), 300);
            }
        }
        return;
    }
    twoPlayerTurn = twoPlayerTurn === "X" ? "O" : "X";
    updateStatus(twoPlayerTurn === "X" ? "Player 1's turn (X)" : "Player 2's turn (O)");
}

async function handleHumanMove(index) {
    if (window.gameOver || window.boardLocked || board[index] !== "") {
        return;
    }

    const requestBoard = [...board];
    const requestToken = ++activeRequestToken;
    board[index] = HUMAN;
    winningLine = null;
    window.boardLocked = true;
    renderBoard();
    if (window.SoundFX) window.SoundFX.move();
    updateStatus("Computer is thinking...");
    window._currentTTTBoard = [...board];

    try {
        const payload = await postJson(TICTACTOE_MOVE_ENDPOINT, {
            board: requestBoard,
            move: index,
            firstPlayer: firstPlayerSelect.value,
            difficulty: difficultySelect.value,
            scoreboard: sessions.tictactoe.scoreboard,
            analysis: sessions.tictactoe.analysis,
        });

        if (requestToken !== activeRequestToken) {
            return;
        }

        const compIndex = payload.board.findIndex((cell, i) => cell === COMPUTER && board[i] === "");
        if (typeof window.pushMoveHistory === "function") {
            window.pushMoveHistory(getTTTCoord(index), compIndex !== -1 ? getTTTCoord(compIndex) : "");
        }

        applySessionData(payload);
        applyRoundData(payload);
        syncBoardLock(payload);
        renderBoard();
    } catch (error) {
        if (requestToken !== activeRequestToken) {
            return;
        }

        board = requestBoard;
        window.gameOver = false;
        window.boardLocked = false;
        winningLine = null;
        renderBoard();
        updateStatus(error.message || "Something went wrong.");
    }
}

async function handleChessSelection(square) {
    if (!square || window.gameOver || window.boardLocked) {
        return;
    }

    const selectedTargets = chessSelectedSquare ? chessLegalMoves[chessSelectedSquare] || [] : [];
    const chosenMove = selectedTargets.find((move) => move.to === square);
    if (chosenMove) {
        await submitChessMove(chessSelectedSquare, chosenMove);
        return;
    }

    if (chessSelectedSquare === square) {
        chessSelectedSquare = null;
        renderBoard();
        return;
    }

    const cell = getChessCell(square);
    if (cell && cell.color === chessPlayerColor) {
        if ((chessLegalMoves[square] || []).length === 0) {
            showTransientStatus("That piece has no legal moves.");
            return;
        }

        chessSelectedSquare = square;
        renderBoard();
        return;
    }

    chessSelectedSquare = null;
    renderBoard();
}

async function submitChessMove(fromSquare, move) {
    // Pawn promotion dialog
    const fromIndex0 = board.findIndex(c => c.square === fromSquare);
    const pawnPiece = fromIndex0 !== -1 ? board[fromIndex0].piece : "";
    const isPawnPromotion = (pawnPiece === "P" && move.to && move.to[1] === "8") ||
                            (pawnPiece === "p" && move.to && move.to[1] === "1");
    let promotion = move.promotion || "q";
    if (isPawnPromotion && typeof window.showPromotionDialog === "function") {
        promotion = await window.showPromotionDialog();
    }

    const requestToken = ++activeRequestToken;
    const previousSelection = chessSelectedSquare;
    const requestBoard = board.map(cell => ({ ...cell }));
    const previousLastMove = chessLastMove ? { ...chessLastMove } : null;

    window.boardLocked = true;
    chessSelectedSquare = null;

    const fromIndex = board.findIndex(c => c.square === fromSquare);
    const toIndex = board.findIndex(c => c.square === move.to);
    const isCapture = toIndex !== -1 && board[toIndex].piece !== "";
    if (fromIndex !== -1 && toIndex !== -1) {
        board[toIndex] = { ...board[toIndex], piece: board[fromIndex].piece, icon: board[fromIndex].icon, color: board[fromIndex].color };
        board[fromIndex] = { ...board[fromIndex], piece: "", icon: "", color: "" };
        chessLastMove = { from: fromSquare, to: move.to };
    }

    if (window.SoundFX) { isCapture ? window.SoundFX.capture() : window.SoundFX.move(); }

    // Track human move for history (algebraic-style)
    chessLastHumanMoveAlg = fromSquare + "→" + move.to + (isPawnPromotion ? "=" + promotion.toUpperCase() : "");
    chessMovePairPending = true;

    renderBoard();
    updateStatus("Computer is thinking...");
    const _promotion = promotion;

    try {
        const payload = await postJson(CHESS_MOVE_ENDPOINT, {
            fen: window.chessFen,
            fromSquare,
            toSquare: move.to,
            promotion: _promotion || "q",
            playerColor: chessPlayerColor,
            difficulty: difficultySelect.value,
            scoreboard: sessions.chess.scoreboard,
        });

        if (requestToken !== activeRequestToken) {
            return;
        }

        applySessionData(payload);
        // Track computer move for history
        if (chessMovePairPending && payload.lastMove) {
            const lm = payload.lastMove;
            const compAlg = lm.from + "→" + lm.to;
            if (typeof window.pushMoveHistory === "function") {
                window.pushMoveHistory(chessLastHumanMoveAlg, compAlg, payload.moveQuality);
            }
            chessMovePairPending = false;
        }
        applyRoundData(payload);
        syncBoardLock(payload);
        renderBoard();
    } catch (error) {
        if (requestToken !== activeRequestToken) {
            return;
        }

        board = requestBoard;
        chessLastMove = previousLastMove;
        chessSelectedSquare = previousSelection;
        window.boardLocked = false;
        chessMovePairPending = false;
        renderBoard();
        updateStatus(error.message || "Unable to play that chess move.");
    }
}

async function startRound() {
    if (typeof currentUser !== "undefined" && !currentUser) {
        if (typeof showModal === "function") showModal();
        return;
    }

    const requestToken = ++activeRequestToken;
    board = [];
    window.gameOver = false;
    window.boardLocked = true;
    winningLine = null;
    previousCells = [];
    chessSelectedSquare = null;
    chessLastMove = null;
    window.moveCount = 0;
    twoPlayerTurn = "X";
    chessMovePairPending = false;
    chessLastHumanMoveAlg = "";

    if (typeof window.resetMoveHistory === "function") window.resetMoveHistory();

    twoPlayerMode = twoPlayerToggle ? twoPlayerToggle.checked : false;
    if (twoPlayerMode && window.gameMode === "tictactoe") {
        updateStatus("Player 1's turn (X)");
    }

    if (window.gameMode === "tictactoe") {
        sessions.tictactoe.analysis = createEmptyAnalysis();
        window._currentTTTBoard = Array(9).fill("");
    } else if (window.gameMode === "chess") {
        sessions.chess.moveQualities = [];
    }

    renderBoard();
    updateStatus(window.gameMode === "chess" ? "Setting up the board..." : "Starting round...");

    try {
        const payload = await postJson(
            window.gameMode === "chess" ? CHESS_NEW_GAME_ENDPOINT : TICTACTOE_NEW_GAME_ENDPOINT,
            window.gameMode === "chess"
                ? {
                    firstPlayer: firstPlayerSelect.value,
                    difficulty: difficultySelect.value,
                    scoreboard: sessions.chess.scoreboard,
                }
                : {
                    firstPlayer: firstPlayerSelect.value,
                    difficulty: difficultySelect.value,
                    scoreboard: sessions.tictactoe.scoreboard,
                    analysis: sessions.tictactoe.analysis,
                }
        );

        if (requestToken !== activeRequestToken) {
            return;
        }

        applySessionData(payload);
        applyRoundData(payload);
        syncBoardLock(payload);
        renderBoard();
    } catch (error) {
        if (requestToken !== activeRequestToken) {
            return;
        }

        board = window.gameMode === "chess" ? [] : Array(9).fill("");
        window.gameOver = false;
        window.boardLocked = false;
        winningLine = null;
        renderBoard();
        updateStatus(error.message || "Unable to start a new game.");
    }
}

async function resetAllData() {
    const restoreMessage = statusElement.textContent;

    try {
        if (window.gameMode === "chess") {
            sessions.chess.scoreboard = createEmptyScoreboard();
            saveChessScoreboard();
            updateScore();
            await startRound();
            return;
        }

        await postJson(RESET_DATA_ENDPOINT, {});
        sessions.tictactoe.scoreboard = createEmptyScoreboard();
        sessions.tictactoe.analysis = createEmptyAnalysis();
        updateScore();
        await startRound();
    } catch (error) {
        showTransientStatus(error.message || "Unable to reset stored data.", restoreMessage);
    }
}

restartButton.addEventListener("click", () => {
    void startRound();
});

changeGameButton.addEventListener("click", () => {
    showGamePicker();
});

resetScoreButton.addEventListener("click", () => {
    void resetAllData();
});

gameCardButtons.forEach((button) => {
    button.addEventListener("click", () => {
        void enterGame(button.dataset.mode || "tictactoe");
    });
});

firstPlayerSelect.addEventListener("change", () => {
    if (hasRoundStarted() && !window.gameOver) {
        showTransientStatus("Opening order will apply next game.");
        return;
    }

    void startRound();
});

difficultySelect.addEventListener("change", () => {
    if (hasRoundStarted() && !window.gameOver) {
        showTransientStatus("Difficulty change will apply next game.");
        return;
    }

    void startRound();
});

// Accuracy Click
const scoreBox = document.getElementById("score");
if (scoreBox) {
    scoreBox.style.cursor = "pointer";
    scoreBox.title = "Click to view detailed accuracy analysis";
    scoreBox.addEventListener("click", () => {
        if (typeof window.showAccuracyModal === "function") {
            window.showAccuracyModal();
        }
    });
}

showGamePicker();
