// Hollow Manor room server: lobbies, role pick, round clock, tag authority.
// Run: node server/index.ts   (Node 23.6+ strips TS types natively)
// Serves the built game from ./dist too, so one process is a full deploy.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { COUNTDOWN, HIDER_COLORS, MAX_PLAYERS, NET_HZ, ROUND_TIME, TAG_RANGE } from '../src/config.ts';
import type { ClientMsg, LobbyPlayer, PlayerState, ServerMsg } from '../src/net/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(import.meta.dirname, '..', 'dist');

interface Player extends LobbyPlayer {
  ws: WebSocket;
  state: PlayerState | null;
  caught: boolean;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, Player>;
  inGame: boolean;
  hunting: boolean; // false during the blind countdown
  seekerId: string;
  timers: NodeJS.Timeout[];
  ending: boolean;
}

const rooms = new Map<string, Room>();
let nextId = 1;

// ---------------- static file serving (production) ----------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};
const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Hollow Manor server running. Build the client with `npm run build`.');
    return;
  }
  const immutable = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

// ---------------- websocket ----------------
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });

function send(p: { ws: WebSocket }, m: ServerMsg): void {
  if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(m));
}
function broadcast(r: Room, m: ServerMsg, except?: string): void {
  const s = JSON.stringify(m);
  for (const p of r.players.values()) if (p.id !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
}
function lobby(r: Room): LobbyPlayer[] {
  return [...r.players.values()].map(({ id, name, color }) => ({ id, name, color }));
}
function sendRoom(r: Room): void {
  for (const p of r.players.values()) send(p, { t: 'room', code: r.code, you: p.id, hostId: r.hostId, players: lobby(r), inGame: r.inGame });
}
function makeCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c: string;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
}
function cleanName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);
  return s || 'Kid';
}
function freeColor(r: Room): number {
  const used = new Set([...r.players.values()].map((p) => p.color));
  return HIDER_COLORS.find((c) => !used.has(c)) ?? HIDER_COLORS[0];
}

function startRound(r: Room): void {
  r.inGame = true;
  r.ending = false;
  const ids = [...r.players.keys()];
  r.seekerId = ids[Math.floor(Math.random() * ids.length)];
  for (const p of r.players.values()) {
    p.state = null;
    p.caught = false;
  }
  broadcast(r, { t: 'start', seed: (Math.random() * 1e9) | 0, seekerId: r.seekerId, players: lobby(r), countdown: COUNTDOWN, round: ROUND_TIME });
  r.hunting = false;
  r.timers.push(
    setTimeout(() => {
      r.hunting = true;
      broadcast(r, { t: 'hunt' });
    }, COUNTDOWN * 1000),
  );
  r.timers.push(setTimeout(() => endRound(r, true), (COUNTDOWN + ROUND_TIME) * 1000));
}

function endRound(r: Room, hidersWin: boolean): void {
  if (!r.inGame) return;
  for (const t of r.timers) clearTimeout(t);
  r.timers = [];
  r.inGame = false;
  r.hunting = false;
  broadcast(r, { t: 'end', hidersWin });
  sendRoom(r);
}

function catchHider(r: Room, id: string): void {
  const p = r.players.get(id);
  if (!p || p.caught || id === r.seekerId) return;
  p.caught = true;
  broadcast(r, { t: 'caught', id });
  const left = [...r.players.values()].filter((x) => x.id !== r.seekerId && !x.caught);
  if (!left.length && !r.ending) {
    r.ending = true;
    r.timers.push(setTimeout(() => endRound(r, false), 1800));
  }
}

function leave(p: Player, r: Room): void {
  r.players.delete(p.id);
  if (!r.players.size) {
    for (const t of r.timers) clearTimeout(t);
    rooms.delete(r.code);
    return;
  }
  if (r.hostId === p.id) r.hostId = r.players.keys().next().value!;
  broadcast(r, { t: 'left', id: p.id });
  if (r.inGame) {
    const hiders = [...r.players.values()].filter((x) => x.id !== r.seekerId);
    if (p.id === r.seekerId || !hiders.length) endRound(r, p.id === r.seekerId);
    else if (hiders.every((x) => x.caught)) endRound(r, false);
  }
  sendRoom(r);
}

wss.on('connection', (ws) => {
  let me: Player | null = null;
  let room: Room | null = null;

  ws.on('message', (raw) => {
    let m: ClientMsg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'create' || m.t === 'join') {
      if (room) return;
      let r: Room | undefined;
      if (m.t === 'create') {
        r = { code: makeCode(), hostId: '', players: new Map(), inGame: false, hunting: false, seekerId: '', timers: [], ending: false };
        rooms.set(r.code, r);
      } else {
        r = rooms.get(String(m.code).toUpperCase().trim());
        if (!r) return send({ ws }, { t: 'error', msg: 'Room not found. Check the code.' });
        if (r.inGame) return send({ ws }, { t: 'error', msg: 'That round is already running. Try again when it ends.' });
        if (r.players.size >= MAX_PLAYERS) return send({ ws }, { t: 'error', msg: 'Room is full.' });
      }
      me = { id: `p${nextId++}`, name: cleanName(m.name), color: freeColor(r), ws, state: null, caught: false };
      r.players.set(me.id, me);
      if (!r.hostId) r.hostId = me.id;
      room = r;
      sendRoom(r);
      return;
    }
    if (!me || !room) return;
    const r = room;
    switch (m.t) {
      case 'leave':
        leave(me, r);
        room = null;
        me = null;
        break;
      case 'start':
        if (me.id === r.hostId && !r.inGame && r.players.size >= 2) startRound(r);
        break;
      case 'st':
        if (r.inGame && Array.isArray(m.s) && m.s.length === 6 && m.s.every((v) => typeof v === 'number' && Number.isFinite(v))) me.state = m.s;
        break;
      case 'door':
        if (r.inGame && Number.isInteger(m.id)) broadcast(r, { t: 'door', id: m.id, open: !!m.open }, me.id);
        break;
      case 'tag': {
        if (!r.hunting || me.id !== r.seekerId || !me.state) break;
        const target = r.players.get(String(m.id));
        if (!target?.state || target.caught || target.state[4] !== -1) break;
        // generous slack for latency; client already checked the tight range
        if (Math.hypot(target.state[0] - me.state[0], target.state[1] - me.state[1]) <= TAG_RANGE + 1.2) catchHider(r, target.id);
        break;
      }
      case 'check': {
        if (!r.hunting || me.id !== r.seekerId || !me.state) break;
        const occ = [...r.players.values()].find((p) => !p.caught && p.id !== r.seekerId && p.state?.[4] === m.spot);
        const ok = occ?.state && Math.hypot(occ.state[0] - me.state[0], occ.state[1] - me.state[1]) < 4;
        send(me, { t: 'checked', spot: m.spot, found: !!ok });
        if (ok) catchHider(r, occ.id);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (me && room) leave(me, room);
  });
});

// Snapshots: the seeker never learns which spot a hider is in.
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.inGame) continue;
    const all: Record<string, PlayerState> = {};
    for (const p of r.players.values()) if (p.state) all[p.id] = p.state;
    const masked: Record<string, PlayerState> = {};
    // hidden hiders: coarse 4-unit position only (enough for the lantern-flicker tell, not the exact spot)
    const coarse = (v: number) => Math.round(v / 4) * 4;
    for (const [id, s] of Object.entries(all)) masked[id] = s[4] >= 0 ? [coarse(s[0]), coarse(s[1]), 0, s[3], -2, 0] : s;
    const full = JSON.stringify({ t: 'snap', p: all } satisfies ServerMsg);
    const forSeeker = JSON.stringify({ t: 'snap', p: masked } satisfies ServerMsg);
    for (const p of r.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(p.id === r.seekerId ? forSeeker : full);
  }
}, 1000 / NET_HZ);

http.listen(PORT, () => console.log(`Hollow Manor server on http://localhost:${PORT}  (ws: /ws)`));
