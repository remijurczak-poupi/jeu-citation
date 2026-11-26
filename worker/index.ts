// API Worker: profiles, solo games, daily challenge, leaderboards and private rooms.
import fanClubs from '../src/data/fan-clubs.json';
import { Hono, type Context } from 'hono';
import { data, getMatcher, normalizeCriterion, playerIndex, playerStints, scopeSize, criterionKey, rankedThemeId, suggest, describeList } from './data';
import { dailyCriterion, dailyNumber, dailyStreak, todayKey } from './daily';
import { applyGuess, boardKey, finish, isSuspect, newGame, scoreOf, toState, expire, type GameRow } from './solo';
import { ROOM_LIMITS } from './room';
import { rarityTiers } from './rarity';
import { chainStart } from './chain';
import { verifyReport, type Verdict } from './verify';
import { compact } from './normalize';
import type { Challenge, DailyStreak, GameRecap, Badge, BoardKind, BoardPeriod, WarRow, Criterion, DailyHistoryItem, DailyInfo, LeaderboardRow, Meta, Ranking, RoomGame, SoloMode } from '../shared/types';
import { MODE_RULES, RANKED_THEMES, SOLO_MODES as SOLO_LIST } from '../shared/types';

export { Room } from './room';

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string; // OAuth web client id: enables Sign in with Google
  RESEND_API_KEY?: string; // enables e-mail sign-in links (sent with Resend)
  ADMIN_KEY?: string; // password of the admin page (reports review)
  MAIL_FROM?: string; // sender of those e-mails, e.g. Name the Players <login@example.com>
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  // Per-IP limits on the endpoints that create rows or send e-mails (optional: absent in local tests).
  WRITE_LIMIT?: RateLimit;
  EMAIL_LIMIT?: RateLimit;
  ADMIN_LIMIT?: RateLimit;
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
const FAN_CLUBS = new Set<string>([...(fanClubs as { q: string }[]).map((c) => c.q), ...data.clubs.map((c) => c.q)]);
const validClub = (c: unknown) => typeof c === 'string' && (c === 'other' || FAN_CLUBS.has(c));
const validCountry = (c: unknown) => typeof c === 'string' && /^([A-Z]{2}|GB-(ENG|SCT|WLS|NIR))$/.test(c);

async function auth(env: Env, id?: string | null, secret?: string | null): Promise<Me | null> {
  if (!id || !secret) return null;
  const hash = await sha256(normSecret(secret));
  const row = await env.DB.prepare(
    `SELECT id, pseudo, club, country FROM profiles WHERE id = ?1
     AND (secret_hash = ?2 OR EXISTS (SELECT 1 FROM device_sessions WHERE secret_hash = ?2 AND profile_id = ?1))`,
  ).bind(id, hash).first<Me>();
  return row ?? null;
}

app.use('/api/*', async (c, next) => {
  c.set('me', await auth(c.env, c.req.header('x-device-id'), c.req.header('x-device-secret')));
  await next();
});
// Per-IP brakes on the endpoints that write to the database or send e-mails, so that a script cannot
// fill D1 (100k writes a day on the free plan) with guest profiles or spend the e-mail quota.
const LIMITED: [RegExp, 'WRITE_LIMIT' | 'EMAIL_LIMIT'][] = [
  [/^\/api\/auth\/email$/, 'EMAIL_LIMIT'],
  [/^\/api\/(profile(\/guest)?|auth\/google|auth\/email\/verify|reports|rooms|challenges|leagues)$/, 'WRITE_LIMIT'],
];
app.use('/api/*', async (c, next) => {
  // Admin: every call counts (GET too), so that the password cannot be guessed by trying many.
  if (c.req.path.startsWith('/api/admin/') && c.env.ADMIN_LIMIT) {
    const { success } = await c.env.ADMIN_LIMIT.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' });
    if (!success) throw new HttpError(429, 'too_many_requests');
  }
  if (c.req.method === 'POST') {
    const rule = LIMITED.find(([re]) => re.test(c.req.path));
    const limiter = rule ? c.env[rule[1]] : undefined;
    if (limiter) {
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
      const { success } = await limiter.limit({ key: `${c.req.path}:${ip}` });
      if (!success) throw new HttpError(429, 'too_many_requests');
    }
  }
  await next();
});
const requireMe = (c: C) => {
  const me = c.get('me');
  if (!me) throw new HttpError(401, 'profile_required');
  return me;
};
class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status as 400);
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
  return c.json({ ...metaCache, auth: { google: c.env.GOOGLE_CLIENT_ID || null, email: !!(c.env.RESEND_API_KEY && c.env.MAIL_FROM) } });
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
    await c.env.DB.prepare('UPDATE profiles SET pseudo = ?, pseudo_norm = ?, club = ?, country = ?, guest = 0 WHERE id = ?')
      .bind(pseudo, pseudoNorm(pseudo), body.club, body.country, me.id).run();
    return c.json({ id: me.id, pseudo, club: body.club, country: body.country });
  }
  const id = crypto.randomUUID();
  const secret = newSecret();
  await c.env.DB.prepare('INSERT INTO profiles (id, secret_hash, pseudo, pseudo_norm, club, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await sha256(secret), pseudo, pseudoNorm(pseudo), body.club, body.country, Date.now()).run();
  return c.json({ id, secret, pseudo, club: body.club, country: body.country });
});

// One click to play: a guest profile with a generated nickname, offered to personalise after the first game.
const GUEST_WORD: Record<string, string> = { en: 'Player', fr: 'Joueur', de: 'Spieler', es: 'Jugador', it: 'Giocatore', pt: 'Jogador' };
app.post('/api/profile/guest', async (c) => {
  const me = c.get('me');
  if (me) return c.json({ ...me });
  const { lang } = (await c.req.json().catch(() => ({}))) as { lang?: string };
  const word = GUEST_WORD[lang ?? 'en'] ?? GUEST_WORD.en;
  const ip = c.req.header('cf-ipcountry') ?? '';
  const country = /^[A-Z]{2}$/.test(ip) && ip !== 'XX' && ip !== 'T1' ? ip : '';
  const id = crypto.randomUUID();
  const secret = newSecret();
  for (let attempt = 0; attempt < 5; attempt++) {
    const pseudo = `${word} ${String(Math.floor(10000 + Math.random() * 90000))}`;
    const res = await c.env.DB.prepare('INSERT OR IGNORE INTO profiles (id, secret_hash, pseudo, pseudo_norm, club, country, created_at, guest) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .bind(id, await sha256(secret), pseudo, pseudoNorm(pseudo), 'other', country, Date.now()).run();
    if (res.meta.changes) return c.json({ id, secret, pseudo, club: 'other', country, guest: true });
  }
  throw new HttpError(503, 'server_error');
});

// ---------- optional sign-in (find your profile on another device) ----------
/**
 * Links the e-mail to the current profile if neither has an account yet; otherwise opens the
 * profile that owns the e-mail on this device (with a new device secret).
 */
async function signIn(c: C, email: string, provider: 'google' | 'email', deviceId: string | null) {
  const e = email.trim().toLowerCase();
  const owner = await c.env.DB.prepare('SELECT profile_id FROM accounts WHERE email = ?').bind(e).first<{ profile_id: string }>();
  if (!owner) {
    if (!deviceId) return { status: 'no_profile' as const };
    const linked = await c.env.DB.prepare('SELECT email FROM accounts WHERE profile_id = ?').bind(deviceId).first();
    if (linked) throw new HttpError(409, 'other_account');
    await c.env.DB.prepare('INSERT INTO accounts (email, profile_id, provider, created_at) VALUES (?, ?, ?, ?)').bind(e, deviceId, provider, Date.now()).run();
    return { status: 'linked' as const, email: e };
  }
  const p = await c.env.DB.prepare('SELECT id, pseudo, club, country FROM profiles WHERE id = ?').bind(owner.profile_id).first<Me>();
  if (!p) throw new HttpError(404, 'profile_not_found');
  const secret = newSecret();
  await c.env.DB.prepare('INSERT INTO device_sessions (secret_hash, profile_id, created_at) VALUES (?, ?, ?)').bind(await sha256(secret), p.id, Date.now()).run();
  return { status: 'signed_in' as const, email: e, session: { ...p, secret } };
}

app.get('/api/account', async (c) => {
  const me = requireMe(c);
  const row = await c.env.DB.prepare('SELECT email, provider FROM accounts WHERE profile_id = ?').bind(me.id).first<{ email: string; provider: string }>();
  return c.json(row ?? null);
});

app.post('/api/auth/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw new HttpError(404, 'not_configured');
  const { credential } = (await c.req.json().catch(() => ({}))) as { credential?: string };
  if (typeof credential !== 'string' || credential.length > 4096) throw new HttpError(400, 'bad_token');
  // Google checks the signature and expiry; we check it was issued for this site.
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!res.ok) throw new HttpError(401, 'bad_token');
  const info = (await res.json()) as { aud?: string; email?: string; email_verified?: string | boolean };
  if (info.aud !== c.env.GOOGLE_CLIENT_ID || !info.email || String(info.email_verified) !== 'true') throw new HttpError(401, 'bad_token');
  return c.json(await signIn(c, info.email, 'google', c.get('me')?.id ?? null));
});

app.post('/api/auth/email', async (c) => {
  if (!c.env.RESEND_API_KEY || !c.env.MAIL_FROM) throw new HttpError(404, 'not_configured');
  const { email, lang } = (await c.req.json().catch(() => ({}))) as { email?: string; lang?: string };
  if (typeof email !== 'string' || email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'bad_email');
  const e = email.trim().toLowerCase();
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM email_tokens WHERE email = ? AND expires_at > ?').bind(e, Date.now()).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) throw new HttpError(429, 'too_many_emails');
  const token = randomCode(32);
  await c.env.DB.prepare('INSERT INTO email_tokens (token_hash, email, device_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), e, c.get('me')?.id ?? null, Date.now() + 15 * 60_000).run();
  const link = `${new URL(c.req.url).origin}/#/login/${token}`;
  const fr = lang === 'fr';
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: c.env.MAIL_FROM,
      to: [e],
      subject: fr ? 'Ton lien de connexion' : 'Your sign-in link',
      text: (fr ? 'Clique sur ce lien pour te connecter (valable 15 minutes) :\n' : 'Click this link to sign in (valid for 15 minutes):\n') + link,
    }),
  });
  if (!sent.ok) throw new HttpError(502, 'email_failed');
  return c.json({ ok: true });
});

app.post('/api/auth/email/verify', async (c) => {
  const { token } = (await c.req.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== 'string' || token.length > 64) throw new HttpError(400, 'bad_token');
  const hash = await sha256(token);
  const row = await c.env.DB.prepare('SELECT email, device_id, expires_at FROM email_tokens WHERE token_hash = ?').bind(hash).first<{ email: string; device_id: string | null; expires_at: number }>();
  await c.env.DB.prepare('DELETE FROM email_tokens WHERE token_hash = ? OR expires_at < ?').bind(hash, Date.now()).run();
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'link_expired');
  return c.json(await signIn(c, row.email, 'email', c.get('me')?.id ?? row.device_id));
});

// ---------- solo games ----------
const SOLO_MODES: SoloMode[] = [...SOLO_LIST, 'daily'];

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
      c.env.DB.prepare('INSERT OR IGNORE INTO scores (game_id, device_id, board_key, score, count, created_at, mode, league, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(g.id, g.device_id, g.board_key, scoreOf(g), g.count, g.last_at, g.board_key.startsWith('archive:') ? 'archive' : g.mode, (JSON.parse(g.criterion) as Criterion).league ?? null,
          isSuspect(g.count, g.started_at, g.last_at) ? 'suspect' : null),
      ...found.map((q) => c.env.DB.prepare('INSERT INTO citations (theme_key, player, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(theme, q)),
    ];
    for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  }
}

/** SQL condition: the score counts in rankings (not set aside, not removed). */
const RANKED = "(flag IS NULL OR flag = 'cleared')";

/** Best-game boards exist for the daily challenge and the big themes only. */
const isRankedBoard = (g: GameRow) => g.daily_date !== null || (g.mode !== 'daily' && rankedThemeId(JSON.parse(g.criterion)) !== undefined);

async function rankOf(c: C, g: GameRow) {
  if (g.status !== 'finished' || !isRankedBoard(g)) return {};
  const row = await c.env.DB.prepare(
    `WITH best AS (SELECT device_id, MAX(score) AS s FROM scores WHERE board_key = ? AND ${RANKED} GROUP BY device_id)
     SELECT (SELECT COUNT(*) FROM best WHERE s > ?) + 1 AS rank, (SELECT COUNT(*) FROM best) AS total`,
  ).bind(g.board_key, scoreOf(g)).first<{ rank: number; total: number }>();
  return row ? { rank: row.rank, total: row.total } : {};
}

app.post('/api/games', async (c) => {
  const me = requireMe(c);
  const body = (await c.req.json().catch(() => ({}))) as { mode?: SoloMode; criterion?: unknown; date?: string; challenge?: string };
  let challenge: { code: string; mode: SoloMode; criterion: string; start: string | null } | null = null;
  if (typeof body.challenge === 'string') {
    challenge = await c.env.DB.prepare('SELECT code, mode, criterion, start FROM challenges WHERE code = ?').bind(body.challenge.toUpperCase()).first();
    if (!challenge) throw new HttpError(404, 'challenge_not_found');
    body.mode = challenge.mode;
    body.criterion = JSON.parse(challenge.criterion);
  }
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
    g.challenge = challenge?.code ?? null;
    if (mode === 'chain' && challenge?.start) {
      g.found = JSON.stringify([challenge.start]);
    } else if (mode === 'chain') {
      const start = chainStart(criterion);
      if (start === null) throw new HttpError(400, 'theme_too_small');
      g.found = JSON.stringify([data.players[start].q]);
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO games (id, device_id, mode, criterion, board_key, daily_date, started_at, deadline, last_at, status, found, count, points, errors, guesses, end_reason, version, challenge)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, 0, ?)`,
  ).bind(g.id, g.device_id, g.mode, g.criterion, g.board_key, g.daily_date, g.started_at, g.deadline, g.last_at, g.status, g.found, g.challenge ?? null).run();
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
  const { text, pick } = (await c.req.json().catch(() => ({}))) as { text?: string; pick?: unknown };
  if (typeof text !== 'string') throw new HttpError(400, 'bad_text');
  if (pick !== undefined && (typeof pick !== 'string' || !/^Q\d{1,12}$/.test(pick))) throw new HttpError(400, 'bad_pick');
  const g = await loadGame(c, c.req.param('id'), me);
  const now = Date.now();
  const prev = g.version;
  const wasActive = g.status === 'active';
  const accepted = await c.env.DB.prepare('SELECT player FROM accepted_answers WHERE theme_key = ?').bind(criterionKey(JSON.parse(g.criterion))).all<{ player: string }>();
  const extra = accepted.results.map((r) => playerIndex(r.player)).filter((p): p is number => p !== undefined);
  const { outcome, changed } = applyGuess(g, text.slice(0, 80), now, pick as string | undefined, extra);
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

// ---------- end of game extras ----------
app.get('/api/games/:id/recap', async (c) => {
  const me = requireMe(c);
  const g = await loadGame(c, c.req.param('id'), me);
  if (g.status !== 'finished') throw new HttpError(409, 'game_active');
  const criterion = JSON.parse(g.criterion) as Criterion;
  const foundQ: string[] = JSON.parse(g.found);
  const found = new Set(foundQ.map(playerIndex).filter((p): p is number => p !== undefined));
  // Best-known players of the theme that were not named.
  const missed = g.mode === 'chain' ? [] : [...getMatcher(criterion).scope.players].filter((p) => !found.has(p))
    .sort((a, b) => data.players[b].s - data.players[a].s).slice(0, 8).map((p) => data.players[p].n);
  // Rarest answers: share of finished games on this theme that named them (fame when too few games).
  const games = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM games WHERE criterion = ? AND status = 'finished'`).bind(g.criterion).first<{ n: number }>();
  const total = games?.n ?? 0;
  let rarest: GameRecap['rarest'] = [];
  const chainStartQ = g.mode === 'chain' ? foundQ[0] : undefined;
  const answers = foundQ.filter((q) => q !== chainStartQ);
  if (answers.length) {
    if (total >= 10) {
      const theme = criterionKey(criterion);
      const counts = new Map<string, number>();
      for (let i = 0; i < answers.length; i += 90) {
        const chunk = answers.slice(i, i + 90);
        const res = await c.env.DB.prepare(`SELECT player, n FROM citations WHERE theme_key = ? AND player IN (${chunk.map(() => '?').join(',')})`).bind(theme, ...chunk).all<{ player: string; n: number }>();
        for (const r of res.results) counts.set(r.player, r.n);
      }
      rarest = answers.map((q) => ({ q, pct: Math.min(100, Math.round(((counts.get(q) ?? 1) / total) * 100)) }))
        .sort((a, b) => a.pct - b.pct).slice(0, 3).map((r) => ({ name: data.players[playerIndex(r.q)!].n, pct: r.pct }));
    } else {
      rarest = answers.map((q) => playerIndex(q)).filter((p): p is number => p !== undefined)
        .sort((a, b) => data.players[a].s - data.players[b].s).slice(0, 3).map((p) => ({ name: data.players[p].n }));
    }
  }
  let tiers: number[] | undefined;
  if (g.daily_date) {
    const res = await c.env.DB.prepare(`SELECT found FROM games WHERE daily_date = ? AND status = 'finished'`).bind(g.daily_date).all<{ found: string }>();
    const t = rarityTiers(res.results.map((r) => JSON.parse(r.found) as string[]));
    tiers = foundQ.map((q) => t.get(q) ?? 1);
  }
  return c.json({ missed, rarest, ...(tiers ? { tiers } : {}) } satisfies GameRecap);
});

// ---------- challenge a friend (same mode and theme, no room) ----------
app.post('/api/challenges', async (c) => {
  const me = requireMe(c);
  const { gameId } = (await c.req.json().catch(() => ({}))) as { gameId?: string };
  const g = await loadGame(c, String(gameId ?? ''), me);
  if (g.status !== 'finished' || g.mode === 'daily') throw new HttpError(400, 'bad_game');
  const existing = await c.env.DB.prepare('SELECT code FROM challenges WHERE game_id = ?').bind(g.id).first<{ code: string }>();
  if (existing) return c.json({ code: existing.code });
  const start = g.mode === 'chain' ? (JSON.parse(g.found) as string[])[0] ?? null : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(6);
    const res = await c.env.DB.prepare('INSERT OR IGNORE INTO challenges (code, game_id, device_id, mode, criterion, start, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(code, g.id, me.id, g.mode, g.criterion, start, g.count, Date.now()).run();
    if (res.meta.changes) return c.json({ code });
  }
  throw new HttpError(503, 'no_code');
});

app.get('/api/challenges/:code', async (c) => {
  const me = c.get('me');
  const code = c.req.param('code').toUpperCase();
  const ch = await c.env.DB.prepare(
    `SELECT ch.code, ch.mode, ch.criterion, ch.count, p.pseudo, p.country FROM challenges ch JOIN profiles p ON p.id = ch.device_id WHERE ch.code = ?`,
  ).bind(code).first<{ code: string; mode: SoloMode; criterion: string; count: number; pseudo: string; country: string }>();
  if (!ch) throw new HttpError(404, 'challenge_not_found');
  const res = await c.env.DB.prepare(
    `SELECT g.device_id, MAX(g.count) AS count, p.pseudo, p.country FROM games g JOIN profiles p ON p.id = g.device_id
     WHERE g.challenge = ? AND g.status = 'finished' GROUP BY g.device_id ORDER BY count DESC LIMIT 50`,
  ).bind(code).all<{ device_id: string; count: number; pseudo: string; country: string }>();
  return c.json({
    code: ch.code, mode: ch.mode, criterion: JSON.parse(ch.criterion),
    from: { pseudo: ch.pseudo, country: ch.country, count: ch.count },
    takers: res.results.map((r) => ({ pseudo: r.pseudo, country: r.country, count: r.count, ...(me && r.device_id === me.id ? { me: true } : {}) })),
  } satisfies Challenge);
});

// ---------- "this answer should have counted" ----------
app.post('/api/reports', async (c) => {
  // A profile is needed (every game has one), so that the hourly cap below always applies.
  const me = requireMe(c);
  const b = (await c.req.json().catch(() => ({}))) as { gameId?: string; text?: string; recognised?: string; criterion?: unknown; note?: string };
  if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 80) throw new HttpError(400, 'bad_text');
  const criterion = parseCriterion(b.criterion ?? {});
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE device_id = ? AND created_at > ?').bind(me.id, Date.now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, 'too_many_reports');
  const ins = await c.env.DB.prepare('INSERT INTO reports (device_id, game_id, text, recognised, criterion, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(me.id, typeof b.gameId === 'string' ? b.gameId.slice(0, 40) : null, b.text.trim(), typeof b.recognised === 'string' ? b.recognised.slice(0, 120) : null,
      JSON.stringify(criterion), typeof b.note === 'string' ? b.note.slice(0, 300) : null, Date.now()).run();
  // Checked right away against Wikipedia; a slow answer is finished in the background (and retried by the cron).
  const check = checkReport(c.env, ins.meta.last_row_id);
  c.executionCtx.waitUntil(check.catch(() => {}));
  const verdict = await Promise.race([check.catch(() => 'manual' as const), new Promise<'pending'>((r) => setTimeout(() => r('pending'), 6000))]);
  return c.json({ ok: true, verdict });
});

/** Player named in a report: the one the game recognised, else the exact name typed. */
function reportedPlayer(text: string, recognised: string | null): number | undefined {
  for (const name of [recognised, text]) {
    if (!name) continue;
    const p = suggest(name, 5).find((x) => compact(data.players[x].n) === compact(name));
    if (p !== undefined) return p;
  }
  return undefined;
}

/** Makes a player count for the report's theme, and credits the answer in the reported game. */
/** Most answers a single game can gain from reports (a few gaps in the data, not a way to rebuild a score). */
const MAX_CREDITED_REPORTS = 5;

async function acceptReport(env: Env, id: number, playerQ: string, status: 'accepted' | 'auto_accepted', resolution: string, credit = true) {
  const r = await env.DB.prepare('SELECT criterion, game_id, device_id FROM reports WHERE id = ?').bind(id).first<{ criterion: string; game_id: string | null; device_id: string | null }>();
  if (!r) return;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO accepted_answers (theme_key, player, report_id, created_at) VALUES (?, ?, ?, ?)').bind(criterionKey(JSON.parse(r.criterion)), playerQ, id, Date.now()),
    env.DB.prepare('UPDATE reports SET status = ?, resolution = ?, checked_at = ? WHERE id = ?').bind(status, resolution, Date.now(), id),
  ]);
  if (!credit || !r.game_id) return;
  const g = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(r.game_id).first<GameRow>();
  // Only the reporter's own game, on the same theme, and only a few times per game.
  if (!g || g.device_id !== r.device_id || criterionKey(JSON.parse(g.criterion)) !== criterionKey(JSON.parse(r.criterion))) return;
  const credited = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE game_id = ? AND status IN ('accepted', 'auto_accepted') AND id <> ?").bind(g.id, id).first<{ n: number }>();
  if ((credited?.n ?? 0) >= MAX_CREDITED_REPORTS) return;
  const found: string[] = JSON.parse(g.found);
  if (found.includes(playerQ) || g.mode === 'chain') return;
  found.push(playerQ);
  const res = await env.DB.prepare('UPDATE games SET found = ?, count = count + 1, version = version + 1 WHERE id = ? AND version = ?').bind(JSON.stringify(found), g.id, g.version).run();
  if (res.meta.changes && g.status === 'finished') {
    await env.DB.batch([
      env.DB.prepare('UPDATE scores SET score = score + 1, count = count + 1 WHERE game_id = ?').bind(g.id),
      env.DB.prepare('INSERT INTO citations (theme_key, player, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(criterionKey(JSON.parse(g.criterion)), playerQ),
    ]);
  }
}

/** Automatic check of one report: accepted or rejected when Wikipedia is clear, left open for a human otherwise. */
async function checkReport(env: Env, id: number): Promise<'accept' | 'reject' | 'manual'> {
  const r = await env.DB.prepare("SELECT text, recognised, criterion FROM reports WHERE id = ? AND status = 'open'").bind(id).first<{ text: string; recognised: string | null; criterion: string }>();
  if (!r) return 'manual';
  const p = reportedPlayer(r.text, r.recognised);
  const criterion = JSON.parse(r.criterion) as Criterion;
  let v: Verdict;
  if (p === undefined) v = { verdict: 'manual', reason: 'player not recognised' };
  else if (getMatcher(criterion).scope.players.has(p)) v = { verdict: 'accept', reason: 'already in the theme with our data' };
  else v = await verifyReport(p, criterion).catch((e: Error) => ({ verdict: 'manual' as const, reason: 'check failed: ' + e.message }));
  // A player already in the theme would have counted during the game: nothing to credit (else a finished
  // game could be topped up afterwards by "reporting" every player of the theme).
  const inTheme = p !== undefined && getMatcher(criterion).scope.players.has(p);
  if (v.verdict === 'accept') await acceptReport(env, id, data.players[p!].q, 'auto_accepted', v.reason, !inTheme);
  else await env.DB.prepare('UPDATE reports SET status = ?, resolution = ?, checked_at = ? WHERE id = ?').bind(v.verdict === 'reject' ? 'auto_rejected' : 'open', v.reason, Date.now(), id).run();
  return v.verdict;
}

/** Cron: reports still open and not checked in the last day (Wikipedia down, slow answer…). */
async function checkPendingReports(env: Env) {
  const rows = await env.DB.prepare("SELECT id FROM reports WHERE status = 'open' AND (checked_at IS NULL OR checked_at < ?) ORDER BY created_at LIMIT 20").bind(Date.now() - 86400_000).all<{ id: number }>();
  for (const r of rows.results) await checkReport(env, r.id).catch(() => {});
}

// ---------- admin: review reports ----------
function requireAdmin(c: C) {
  // Trimmed on both sides: a space or line break pasted with the password must not lock Rémi out.
  // Sent URI-encoded so that accents or symbols survive the HTTP header.
  let key = c.req.header('x-admin-key') ?? '';
  try { key = decodeURIComponent(key); } catch { /* sent raw */ }
  key = key.trim();
  const expected = c.env.ADMIN_KEY?.trim();
  if (!expected) throw new HttpError(404, 'admin_not_configured');
  // Lengths only (never the password) help tell a typo from a secret that did not arrive.
  if (!key || key !== expected) throw new HttpError(401, 'bad_admin_key', { got: key.length, want: expected.length });
}
/** Clubs and seasons of a player, to judge a report. */
const careerText = (p: number) => playerStints(p).map(([, cl, s, e]) => `${data.clubs[cl].n} ${s >= 0 ? s : '?'}–${e >= 0 ? e : data.players[p].x ? 'now' : '?'}`).join(' · ');

app.get('/api/admin/reports', async (c) => {
  requireAdmin(c);
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.text, r.recognised, r.criterion, r.note, r.created_at, r.status, r.game_id, r.resolution, p.pseudo
     FROM reports r LEFT JOIN profiles p ON p.id = r.device_id
     WHERE ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"} ORDER BY r.created_at DESC LIMIT 200`,
  ).all<{ id: number; text: string; recognised: string | null; criterion: string; note: string | null; created_at: number; status: string; game_id: string | null; pseudo: string | null; resolution: string | null }>();
  return c.json(rows.results.map((r) => {
    const criterion = JSON.parse(r.criterion) as Criterion;
    const p = r.recognised ? suggest(r.recognised, 1)[0] : undefined;
    const exact = p !== undefined && data.players[p].n === r.recognised ? p : undefined;
    return {
      ...r, criterion,
      player: exact !== undefined ? { q: data.players[exact].q, n: data.players[exact].n, career: careerText(exact), inTheme: getMatcher(criterion).scope.players.has(exact) } : null,
    };
  }));
});

app.get('/api/admin/player', (c) => {
  requireAdmin(c);
  const p = playerIndex(c.req.query('q') ?? '');
  if (p === undefined) throw new HttpError(404, 'player_not_found');
  return c.json({ q: data.players[p].q, n: data.players[p].n, career: careerText(p) });
});

app.post('/api/admin/reports/:id', async (c) => {
  requireAdmin(c);
  const id = Number(c.req.param('id'));
  const { action, player } = (await c.req.json().catch(() => ({}))) as { action?: string; player?: string };
  const r = await c.env.DB.prepare('SELECT criterion FROM reports WHERE id = ?').bind(id).first<{ criterion: string }>();
  if (!r) throw new HttpError(404, 'report_not_found');
  if (action === 'accept') {
    if (typeof player !== 'string' || playerIndex(player) === undefined) throw new HttpError(400, 'bad_player');
    await acceptReport(c.env, id, player, 'accepted', 'accepted by hand');
  } else if (action === 'reject') {
    await c.env.DB.prepare("UPDATE reports SET status = 'rejected' WHERE id = ?").bind(id).run();
  } else if (action === 'reopen') {
    await c.env.DB.prepare("UPDATE reports SET status = 'open' WHERE id = ?").bind(id).run();
  } else throw new HttpError(400, 'bad_action');
  return c.json({ ok: true });
});

// ---------- admin: scores set aside ----------
app.get('/api/admin/suspects', async (c) => {
  requireAdmin(c);
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const rows = await c.env.DB.prepare(
    `SELECT s.game_id, s.board_key, s.mode, s.count, s.created_at, s.flag, g.started_at, g.last_at, g.criterion, g.errors, p.pseudo
     FROM scores s JOIN games g ON g.id = s.game_id LEFT JOIN profiles p ON p.id = s.device_id
     WHERE ${status === 'open' ? "s.flag = 'suspect'" : "s.flag IN ('cleared', 'removed')"} ORDER BY s.created_at DESC LIMIT 200`,
  ).all<{ game_id: string; board_key: string; mode: string; count: number; created_at: number; flag: string; started_at: number; last_at: number; criterion: string; errors: number; pseudo: string | null }>();
  return c.json(rows.results.map(({ criterion, ...r }) => ({ ...r, criterion: JSON.parse(criterion) as Criterion, seconds: Math.round((r.last_at - r.started_at) / 1000) })));
});

app.post('/api/admin/suspects/:game', async (c) => {
  requireAdmin(c);
  const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
  const flag = action === 'clear' ? 'cleared' : action === 'remove' ? 'removed' : action === 'reopen' ? 'suspect' : null;
  if (!flag) throw new HttpError(400, 'bad_action');
  const res = await c.env.DB.prepare('UPDATE scores SET flag = ? WHERE game_id = ? AND flag IS NOT NULL').bind(flag, c.req.param('game')).run();
  if (!res.meta.changes) throw new HttpError(404, 'score_not_found');
  return c.json({ ok: true });
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
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE board_key = ? AND ${RANKED}`).bind(`daily:${date}`).first<{ n: number }>();
  let streak: DailyStreak | undefined;
  if (me) {
    const rows = await c.env.DB.prepare('SELECT daily_date AS d FROM games WHERE device_id = ? AND daily_date IS NOT NULL ORDER BY daily_date').bind(me.id).all<{ d: string }>();
    streak = dailyStreak(rows.results.map((r) => r.d), date);
  }
  return c.json({ date, number: dailyNumber(date), criterion, difficulty, played, playerCount: n?.n ?? 0, ...(streak ? { streak } : {}) } satisfies DailyInfo);
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
  const kind: BoardKind = q.kind === 'total' ? 'total' : 'best';
  const period: BoardPeriod = (['day', 'week', 'month', 'year', 'all'] as const).find((p) => p === q.period) ?? (kind === 'total' ? 'week' : 'all');
  const since = periodStart(period);
  const theme = RANKED_THEMES.find((r) => r.id === q.theme) ?? RANKED_THEMES[0];
  const board = mode === 'daily' ? boardKey('daily', {}, date) : boardKey(mode, normalizeCriterion(theme.criterion));

  let rows: { device_id: string; score: number }[];
  if (ranking === 'rarity') {
    const games = await c.env.DB.prepare(`SELECT device_id, found FROM games WHERE daily_date = ? AND status = 'finished'
       AND id NOT IN (SELECT game_id FROM scores WHERE flag IN ('suspect', 'removed'))`).bind(date).all<{ device_id: string; found: string }>();
    const founds = games.results.map((g) => JSON.parse(g.found) as string[]);
    const tiers = rarityTiers(founds);
    rows = games.results.map((g, i) => ({ device_id: g.device_id, score: founds[i].reduce((s, q2) => s + (tiers.get(q2) ?? 1), 0) }));
  } else if (kind === 'total') {
    // Players named over the period in this mode, whatever the theme.
    const res = await c.env.DB.prepare(
      `SELECT device_id, SUM(count) AS score FROM scores WHERE mode = ? AND created_at >= ? AND ${RANKED} GROUP BY device_id`,
    ).bind(mode, since).all<{ device_id: string; score: number }>();
    rows = res.results;
  } else {
    const res = await c.env.DB.prepare(
      `SELECT device_id, MAX(score) AS score FROM scores WHERE board_key = ? AND created_at >= ? AND ${RANKED} GROUP BY device_id`,
    ).bind(board, mode === 'daily' ? 0 : since).all<{ device_id: string; score: number }>();
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
    kind,
    period,
    ranking,
    total: rows.length,
    dist: distribution(rows.map((r) => r.score)),
    rows: top.map(toRow),
    me: myIdx >= 0 ? toRow(rows[myIdx], myIdx) : null,
  });
});

/** How many players per score bracket (at most 40 brackets), to draw the curve. */
function distribution(scores: number[]): { width: number; counts: number[] } {
  if (!scores.length) return { width: 1, counts: [] };
  const max = Math.max(...scores);
  const width = Math.max(1, Math.ceil((max + 1) / 40));
  const counts = new Array(Math.floor(max / width) + 1).fill(0);
  for (const v of scores) counts[Math.floor(Math.max(0, v) / width)]++;
  return { width, counts };
}

/** Start of the period in ms, by Paris calendar (week starts on Monday). */
function periodStart(period: BoardPeriod): number {
  if (period === 'all') return 0;
  const today = todayKey();
  const noon = Date.parse(today + 'T12:00:00Z');
  let day = today;
  if (period === 'week') day = todayKey(noon - ((new Date(noon).getUTCDay() + 6) % 7) * 86400_000);
  else if (period === 'month') day = today.slice(0, 8) + '01';
  else if (period === 'year') day = today.slice(0, 5) + '01-01';
  return Date.parse(day + 'T00:00:00+01:00');
}

// ---------- badges ----------
// "Top 5 % in Ligue 1": players named in all games of a league (any mode and filters), against everyone who played it.
const BADGE_TOPS = [1, 5, 10, 25];
const BADGE_MIN_PLAYERS = 10;
app.get('/api/badges', async (c) => {
  const me = requireMe(c);
  const res = await c.env.DB.prepare(
    `SELECT COALESCE(league, 'all') AS scope, device_id, SUM(count) AS n FROM scores WHERE mode <> 'archive' AND ${RANKED} GROUP BY scope, device_id
     UNION ALL SELECT 'all5', device_id, SUM(count) FROM scores WHERE mode <> 'archive' AND ${RANKED} GROUP BY device_id`,
  ).all<{ scope: string; device_id: string; n: number }>();
  const byScope = new Map<string, { device_id: string; n: number }[]>();
  for (const r of res.results) if (r.scope !== 'all') (byScope.get(r.scope) ?? byScope.set(r.scope, []).get(r.scope)!).push(r);
  const badges: Badge[] = [];
  for (const [scope, rows] of byScope) {
    const mine = rows.find((r) => r.device_id === me.id);
    if (!mine || rows.length < BADGE_MIN_PLAYERS || mine.n === 0) continue;
    const rank = rows.filter((r) => r.n > mine.n).length + 1;
    const top = BADGE_TOPS.find((p) => rank <= Math.max(1, Math.floor((rows.length * p) / 100)));
    if (top) badges.push({ scope: scope === 'all5' ? 'all' : scope, top, rank, total: rows.length });
  }
  badges.sort((a, b) => a.top - b.top);
  return c.json(badges);
});

// ---------- suggestions while typing ----------
// From the whole base (not the theme), so they never give the answer away.
app.get('/api/suggest', (c) => {
  const q = c.req.query('q') ?? '';
  c.header('Cache-Control', 'public, max-age=3600');
  let crit: Criterion | undefined;
  try { const raw = c.req.query('c'); if (raw) crit = normalizeCriterion(JSON.parse(raw)); } catch { crit = undefined; }
  return c.json(describeList(suggest(q.slice(0, 60)), crit));
});

// ---------- clubs & countries war ----------
// Each supporter's daily challenge results count for their club and their country.
// Daily scores only (one attempt a day), so spamming games doesn't help.
app.get('/api/war', async (c) => {
  const me = c.get('me');
  const by = c.req.query('by') === 'country' ? 'country' : 'club';
  const metric = c.req.query('metric') === 'supporters' ? 'supporters' : 'points';
  const rows = metric === 'supporters' ? await supporterRows(c, by, c.req.query('period') === 'month' ? 'month' : 'week') : await pointRows(c, by, c.req.query('period') === 'all' ? 'all' : 'week');
  const mine = me ? rows.find((r) => r.key === me[by]) ?? null : null;
  return c.json({ by, metric, period: c.req.query('period') ?? 'week', rows: rows.slice(0, 50), me: mine, total: rows.length });
});

/** Daily challenge points per club or country (each supporter's daily scores). */
async function pointRows(c: C, by: 'club' | 'country', period: 'week' | 'all'): Promise<WarRow[]> {
  const today = todayKey();
  const weekday = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
  const from = period === 'week' ? todayKey(Date.parse(today + 'T12:00:00Z') - weekday * 86400_000) : '0000-00-00';
  const res = await c.env.DB.prepare(
    `SELECT p.${by} AS k, SUM(s.count) AS points, COUNT(DISTINCT s.device_id) AS players
     FROM scores s JOIN profiles p ON p.id = s.device_id
     WHERE s.board_key >= ? AND s.board_key < 'daily;' AND (s.flag IS NULL OR s.flag = 'cleared') AND p.${by} NOT IN ('other', '')
     GROUP BY p.${by} ORDER BY points DESC`,
  ).bind('daily:' + from).all<{ k: string; points: number; players: number }>();
  return res.results.map((r, i) => ({ rank: i + 1, key: r.k, points: r.points, players: r.players }));
}

/** Active supporters per club or country: profiles that played at least one game in the period (clicks alone don't count). */
async function supporterRows(c: C, by: 'club' | 'country', period: 'week' | 'month'): Promise<WarRow[]> {
  const res = await c.env.DB.prepare(
    `SELECT p.${by} AS k, COUNT(*) AS players FROM profiles p
     WHERE p.${by} NOT IN ('other', '') AND EXISTS (SELECT 1 FROM games g WHERE g.device_id = p.id AND g.started_at >= ?)
     GROUP BY p.${by} ORDER BY players DESC`,
  ).bind(periodStart(period)).all<{ k: string; players: number }>();
  let rank = 0, prev = -1;
  return res.results.map((r, i) => { if (r.players !== prev) { rank = i + 1; prev = r.players; } return { rank, key: r.k, points: r.players, players: r.players }; });
}

/** A club's standing, for the "come and support your club" page. */
app.get('/api/clubs/:q', async (c) => {
  const q = c.req.param('q');
  if (!FAN_CLUBS.has(q)) throw new HttpError(404, 'club_not_found');
  const rows = await supporterRows(c, 'club', 'week');
  const row = rows.find((r) => r.key === q);
  const all = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM profiles WHERE club = ?').bind(q).first<{ n: number }>();
  return c.json({ q, rank: row?.rank ?? null, active: row?.players ?? 0, supporters: all?.n ?? 0, clubs: rows.length });
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

export default {
  fetch: app.fetch,
  // Every 30 minutes: finish the automatic checks of reports left open.
  scheduled: async (_e: ScheduledController, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(checkPendingReports(env)); },
} satisfies ExportedHandler<Env>;
