// Multiplayer room (one Durable Object per room code). The object is the referee:
// it owns the clock, the bomb/ball and validates every answer.
import { DurableObject } from 'cloudflare:workers';
import { getMatcher, matchGuess, normalizeCriterion, playerName, scopeSize } from './data';
import { chainMatcher, chainStart, clubLabel, seasonLabel, teammates } from './chain';
import type { Criterion, RoomClientMsg, RoomGame, RoomPlayer, RoomServerMsg, RoomState } from '../shared/types';

export const ROOM_LIMITS: Record<RoomGame, { min: number; max: number }> = {
  bomb: { min: 2, max: 10 }, duel: { min: 2, max: 2 }, chain: { min: 2, max: 10 }, royale: { min: 2, max: 20 },
};
const CHAIN_LIVES = 2;
const CHAIN_TURN_MS = 20_000;
const ROYALE_ROUND_MS = [30_000, 15_000]; // first round, shortest round (2 s less each round)
const MIN_GUESS_INTERVAL_MS = 150;
const BOMB_LIVES = 2;
const BOMB_FUSE = [15_000, 45_000]; // random fuse length per round, hidden from players
const DUEL_HALF_MS = 20_000; // time for the ball to go from the centre to a player
const DUEL_ACCEL = 1.06; // ball speeds up after each answer
const MIN_THEME_SIZE = 30;

interface Env { DB: D1Database }

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null;
  private sockets = new Map<WebSocket, string>();
  private cited = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chainLast = -1; // chain: last player of the chain
  private lastGuess = new Map<string, number>();

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      const { code, game, criterion } = (await req.json()) as { code: string; game: RoomGame; criterion: Criterion };
      if (this.s) return Response.json({ error: 'exists' }, { status: 409 });
      this.s = { code, game, criterion: normalizeCriterion(criterion), phase: 'lobby', players: [], turn: null, round: 0, cited: [], winner: null, serverNow: Date.now() };
      return Response.json({ ok: true });
    }
    if (!this.s) return new Response('Room not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return Response.json({ game: this.s.game, phase: this.s.phase, players: this.s.players.length });
    const who = JSON.parse(req.headers.get('X-Player') ?? 'null') as Pick<RoomPlayer, 'id' | 'pseudo' | 'club' | 'country'> | null;
    if (!who) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const send = (m: RoomServerMsg) => server.send(JSON.stringify(m));
    let p = this.s.players.find((x) => x.id === who.id);
    if (!p) {
      if (this.s.phase !== 'lobby') { send({ t: 'error', message: 'started' }); server.close(4000, 'started'); return new Response(null, { status: 101, webSocket: client }); }
      if (this.s.players.length >= ROOM_LIMITS[this.s.game].max) { send({ t: 'error', message: 'full' }); server.close(4001, 'full'); return new Response(null, { status: 101, webSocket: client }); }
      p = { ...who, lives: 0, connected: true, host: this.s.players.length === 0 };
      this.s.players.push(p);
    }
    p.connected = true;
    this.sockets.set(server, who.id);
    send({ t: 'you', id: who.id });
    server.addEventListener('message', (ev) => {
      try { this.onMessage(who.id, JSON.parse(String(ev.data)) as RoomClientMsg, send); } catch { send({ t: 'error', message: 'bad_message' }); }
    });
    const onClose = () => {
      this.sockets.delete(server);
      const still = [...this.sockets.values()].includes(who.id);
      const pl = this.s?.players.find((x) => x.id === who.id);
      if (pl && !still) {
        pl.connected = false;
        if (this.s!.phase === 'lobby') {
          this.s!.players = this.s!.players.filter((x) => x.id !== who.id);
          if (pl.host && this.s!.players[0]) this.s!.players[0].host = true;
        }
      }
      this.broadcast();
    };
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(id: string, msg: RoomClientMsg, send: (m: RoomServerMsg) => void) {
    const s = this.s!;
    const me = s.players.find((p) => p.id === id);
    if (!me) return;
    if (msg.t === 'criterion') {
      if (!me.host || s.phase === 'playing') return;
      const c = normalizeCriterion(msg.criterion ?? {});
      if (scopeSize(c) < MIN_THEME_SIZE) return send({ t: 'error', message: 'theme_too_small' });
      s.criterion = c;
    } else if (msg.t === 'start') {
      if (!me.host || s.phase === 'playing') return;
      const live = s.players.filter((p) => p.connected);
      if (live.length < ROOM_LIMITS[s.game].min) return send({ t: 'error', message: 'not_enough_players' });
      s.players = live;
      this.start();
    } else if (msg.t === 'guess') {
      if (s.phase !== 'playing' || typeof msg.text !== 'string') return;
      const now = Date.now();
      if (now - (this.lastGuess.get(id) ?? 0) < MIN_GUESS_INTERVAL_MS) return;
      this.lastGuess.set(id, now);
      if (s.game === 'royale') {
        if (me.lives > 0) this.royaleGuess(me, msg.text.slice(0, 80), send);
      } else if (s.turn === id) this.guess(me, msg.text.slice(0, 80));
    }
    this.broadcast();
  }

  private start() {
    const s = this.s!;
    s.phase = 'playing';
    s.cited = [];
    this.cited.clear();
    s.winner = null;
    s.lastEvent = undefined;
    s.round = 1;
    s.chain = undefined;
    s.deadline = undefined;
    for (const p of s.players) { p.lives = s.game === 'bomb' ? BOMB_LIVES : s.game === 'chain' ? CHAIN_LIVES : 1; p.found = 0; p.roundFound = 0; }
    if (s.game === 'chain') {
      s.turn = s.players[Math.floor(Math.random() * s.players.length)].id;
      this.newChain();
      if (s.phase === 'playing') this.armTurn();
    } else if (s.game === 'royale') {
      s.turn = null;
      this.armRound();
    } else if (s.game === 'bomb') {
      s.turn = s.players[Math.floor(Math.random() * s.players.length)].id;
      this.armFuse();
    } else {
      const dir = Math.random() < 0.5 ? -1 : 1;
      s.ball = { pos: 0.5, dir, speed: 0.5 / DUEL_HALF_MS, at: Date.now() };
      s.turn = s.players[dir === -1 ? 0 : 1].id;
      this.scheduleHit();
    }
  }

  private guess(me: RoomPlayer, text: string) {
    const s = this.s!;
    const matcher = s.game === 'chain' ? chainMatcher(this.chainLast, s.criterion) : getMatcher(s.criterion);
    const res = matchGuess(matcher, text, this.cited);
    if (res.status === 'invalid') return;
    if (res.status !== 'ok') {
      s.lastEvent = { kind: res.status, player: me.id, name: res.player !== undefined ? playerName(res.player) : undefined };
      return;
    }
    this.cited.add(res.player);
    s.cited.push(playerName(res.player));
    s.lastEvent = { kind: 'ok', player: me.id, name: playerName(res.player) };
    me.found = (me.found ?? 0) + 1;
    if (s.game === 'chain') {
      const l = teammates(this.chainLast).get(res.player);
      s.chain!.push({ name: playerName(res.player), ...(l ? { club: clubLabel(l.club), seasons: seasonLabel(l.from, l.to) } : {}) });
      this.chainLast = res.player;
      s.turn = this.nextAlive(me.id);
      this.armTurn();
    } else if (s.game === 'bomb') {
      s.turn = this.nextAlive(me.id);
    } else {
      const b = s.ball!;
      const now = Date.now();
      b.pos = this.ballPos(now);
      b.dir = (b.dir * -1) as -1 | 1;
      b.speed *= DUEL_ACCEL;
      b.at = now;
      s.turn = s.players[b.dir === -1 ? 0 : 1].id;
      this.scheduleHit();
    }
  }

  // ----- Chain of teammates -----
  private newChain() {
    const s = this.s!;
    const start = chainStart(s.criterion);
    if (start === null) { this.end(null); return; }
    this.chainLast = start;
    this.cited.add(start);
    s.chain = [{ name: playerName(start) }];
  }

  private armTurn() {
    if (this.timer) clearTimeout(this.timer);
    this.s!.deadline = Date.now() + CHAIN_TURN_MS;
    this.timer = setTimeout(() => this.turnTimeout(), CHAIN_TURN_MS);
  }

  private turnTimeout() {
    const s = this.s!;
    if (s.phase !== 'playing' || !s.turn) return;
    const holder = s.players.find((p) => p.id === s.turn)!;
    holder.lives--;
    s.lastEvent = { kind: 'timeout', player: holder.id };
    const alive = s.players.filter((p) => p.lives > 0);
    if (alive.length <= 1) return this.end(alive[0]?.id ?? null);
    s.round++;
    // Dead end (every teammate already named): start a new chain.
    const left = [...chainMatcher(this.chainLast, s.criterion).scope.players].some((p) => !this.cited.has(p));
    if (!left) {
      this.newChain();
      if (s.phase !== 'playing') return;
      s.lastEvent = { kind: 'restart', player: holder.id };
    }
    s.turn = this.nextAlive(holder.id);
    this.armTurn();
    this.broadcast();
  }

  // ----- Battle royale: everyone answers at once, the weakest of each round is out -----
  private royaleGuess(me: RoomPlayer, text: string, send: (m: RoomServerMsg) => void) {
    const s = this.s!;
    const res = matchGuess(getMatcher(s.criterion), text, this.cited);
    if (res.status === 'invalid') return;
    if (res.status !== 'ok') {
      send({ t: 'outcome', outcome: res.status === 'duplicate' ? { status: 'duplicate', name: playerName(res.player) } : { status: 'wrong', name: res.player !== undefined ? playerName(res.player) : undefined } });
      return;
    }
    this.cited.add(res.player);
    s.cited.push(playerName(res.player));
    me.found = (me.found ?? 0) + 1;
    me.roundFound = (me.roundFound ?? 0) + 1;
    s.lastEvent = { kind: 'ok', player: me.id, name: playerName(res.player) };
    send({ t: 'outcome', outcome: { status: 'ok', name: playerName(res.player) } });
  }

  private armRound() {
    if (this.timer) clearTimeout(this.timer);
    const ms = Math.max(ROYALE_ROUND_MS[1], ROYALE_ROUND_MS[0] - (this.s!.round - 1) * 2000);
    this.s!.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.endRound(), ms);
  }

  private endRound() {
    const s = this.s!;
    if (s.phase !== 'playing') return;
    const alive = s.players.filter((p) => p.lives > 0);
    const min = Math.min(...alive.map((p) => p.roundFound ?? 0));
    const losers = alive.filter((p) => (p.roundFound ?? 0) === min);
    if (losers.length < alive.length) {
      for (const p of losers) p.lives = 0;
      s.lastEvent = { kind: 'out', player: losers[0].id, players: losers.map((p) => p.id) };
    } else if (min === 0 && s.round >= 3) {
      // Nobody can answer any more: the best total wins.
      const best = Math.max(...alive.map((p) => p.found ?? 0));
      const top = alive.filter((p) => (p.found ?? 0) === best);
      return this.end(top.length === 1 ? top[0].id : null);
    } else s.lastEvent = undefined;
    for (const p of s.players) p.roundFound = 0;
    const still = s.players.filter((p) => p.lives > 0);
    if (still.length <= 1) return this.end(still[0]?.id ?? null);
    s.round++;
    this.armRound();
    this.broadcast();
  }

  private end(winner: string | null) {
    const s = this.s!;
    if (this.timer) clearTimeout(this.timer);
    s.phase = 'ended';
    s.winner = winner;
    s.turn = null;
    s.deadline = undefined;
    this.broadcast();
  }

  private nextAlive(fromId: string): string {
    const ps = this.s!.players;
    const i = ps.findIndex((p) => p.id === fromId);
    for (let k = 1; k <= ps.length; k++) {
      const p = ps[(i + k) % ps.length];
      if (p.lives > 0) return p.id;
    }
    return fromId;
  }

  private armFuse() {
    if (this.timer) clearTimeout(this.timer);
    const ms = BOMB_FUSE[0] + Math.random() * (BOMB_FUSE[1] - BOMB_FUSE[0]);
    this.timer = setTimeout(() => this.boom(), ms);
  }

  private boom() {
    const s = this.s!;
    if (s.phase !== 'playing' || !s.turn) return;
    const holder = s.players.find((p) => p.id === s.turn)!;
    holder.lives--;
    s.lastEvent = { kind: 'boom', player: holder.id };
    const alive = s.players.filter((p) => p.lives > 0);
    if (alive.length <= 1) {
      s.phase = 'ended';
      s.winner = alive[0]?.id ?? null;
      s.turn = null;
    } else {
      s.round++;
      s.turn = holder.lives > 0 ? holder.id : this.nextAlive(holder.id);
      this.armFuse();
    }
    this.broadcast();
  }

  private ballPos(now: number) {
    const b = this.s!.ball!;
    return Math.min(1, Math.max(0, b.pos + b.dir * b.speed * (now - b.at)));
  }

  private scheduleHit() {
    if (this.timer) clearTimeout(this.timer);
    const b = this.s!.ball!;
    const dist = b.dir === -1 ? b.pos : 1 - b.pos;
    this.timer = setTimeout(() => this.hit(), dist / b.speed);
  }

  private hit() {
    const s = this.s!;
    if (s.phase !== 'playing') return;
    const loser = s.players.find((p) => p.id === s.turn)!;
    loser.lives = 0;
    s.lastEvent = { kind: 'hit', player: loser.id };
    s.phase = 'ended';
    s.winner = s.players.find((p) => p.id !== loser.id)?.id ?? null;
    s.ball!.pos = s.ball!.dir === -1 ? 0 : 1;
    s.ball!.at = Date.now();
    s.ball!.speed = 0;
    s.turn = null;
    this.broadcast();
  }

  private broadcast() {
    if (!this.s) return;
    this.s.serverNow = Date.now();
    const msg = JSON.stringify({ t: 'state', state: this.s } satisfies RoomServerMsg);
    for (const ws of this.sockets.keys()) {
      try { ws.send(msg); } catch { /* closed */ }
    }
  }
}
