# Towa’s Whiteboards

A real-time collaborative whiteboard you can run yourself. Create a room, share the link, and draw together with live
cursors, chat, shapes, undo and redo. Rooms can be private, capped in size, and delete themselves automatically.

Built with **Node.js, Express, Socket.IO and the HTML Canvas**. There is no frontend framework and no build step.

## Features

**Drawing**
- Pen, eraser (real erasing, not white paint), line, rectangle and ellipse. Hold Shift for straight lines, squares and circles.
- 13 preset colors plus a color wheel, brush size slider, optional grid.
- Per-user undo and redo that only touch your own strokes, even after a reconnect.
- Download the board as a PNG.
- The mouse cursor changes to match the selected tool (pencil in your pen color, eraser).
- Keyboard shortcuts: `P` pen, `E` eraser, `L` line, `R` rectangle, `O` ellipse, `Ctrl+Z` undo, `Ctrl+Y` redo.

**Collaboration**
- Live cursors with name tags, one per connection.
- Room chat with history and an unread badge.
- Reconnect handling: strokes drawn while offline are re-sent when the connection returns.
- Presence counter showing people in the room against its capacity.

**Rooms**
- Home screen with a tab for every room, each showing a live preview of the board, who is in it and when it will be deleted.
- Create-room popup: name, capacity (default 20), lifetime (1, 7 or 30 days), password protection, listed or unlisted,
  blurred home page preview, and "only I can clear the board".
- Rooms delete themselves when their timer ends (30 days at most).
- Private rooms ask for a password. Their previews are always blurred.

**Personalization (saved in your browser)**
- Required name popup on your first visit.
- Hover-out settings sidebar: dark or light theme (dark by default), custom blurred background image with blur and dim
  sliders, grid, cursor visibility, cursor names, chat visibility, and reset.
- Pen color and size are remembered.

## Project structure

    server.js              Express server, REST API, Socket.IO events, room storage and cleanup
    public/
      home.html            Home screen: room tabs with previews, create-room popup
      index.html           The board: canvas, tools, chat, cursors
      sidebar.js           Name popup, theme, background and settings sidebar (shared by both pages)
      theme.css            Dark and light theme variables and shared component styles
      images/              Backgrounds, banner and icons
    data/rooms.json        Created at runtime, holds saved rooms

## How it works

- **Stroke model:** `{ id, userId, color, width, erase, points: [[x, y], ...] }` on a fixed 1600x1000 logical canvas,
  so every screen size renders the same board. The canvas is transparent, so the eraser uses `destination-out`.
- **Server is the source of truth,** so every client converges on the same stroke order.
- **Socket.IO events:** `join` then `init`; `stroke:start`, `stroke:points` (batched about every 40 ms), `stroke:add`,
  `stroke:remove`, `undo`, `redo`, `clear`, `chat`, `cursor` (volatile), `presence`, `join:denied`, `room:gone`.
- **REST API:** `GET /api/rooms`, `POST /api/rooms`, and `GET /api/rooms/:id/preview.svg`.
- **Previews:** the server renders each board as a small SVG (cached until the board changes). Blurring happens on the
  server, so the raw preview URL never leaks a private or blurred board.
- **Cleanup:** an hourly job deletes expired rooms and tells anyone still inside.

## Security notes

- Passwords are stored as salted scrypt hashes and checked on the server before a user can join. Repeated wrong guesses
  disconnect the socket.
- Capacity, ownership and "only the creator can clear" are enforced server-side.
- All client input is validated and length-limited. Names, room names and chat are inserted as text, never as HTML.
- Unlisted rooms are only reachable by link. Anyone with the link to a public room can join it.
