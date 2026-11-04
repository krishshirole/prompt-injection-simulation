const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const riddles = require("./riddles.json");

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
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "admin123";  // Change this!

// ── In-memory state ──────────────────────────────────────────────────
const players = new Map();        // socketId → { name, score, solved[], usedHints[] }
const adminTokens = new Set();    // valid admin session tokens

// Game state
let gameState = "lobby";          // "lobby" | "playing" | "finished"
let gamePin = generatePin();      // 4-digit PIN for students to join
let timerDuration = 0;
let timerRemaining = 0;
let timerInterval = null;

// ── Generate a random 4-digit PIN ────────────────────────────────────
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// ── Generate a secure admin token ────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ── Admin auth middleware ────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// ── Helper: build leaderboard array ──────────────────────────────────
function getLeaderboard() {
  return Array.from(players.values())
    .map((p) => ({
      name: p.name,
      score: p.score,
      solved: p.solved.length,
      total: riddles.length,
    }))
    .sort((a, b) => b.score - a.score || b.solved - a.solved);
}

// ── Helper: build lobby player list ──────────────────────────────────
function getLobbyList() {
  return Array.from(players.values()).map((p) => p.name);
}

// ── Helper: pick the next unsolved riddle for a player ───────────────
function nextRiddle(player) {
  const unsolved = riddles.filter((r) => !player.solved.includes(r.id));
  if (unsolved.length === 0) return null;
  return unsolved[0];
}

// ── Helper: sanitize riddle ──────────────────────────────────────────
function safeRiddle(r) {
  return { id: r.id, riddle: r.riddle, category: r.category };
}

// ── Timer helpers ────────────────────────────────────────────────────
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
// ROUTES
// ══════════════════════════════════════════════════════════════════════

// ── Admin login page ─────────────────────────────────────────────────
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ── Admin login endpoint ─────────────────────────────────────────────
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateToken();
    adminTokens.add(token);
    console.log("🔐 Admin logged in");
    return res.json({ success: true, token, pin: gamePin });
  }
  res.status(401).json({ success: false, error: "Wrong password." });
});

// ── Admin logout ─────────────────────────────────────────────────────
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.headers["x-admin-token"] || req.query.token;
  adminTokens.delete(token);
  res.json({ success: true });
});

// ── Admin: get game status ───────────────────────────────────────────
app.get("/api/status", requireAdmin, (_req, res) => {
  res.json({
    state: gameState,
    pin: gamePin,
    playerCount: players.size,
    timerDuration,
    timerRemaining,
    players: getLobbyList(),
  });
});

// ── Admin: regenerate PIN ────────────────────────────────────────────
app.post("/api/pin/regenerate", requireAdmin, (_req, res) => {
  gamePin = generatePin();
  console.log(`🔑 New game PIN: ${gamePin}`);
  res.json({ pin: gamePin });
});

// ── Admin: get leaderboard JSON ──────────────────────────────────────
app.get("/api/leaderboard", requireAdmin, (_req, res) => {
  res.json(getLeaderboard());
});

// ── Admin: start game ────────────────────────────────────────────────
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
  console.log(`🚀 Game started! Timer: ${seconds}s, Players: ${players.size}`);

  for (const [socketId, player] of players) {
    const r = nextRiddle(player);
    const s = io.sockets.sockets.get(socketId);
    if (s) {
      s.emit("game_started", {
        riddle: r ? safeRiddle(r) : null,
        total: riddles.length,
        solved: 0,
        score: 0,
        timeRemaining: seconds,
      });
    }
  }

  io.emit("game_state", { state: gameState });
  io.emit("leaderboard", getLeaderboard());
  startTimer(seconds);

  res.json({ status: "Game started!", timer: seconds, players: players.size });
});

// ── Admin: end game early ────────────────────────────────────────────
app.post("/api/end", requireAdmin, (_req, res) => {
  if (gameState !== "playing") {
    return res.status(400).json({ error: "Game is not running." });
  }
  endGame();
  res.json({ status: "Game ended!" });
});

// ── Admin: reset game ────────────────────────────────────────────────
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
// SOCKET.IO
// ══════════════════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);
  socket.emit("game_state", { state: gameState });

  // ── Player joins with name + PIN ───────────────────────────────────
  socket.on("join", ({ name, pin }) => {
    name = (name || "").trim().substring(0, 30);
    pin = (pin || "").trim();

    if (!name) return socket.emit("error_msg", "Please enter a valid name.");
    if (!pin)  return socket.emit("error_msg", "Please enter the game PIN.");

    // Validate PIN
    if (pin !== gamePin) {
      return socket.emit("error_msg", "Wrong game PIN! Ask your teacher for the correct PIN.");
    }

    // Check duplicate names
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
      solved: [],
      usedHints: [],
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
      const r = nextRiddle(player);
      socket.emit("joined", {
        name,
        riddle: r ? safeRiddle(r) : null,
        total: riddles.length,
        solved: 0,
        score: 0,
        timeRemaining: timerRemaining,
      });
      io.emit("leaderboard", getLeaderboard());
    }

    console.log(`👤 ${name} joined (PIN ✓)  (${players.size} online)`);
  });

  // ── Request hint ───────────────────────────────────────────────────
  socket.on("hint", (riddleId) => {
    if (gameState !== "playing") return;
    const player = players.get(socket.id);
    if (!player) return;
    const r = riddles.find((x) => x.id === riddleId);
    if (!r) return;
    if (!player.usedHints.includes(riddleId)) {
      player.usedHints.push(riddleId);
    }
    socket.emit("hint_response", { id: riddleId, hint: r.hint });
  });

  // ── Submit answer ──────────────────────────────────────────────────
  socket.on("answer", ({ riddleId, answer }) => {
    if (gameState !== "playing") return;
    const player = players.get(socket.id);
    if (!player) return;
    const r = riddles.find((x) => x.id === riddleId);
    if (!r) return;
    if (player.solved.includes(riddleId)) return;

    const correct = answer.trim().toLowerCase() === r.answer.trim().toLowerCase();

    if (correct) {
      player.solved.push(riddleId);
      const usedHint = player.usedHints.includes(riddleId);
      const points = usedHint ? 5 : 10;
      player.score += points;

      const next = nextRiddle(player);
      socket.emit("result", {
        correct: true,
        points,
        usedHint,
        score: player.score,
        solved: player.solved.length,
        total: riddles.length,
        nextRiddle: next ? safeRiddle(next) : null,
      });
      io.emit("leaderboard", getLeaderboard());
    } else {
      socket.emit("result", { correct: false });
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────
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

// ── Start server ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🎮 Riddle Quest server running!`);
  console.log(`   Local:     http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/admin`);
  console.log(`   Admin Pass: ${ADMIN_PASSWORD}`);
  console.log(`   Game PIN:   ${gamePin}`);
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`   Network:   http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`\n   Share the Network URL + Game PIN with your students!\n`);
});
