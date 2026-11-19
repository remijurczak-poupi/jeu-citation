// API Worker: profiles, solo games, daily challenge, leaderboards and private rooms.
import { Hono, type Context } from 'hono';
import { data, normalizeCriterion, scopeSize, criterionKey } from './data';
import { dailyCriterion, dailyNumber, todayKey } from './daily';
import { applyGuess, boardKey, finish, newGame, scoreOf, toState, expire, type GameRow } from './solo';
import { ROOM_LIMITS } from './room';
import { rarityTiers } from './rarity';
import { chainStart } from './chain';
import type { WarRow, Criterion, DailyHistoryItem, DailyInfo, LeaderboardRow, Meta, Ranking, RoomGame, SoloMode } from '../shared/types';
import { MODE_RULES } from '../shared/types';

export { Room } from './room';

interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}
interface Me { id: string; pseudo: string; club: string; country: string }
type C = Context<{ Bindings: Env; Variables: { me: Me | null } }>;

const MIN_THEME_SIZE = 15;
const MAX_GAMES_PER_HOUR = 80;

const app = new Hono<{ Bindings: Env; Variables: { me: Me | null } }>();

// ---------- helpers ----------
async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
/** Recovery code shown to the player, e.g. "K7QH-2MZP-W9XA-C4TR". It is the device secret. */
const newSecret = () => randomCode(16).match(/.{4}/g)!.join('-');
const normSecret = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? '';

const BANNED = ['nazi', 'hitler', 'nigger', 'nigga', 'fuck', 'pute', 'salope', 'encul', 'pd', 'connard', 'bite', 'cunt', 'whore', 'faggot'];
function checkPseudo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}_ .-]{3,16}$/u.test(p)) return null;
  const flat = p.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  if (BANNED.some((b) => (b.length <= 3 ? flat === b : flat.includes(b)))) return null;
  return p;
}
const pseudoNorm = (p: string) => p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const validClub = (c: unknown) => typeof c === 'string' && (c === 'other' || data.clubs.some((x) => x.q === c));
const validCountry = (c: unknown) => typeof c === 'string' && /^([A-Z]{2}|GB-(ENG|SCT|WLS|NIR))$/.test(c);

async function auth(env: Env, id?: string | null, secret?: string | null): Promise<Me | null> {
  if (!id || !secret) return null;
  const row = await env.DB.prepare('SELECT id, pseudo, club, country FROM profiles WHERE id = ? AND secret_hash = ?')
    .bind(id, await sha256(normSecret(secret)))
    .first<Me>();
  return row ?? null;
}

app.use('/api/*', async (c, next) => {
  c.set('me', await auth(c.env, c.req.header('x-device-id'), c.req.header('x-device-secret')));
  await next();
});
const requireMe = (c: C) => {
  const me = c.get('me');
  if (!me) throw new HttpError(401, 'profile_required');
  return me;
};
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

function parseCriterion(raw: unknown): Criterion {
  // normalizeCriterion validates every field (values may be strings when they come from a query string).
  return normalizeCriterion((raw ?? {}) as Criterion);
}

// ---------- meta ----------
let metaCache: Meta | null = null;
app.get('/api/meta', (c) => {
  metaCache ??= {
    firstSeason: data.firstSeason,
    currentSeason: data.currentSeason,
    leagues: data.leagues.map(({ id, name, country }) => ({ id, name, country })),
    clubs: data.clubs.map(({ q, n, nf, l }) => ({ q, n, ...(nf ? { nf } : {}), l })),
    playerCount: data.players.length,
    nationalities: (() => {
      const count = new Map<string, number>();
      for (const p of data.players) for (const c of p.c ?? []) count.set(c, (count.get(c) ?? 0) + 1);
      return [...count].filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    })(),
    tournaments: (() => {
      const years = new Map<string, Set<number>>();
      for (const p of data.players) for (const t of p.t ?? []) {
        const code = t.slice(0, 2);
        (years.get(code) ?? years.set(code, new Set()).get(code)!).add(+t.slice(2));
      }
      return [...years].map(([code, ys]) => ({ code, years: [...ys].sort((a, b) => a - b) }));
    })(),
  };
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(metaCache);
});

app.post('/api/theme/size', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ size: scopeSize(parseCriterion((body as { criterion?: unknown }).criterion)) });
});

// ---------- profile ----------
app.get('/api/profile', (c) => c.json(requireMe(c)));

app.post('/api/profile', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const pseudo = checkPseudo(body.pseudo);
  if (!pseudo) throw new HttpError(400, 'bad_pseudo');
  if (!validClub(body.club)) throw new HttpError(400, 'bad_club');
  if (!validCountry(body.country)) throw new HttpError(400, 'bad_country');
  const me = c.get('me');
  const taken = await c.env.DB.prepare('SELECT id FROM profiles WHERE pseudo_norm = ?').bind(pseudoNorm(pseudo)).first<{ id: string }>();
  if (taken && taken.id !== me?.id) throw new HttpError(409, 'pseudo_taken');
  if (me) {
    await c.env.DB.prepare('UPDATE profiles SET pseudo = ?, pseudo_norm = ?, club = ?, country = ? WHERE id = ?')
      .bind(pseudo, pseudoNorm(pseudo), body.club, body.country, me.id).run();
    return c.json({ id: me.id, pseudo, club: body.club, country: body.country });
  }
  const id = crypto.randomUUID();
  const secret = newSecret();
  await c.env.DB.prepare('INSERT INTO profiles (id, secret_hash, pseudo, pseudo_norm, club, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await sha256(secret), pseudo, pseudoNorm(pseudo), body.club, body.country, Date.now()).run();
  return c.json({ id, secret, pseudo, club: body.club, country: body.country });
});

app.post('/api/profile/recover', async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (typeof code !== 'string') throw new HttpError(400, 'bad_code');
  const secret = normSecret(code);
  const row = await c.env.DB.prepare('SELECT id, pseudo, club, country FROM profiles WHERE secret_hash = ?').bind(await sha256(secret)).first<Me>();
  if (!row) throw new HttpError(404, 'unknown_code');
  return c.json({ ...row, secret });
});

// ---------- solo games ----------
const SOLO_MODES: SoloMode[] = ['timed1', 'timed3', 'timed10', 'unlimited', 'hardcore', 'streak', 'chain', 'daily'];

async function loadGame(c: C, id: string, me: Me): Promise<GameRow> {
  const g = await c.env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<GameRow>();
  if (!g || g.device_id !== me.id) throw new HttpError(404, 'game_not_found');
  return g;
}

/** Saves the game; if it just finished, records the score and citation counts. */
async function saveGame(c: C, g: GameRow, prevVersion: number, wasActive: boolean) {
  g.version = prevVersion + 1;
  const res = await c.env.DB.prepare(
    `UPDATE games SET deadline=?, last_at=?, status=?, found=?, count=?, points=?, errors=?, guesses=?, end_reason=?, version=? WHERE id=? AND version=?`,
  ).bind(g.deadline, g.last_at, g.status, g.found, g.count, g.points, g.errors, g.guesses, g.end_reason, g.version, g.id, prevVersion).run();
  if (!res.meta.changes) throw new HttpError(409, 'concurrent_update');
  if (wasActive && g.status === 'finished') {
    const theme = criterionKey(JSON.parse(g.criterion));
    const found: string[] = JSON.parse(g.found);
    const stmts = [
      c.env.DB.prepare('INSERT OR IGNORE INTO scores (game_id, device_id, board_key, score, count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(g.id, g.device_id, g.board_key, scoreOf(g), g.count, g.last_at),
      ...found.map((q) => c.env.DB.prepare('INSERT INTO citations (theme_key, player, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(theme, q)),
    ];
    for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  }
}

async function rankOf(c: C, g: GameRow) {
  if (g.status !== 'finished') return {};
  const row = await c.env.DB.prepare(
    `WITH best AS (SELECT device_id, MAX(score) AS s FROM scores WHERE board_key = ? GROUP BY device_id)
     SELECT (SELECT COUNT(*) FROM best WHERE s > ?) + 1 AS rank, (SELECT COUNT(*) FROM best) AS total`,
  ).bind(g.board_key, scoreOf(g)).first<{ rank: number; total: number }>();
  return row ? { rank: row.rank, total: row.total } : {};
}

app.post('/api/games', async (c) => {
  const me = requireMe(c);
  const body = (await c.req.json().catch(() => ({}))) as { mode?: SoloMode; criterion?: unknown; date?: string };
  const mode = body.mode;
  if (!mode || !SOLO_MODES.includes(mode)) throw new HttpError(400, 'bad_mode');
  const now = Date.now();
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM games WHERE device_id = ? AND started_at > ?').bind(me.id, now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_GAMES_PER_HOUR) throw new HttpError(429, 'too_many_games');

  let g: GameRow;
  if (mode === 'daily') {
    const today = todayKey(now);
    const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.date <= today && dailyNumber(body.date) >= 1 ? body.date : today;
    const { criterion } = dailyCriterion(date);
    if (date === today) {
      // One ranked attempt per day and per profile.
      const existing = await c.env.DB.prepare('SELECT * FROM games WHERE device_id = ? AND daily_date = ?').bind(me.id, date).first<GameRow>();
      if (existing) {
        const wasActive = existing.status === 'active';
        if (expire(existing, now)) await saveGame(c, existing, existing.version, wasActive);
        return c.json(toState(existing, now, await rankOf(c, existing)));
      }
      g = newGame(crypto.randomUUID(), me.id, 'daily', criterion, now, date);
    } else {
      // Archive: replayable, separate board, no influence on the day's ranking.
      g = newGame(crypto.randomUUID(), me.id, 'timed3', criterion, now);
      g.mode = 'daily';
      g.deadline = now + MODE_RULES.daily.duration! * 1000;
      g.board_key = `archive:${date}`;
    }
  } else {
    const criterion = parseCriterion(body.criterion);
    if (scopeSize(criterion) < MIN_THEME_SIZE) throw new HttpError(400, 'theme_too_small');
    g = newGame(crypto.randomUUID(), me.id, mode, criterion, now);
    if (mode === 'chain') {
      const start = chainStart(criterion);
      if (start === null) throw new HttpError(400, 'theme_too_small');
      g.found = JSON.stringify([data.players[start].q]);
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO games (id, device_id, mode, criterion, board_key, daily_date, started_at, deadline, last_at, status, found, count, points, errors, guesses, end_reason, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, 0)`,
  ).bind(g.id, g.device_id, g.mode, g.criterion, g.board_key, g.daily_date, g.started_at, g.deadline, g.last_at, g.status, g.found).run();
  return c.json(toState(g, now));
});

app.get('/api/games/:id', async (c) => {
  const me = requireMe(c);
  const g = await loadGame(c, c.req.param('id'), me);
  const now = Date.now();
  const wasActive = g.status === 'active';
  if (expire(g, now)) await saveGame(c, g, g.version, wasActive);
  return c.json(toState(g, now, await rankOf(c, g)));
});

app.post('/api/games/:id/guess', async (c) => {
  const me = requireMe(c);
  const { text } = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (typeof text !== 'string') throw new HttpError(400, 'bad_text');
  const g = await loadGame(c, c.req.param('id'), me);
  const now = Date.now();
  const prev = g.version;
  const wasActive = g.status === 'active';
  const { outcome, changed } = applyGuess(g, text.slice(0, 80), now);
  if (changed) await saveGame(c, g, prev, wasActive);
  return c.json({ outcome, state: toState(g, now, await rankOf(c, g)) });
});

app.post('/api/games/:id/finish', async (c) => {
  const me = requireMe(c);
  const g = await loadGame(c, c.req.param('id'), me);
  const now = Date.now();
  const prev = g.version;
  const wasActive = g.status === 'active';
  finish(g, now);
  if (wasActive) await saveGame(c, g, prev, wasActive);
  return c.json(toState(g, now, await rankOf(c, g)));
});

// ---------- daily ----------
app.get('/api/daily', async (c) => {
  const me = c.get('me');
  const date = todayKey();
  const { criterion, difficulty } = dailyCriterion(date);
  let played = null;
  if (me) {
    const g = await c.env.DB.prepare('SELECT * FROM games WHERE device_id = ? AND daily_date = ?').bind(me.id, date).first<GameRow>();
    if (g) {
      const now = Date.now();
      const wasActive = g.status === 'active';
      if (expire(g, now)) await saveGame(c, g, g.version, wasActive);
      played = toState(g, now, await rankOf(c, g));
    }
  }
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board_key = ?').bind(`daily:${date}`).first<{ n: number }>();
  return c.json({ date, number: dailyNumber(date), criterion, difficulty, played, playerCount: n?.n ?? 0 } satisfies DailyInfo);
});

app.get('/api/daily/history', async (c) => {
  const me = c.get('me');
  const today = todayKey();
  const items: DailyHistoryItem[] = [];
  const mine = new Map<string, number>();
  if (me) {
    const rows = await c.env.DB.prepare('SELECT daily_date, count FROM games WHERE device_id = ? AND daily_date IS NOT NULL ORDER BY daily_date DESC LIMIT 60').bind(me.id).all<{ daily_date: string; count: number }>();
    for (const r of rows.results) mine.set(r.daily_date, r.count);
  }
  for (let i = 1; i <= 30; i++) {
    const date = todayKey(Date.parse(today + 'T12:00:00Z') - i * 86400000);
    if (dailyNumber(date) < 1) break;
    const { criterion, difficulty } = dailyCriterion(date);
    items.push({ date, number: dailyNumber(date), criterion, difficulty, myCount: mine.get(date) ?? null });
  }
  return c.json(items);
});

// ---------- leaderboards ----------
app.get('/api/leaderboard', async (c) => {
  const me = c.get('me');
  const q = c.req.query();
  const mode = (q.mode ?? 'daily') as SoloMode;
  if (!SOLO_MODES.includes(mode)) throw new HttpError(400, 'bad_mode');
  const ranking: Ranking = q.ranking === 'rarity' && mode === 'daily' ? 'rarity' : 'count';
  const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayKey();
  const board = mode === 'daily' ? boardKey('daily', {}, date) : boardKey(mode, parseCriterion(q));
  const period = q.period === 'day' ? 86400_000 : q.period === 'week' ? 7 * 86400_000 : null;
  const since = mode === 'daily' || !period ? 0 : Date.now() - period;

  let rows: { device_id: string; score: number }[];
  if (ranking === 'rarity') {
    const games = await c.env.DB.prepare(`SELECT device_id, found FROM games WHERE daily_date = ? AND status = 'finished'`).bind(date).all<{ device_id: string; found: string }>();
    const founds = games.results.map((g) => JSON.parse(g.found) as string[]);
    const tiers = rarityTiers(founds);
    rows = games.results.map((g, i) => ({ device_id: g.device_id, score: founds[i].reduce((s, q2) => s + (tiers.get(q2) ?? 1), 0) }));
  } else {
    const res = await c.env.DB.prepare(
      `SELECT device_id, MAX(score) AS score FROM scores WHERE board_key = ? AND created_at >= ? GROUP BY device_id`,
    ).bind(board, since).all<{ device_id: string; score: number }>();
    rows = res.results;
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 50);
  const myIdx = me ? rows.findIndex((r) => r.device_id === me.id) : -1;
  const ids = [...new Set([...top.map((r) => r.device_id), ...(myIdx >= 0 ? [me!.id] : [])])];
  const profiles = new Map<string, Me>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const res = await c.env.DB.prepare(`SELECT id, pseudo, club, country FROM profiles WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<Me>();
    for (const p of res.results) profiles.set(p.id, p);
  }
  // Ties share a rank.
  const rankAt = (i: number) => rows.findIndex((r) => r.score === rows[i].score) + 1;
  const toRow = (r: { device_id: string; score: number }, i: number): LeaderboardRow => {
    const p = profiles.get(r.device_id);
    return { rank: rankAt(i), pseudo: p?.pseudo ?? '?', club: p?.club ?? 'other', country: p?.country ?? '', score: r.score, ...(me && r.device_id === me.id ? { me: true } : {}) };
  };
  return c.json({
    board,
    ranking,
    total: rows.length,
    rows: top.map(toRow),
    me: myIdx >= 0 ? toRow(rows[myIdx], myIdx) : null,
  });
});

// ---------- clubs & countries war ----------
// Each supporter's daily challenge results count for their club and their country.
// Daily scores only (one attempt a day), so spamming games doesn't help.
app.get('/api/war', async (c) => {
  const me = c.get('me');
  const by = c.req.query('by') === 'country' ? 'country' : 'club';
  const period = c.req.query('period') === 'all' ? 'all' : 'week';
  const today = todayKey();
  const weekday = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
  const from = period === 'week' ? todayKey(Date.parse(today + 'T12:00:00Z') - weekday * 86400_000) : '0000-00-00';
  const res = await c.env.DB.prepare(
    `SELECT p.${by} AS k, SUM(s.count) AS points, COUNT(DISTINCT s.device_id) AS players
     FROM scores s JOIN profiles p ON p.id = s.device_id
     WHERE s.board_key >= ? AND s.board_key < 'daily;' AND p.${by} <> 'other'
     GROUP BY p.${by} ORDER BY points DESC`,
  ).bind('daily:' + from).all<{ k: string; points: number; players: number }>();
  const rows: WarRow[] = res.results.map((r, i) => ({ rank: i + 1, key: r.k, points: r.points, players: r.players }));
  const mine = me ? rows.find((r) => r.key === me[by]) ?? null : null;
  return c.json({ by, period, from, rows: rows.slice(0, 50), me: mine, total: rows.length });
});

// ---------- rooms ----------
app.post('/api/rooms', async (c) => {
  requireMe(c);
  const body = (await c.req.json().catch(() => ({}))) as { game?: RoomGame; criterion?: unknown };
  if (!body.game || !(body.game in ROOM_LIMITS)) throw new HttpError(400, 'bad_game');
  const criterion = parseCriterion(body.criterion);
  if (scopeSize(criterion) < 30) throw new HttpError(400, 'theme_too_small');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(5);
    const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, game: body.game, criterion }) });
    if (res.ok) return c.json({ code });
  }
  throw new HttpError(503, 'no_code');
});

app.get('/api/rooms/:code/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') throw new HttpError(426, 'websocket_required');
  const me = await auth(c.env, c.req.query('id'), c.req.query('secret'));
  if (!me) throw new HttpError(401, 'profile_required');
  const code = c.req.param('code').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new HttpError(404, 'room_not_found');
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(code));
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Player', JSON.stringify({ id: me.id, pseudo: me.pseudo, club: me.club, country: me.country }));
  return stub.fetch(new Request('https://room/ws', { headers }));
});

app.get('/api/rooms/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new HttpError(404, 'room_not_found');
  const res = await c.env.ROOMS.get(c.env.ROOMS.idFromName(code)).fetch('https://room/info');
  if (!res.ok) throw new HttpError(404, 'room_not_found');
  return c.json(await res.json());
});

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

export default app;
