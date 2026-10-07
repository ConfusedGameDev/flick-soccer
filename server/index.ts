import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { newSeed } from '../src/engine/seeds';
import type { Team } from '../src/engine/types';
import { CODE_ALPHABET, CODE_LENGTH, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { Room } from './room';

// Match server: one process, rooms in memory, JSON over WebSocket.
// GET /health answers 200 for Fly's checks.

const PORT = Number(process.env.PORT ?? 8787);
/** Rooms with no activity for this long are dropped. */
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

interface Seat {
  room: Room;
  side: Team;
}

const rooms = new Map<string, { room: Room; sockets: Partial<Record<Team, WebSocket>>; touched: number }>();

const makeCode = (): string => {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
};
const makeToken = (): string => randomBytes(12).toString('base64url');

function createRoom(): Room {
  const code = makeCode();
  const entry = { room: null as unknown as Room, sockets: {} as Partial<Record<Team, WebSocket>>, touched: Date.now() };
  const room = new Room(
    code,
    newSeed(),
    {
      send: (side, msg) => {
        const ws = entry.sockets[side];
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
      schedule: (fn, ms) => {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      },
      now: () => Date.now(),
    },
    makeToken,
  );
  entry.room = room;
  rooms.set(code, entry);
  return room;
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok rooms=${rooms.size}`);
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  let seat: Seat | null = null;
  const reply = (msg: ServerMessage) => ws.send(JSON.stringify(msg));

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data)) as ClientMessage;
    } catch {
      return;
    }
    if (msg.t === 'create') {
      const room = createRoom();
      const side = room.seat(msg.kit)!;
      rooms.get(room.code)!.sockets[side] = ws;
      seat = { room, side };
      reply({ t: 'created', code: room.code, token: room.tokens[side], side });
      return;
    }
    if (msg.t === 'join') {
      const entry = rooms.get(String(msg.code).toUpperCase());
      if (!entry) return reply({ t: 'error', message: 'No match with that code' });
      if (entry.room.full) return reply({ t: 'error', message: 'That match is full' });
      entry.touched = Date.now();
      // Reply before seating so 'joined' precedes 'start'.
      const side: Team = 'away';
      entry.sockets[side] = ws;
      seat = { room: entry.room, side };
      reply({ t: 'joined', code: entry.room.code, token: entry.room.tokens[side], side });
      entry.room.seat(msg.kit);
      return;
    }
    if (msg.t === 'resume') {
      const entry = rooms.get(String(msg.code).toUpperCase());
      if (!entry) return reply({ t: 'error', message: 'That match is gone' });
      const side = (['home', 'away'] as const).find((s) => entry.room.tokens[s] === msg.token);
      if (!side) return reply({ t: 'error', message: 'Bad token' });
      entry.sockets[side] = ws;
      entry.touched = Date.now();
      seat = { room: entry.room, side };
      entry.room.resume(side);
      return;
    }
    if (!seat) return;
    rooms.get(seat.room.code)!.touched = Date.now();
    seat.room.handle(seat.side, msg);
  });

  ws.on('close', () => {
    // Keep the seat: the player may resume. Rooms expire by TTL.
    if (seat) {
      const entry = rooms.get(seat.room.code);
      if (entry && entry.sockets[seat.side] === ws) delete entry.sockets[seat.side];
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of rooms) if (now - entry.touched > ROOM_TTL_MS) rooms.delete(code);
}, 60_000).unref();

http.listen(PORT, () => console.log(`match server listening on :${PORT}`));
