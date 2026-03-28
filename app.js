const HUMAN = "X";
const TICTACTOE_MOVE_ENDPOINT = "/api/move";
const TICTACTOE_NEW_GAME_ENDPOINT = "/api/new-game";
const CHESS_MOVE_ENDPOINT = "/api/chess/move";
const CHESS_NEW_GAME_ENDPOINT = "/api/chess/new-game";
const RESET_DATA_ENDPOINT = "/api/reset-data";
const CHESS_SCORE_STORAGE_KEY = "board-games-chess-scoreboard";

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
const boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");
const scoreElement = document.getElementById("score");
const restartButton = document.getElementById("restart");
const changeGameButton = document.getElementById("change-game");
const resetScoreButton = document.getElementById("reset-score");
const firstPlayerSelect = document.getElementById("first-player");
const difficultySelect = document.getElementById("difficulty");
const sideCardElement = document.getElementById("side-card");
const sideIndicatorElement = document.getElementById("side-indicator");
const sideHelperElement = document.getElementById("side-helper");
const gameTitleElement = document.getElementById("game-title");
const gameSubtitleElement = document.getElementById("game-subtitle");
const setupHintElement = document.getElementById("setup-hint");
const gameCardButtons = document.querySelectorAll("[data-mode]");

function createEmptyScoreboard() {
    return {
        human: 0,
        computer: 0,
        draws: 0,
    };
}

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

let gameMode = null;
let board = [];
let gameOver = false;
let boardLocked = false;
let previousCells = [];
let winningLine = null;
let activeRequestToken = 0;
let statusFlashTimer = null;
let chessFen = "";
let chessTurn = "white";
let chessPlayerColor = "white";
let chessLegalMoves = {};
let chessSelectedSquare = null;
let chessLastMove = null;
let moveCount = 0;

function getActiveSession() {
    return sessions[gameMode];
}

function updateModePresentation() {
    const config = MODE_CONFIG[gameMode];
    document.title = `${config.title} | Board Games Hub`;
    document.body.classList.toggle("mode-chess", gameMode === "chess");
    gameTitleElement.textContent = config.title;
    gameSubtitleElement.textContent = config.subtitle;
    setupHintElement.textContent = config.hint;
    restartButton.textContent = config.restartLabel;
    resetScoreButton.textContent = config.resetLabel;
    sideCardElement.classList.toggle("is-hidden", gameMode !== "chess");
}

function setGameMode(mode) {
    gameMode = mode in MODE_CONFIG ? mode : "tictactoe";
    updateModePresentation();
    createBoard();
    updateScore();
}

function showGamePicker() {
    activeRequestToken += 1;
    gameMode = null;
    document.body.classList.remove("mode-chess");
    board = [];
    gameOver = false;
    boardLocked = false;
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
    boardElement.className = `board ${gameMode === "chess" ? "chess-board" : "tictactoe-board"}`;

    const totalCells = gameMode === "chess" ? 64 : 9;
    for (let index = 0; index < totalCells; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `cell ${gameMode === "chess" ? "chess-cell" : "tic-cell"}`;
        button.setAttribute("role", "gridcell");
        button.dataset.index = String(index);
        button.setAttribute("aria-label", gameMode === "chess" ? `Chess square ${index + 1}` : `Cell ${index + 1}`);
        button.addEventListener("click", () => {
            if (gameMode === "chess") {
                const square = button.dataset.square || "";
                void handleChessSelection(square);
                return;
            }

            void handleHumanMove(index);
        });
        boardElement.appendChild(button);
    }
}

function updateScore() {
    const scoreboard = getActiveSession().scoreboard;
    scoreElement.textContent = `You ${scoreboard.human} - ${scoreboard.computer} Computer | Draws ${scoreboard.draws}`;
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
    if (gameMode === "chess") {
        return moveCount > 0;
    }

    return board.some((cell) => cell !== "");
}

function updateControlStates() {
    const lockSetup = hasRoundStarted() && !gameOver;
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
    if (gameMode !== "chess") {
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

    if (gameMode === "chess") {
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
            cell.disabled = gameOver || boardLocked;
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
        cell.disabled = gameOver || boardLocked || value !== "";
        cell.classList.remove("winning");

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

    if (gameMode === "tictactoe" && payload.analysis) {
        session.analysis = {
            ...createEmptyAnalysis(),
            ...payload.analysis,
        };
    }

    if (gameMode === "chess") {
        saveChessScoreboard();
    }

    updateScore();
}

function applyRoundData(payload) {
    if (gameMode === "chess") {
        chessPlayerColor = typeof payload.playerColor === "string" ? payload.playerColor : "white";
        board = orientChessBoard(payload.board, chessPlayerColor);
        gameOver = Boolean(payload.gameOver);
        chessFen = typeof payload.fen === "string" ? payload.fen : "";
        chessTurn = typeof payload.turn === "string" ? payload.turn : "white";
        chessLegalMoves = payload.legalMoves && typeof payload.legalMoves === "object" ? payload.legalMoves : {};
        chessLastMove = payload.lastMove && typeof payload.lastMove === "object" ? payload.lastMove : null;
        chessSelectedSquare = null;
        moveCount = Number.isInteger(payload.moveCount) ? payload.moveCount : 0;
        winningLine = null;
    } else {
        board = Array.isArray(payload.board) ? [...payload.board] : Array(9).fill("");
        gameOver = Boolean(payload.gameOver);
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
        window.setTimeout(() => window.alert(payload.status || "Game Over!"), 50);
    } else if (gameMode === "chess" && payload.isCheck) {
        window.setTimeout(() => window.alert("Check!"), 50);
    }
}

function syncBoardLock(payload) {
    if (gameMode === "chess") {
        boardLocked = !payload.gameOver && payload.turn !== payload.playerColor;
        return;
    }

    boardLocked = false;
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

async function handleHumanMove(index) {
    if (gameOver || boardLocked || board[index] !== "") {
        return;
    }

    const requestBoard = [...board];
    const requestToken = ++activeRequestToken;
    board[index] = HUMAN;
    winningLine = null;
    boardLocked = true;
    renderBoard();
    updateStatus("Computer is thinking...");

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

        applySessionData(payload);
        applyRoundData(payload);
        syncBoardLock(payload);
        renderBoard();
    } catch (error) {
        if (requestToken !== activeRequestToken) {
            return;
        }

        board = requestBoard;
        gameOver = false;
        boardLocked = false;
        winningLine = null;
        renderBoard();
        updateStatus(error.message || "Something went wrong.");
    }
}

async function handleChessSelection(square) {
    if (!square || gameOver || boardLocked) {
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
    const requestToken = ++activeRequestToken;
    const previousSelection = chessSelectedSquare;
    const requestBoard = board.map(cell => ({ ...cell }));
    const previousLastMove = chessLastMove ? { ...chessLastMove } : null;

    boardLocked = true;
    chessSelectedSquare = null;

    const fromIndex = board.findIndex(c => c.square === fromSquare);
    const toIndex = board.findIndex(c => c.square === move.to);
    if (fromIndex !== -1 && toIndex !== -1) {
        board[toIndex] = { ...board[toIndex], piece: board[fromIndex].piece, icon: board[fromIndex].icon, color: board[fromIndex].color };
        board[fromIndex] = { ...board[fromIndex], piece: "", icon: "", color: "" };
        chessLastMove = { from: fromSquare, to: move.to };
    }

    renderBoard();
    updateStatus("Computer is thinking...");

    try {
        const payload = await postJson(CHESS_MOVE_ENDPOINT, {
            fen: chessFen,
            fromSquare,
            toSquare: move.to,
            promotion: move.promotion || "q",
            playerColor: chessPlayerColor,
            difficulty: difficultySelect.value,
            scoreboard: sessions.chess.scoreboard,
        });

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

        board = requestBoard;
        chessLastMove = previousLastMove;
        chessSelectedSquare = previousSelection;
        boardLocked = false;
        renderBoard();
        updateStatus(error.message || "Unable to play that chess move.");
    }
}

async function startRound() {
    const requestToken = ++activeRequestToken;
    board = [];
    gameOver = false;
    boardLocked = true;
    winningLine = null;
    previousCells = [];
    chessSelectedSquare = null;
    chessLastMove = null;
    moveCount = 0;

    if (gameMode === "tictactoe") {
        sessions.tictactoe.analysis = createEmptyAnalysis();
    }

    renderBoard();
    updateStatus(gameMode === "chess" ? "Setting up the board..." : "Starting round...");

    try {
        const payload = await postJson(
            gameMode === "chess" ? CHESS_NEW_GAME_ENDPOINT : TICTACTOE_NEW_GAME_ENDPOINT,
            gameMode === "chess"
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

        board = gameMode === "chess" ? [] : Array(9).fill("");
        gameOver = false;
        boardLocked = false;
        winningLine = null;
        renderBoard();
        updateStatus(error.message || "Unable to start a new game.");
    }
}

async function resetAllData() {
    const restoreMessage = statusElement.textContent;

    try {
        if (gameMode === "chess") {
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
    if (hasRoundStarted() && !gameOver) {
        showTransientStatus("Opening order will apply next game.");
        return;
    }

    void startRound();
});

difficultySelect.addEventListener("change", () => {
    if (hasRoundStarted() && !gameOver) {
        showTransientStatus("Difficulty change will apply next game.");
        return;
    }

    void startRound();
});

showGamePicker();
