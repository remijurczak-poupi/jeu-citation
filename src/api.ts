// Small API client. The device id + secret identify the player's profile (no account).
import type { ClubDayBoard, LeagueBoard, LeagueDuration, LeagueSummary, LeagueView, Challenge, GameRecap, ClubStanding, WarMetric, SignInResult, Criterion, DailyHistoryItem, DailyInfo, GameState, GuessOutcome, LeaderboardRow, Meta, Profile, Ranking, RoomGame, SoloMode, Suggestion, WarBoard, Badge, BoardKind, BoardPeriod } from '../shared/types';

export interface Session extends Profile { id: string; secret: string; guest?: boolean }

const KEY = 'ntp-session';
export function loadSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: session lives in memory only */ }
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

let session: Session | null = loadSession();
export const getSession = () => session;
export const setSession = (s: Session) => { session = s; saveSession(s); };

/** Guest profile created on the first action that needs one (start a game, join a room…). */
let guestPending: Promise<void> | null = null;
export function ensureSession(): Promise<void> {
  if (session) return Promise.resolve();
  let lang = 'en';
  try { lang = localStorage.getItem('lang') ?? document.documentElement.lang ?? 'en'; } catch { /* ignore */ }
  guestPending ??= call<Session>('POST', '/profile/guest', { lang }).then((s) => setSession({ ...s, guest: true })).finally(() => { guestPending = null; });
  return guestPending;
}
const NEEDS_PROFILE = /^\/(games|rooms|challenges|leagues)/;

async function call<R>(method: string, path: string, body?: unknown): Promise<R> {
  if (!session && method !== 'GET' && NEEDS_PROFILE.test(path)) await ensureSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) { headers['x-device-id'] = session.id; headers['x-device-secret'] = session.secret; }
  const res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({ error: 'server_error' }))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? 'server_error', res.status);
  return json as R;
}

export const api = {
  meta: () => call<Meta>('GET', '/meta'),
  themeSize: (criterion: Criterion) => call<{ size: number }>('POST', '/theme/size', { criterion }),
  saveProfile: (p: Profile) => call<Profile & { id: string; secret?: string }>('POST', '/profile', p),
  account: () => call<{ email: string; provider: string } | null>('GET', '/account'),
  signInGoogle: (credential: string) => call<SignInResult>('POST', '/auth/google', { credential }),
  sendEmailLink: (email: string, lang: string) => call<{ ok: true }>('POST', '/auth/email', { email, lang }),
  verifyEmailLink: (token: string) => call<SignInResult>('POST', '/auth/email/verify', { token }),
  ensureSession,
  startGame: (mode: SoloMode, criterion?: Criterion, date?: string) => call<GameState>('POST', '/games', { mode, criterion, date }),
  acceptChallenge: (code: string) => call<GameState>('POST', '/games', { challenge: code }),
  recap: (id: string) => call<GameRecap>('GET', `/games/${id}/recap`),
  createChallenge: (gameId: string) => call<{ code: string }>('POST', '/challenges', { gameId }),
  challenge: (code: string) => call<Challenge>('GET', `/challenges/${code}`),
  report: (r: { gameId?: string; text: string; recognised?: string; criterion: Criterion; note?: string }) => call<{ ok: true; verdict: 'accept' | 'reject' | 'manual' | 'pending' }>('POST', '/reports', r),
  game: (id: string) => call<GameState>('GET', `/games/${id}`),
  guess: (id: string, text: string, pick?: string) => call<{ outcome: GuessOutcome; state: GameState }>('POST', `/games/${id}/guess`, { text, ...(pick ? { pick } : {}) }),
  suggest: (q: string, criterion?: Criterion) => call<Suggestion[]>('GET', `/suggest?q=${encodeURIComponent(q)}${criterion ? '&c=' + encodeURIComponent(JSON.stringify(criterion)) : ''}`),
  finish: (id: string) => call<GameState>('POST', `/games/${id}/finish`),
  daily: () => call<DailyInfo>('GET', '/daily'),
  dailyHistory: () => call<DailyHistoryItem[]>('GET', '/daily/history'),
  war: (by: 'club' | 'country', metric: WarMetric, period: string) => call<WarBoard>('GET', `/war?by=${by}&metric=${metric}&period=${period}`),
  club: (q: string) => call<ClubStanding>('GET', `/clubs/${q}`),
  clubsOfDay: (date?: string) => call<ClubDayBoard>('GET', '/daily/clubs' + (date ? `?date=${date}` : '')),
  leagues: () => call<LeagueSummary[]>('GET', '/leagues'),
  league: (code: string, view: LeagueView, date?: string) => call<LeagueBoard>('GET', `/leagues/${encodeURIComponent(code)}?view=${view}${date ? `&date=${date}` : ''}`),
  createLeague: (name: string, duration: LeagueDuration) => call<{ code: string }>('POST', '/leagues', { name, duration }),
  joinLeague: (code: string) => call<{ ok: true; code: string }>('POST', `/leagues/${encodeURIComponent(code)}/join`),
  leaveLeague: (code: string) => call<{ ok: true }>('POST', `/leagues/${encodeURIComponent(code)}/leave`),
  deleteLeague: (code: string) => call<{ ok: true }>('DELETE', `/leagues/${encodeURIComponent(code)}`),
  leaderboard: (p: { mode: SoloMode; kind?: BoardKind; theme?: string; period?: BoardPeriod; ranking?: Ranking; date?: string; club?: string }) => {
    const q = new URLSearchParams({ mode: p.mode, kind: p.kind ?? 'best', ranking: p.ranking ?? 'count' });
    if (p.period) q.set('period', p.period);
    if (p.theme) q.set('theme', p.theme);
    if (p.date) q.set('date', p.date);
    if (p.club) q.set('club', p.club);
    return call<{ total: number; dist?: { width: number; counts: number[] }; rows: LeaderboardRow[]; me: LeaderboardRow | null }>('GET', '/leaderboard?' + q);
  },
  badges: () => call<Badge[]>('GET', '/badges'),
  createRoom: (game: RoomGame, criterion: Criterion) => call<{ code: string }>('POST', '/rooms', { game, criterion }),
  roomSocketUrl: (code: string) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/api/rooms/${code}/ws?id=${encodeURIComponent(session?.id ?? '')}&secret=${encodeURIComponent(session?.secret ?? '')}`;
  },
};
