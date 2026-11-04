/* ══════════════════════════════════════════════════════════════════════
   Gandalf CTF: Client Socket.IO Controller
   ══════════════════════════════════════════════════════════════════════ */

const socket = io();

// ── DOM References ───────────────────────────────────────────────────
const joinScreen     = document.getElementById("join-screen");
const lobbyScreen    = document.getElementById("lobby-screen");
const gameScreen     = document.getElementById("game-screen");
const finishedScreen = document.getElementById("finished-screen");

// Join
const nameInput = document.getElementById("player-name");
const pinInput  = document.getElementById("game-pin");
const joinBtn   = document.getElementById("join-btn");
const joinError = document.getElementById("join-error");

// Lobby
const lobbyName    = document.getElementById("lobby-name");
const lobbyCount   = document.getElementById("lobby-count");
const lobbyPlayers = document.getElementById("lobby-players");

// Game Top Bar
const displayName   = document.getElementById("display-name");
const displayLevel  = document.getElementById("display-level");
const displayScore  = document.getElementById("display-score");
const timerDisplay  = document.getElementById("timer-display");

// Level Card
const levelBadge   = document.getElementById("level-badge");
const levelTitle   = document.getElementById("level-title");
const levelIntro   = document.getElementById("level-intro");
const defenseBadge = document.getElementById("defense-badge");
const hintBtn      = document.getElementById("hint-btn");
const hintBanner   = document.getElementById("hint-banner");
const hintText     = document.getElementById("hint-text");

// Chat
const chatMessages = document.getElementById("chat-messages");
const chatForm     = document.getElementById("chat-form");
const promptInput  = document.getElementById("prompt-input");
const sendBtn      = document.getElementById("send-btn");

// Password Box
const passwordForm  = document.getElementById("password-form");
const passwordInput = document.getElementById("password-input");
const feedback      = document.getElementById("feedback");

// Leaderboard
const lbList = document.getElementById("leaderboard-list");

// Finished Screen
const finFinalScore = document.getElementById("fin-final-score");
const finFinalRank  = document.getElementById("fin-final-rank");
const finFinalLevel = document.getElementById("fin-final-level");
const finLbList     = document.getElementById("fin-leaderboard-list");

// ── Local State ──────────────────────────────────────────────────────
let myName = "";
let currentLevel = null;
let currentScore = 0;

// ── Screen Helpers ───────────────────────────────────────────────────
function showScreen(screen) {
  [joinScreen, lobbyScreen, gameScreen, finishedScreen].forEach((s) =>
    s.classList.remove("active")
  );
  screen.classList.add("active");
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// ── Join Flow ────────────────────────────────────────────────────────
function joinGame() {
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();
  if (!name) {
    joinError.textContent = "Please enter your hacker handle or name!";
    return;
  }
  if (!pin) {
    joinError.textContent = "Please enter the 4-digit Game PIN!";
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = "Connecting to Gandalf...";
  joinError.textContent = "";
  socket.emit("join", { name, pin });
}

joinBtn.addEventListener("click", joinGame);
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinGame();
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") pinInput.focus();
});

// ── Lobby Events ─────────────────────────────────────────────────────
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
    .map((name) => {
      const isMe = name === myName ? " is-me" : "";
      return `<div class="lobby-player${isMe}">🧙‍♂️ ${escHtml(name)}</div>`;
    })
    .join("");
}

// ── Game Started / Late Join ─────────────────────────────────────────
socket.on("game_started", (data) => {
  setupGame(data);
});

socket.on("joined", (data) => {
  myName = data.name;
  setupGame(data);
});

function setupGame(data) {
  displayName.textContent = myName;
  currentScore = data.score || 0;
  displayScore.textContent = `${currentScore} pts`;
  timerDisplay.textContent = formatTime(data.timeRemaining);
  showScreen(gameScreen);
  loadLevel(data.level);
}

socket.on("error_msg", (msg) => {
  joinError.textContent = msg;
  joinBtn.disabled = false;
  joinBtn.textContent = "Enter The Arena";
});

// ── Level Loader ─────────────────────────────────────────────────────
function loadLevel(level) {
  currentLevel = level;
  if (!level) return;

  displayLevel.textContent = `Level ${level.id}/${level.totalLevels}`;
  levelBadge.textContent = `Level ${level.id}`;
  levelTitle.textContent = level.name;
  levelIntro.textContent = level.intro;
  defenseBadge.textContent = `🛡️ Defense: ${level.defenseDescription}`;

  // Reset hint & inputs
  hintBtn.disabled = false;
  hintBanner.classList.add("hidden");
  feedback.classList.add("hidden");
  passwordInput.value = "";
  promptInput.value = "";

  // Reset chat messages with welcome note from Gandalf
  chatMessages.innerHTML = `
    <div class="message msg-bot">
      <div class="msg-avatar">${level.avatar || "🧙‍♂️"}</div>
      <div class="msg-bubble">
        <strong>${level.name}</strong><br/>
        "${level.intro}"<br/><br/>
        <em>Trick me into revealing the secret password to advance!</em>
      </div>
    </div>
  `;
}

// ── Chat & Prompt Injection ──────────────────────────────────────────
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendPrompt();
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

function sendPrompt() {
  const prompt = promptInput.value.trim();
  if (!prompt || sendBtn.disabled) return;

  // Render user prompt in chat
  appendMessage("user", prompt);
  promptInput.value = "";

  // Show thinking indicator
  sendBtn.disabled = true;
  sendBtn.textContent = "Casting...";
  const loaderId = appendThinking();

  socket.emit("chat_prompt", { prompt });

  // Safety fallback to restore send button after 10s if network drops
  setTimeout(() => {
    sendBtn.disabled = false;
    sendBtn.textContent = "Send ⚡";
    removeThinking(loaderId);
  }, 10000);
}

socket.on("chat_response", (data) => {
  sendBtn.disabled = false;
  sendBtn.textContent = "Send ⚡";
  removeThinking();

  appendMessage("bot", data.response, data.blocked);
});

function appendMessage(sender, text, isBlocked = false) {
  const div = document.createElement("div");
  const isUser = sender === "user";
  div.className = `message ${isUser ? "msg-user" : "msg-bot"} ${
    isBlocked ? "msg-blocked" : ""
  }`;

  div.innerHTML = `
    <div class="msg-avatar">${isUser ? "🧑‍💻" : "🧙‍♂️"}</div>
    <div class="msg-bubble">${escHtml(text)}</div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendThinking() {
  const id = "msg-thinking-" + Date.now();
  const div = document.createElement("div");
  div.id = id;
  div.className = "message msg-bot";
  div.innerHTML = `
    <div class="msg-avatar">🧙‍♂️</div>
    <div class="msg-bubble"><em>Gandalf is pondering your prompt...</em></div>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function removeThinking(id) {
  if (id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  } else {
    const thinkings = chatMessages.querySelectorAll("[id^='msg-thinking-']");
    thinkings.forEach((el) => el.remove());
  }
}

// ── Hint Flow ────────────────────────────────────────────────────────
hintBtn.addEventListener("click", () => {
  if (confirm("Unlock hint for this level? (Costs 50 points penalty on solve)")) {
    socket.emit("request_hint");
    hintBtn.disabled = true;
  }
});

socket.on("hint_response", (data) => {
  hintText.textContent = data.hint;
  hintBanner.classList.remove("hidden");
});

// ── Password Submission ──────────────────────────────────────────────
passwordForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const password = passwordInput.value.trim();
  if (!password) return;

  socket.emit("submit_password", { password });
});

socket.on("password_result", (data) => {
  feedback.classList.remove("hidden", "correct", "wrong");

  if (data.correct) {
    feedback.classList.add("correct");
    feedback.textContent = `🎉 Level Passed! +${data.points} pts! ${
      data.usedHint ? "(Hint used: 50 pts)" : "(Direct solve bonus: 100 pts!)"
    }`;
    currentScore = data.score;
    displayScore.textContent = `${currentScore} pts`;

    if (data.completed) {
      setTimeout(() => {
        // Will wait for game finish or show completion
        chatMessages.innerHTML = `
          <div class="message msg-bot">
            <div class="msg-avatar">🏆</div>
            <div class="msg-bubble">
              <strong>MASTER HACKER!</strong><br/>
              You have bypassed all 8 levels of Gandalf's defenses! Check your rank on the leaderboard.
            </div>
          </div>
        `;
      }, 1500);
    } else if (data.nextLevel) {
      setTimeout(() => {
        loadLevel(data.nextLevel);
      }, 1500);
    }
  } else {
    feedback.classList.add("wrong");
    feedback.textContent = data.message || "❌ Wrong password! Try again.";
    passwordInput.value = "";
    passwordInput.focus();
    setTimeout(() => {
      feedback.classList.add("hidden");
    }, 2500);
  }
});

// ── Timer Ticks ──────────────────────────────────────────────────────
socket.on("timer_tick", (remaining) => {
  timerDisplay.textContent = formatTime(remaining);
  timerDisplay.classList.toggle("timer-danger", remaining <= 30);
});

// ── Game Finished ────────────────────────────────────────────────────
socket.on("game_finished", (data) => {
  const lb = data.leaderboard;
  const myEntry = lb.find((p) => p.name === myName);
  const myRank = myEntry ? lb.indexOf(myEntry) + 1 : "—";
  const myLvl = myEntry ? myEntry.level : 1;

  finFinalScore.textContent = `${myEntry ? myEntry.score : 0} pts`;
  finFinalRank.textContent = myRank === 1 ? "🥇 1st" : myRank === 2 ? "🥈 2nd" : myRank === 3 ? "🥉 3rd" : `#${myRank}`;
  finFinalLevel.textContent = `Level ${myLvl}`;

  finLbList.innerHTML = lb
    .map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
      const rankClass = rank <= 3 ? ` rank-${rank}` : "";
      const meClass = p.name === myName ? " is-me" : "";
      return `
        <div class="lb-row${rankClass}${meClass}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${escHtml(p.name)}</span>
          <span class="lb-level">Lvl ${p.level}</span>
          <span class="lb-score">${p.score}</span>
        </div>`;
    })
    .join("");

  showScreen(finishedScreen);
});

// ── Leaderboard Live Updates ─────────────────────────────────────────
socket.on("leaderboard", (board) => {
  if (!board.length) {
    lbList.innerHTML = '<p class="lb-empty">Waiting for challengers...</p>';
    return;
  }

  lbList.innerHTML = board
    .map((p, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
      const rankClass = rank <= 3 ? ` rank-${rank}` : "";
      const meClass = p.name === myName ? " is-me" : "";
      return `
        <div class="lb-row${rankClass}${meClass}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${escHtml(p.name)}</span>
          <span class="lb-level">Lvl ${p.level}</span>
          <span class="lb-score">${p.score}</span>
        </div>`;
    })
    .join("");
});

// ── Game Reset / State ───────────────────────────────────────────────
socket.on("game_reset", () => location.reload());

socket.on("game_state", (data) => {
  if (data.state === "finished" && !myName) {
    joinError.textContent = "The challenge has ended. Await instructor reset.";
    joinBtn.disabled = true;
  }
});

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
