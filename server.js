const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const levels = require("./levels.json");
const { queryGemini, setApiKey, getApiKey } = require("./aiEngine");

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, "public")));

// ── Configuration ────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "admin123";

// ── In-memory state ──────────────────────────────────────────────────
// socketId → { name, score, currentLevel, hintsUsed: Set/Array, completed }
const players = new Map();
const adminTokens = new Set();

let gameState = "lobby"; // "lobby" | "playing" | "finished"
let gamePin = generatePin();
let timerDuration = 0;
let timerRemaining = 0;
let timerInterval = null;

function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// ── Leaderboard Helper ───────────────────────────────────────────────
function getLeaderboard() {
  return Array.from(players.values())
    .map((p) => ({
      name: p.name,
      score: p.score,
      level: Math.min(p.currentLevel, levels.length),
      completed: p.completed,
      totalLevels: levels.length,
    }))
    .sort((a, b) => b.score - a.score || b.level - a.level);
}

function getLobbyList() {
  return Array.from(players.values()).map((p) => p.name);
}

// Sanitize level data for client (hide the real password!)
function safeLevel(lvl) {
  if (!lvl) return null;
  return {
    id: lvl.id,
    name: lvl.name,
    avatar: lvl.avatar,
    intro: lvl.intro,
    defenseDescription: lvl.defenseDescription,
    points: lvl.points,
    hintPenalty: lvl.hintPenalty,
    totalLevels: levels.length,
  };
}

// ── Timer Helpers ────────────────────────────────────────────────────
function startTimer(seconds) {
  timerDuration = seconds;
  timerRemaining = seconds;
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    timerRemaining--;
    io.emit("timer_tick", timerRemaining);

    if (timerRemaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      endGame();
    }
  }, 1000);
}

function endGame() {
  gameState = "finished";
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  io.emit("game_finished", { leaderboard: getLeaderboard() });
  io.emit("game_state", { state: gameState });
  console.log("🏁 Game finished!");
}

// ══════════════════════════════════════════════════════════════════════
// HTTP ROUTES & ADMIN APIS
// ══════════════════════════════════════════════════════════════════════

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateToken();
    adminTokens.add(token);
    console.log("🔐 Admin logged in");
    return res.json({ success: true, token, pin: gamePin, hasApiKey: !!getApiKey() });
  }
  res.status(401).json({ success: false, error: "Wrong password." });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.headers["x-admin-token"] || req.query.token;
  adminTokens.delete(token);
  res.json({ success: true });
});

app.get("/api/status", requireAdmin, (_req, res) => {
  res.json({
    state: gameState,
    pin: gamePin,
    playerCount: players.size,
    timerDuration,
    timerRemaining,
    players: getLobbyList(),
    hasApiKey: !!getApiKey(),
  });
});

app.post("/api/pin/regenerate", requireAdmin, (_req, res) => {
  gamePin = generatePin();
  console.log(`🔑 New game PIN: ${gamePin}`);
  res.json({ pin: gamePin });
});

app.post("/api/set-api-key", requireAdmin, (req, res) => {
  const { apiKey } = req.body;
  setApiKey(apiKey);
  console.log(`🤖 Gemini API key updated: ${apiKey ? "Active" : "Disabled (using local simulator)"}`);
  res.json({ success: true, hasApiKey: !!getApiKey() });
});

app.get("/api/leaderboard", requireAdmin, (_req, res) => {
  res.json(getLeaderboard());
});

app.post("/api/start", requireAdmin, (req, res) => {
  if (gameState !== "lobby") {
    return res.status(400).json({ error: "Game is not in lobby state." });
  }
  if (players.size === 0) {
    return res.status(400).json({ error: "No players have joined yet." });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const seconds = parseInt(url.searchParams.get("timer") || "600", 10);

  gameState = "playing";
  console.log(`🚀 Gandalf CTF started! Timer: ${seconds}s, Players: ${players.size}`);

  // Send Level 1 to every player
  for (const [socketId, player] of players) {
    const s = io.sockets.sockets.get(socketId);
    if (s) {
      const lvl = levels.find((l) => l.id === player.currentLevel);
      s.emit("game_started", {
        level: safeLevel(lvl),
        totalLevels: levels.length,
        score: player.score,
        timeRemaining: seconds,
      });
    }
  }

  io.emit("game_state", { state: gameState });
  io.emit("leaderboard", getLeaderboard());
  startTimer(seconds);

  res.json({ status: "Game started!", timer: seconds, players: players.size });
});

app.post("/api/end", requireAdmin, (_req, res) => {
  if (gameState !== "playing") {
    return res.status(400).json({ error: "Game is not running." });
  }
  endGame();
  res.json({ status: "Game ended!" });
});

app.post("/api/reset", requireAdmin, (_req, res) => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState = "lobby";
  timerDuration = 0;
  timerRemaining = 0;
  gamePin = generatePin();
  players.clear();
  io.emit("game_reset");
  io.emit("leaderboard", []);
  io.emit("game_state", { state: "lobby" });
  console.log(`🔄 Game reset! New PIN: ${gamePin}`);
  res.json({ status: "Game reset!", pin: gamePin });
});

// ══════════════════════════════════════════════════════════════════════
// SOCKET.IO REAL-TIME GAMEPLAY
// ══════════════════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);
  socket.emit("game_state", { state: gameState });

  // ── Player Join ─────────────────────────────────────────────────────
  socket.on("join", ({ name, pin }) => {
    name = (name || "").trim().substring(0, 30);
    pin = (pin || "").trim();

    if (!name) return socket.emit("error_msg", "Please enter a valid name.");
    if (!pin) return socket.emit("error_msg", "Please enter the game PIN.");

    if (pin !== gamePin) {
      return socket.emit("error_msg", "Wrong game PIN! Ask your instructor.");
    }

    for (const [, p] of players) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        return socket.emit("error_msg", "That name is already taken. Pick another!");
      }
    }

    if (gameState === "finished") {
      return socket.emit("error_msg", "The game has already ended. Ask the host to reset.");
    }

    const player = {
      name,
      score: 0,
      currentLevel: 1,
      hintsUsed: [],
      completed: false,
    };
    players.set(socket.id, player);

    if (gameState === "lobby") {
      socket.emit("joined_lobby", {
        name,
        playerCount: players.size,
        players: getLobbyList(),
      });
      io.emit("lobby_update", {
        playerCount: players.size,
        players: getLobbyList(),
      });
    } else if (gameState === "playing") {
      const lvl = levels.find((l) => l.id === player.currentLevel);
      socket.emit("joined", {
        name,
        level: safeLevel(lvl),
        totalLevels: levels.length,
        score: 0,
        timeRemaining: timerRemaining,
      });
      io.emit("leaderboard", getLeaderboard());
    }

    console.log(`👤 ${name} joined  (${players.size} online)`);
  });

  // ── Prompt Injection Chat with Gandalf ──────────────────────────────
  socket.on("chat_prompt", async ({ prompt }) => {
    if (gameState !== "playing") return;
    const player = players.get(socket.id);
    if (!player || player.completed) return;

    prompt = (prompt || "").trim();
    if (!prompt) return;

    const level = levels.find((l) => l.id === player.currentLevel);
    if (!level) return;

    try {
      const result = await queryGemini(prompt, level);
      socket.emit("chat_response", {
        prompt,
        response: result.response,
        blocked: result.blocked,
        reason: result.reason,
      });
    } catch (err) {
      socket.emit("chat_response", {
        prompt,
        response: "An anomaly occurred in the wizarding network. Try again!",
        blocked: false,
      });
    }
  });

  // ── Password Submission to Unlock Next Level ────────────────────────
  socket.on("submit_password", ({ password }) => {
    if (gameState !== "playing") return;
    const player = players.get(socket.id);
    if (!player || player.completed) return;

    const guess = (password || "").trim().toUpperCase();
    const level = levels.find((l) => l.id === player.currentLevel);
    if (!level) return;

    if (guess === level.password.toUpperCase()) {
      const usedHint = player.hintsUsed.includes(level.id);
      const points = usedHint ? level.hintPenalty : level.points;
      player.score += points;
      player.currentLevel++;

      const isFinished = player.currentLevel > levels.length;
      if (isFinished) {
        player.completed = true;
      }

      const nextLvl = levels.find((l) => l.id === player.currentLevel);

      socket.emit("password_result", {
        correct: true,
        points,
        usedHint,
        score: player.score,
        completed: isFinished,
        nextLevel: safeLevel(nextLvl),
        currentLevelNum: player.currentLevel,
        totalLevels: levels.length,
      });

      io.emit("leaderboard", getLeaderboard());
      console.log(`🏆 ${player.name} passed Level ${level.id} (+${points} pts)`);
    } else {
      socket.emit("password_result", {
        correct: false,
        message: "❌ Password rejected! Gandalf remains undefeated on this level.",
      });
    }
  });

  // ── Request Hint ────────────────────────────────────────────────────
  socket.on("request_hint", () => {
    if (gameState !== "playing") return;
    const player = players.get(socket.id);
    if (!player || player.completed) return;

    const level = levels.find((l) => l.id === player.currentLevel);
    if (!level) return;

    if (!player.hintsUsed.includes(level.id)) {
      player.hintsUsed.push(level.id);
    }

    socket.emit("hint_response", {
      levelId: level.id,
      hint: level.hint,
    });
  });

  // ── Disconnect ──────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) console.log(`👋 ${player.name} left`);
    players.delete(socket.id);

    if (gameState === "lobby") {
      io.emit("lobby_update", {
        playerCount: players.size,
        players: getLobbyList(),
      });
    }
    io.emit("leaderboard", getLeaderboard());
  });
});

// ── Start Server ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🧙‍♂️ Gandalf Prompt Injection Arena running!`);
  console.log(`   Local:      http://localhost:${PORT}`);
  console.log(`   Dashboard:  http://localhost:${PORT}/admin`);
  console.log(`   Admin Pass: ${ADMIN_PASSWORD}`);
  console.log(`   Game PIN:   ${gamePin}`);
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`   Network:    http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`\n   Share Network URL + PIN with students!\n`);
});
