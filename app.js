const HUMAN = "X";
const MOVE_ENDPOINT = "/api/move";
const NEW_GAME_ENDPOINT = "/api/new-game";
const RESET_DATA_ENDPOINT = "/api/reset-data";

const boardElement = document.getElementById("board");
const statusElement = document.getElementById("status");
const scoreElement = document.getElementById("score");
const restartButton = document.getElementById("restart");
const resetScoreButton = document.getElementById("reset-score");
const firstPlayerSelect = document.getElementById("first-player");
const difficultySelect = document.getElementById("difficulty");

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

let board = Array(9).fill("");
let gameOver = false;
let boardLocked = false;
let previousBoard = Array(9).fill("");
let winningLine = null;
let activeRequestToken = 0;
let statusFlashTimer = null;
let scoreboard = createEmptyScoreboard();
let analysis = createEmptyAnalysis();

function createBoard() {
    boardElement.innerHTML = "";

    for (let index = 0; index < 9; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", `Cell ${index + 1}`);
        button.dataset.index = String(index);
        button.addEventListener("click", () => {
            void handleHumanMove(index);
        });
        boardElement.appendChild(button);
    }
}

function updateScore() {
    scoreElement.textContent = `You ${scoreboard.human} - ${scoreboard.computer} Computer | Draws ${scoreboard.draws}`;
}

function updateAnalysis() {
    // AI analytics stay in app state and the backend save file, but are hidden from the player UI.
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
    }, 1600);
}

function updateControlStates() {
    const roundStarted = board.some((cell) => cell !== "");
    const lockSetup = roundStarted && !gameOver;
    firstPlayerSelect.disabled = lockSetup;
    difficultySelect.disabled = lockSetup;
}

function renderBoard() {
    const cells = boardElement.querySelectorAll(".cell");

    cells.forEach((cell, index) => {
        const value = board[index];
        cell.textContent = value;
        cell.dataset.value = value;
        cell.disabled = gameOver || boardLocked || value !== "";
        cell.classList.remove("winning");

        if (value !== "" && value !== previousBoard[index]) {
            cell.classList.add("pop-in");
            window.setTimeout(() => cell.classList.remove("pop-in"), 180);
        }
    });

    if (winningLine) {
        winningLine.forEach((index) => {
            cells[index].classList.add("winning");
        });
    }

    previousBoard = [...board];
    updateControlStates();
}

function applySessionData(payload) {
    if (payload.scoreboard) {
        scoreboard = {
            ...createEmptyScoreboard(),
            ...payload.scoreboard,
        };
    }

    if (payload.analysis) {
        analysis = {
            ...createEmptyAnalysis(),
            ...payload.analysis,
        };
    }

    updateScore();
    updateAnalysis();
}

function applyRoundData(payload) {
    board = Array.isArray(payload.board) ? [...payload.board] : Array(9).fill("");
    gameOver = Boolean(payload.gameOver);
    winningLine = Array.isArray(payload.winningLine) ? payload.winningLine : null;

    if (typeof payload.firstPlayer === "string") {
        firstPlayerSelect.value = payload.firstPlayer;
    }

    if (typeof payload.difficulty === "string") {
        difficultySelect.value = payload.difficulty;
    }

    renderBoard();
    updateStatus(payload.status || "Your turn");
}

function getSessionState() {
    return {
        board,
        status: statusElement.textContent,
        gameOver,
        winningLine,
        firstPlayer: firstPlayerSelect.value,
        difficulty: difficultySelect.value,
        scoreboard,
        analysis,
    };
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
        const payload = await postJson(MOVE_ENDPOINT, {
            board: requestBoard,
            move: index,
            firstPlayer: firstPlayerSelect.value,
            difficulty: difficultySelect.value,
            scoreboard,
            analysis,
        });

        if (requestToken !== activeRequestToken) {
            return;
        }

        applySessionData(payload);
        boardLocked = Boolean(payload.gameOver);
        applyRoundData(payload);
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

async function startRound() {
    const requestToken = ++activeRequestToken;
    board = Array(9).fill("");
    gameOver = false;
    boardLocked = true;
    winningLine = null;
    previousBoard = Array(9).fill("");
    analysis = createEmptyAnalysis();
    renderBoard();
    updateStatus("Starting round...");

    try {
        const payload = await postJson(NEW_GAME_ENDPOINT, {
            firstPlayer: firstPlayerSelect.value,
            difficulty: difficultySelect.value,
            scoreboard,
            analysis,
        });

        if (requestToken !== activeRequestToken) {
            return;
        }

        applySessionData(payload);
        boardLocked = false;
        applyRoundData(payload);
    } catch (error) {
        if (requestToken !== activeRequestToken) {
            return;
        }

        board = Array(9).fill("");
        gameOver = false;
        boardLocked = false;
        winningLine = null;
        renderBoard();
        updateStatus(error.message || "Unable to start a new round.");
    }
}

async function resetAllData() {
    const restoreMessage = statusElement.textContent;

    try {
        await postJson(RESET_DATA_ENDPOINT, {});
        scoreboard = createEmptyScoreboard();
        analysis = createEmptyAnalysis();
        updateScore();
        updateAnalysis();
        await startRound();
    } catch (error) {
        showTransientStatus(error.message || "Unable to reset stored data.", restoreMessage);
    }
}

restartButton.addEventListener("click", () => {
    void startRound();
});

resetScoreButton.addEventListener("click", () => {
    void resetAllData();
});

firstPlayerSelect.addEventListener("change", () => {
    const roundStarted = board.some((cell) => cell !== "");
    if (roundStarted && !gameOver) {
        showTransientStatus("Opening order will apply next round.");
        return;
    }

    void startRound();
});

difficultySelect.addEventListener("change", () => {
    const roundStarted = board.some((cell) => cell !== "");
    if (roundStarted && !gameOver) {
        showTransientStatus("Difficulty change will apply next round.");
        return;
    }

    void startRound();
});

createBoard();
updateScore();
updateAnalysis();
void startRound();
