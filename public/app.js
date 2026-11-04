/* ═══════════════════════════════════════════════════════════════
   Riddle Quest — Client
   ═══════════════════════════════════════════════════════════════ */
const socket = io();

// ── DOM refs ─────────────────────────────────────────────────────
const joinScreen    = document.getElementById("join-screen");
const lobbyScreen   = document.getElementById("lobby-screen");
const gameScreen    = document.getElementById("game-screen");
const finishedScreen= document.getElementById("finished-screen");
const nameInput     = document.getElementById("player-name");
const pinInput      = document.getElementById("game-pin");
const joinBtn       = document.getElementById("join-btn");
const joinError     = document.getElementById("join-error");
const lobbyName     = document.getElementById("lobby-name");
const lobbyCount    = document.getElementById("lobby-count");
const lobbyPlayers  = document.getElementById("lobby-players");
const displayName   = document.getElementById("display-name");
const displayScore  = document.getElementById("display-score");
const displaySolved = document.getElementById("display-solved");
const displayTotal  = document.getElementById("display-total");
const timerDisplay  = document.getElementById("timer-display");
const riddleCard    = document.getElementById("riddle-card");
const completeCard  = document.getElementById("complete-card");
const riddleCat     = document.getElementById("riddle-category");
const riddleText    = document.getElementById("riddle-text");
const hintArea      = document.getElementById("hint-area");
const hintText      = document.getElementById("hint-text");
const hintBtn       = document.getElementById("hint-btn");
const answerInput   = document.getElementById("answer-input");
const submitBtn     = document.getElementById("submit-btn");
const feedback      = document.getElementById("feedback");
const lbList        = document.getElementById("leaderboard-list");
const finalScore    = document.getElementById("final-score");
const finFinalScore = document.getElementById("fin-final-score");
const finFinalRank  = document.getElementById("fin-final-rank");
const finLbList     = document.getElementById("fin-leaderboard-list");

let myName = "";
let currentRiddleId = null;

// ── Screens ──────────────────────────────────────────────────────
function showScreen(screen) {
  [joinScreen, lobbyScreen, gameScreen, finishedScreen].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// ── Join ─────────────────────────────────────────────────────────
function joinGame() {
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  if (!name) { joinError.textContent = "Please enter your name!"; return; }
  if (!pin)  { joinError.textContent = "Please enter the game PIN!"; return; }
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining...";
  joinError.textContent = "";
  socket.emit("join", { name, pin });
}

joinBtn.addEventListener("click", joinGame);
pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinGame(); });
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") pinInput.focus(); });

// ── Server: joined lobby ─────────────────────────────────────────
socket.on("joined_lobby", (data) => {
  myName = data.name;
  lobbyName.textContent = data.name;
  lobbyCount.textContent = data.playerCount;
  renderLobbyPlayers(data.players);
  showScreen(lobbyScreen);
});

socket.on("lobby_update", (data) => {
  lobbyCount.textContent = data.playerCount;
  renderLobbyPlayers(data.players);
});

function renderLobbyPlayers(playersList) {
  lobbyPlayers.innerHTML = playersList
    .map(name => {
      const isMe = name === myName ? " is-me" : "";
      return `<div class="lobby-player${isMe}">🧙 ${escHtml(name)}</div>`;
    })
    .join("");
}

// ── Server: game started ─────────────────────────────────────────
socket.on("game_started", (data) => {
  displayName.textContent = myName;
  displayScore.textContent = data.score;
  displaySolved.textContent = data.solved;
  displayTotal.textContent = data.total;
  timerDisplay.textContent = formatTime(data.timeRemaining);
  showScreen(gameScreen);
  if (data.riddle) showRiddle(data.riddle);
  else showComplete(data.score);
});

// ── Server: joined mid-game ─────────────────────────────────────
socket.on("joined", (data) => {
  myName = data.name;
  displayName.textContent = data.name;
  displayScore.textContent = data.score;
  displaySolved.textContent = data.solved;
  displayTotal.textContent = data.total;
  timerDisplay.textContent = formatTime(data.timeRemaining);
  showScreen(gameScreen);
  if (data.riddle) showRiddle(data.riddle);
  else showComplete(data.score);
});

// ── Server: error ────────────────────────────────────────────────
socket.on("error_msg", (msg) => {
  joinError.textContent = msg;
  joinBtn.disabled = false;
  joinBtn.textContent = "Join Game";
});

// ── Timer tick ───────────────────────────────────────────────────
socket.on("timer_tick", (remaining) => {
  timerDisplay.textContent = formatTime(remaining);
  timerDisplay.classList.toggle("timer-danger", remaining <= 30);
});

// ── Game finished ────────────────────────────────────────────────
socket.on("game_finished", (data) => {
  const lb = data.leaderboard;
  const myEntry = lb.find(p => p.name === myName);
  const myRank = myEntry ? lb.indexOf(myEntry) + 1 : "—";
  finFinalScore.textContent = myEntry ? myEntry.score : 0;
  finFinalRank.textContent = myRank;

  finLbList.innerHTML = lb.map((p, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const rankClass = rank <= 3 ? ` rank-${rank}` : "";
    const meClass = p.name === myName ? " is-me" : "";
    return `<div class="lb-row${rankClass}${meClass}">
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${escHtml(p.name)}</span>
      <span class="lb-solved">${p.solved}/${p.total}</span>
      <span class="lb-score">${p.score}</span>
    </div>`;
  }).join("");
  showScreen(finishedScreen);
});

// ── Riddle display ───────────────────────────────────────────────
function showRiddle(r) {
  currentRiddleId = r.id;
  riddleCat.textContent = "🎬 " + r.category;
  riddleText.textContent = r.riddle;
  answerInput.value = "";
  hintArea.classList.add("hidden");
  hintBtn.disabled = false;
  feedback.classList.add("hidden");
  feedback.className = "feedback hidden";
  riddleCard.classList.remove("hidden");
  completeCard.classList.add("hidden");
  answerInput.focus();
}

function showComplete(score) {
  riddleCard.classList.add("hidden");
  completeCard.classList.remove("hidden");
  finalScore.textContent = score;
}

// ── Hint ─────────────────────────────────────────────────────────
hintBtn.addEventListener("click", () => {
  if (currentRiddleId == null) return;
  socket.emit("hint", currentRiddleId);
  hintBtn.disabled = true;
});
socket.on("hint_response", (data) => {
  hintText.textContent = data.hint;
  hintArea.classList.remove("hidden");
});

// ── Submit answer ────────────────────────────────────────────────
function submitAnswer() {
  const answer = answerInput.value.trim();
  if (!answer || currentRiddleId == null) return;
  socket.emit("answer", { riddleId: currentRiddleId, answer });
}
submitBtn.addEventListener("click", submitAnswer);
answerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAnswer(); });

// ── Result ───────────────────────────────────────────────────────
socket.on("result", (data) => {
  feedback.classList.remove("hidden", "correct", "wrong");
  if (data.correct) {
    const note = data.usedHint ? " (hint used)" : " (no hint bonus!)";
    feedback.classList.add("correct");
    feedback.textContent = `✅ Correct! +${data.points} points${note}`;
    displayScore.textContent = data.score;
    displaySolved.textContent = data.solved;
    setTimeout(() => {
      if (data.nextRiddle) showRiddle(data.nextRiddle);
      else showComplete(data.score);
    }, 1500);
  } else {
    feedback.classList.add("wrong");
    feedback.textContent = "❌ Wrong answer! Try again.";
    answerInput.value = "";
    answerInput.focus();
    setTimeout(() => feedback.classList.add("hidden"), 2000);
  }
});

// ── Leaderboard ──────────────────────────────────────────────────
socket.on("leaderboard", (board) => {
  if (!board.length) {
    lbList.innerHTML = '<p class="lb-empty">Waiting for players...</p>';
    return;
  }
  lbList.innerHTML = board.map((p, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const rankClass = rank <= 3 ? ` rank-${rank}` : "";
    const meClass = p.name === myName ? " is-me" : "";
    return `<div class="lb-row${rankClass}${meClass}">
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${escHtml(p.name)}</span>
      <span class="lb-solved">${p.solved}/${p.total}</span>
      <span class="lb-score">${p.score}</span>
    </div>`;
  }).join("");
});

// ── Game reset / state ───────────────────────────────────────────
socket.on("game_reset", () => location.reload());
socket.on("game_state", (data) => {
  if (data.state === "finished" && !myName) {
    joinError.textContent = "The game has ended. Ask the host to reset.";
    joinBtn.disabled = true;
  }
});

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
