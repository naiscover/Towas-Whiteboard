const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'rooms.json');
const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // rooms are deleted 30 days after creation
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
const MAX_ROOMS = 200;
const ID_RE = /^[a-z0-9-]{3,32}$/i;
const MAX_POINTS_PER_STROKE = 5000;
const MAX_STROKES_PER_ROOM = 5000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- Validation helpers (never trust the client) ----
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function cleanPoints(pts) {
  if (!Array.isArray(pts)) return [];
  return pts
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [clamp(p[0], 0, 1600), clamp(p[1], 0, 1000)]);
}
const cleanColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#1d2733');
const stripText = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim() : '');
const cleanName = (n) => stripText(n).slice(0, 20);
const cleanRoomName = (n) => stripText(n).slice(0, 40);

// ---- State: roomId -> { name, createdAt, strokes }. Persisted to disk (debounced). ----
const rooms = new Map();
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [id, v] of Object.entries(saved)) {
    if (Array.isArray(v)) rooms.set(id, { name: id, createdAt: Date.now(), strokes: v }); // old file format
    else if (v && Array.isArray(v.strokes)) {
      rooms.set(id, { name: cleanRoomName(v.name) || id, createdAt: Number(v.createdAt) || Date.now(), strokes: v.strokes });
    }
  }
} catch { /* first run */ }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const [id, r] of rooms) out[id] = { name: r.name, createdAt: r.createdAt, strokes: r.strokes };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(out), (err) => err && console.error('save failed', err));
  }, 1000);
}

const presence = (id) => io.sockets.adapter.rooms.get(id)?.size || 0;

function makeId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '') || 'room';
  return slug + '-' + crypto.randomBytes(3).toString('hex');
}

// ---- Auto-delete expired rooms ----
function deleteExpired() {
  const now = Date.now();
  let changed = false;
  for (const [id, r] of rooms) {
    if (now - r.createdAt >= ROOM_TTL_MS) {
      rooms.delete(id);
      io.to(id).emit('room:gone');
      io.in(id).socketsLeave(id);
      changed = true;
    }
  }
  if (changed) scheduleSave();
}
deleteExpired();
setInterval(deleteExpired, CLEANUP_EVERY_MS);

// ---- HTTP ----
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/api/rooms', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = [...rooms.entries()]
    .map(([id, r]) => ({ id, name: r.name, people: presence(id), createdAt: r.createdAt, expiresAt: r.createdAt + ROOM_TTL_MS }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.post('/api/rooms', (req, res) => {
  if (rooms.size >= MAX_ROOMS) return res.status(429).json({ error: 'Too many rooms right now. Try again later.' });
  const name = cleanRoomName(req.body && req.body.name) || 'Untitled room';
  const id = makeId(name);
  rooms.set(id, { name, createdAt: Date.now(), strokes: [] });
  scheduleSave();
  res.status(201).json({ id, name });
});

app.get('/b/:id', (req, res) => {
  if (!ID_RE.test(req.params.id) || !rooms.has(req.params.id)) return res.redirect('/?missing=1');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Realtime ----
io.on('connection', (socket) => {
  let roomId = null;
  let clientId = null;
  const room = () => (roomId ? rooms.get(roomId) : null);

  socket.on('join', (msg) => {
    if (!msg || !ID_RE.test(msg.room) || typeof msg.clientId !== 'string') return;
    const r = rooms.get(msg.room);
    if (!r) return socket.emit('room:gone');
    roomId = msg.room;
    clientId = msg.clientId.slice(0, 64);
    socket.join(roomId);
    socket.emit('init', { strokes: r.strokes, name: r.name, expiresAt: r.createdAt + ROOM_TTL_MS });
    io.to(roomId).emit('presence', presence(roomId));
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
    socket.to(roomId).volatile.emit('cursor', { id: clientId, x: c.x, y: c.y, color: cleanColor(c.color), name: cleanName(c.name) });
  });

  socket.on('disconnect', () => {
    if (!roomId) return;
    socket.to(roomId).emit('cursor:gone', clientId);
    io.to(roomId).emit('presence', presence(roomId));
  });
});

server.listen(PORT, () => console.log(`Whiteboard running on http://localhost:${PORT}`));