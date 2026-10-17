# Collaborative Whiteboard

Real-time shared whiteboard. Open the same `/b/<room>` link in several tabs or devices and draw together.

**Features:** rooms via URL, live strokes and cursors, per-user undo, eraser, board persisted to disk,
reconnect handling (strokes drawn while offline are re-sent), server-side input validation.

## Run

    npm install
    npm start          # http://localhost:3000  (redirects to a new random room)

Open the room URL in two windows to see it sync.

## How it works

- **Stroke model:** `{ id, userId, color, width, points: [[x, y], ...] }` on a fixed 1600x1000 logical canvas,
  so every screen size renders the same board.
- **Protocol (Socket.IO):** `join` -> `init` (full state); `stroke:start`, `stroke:points` (batched every ~40 ms),
  `stroke:remove`, `clear`, `cursor` (volatile, droppable), `presence`.
- **Ordering:** the server is the single source of truth, so every client converges on the same stroke order.
- **Undo:** per user (stable `clientId` in localStorage), so it survives reconnects.
- **Persistence:** in-memory map flushed to `data/rooms.json` (debounced). Swap for Redis or Postgres to scale.

## Deploy

Render, Railway or Fly.io all work: build command `npm install`, start command `npm start`.
Note: free tiers often have an ephemeral disk, so use a managed DB if you want boards to survive redeploys.

## Next steps (these make it resume-worthy)

1. **Load test** with k6 or Artillery and record concurrent users per room and p95 sync latency.
2. **Redis adapter** (`@socket.io/redis-adapter`) to run multiple server instances.
3. **Redo**, plus an object eraser that removes whole strokes instead of painting white.
4. **Auth and saved boards** per account.
5. **Replace the stroke list with a CRDT (Yjs)** for offline-first merging, then write up the trade-offs.
6. Tests for the server handlers and a CI workflow.

## Resume bullet (fill in your own numbers once you measure them)

> Built a real-time collaborative whiteboard (Node.js, Socket.IO, Canvas) with shared rooms, per-user undo,
> reconnect-safe sync and persistence; load-tested to XX concurrent users per room at <XX ms p95 latency.
