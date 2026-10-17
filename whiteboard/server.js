const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'rooms.json');
const DAY = 24 * 60 * 60 * 1000;
const EXPIRY_CHOICES_DAYS = [1, 7, 30]; // 30 days (1 month) is the longest a room can live
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
const MAX_ROOMS = 200;
const DEFAULT_CAPACITY = 20;
const MAX_MESSAGES = 200;
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

// ---- Passwords: salted scrypt hashes, never stored in plain text ----
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
function checkPw(room, pw) {
  if (!room.pw) return true;
  if (typeof pw !== 'string' || !pw) return false;
  const h = crypto.scryptSync(pw.slice(0, 64), room.pw.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(room.pw.hash, 'hex'));
}

// ---- State: roomId -> room. Persisted to disk (debounced). ----
// room = { name, createdAt, expiresAt, capacity, listed, ownerOnlyClear, ownerKey, pw, strokes, messages }
const rooms = new Map();
function normalizeRoom(id, v) {
  const strokes = Array.isArray(v) ? v : Array.isArray(v && v.strokes) ? v.strokes : null;
  if (!strokes) return null;
  const o = Array.isArray(v) ? {} : v;
  const createdAt = Number(o.createdAt) || Date.now();
  return {
    name: cleanRoomName(o.name) || id,
    createdAt,
    expiresAt: Number(o.expiresAt) || createdAt + 30 * DAY,
    capacity: clamp(Math.round(Number(o.capacity)) || DEFAULT_CAPACITY, 2, 100),
    listed: o.listed !== false,
    blurPreview: !!o.blurPreview,
    updatedAt: Number(o.updatedAt) || createdAt,
    ownerOnlyClear: !!o.ownerOnlyClear,
    ownerKey: typeof o.ownerKey === 'string' ? o.ownerKey : crypto.randomBytes(16).toString('hex'),
    pw: o.pw && o.pw.salt && o.pw.hash ? o.pw : null,
    strokes,
    messages: Array.isArray(o.messages) ? o.messages.slice(-MAX_MESSAGES) : [],
  };
}
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [id, v] of Object.entries(saved)) {
    const r = normalizeRoom(id, v);
    if (r) rooms.set(id, r);
  }
} catch { /* first run */ }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const [id, r] of rooms) out[id] = r;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(out), (err) => err && console.error('save failed', err));
  }, 1000);
}

// People in a room, counted by clientId (a reconnecting user is not counted twice)
function clientsIn(id) {
  const out = new Set();
  for (const sid of io.sockets.adapter.rooms.get(id) || []) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.clientId) out.add(s.data.clientId);
  }
  return out;
}

function makeId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '') || 'room';
  return slug + '-' + crypto.randomBytes(3).toString('hex');
}

// ---- Redo stacks (per user, in memory) and home-page previews ----
const redoStacks = new Map(); // "roomId:clientId" -> [stroke]
const touch = (r) => { r.updatedAt = Date.now(); };
const previewCache = new Map(); // roomId -> { at, svg }

// Draws the board as a small SVG for the home page. Private rooms and rooms with "blur preview" are blurred server-side,
// so the raw preview URL never reveals the drawing.
function buildPreview(r) {
  const blur = r.blurPreview || !!r.pw;
  const paths = [];
  for (const s of r.strokes.slice(-1500)) {
    const pts = s.points;
    if (!pts || !pts.length) continue;
    const step = Math.max(1, Math.ceil(pts.length / 120));
    let d = 'M' + Math.round(pts[0][0]) + ' ' + Math.round(pts[0][1]);
    if (pts.length === 1) d += 'l0 0';
    for (let i = step; i < pts.length; i += step) d += 'L' + Math.round(pts[i][0]) + ' ' + Math.round(pts[i][1]);
    const last = pts[pts.length - 1];
    if ((pts.length - 1) % step) d += 'L' + Math.round(last[0]) + ' ' + Math.round(last[1]);
    paths.push('<path d="' + d + '" stroke="' + (s.erase ? '#ffffff' : cleanColor(s.color)) + '" stroke-width="' + Math.max(1, Math.round(s.width)) + '"/>');
  }
  const g = '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' + paths.join('') + '</g>';
  const body = blur
    ? '<defs><filter id="b" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="40"/></filter></defs><g filter="url(#b)">' + g + '</g>'
    : g;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="800" height="500"><rect width="1600" height="1000" fill="#ffffff"/>' + body + '</svg>';
}

// ---- Auto-delete expired rooms ----
function deleteExpired() {
  const now = Date.now();
  let changed = false;
  for (const [id, r] of rooms) {
    if (now >= r.expiresAt) {
      rooms.delete(id);
      previewCache.delete(id);
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
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

app.get('/api/rooms', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = [...rooms.entries()]
    .filter(([, r]) => r.listed)
    .map(([id, r]) => ({
      id, name: r.name, people: clientsIn(id).size, capacity: r.capacity,
      private: !!r.pw, createdAt: r.createdAt, expiresAt: r.expiresAt, updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.post('/api/rooms', (req, res) => {
  if (rooms.size >= MAX_ROOMS) return res.status(429).json({ error: 'Too many rooms right now. Try again later.' });
  const b = req.body || {};
  const name = cleanRoomName(b.name) || 'Untitled room';
  const capacity = clamp(Math.round(Number(b.capacity)) || DEFAULT_CAPACITY, 2, 100);
  const days = EXPIRY_CHOICES_DAYS.includes(Number(b.expiryDays)) ? Number(b.expiryDays) : 30;
  let pw = null;
  if (b.private) {
    const p = typeof b.password === 'string' ? b.password : '';
    if (p.length < 4 || p.length > 64) return res.status(400).json({ error: 'Choose a password of 4 to 64 characters.' });
    pw = hashPw(p);
  }
  const id = makeId(name);
  const ownerKey = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  rooms.set(id, {
    name, createdAt: now, expiresAt: now + days * DAY, capacity, listed: b.listed !== false,
    ownerOnlyClear: !!b.ownerOnlyClear, blurPreview: !!b.blurPreview, updatedAt: now, ownerKey, pw, strokes: [], messages: [],
  });
  scheduleSave();
  res.status(201).json({ id, name, ownerKey });
});

app.get('/api/rooms/:id/preview.svg', (req, res) => {
  const r = ID_RE.test(req.params.id) && rooms.get(req.params.id);
  if (!r) return res.status(404).end();
  let c = previewCache.get(req.params.id);
  if (!c || c.at !== r.updatedAt) { c = { at: r.updatedAt, svg: buildPreview(r) }; previewCache.set(req.params.id, c); }
  res.set('Cache-Control', 'public, max-age=300'); // the page asks with ?v=<updatedAt>, so a changed board gets a new URL
  res.type('image/svg+xml').send(c.svg);
});

app.get('/b/:id', (req, res) => {
  if (!ID_RE.test(req.params.id) || !rooms.has(req.params.id)) return res.redirect('/?missing=1');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Realtime ----
io.on('connection', (socket) => {
  let roomId = null;
  let clientId = null;
  let isOwner = false;
  const room = () => (roomId ? rooms.get(roomId) : null);
  const redoKey = () => roomId + ':' + clientId;
  const announce = () => {
    const r = room();
    if (r) io.to(roomId).emit('presence', { count: clientsIn(roomId).size, capacity: r.capacity });
  };

  socket.on('join', (msg) => {
    if (!msg || !ID_RE.test(msg.room) || typeof msg.clientId !== 'string') return;
    const r = rooms.get(msg.room);
    if (!r) return socket.emit('room:gone');
    if (!checkPw(r, msg.password)) {
      socket.data.fails = (socket.data.fails || 0) + 1;
      if (socket.data.fails > 8) return socket.disconnect(true); // stop password guessing
      return socket.emit('join:denied', { reason: msg.password ? 'wrong-password' : 'password' });
    }
    const cid = msg.clientId.slice(0, 64);
    const present = clientsIn(msg.room);
    if (!present.has(cid) && present.size >= r.capacity) return socket.emit('join:denied', { reason: 'full' });

    if (roomId && roomId !== msg.room) socket.leave(roomId);
    roomId = msg.room;
    clientId = cid;
    socket.data.clientId = cid;
    isOwner = typeof msg.ownerKey === 'string' && msg.ownerKey === r.ownerKey;
    socket.join(roomId);
    socket.emit('init', {
      strokes: r.strokes, messages: r.messages, name: r.name,
      expiresAt: r.expiresAt, capacity: r.capacity, ownerOnlyClear: r.ownerOnlyClear, isOwner,
    });
    announce();
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
      erase: !!s.erase,
      points: cleanPoints(s.points).slice(0, MAX_POINTS_PER_STROKE),
    };
    r.strokes.push(stroke);
    redoStacks.delete(redoKey()); // drawing something new ends the redo history
    touch(r);
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
    touch(r);
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
        const k = redoKey(); const st = redoStacks.get(k) || [];
        st.push(removed); if (st.length > 50) st.shift(); redoStacks.set(k, st);
        touch(r);
        io.to(roomId).emit('stroke:remove', removed.id);
        scheduleSave();
        break;
      }
    }
  });

  socket.on('redo', () => {
    const r = room();
    if (!r) return;
    const stack = redoStacks.get(redoKey());
    const stroke = stack && stack.pop();
    if (!stroke || r.strokes.length >= MAX_STROKES_PER_ROOM) return;
    r.strokes.push(stroke);
    touch(r);
    io.to(roomId).emit('stroke:add', stroke);
    scheduleSave();
  });

  socket.on('clear', () => {
    const r = room();
    if (!r) return;
    if (r.ownerOnlyClear && !isOwner) return socket.emit('notice', 'Only the room creator can clear this board.');
    r.strokes = [];
    touch(r);
    for (const k of redoStacks.keys()) if (k.startsWith(roomId + ':')) redoStacks.delete(k);
    io.to(roomId).emit('clear');
    scheduleSave();
  });

  socket.on('chat', (m) => {
    const r = room();
    if (!r || !m) return;
    const text = stripText(m.text).slice(0, 300);
    const now = Date.now();
    if (!text || now - (socket.data.lastChat || 0) < 400) return; // basic flood control
    socket.data.lastChat = now;
    const msg = { id: crypto.randomBytes(4).toString('hex'), from: clientId, name: cleanName(m.name) || 'Guest', text, ts: now };
    r.messages.push(msg);
    if (r.messages.length > MAX_MESSAGES) r.messages.shift();
    io.to(roomId).emit('chat', msg);
    scheduleSave();
  });

  // Cursor ids are per connection (socket.id), so two tabs in one browser stay distinct.
  socket.on('cursor', (c) => {
    if (!roomId || !c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
    socket.to(roomId).volatile.emit('cursor', {
      id: socket.id, x: clamp(c.x, 0, 1600), y: clamp(c.y, 0, 1000), color: cleanColor(c.color), name: cleanName(c.name),
    });
  });

  socket.on('disconnect', () => {
    if (!roomId) return;
    socket.to(roomId).emit('cursor:gone', socket.id);
    announce();
  });
});

server.listen(PORT, () => console.log(`Whiteboard running on http://localhost:${PORT}`));
