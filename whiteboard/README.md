Collaborative Whiteboard

Real-time shared whiteboard. Open the same /b/<room> link in several tabs or devices and draw together.

Features: home screen with a tab for every room, create-room bar, rooms auto-deleted 30 days after creation, optional display name shown on your cursor, custom blurred background image (kept in your browser), live strokes and cursors, per-user undo, eraser, boards persisted to disk, reconnect handling, server-side input validation.

Run
npm install
npm start          # http://localhost:3000  (home screen with the room list)

Open the room URL in two windows to see it sync.

How it works
Stroke model: { id, userId, color, width, points: [[x, y], ...] } on a fixed 1600x1000 logical canvas, so every screen size renders the same board.
Protocol (Socket.IO): join -> init (full state); stroke:start, stroke:points (batched every ~40 ms), stroke:remove, clear, cursor (volatile, droppable), presence.
Ordering: the server is the single source of truth, so every client converges on the same stroke order.
Undo: per user (stable clientId in localStorage), so it survives reconnects.
Persistence: in-memory map flushed to data/rooms.json (debounced). Swap for Redis or Postgres to scale.
Rooms
GET /api/rooms lists rooms, POST /api/rooms {name} creates one. Room IDs look like team-sketch-a1b2c3.
A cleanup job runs hourly and deletes rooms older than ROOM_TTL_MS (30 days from creation, set at the top of server.js). Anyone still inside a deleted room gets a "This room is gone" screen.
All rooms are listed publicly. Add auth or private rooms if you need that.
Deploy

Render, Railway or Fly.io all work: build command npm install, start command npm start. Note: free tiers often have an ephemeral disk, so use a managed DB if you want boards to survive redeploys.