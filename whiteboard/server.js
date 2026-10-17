const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'rooms.json');
const ID_RE = /^[a-z0-9-]{3,32}$/i;
const MAX_POINTS_PER_STROKE = 5000;
const MAX_STROKES_PER_ROOM = 5000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- State: roomId -> { strokes: [] }. Persisted to disk (debounced). ----
const rooms = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [id, strokes] of Object.entries(saved)) rooms.set(id, { strokes });
} catch { /* first run */ }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const [id, r] of rooms) out[id] = r.strokes;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(out), (err) => err && console.error('save failed', err));
  }, 1000);
}

// ---- Validation helpers (never trust the client) ----
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function cleanPoints(pts) {
  if (!Array.isArray(pts)) return [];
  return pts
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [clamp(p[0], 0, 1600), clamp(p[1], 0, 1000)]);
}
const cleanColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#1d2733');

// ---- HTTP ----
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (req, res) => res.redirect('/b/' + Math.random().toString(36).slice(2, 8)));
app.get('/b/:id', (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Realtime ----
io.on('connection', (socket) => {
  let roomId = null;
  let clientId = null;
  const room = () => (roomId ? rooms.get(roomId) : null);
  const presence = () => io.sockets.adapter.rooms.get(roomId)?.size || 0;

  socket.on('join', (msg) => {
    if (!msg || !ID_RE.test(msg.room) || typeof msg.clientId !== 'string') return;
    roomId = msg.room;
    clientId = msg.clientId.slice(0, 64);
    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, { strokes: [] });
    socket.emit('init', { strokes: rooms.get(roomId).strokes });
    io.to(roomId).emit('presence', presence());
  });

  socket.on('stroke:start', (s) => {
    const r = room();
    if (!r || !s || typeof s.id !== 'string') return;
    if (r.strokes.length >= MAX_STROKES_PER_ROOM) return;
    if (r.strokes.some((x) => x.id === s.id)) return; // dedupe (reconnect resends)
    const stroke = {
      id: s.id.slice(0, 64),
      userId: clientId,
      color: cleanColor(s.color),
      width: clamp(Number(s.width) || 4, 1, 80),
      points: cleanPoints(s.points).slice(0, MAX_POINTS_PER_STROKE),
    };
    r.strokes.push(stroke);
    socket.to(roomId).emit('stroke:start', stroke);
    scheduleSave();
  });

  socket.on('stroke:points', (msg) => {
    const r = room();
    if (!r || !msg) return;
    const stroke = [...r.strokes].reverse().find((x) => x.id === msg.id && x.userId === clientId);
    if (!stroke) return;
    const pts = cleanPoints(msg.points).slice(0, MAX_POINTS_PER_STROKE - stroke.points.length);
    if (!pts.length) return;
    stroke.points.push(...pts);
    socket.to(roomId).emit('stroke:points', { id: stroke.id, points: pts });
    scheduleSave();
  });

  // Per-user undo: removes this user's most recent stroke, even if others drew after.
  socket.on('undo', () => {
    const r = room();
    if (!r) return;
    for (let i = r.strokes.length - 1; i >= 0; i--) {
      if (r.strokes[i].userId === clientId) {
        const [removed] = r.strokes.splice(i, 1);
        io.to(roomId).emit('stroke:remove', removed.id);
        scheduleSave();
        break;
      }
    }
  });

  socket.on('clear', () => {
    const r = room();
    if (!r) return;
    r.strokes = [];
    io.to(roomId).emit('clear');
    scheduleSave();
  });

  socket.on('cursor', (c) => {
    if (!roomId || !c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
    socket.to(roomId).volatile.emit('cursor', { id: clientId, x: c.x, y: c.y, color: cleanColor(c.color) });
  });

  socket.on('disconnect', () => {
    if (!roomId) return;
    socket.to(roomId).emit('cursor:gone', clientId);
    io.to(roomId).emit('presence', presence());
  });
});

server.listen(PORT, () => console.log(`Whiteboard running on http://localhost:${PORT}`));
