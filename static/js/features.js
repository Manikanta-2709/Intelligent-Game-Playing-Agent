/* ============================================================
   BOARD GAMES HUB — FEATURE EXTENSIONS
   ============================================================ */

/* ---------- PARTICLES ---------- */
(function initParticles() {
  const canvas = document.getElementById("particles-canvas");
  const ctx = canvas.getContext("2d");
  let W, H, particles = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function getColor() {
    return document.body.classList.contains("mode-chess")
      ? "rgba(16,185,129,"
      : "rgba(99,102,241,";
  }

  function makeParticle() {
    return {
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      a: Math.random() * 0.5 + 0.1
    };
  }

  for (let i = 0; i < 55; i++) particles.push(makeParticle());

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const col = getColor();
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = col + p.a + ")";
      ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > W) p.dx *= -1;
      if (p.y < 0 || p.y > H) p.dy *= -1;
    }
    requestAnimationFrame(draw);
  }
  draw();

  window.burstParticles = function() {
    for (let i = 0; i < 12; i++) {
      const p = makeParticle();
      p.dx = (Math.random() - 0.5) * 3;
      p.dy = (Math.random() - 0.5) * 3;
      particles.push(p);
    }
    setTimeout(() => { particles = particles.slice(0, 55); }, 2000);
  };
})();

/* ---------- SOUND ---------- */
const SoundFX = (function() {
  let ctx = null;
  let muted = localStorage.getItem("bgHub-muted") === "1";

  async function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  }

  async function tone(freq, type, duration, gain) {
    if (muted) return;
    try {
      const ac = await getCtx();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.connect(g); g.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + duration);
    } catch(e) {
      console.error("Audio error:", e);
    }
  }

  const el = document.getElementById("sound-toggle");
  function updateBtn() {
    if (!el) return;
    el.textContent = muted ? "🔇" : "🔊";
    el.classList.toggle("muted", muted);
  }
  updateBtn();
  if (el) el.addEventListener("click", () => {
    muted = !muted;
    localStorage.setItem("bgHub-muted", muted ? "1" : "0");
    updateBtn();
  });

  return {
    move()    { tone(440, "triangle", 0.12, 0.15); },
    capture() { tone(300, "sawtooth", 0.22, 0.18); },
    win()     { [523,659,784].forEach((f,i)=>setTimeout(()=>tone(f,"sine",0.4,0.2),i*120)); },
    lose()    { [523,440,330].forEach((f,i)=>setTimeout(()=>tone(f,"triangle",0.35,0.15),i*130)); },
    draw()    { tone(400,"sine",0.5,0.12); },
    check()   { tone(880,"square",0.15,0.12); },
    hint()    { tone(600,"sine",0.2,0.1); }
  };
})();
window.SoundFX = SoundFX;

/* ---------- WIN STREAK ---------- */
const Streak = (function() {
  let cur = 0;
  let best = 0;

  function render() {
    const el = document.getElementById("streak-badge");
    if (!el) return;
    if (cur >= 2) {
      el.textContent = "🔥 " + cur + " streak";
      el.classList.remove("is-hidden");
    } else {
      el.classList.add("is-hidden");
    }
  }
  return {
    win()  { cur++; if (cur > best) best = cur; render(); },
    reset(){ cur = 0; render(); },
    get()  { return { cur, best }; },
    sync(c, b) { cur = c; best = b; render(); },
    render
  };
})();
window.Streak = Streak;

/* ---------- ACHIEVEMENTS ---------- */
const Achievements = (function() {
  const DEFS = [
    { id:"first_win",    icon:"🏆", name:"First Win",      check:(s)=> s.wins >= 1 },
    { id:"hat_trick",    icon:"🔥", name:"Hat Trick",       check:(s)=> s.streak >= 3 },
    { id:"perfect_ttt",  icon:"🎯", name:"Perfect Game",    check:(s)=> s.accuracy >= 100 && s.game==="tictactoe" },
    { id:"chess_hard",   icon:"♟️", name:"Chess Master",    check:(s)=> s.game==="chess" && s.won && s.diff==="hard" },
    { id:"speed_demon",  icon:"⚡", name:"Speed Demon",     check:(s)=> s.game==="chess" && s.won && s.moves <= 20 },
    { id:"peacemaker",   icon:"🤝", name:"Peacemaker",      check:(s)=> s.draws >= 3 },
    { id:"come_back",    icon:"💪", name:"Come Back",       check:(s)=> s.wins >= 1 && s.prevLoss },
  ];

  let unlocked = [];

  function check(state) {
    if (typeof currentUser !== "undefined" && !currentUser) return; // Need login
    let changed = false;
    for (const def of DEFS) {
      if (!unlocked.includes(def.id) && def.check(state)) {
        unlocked.push(def.id);
        changed = true;
        showToast(def);
      }
    }
    if (changed) {
      fetch("/api/user/achievements", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ achievements: unlocked })
      }).catch(e => console.error(e));
    }
  }

  function showToast(def) {
    const container = document.getElementById("achievement-container");
    if (!container) return;
    const t = document.createElement("div");
    t.className = "achievement-toast";
    t.innerHTML = `<span class="toast-icon">${def.icon}</span>
      <div class="toast-body">
        <div class="toast-title">Achievement Unlocked</div>
        <div class="toast-name">${def.name}</div>
      </div>`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add("toast-out");
      setTimeout(() => t.remove(), 400);
    }, 3500);
  }

  return { 
    check,
    sync(achievements) { unlocked = achievements || []; }
  };
})();
window.Achievements = Achievements;

window.syncGameFeatures = function(user) {
    if (!user) return;
    Streak.sync(user.current_streak || 0, user.best_streak || 0);
    Achievements.sync(user.achievements || []);
};

/* ---------- CONFETTI ---------- */
function runConfetti(canvas) {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext("2d");
  const pieces = Array.from({length:80}, ()=>({
    x: Math.random()*canvas.width, y: -10,
    w: Math.random()*8+4, h: Math.random()*5+3,
    r: Math.random()*Math.PI*2,
    dr: (Math.random()-.5)*.2,
    dx: (Math.random()-.5)*4,
    dy: Math.random()*3+2,
    color: ["#6366f1","#38bdf8","#34d399","#fbbf24","#f87171"][Math.floor(Math.random()*5)]
  }));
  let frame;
  function tick() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const p of pieces){
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.r);
      ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
      p.x+=p.dx; p.y+=p.dy; p.r+=p.dr;
    }
    if(pieces.some(p=>p.y<canvas.height)) frame=requestAnimationFrame(tick);
  }
  tick();
  setTimeout(()=>{ cancelAnimationFrame(frame); ctx.clearRect(0,0,canvas.width,canvas.height); },4000);
}

/* ---------- GAME-OVER MODAL ---------- */
function getRating(acc) {
  if (acc >= 90) return { label:"Grandmaster", grade:"grade-s" };
  if (acc >= 75) return { label:"Expert", grade:"grade-a" };
  if (acc >= 55) return { label:"Intermediate", grade:"grade-b" };
  if (acc >= 35) return { label:"Beginner", grade:"grade-c" };
  return { label:"Novice", grade:"grade-d" };
}
function getChessRating(won, diff, moves) {
  if (won && diff==="hard")   return { label:"Grandmaster", grade:"grade-s" };
  if (won && diff==="medium") return { label:"Expert", grade:"grade-a" };
  if (won && diff==="easy")   return { label:"Intermediate", grade:"grade-b" };
  if (!won && diff==="hard")  return { label:"Strong Player", grade:"grade-b" };
  if (!won)                   return { label:"Learner", grade:"grade-c" };
  return { label:"Player", grade:"grade-d" };
}
function getComment(result, acc) {
  if (result==="win") {
    if (acc>=90) return "Flawless play! You dominated every move.";
    if (acc>=75) return "Excellent performance! Very few mistakes.";
    if (acc>=55) return "Good game! Keep practising to sharpen your edge.";
    return "You won — but there's room to improve your accuracy.";
  }
  if (result==="draw") return "Well balanced game! Draws against an AI are no small feat.";
  if (acc>=75) return "Tough loss, but your moves were sharp. Try again!";
  if (acc>=50) return "Good effort! Analyse your mistakes and come back stronger.";
  return "Keep playing — practice makes perfect!";
}

window.showGameOverModal = function(payload, gameMode, twoPlayerMode) {
  const overlay  = document.getElementById("gameover-overlay");
  const icon     = document.getElementById("gameover-icon");
  const eyebrow  = document.getElementById("gameover-eyebrow");
  const title    = document.getElementById("gameover-title");
  const subtitle = document.getElementById("gameover-subtitle");
  const badge    = document.getElementById("perf-rating-badge");
  const acc      = document.getElementById("perf-accuracy");
  const movesEl  = document.getElementById("perf-moves");
  const barFill  = document.getElementById("perf-bar-fill");
  const barLabel = document.getElementById("perf-bar-label");
  const comment  = document.getElementById("perf-comment");
  const confetti = document.getElementById("confetti-canvas");

  const status  = payload.status || "";
  const isWin   = status.toLowerCase().includes("you win") || (payload.winner && payload.winner !== "O" && payload.winner !== "black" && !twoPlayerMode ? payload.winner === "X" || payload.winner === "white" : false);
  const isDraw  = payload.draw || status.toLowerCase().includes("draw");
  const won     = status.toLowerCase().includes("you win") || status.toLowerCase().includes("checkmate. you win");
  const lost    = !won && !isDraw;
  const result  = won ? "win" : isDraw ? "draw" : "loss";

  // Icons & titles
  if (won)       { icon.textContent="🏆"; title.textContent="You Win!"; eyebrow.textContent="Victory"; }
  else if (isDraw){ icon.textContent="🤝"; title.textContent="It's a Draw!"; eyebrow.textContent="Draw"; }
  else           { icon.textContent="💻"; title.textContent="Computer Wins"; eyebrow.textContent="Defeat"; }
  subtitle.textContent = status;

  // Performance
  let accPct = 0;
  let rating;
  if (gameMode === "tictactoe") {
    const analysis = payload.analysis || {};
    accPct = analysis.accuracyScore || 0;
    rating = getRating(accPct);
    acc.textContent = accPct.toFixed(1) + "%";
    const total = (analysis.totalMoves || 0);
    movesEl.textContent = total;
  } else {
    const moves = payload.moveCount || 0;
    const diff  = (payload.difficulty || "medium");
    rating = getChessRating(won, diff, moves);
    
    // Calculate real accuracy from moveQualities array
    let qArr = [];
    if (typeof sessions !== "undefined" && sessions.chess && sessions.chess.moveQualities) {
      qArr = sessions.chess.moveQualities;
    }
    if (qArr.length > 0) {
      let score = 0;
      qArr.forEach(q => {
        if (q === "best" || q === "great") score += 100;
        else if (q === "good") score += 75;
        else if (q === "inaccuracy") score += 40;
        else if (q === "blunder") score += 0;
      });
      accPct = score / qArr.length;
    } else {
      accPct = won ? (diff==="hard"?95:diff==="medium"?75:55) : isDraw?50:25;
    }
    
    acc.textContent = won ? "Win" : isDraw ? "Draw" : "Loss";
    movesEl.textContent = moves;
  }

  badge.textContent  = rating.label;
  badge.className    = "perf-badge " + rating.grade;
  barLabel.textContent = Math.round(accPct) + "%";
  comment.textContent  = getComment(result, accPct);

  // Animate bar after slight delay
  barFill.style.width = "0%";
  setTimeout(() => { barFill.style.width = Math.min(accPct,100) + "%"; }, 100);

  overlay.classList.remove("is-hidden");

  if (won) { runConfetti(confetti); SoundFX.win(); burstParticles(); }
  else if (isDraw) { SoundFX.draw(); }
  else { SoundFX.lose(); }

  // Streak & achievements
  const scoreboard = payload.scoreboard || {};
  if (won)       Streak.win();
  else           Streak.reset();
  Streak.render();

  Achievements.check({
    wins: scoreboard.human || 0,
    draws: scoreboard.draws || 0,
    streak: Streak.get().cur,
    accuracy: accPct,
    game: gameMode,
    won, diff: payload.difficulty || "medium",
    moves: payload.moveCount || 0,
    prevLoss: false
  });
};

// Modal buttons
document.getElementById("gameover-play-again").addEventListener("click", () => {
  document.getElementById("gameover-overlay").classList.add("is-hidden");
  document.getElementById("restart").click();
});
document.getElementById("gameover-change-game").addEventListener("click", () => {
  document.getElementById("gameover-overlay").classList.add("is-hidden");
  document.getElementById("change-game").click();
});

/* ---------- PROMOTION DIALOG ---------- */
let _promotionResolve = null;

window.showPromotionDialog = function() {
  return new Promise(resolve => {
    _promotionResolve = resolve;
    document.getElementById("promotion-overlay").classList.remove("is-hidden");
  });
};

document.querySelectorAll(".promo-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const piece = btn.dataset.piece;
    document.getElementById("promotion-overlay").classList.add("is-hidden");
    if (_promotionResolve) { _promotionResolve(piece); _promotionResolve = null; }
  });
});

/* ---------- MOVE HISTORY (CHESS) ---------- */
let _moveHistory = [];

window.resetMoveHistory = function() { _moveHistory = []; renderMoveHistory(); };

window.pushMoveHistory = function(whiteMove, blackMove, quality) {
  _moveHistory.push({ w: whiteMove, b: blackMove || "", q: quality || "" });
  renderMoveHistory();
};

function renderMoveHistory() {
  const list = document.getElementById("move-history-list");
  if (!list) return;
  list.innerHTML = _moveHistory.map((m, i) => {
    let qIcon = "";
    if (m.q === "best" || m.q === "great") qIcon = " <span title='Best Move' style='color:#10b981;font-size:0.85em'>⭐</span>";
    else if (m.q === "blunder") qIcon = " <span title='Blunder' style='color:#ef4444;font-size:0.85em'>❌</span>";
    else if (m.q === "inaccuracy") qIcon = " <span title='Inaccuracy' style='color:#f59e0b;font-size:0.85em'>❓</span>";
    
    const whiteContent = m.w || "---";
    const blackContent = m.b || "---";

    return `<div class="move-row">
      <span class="move-num">${i+1}.</span>
      <span class="move-white">${whiteContent}${qIcon}</span>
      <span class="move-black">${blackContent}</span>
    </div>`;
  }).join("");
  list.scrollTop = list.scrollHeight;
}

/* ---------- BOARD COORDINATES ---------- */
window.buildChessCoords = function(playerColor) {
  const ranks = document.getElementById("coord-ranks");
  const files = document.getElementById("coord-files");
  if (!ranks || !files) return;
  const rankLabels = playerColor === "black"
    ? ["1","2","3","4","5","6","7","8"]
    : ["8","7","6","5","4","3","2","1"];
  const fileLabels = playerColor === "black"
    ? ["h","g","f","e","d","c","b","a"]
    : ["a","b","c","d","e","f","g","h"];
  ranks.innerHTML = rankLabels.map(r=>`<span>${r}</span>`).join("");
  files.innerHTML = fileLabels.map(f=>`<span>${f}</span>`).join("");
};

/* ---------- GAME HISTORY LOG ---------- */
window.loadGameHistory = function() {
  fetch("/api/history")
    .then(r => r.json())
    .then(data => {
      const list = document.getElementById("history-list");
      if (!list || !data.games) return;
      list.innerHTML = data.games.map(g => {
        const cls = g.result === "human_win" ? "win" : g.result === "draw" ? "draw" : "loss";
        const label = g.result === "human_win" ? "You Won" : g.result === "draw" ? "Draw" : "You Lost";
        return `<div class="history-item">
          <span class="h-result ${cls}">${label}</span>
          <span class="h-diff">${g.difficulty}</span>
          <span class="h-date">${g.saved_at.split(" ").slice(0,2).join(" ")}</span>
        </div>`;
      }).join("") || "<div style='padding:12px 20px;color:var(--muted);font-size:.85rem;'>No games yet.</div>";
    })
    .catch(err => {
      console.error("Failed to load game history:", err);
      const list = document.getElementById("history-list");
      if (list) list.innerHTML = "<div style='padding:12px 20px;color:#f87171;font-size:.85rem;'>Error loading history.</div>";
    });
};

document.getElementById("history-toggle").addEventListener("click", () => {
  const panel = document.getElementById("history-panel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) window.loadGameHistory();
});

/* ---------- ACCURACY & WARNING MODALS ---------- */
window.showAccuracyModal = function() {
    const session = sessions[window.gameMode];
    if (!session) return;
    
    let acc = 0, opt = 0, tot = 0, perf = 0;
    
    if (window.gameMode === "tictactoe") {
        acc = session.analysis.accuracyScore;
        opt = session.analysis.optimalMoves;
        tot = session.analysis.totalMoves;
        perf = session.analysis.performanceScore;
    } else {
        tot = window.moveCount;
        opt = Math.round(tot * 0.75); // Fallback if not tracked
        acc = (opt / (tot || 1)) * 100;
        perf = 85.0;
    }
    
    document.getElementById("acc-optimal").textContent = opt;
    document.getElementById("acc-total").textContent = tot;
    document.getElementById("acc-rate").textContent = Math.round(acc) + "%";
    document.getElementById("acc-perf").textContent = perf.toFixed(1);
    
    document.getElementById("accuracy-overlay").classList.remove("is-hidden");
};

document.getElementById("close-accuracy").addEventListener("click", () => {
    document.getElementById("accuracy-overlay").classList.add("is-hidden");
});

let _warningConfirmCallback = null;
window.showWarningModal = function(title, subtitle, onConfirm) {
    document.getElementById("warning-title").textContent = title;
    document.getElementById("warning-subtitle").textContent = subtitle;
    _warningConfirmCallback = onConfirm;
    document.getElementById("warning-overlay").classList.remove("is-hidden");
};

document.getElementById("warning-confirm").addEventListener("click", async () => {
    if (_warningConfirmCallback) await _warningConfirmCallback();
    document.getElementById("warning-overlay").classList.add("is-hidden");
});

document.getElementById("warning-cancel").addEventListener("click", () => {
    document.getElementById("warning-overlay").classList.add("is-hidden");
});

/* ---------- HINT BUTTON REMOVED ---------- */
