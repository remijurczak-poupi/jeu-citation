// Small API client. The device id + secret identify the player's profile (no account).
import type { Criterion, DailyHistoryItem, DailyInfo, GameState, GuessOutcome, LeaderboardRow, Meta, Profile, Ranking, RoomGame, SoloMode, Suggestion, WarBoard } from '../shared/types';

export interface Session extends Profile { id: string; secret: string }

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

async function call<R>(method: string, path: string, body?: unknown): Promise<R> {
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
  recover: (code: string) => call<Session>('POST', '/profile/recover', { code }),
  startGame: (mode: SoloMode, criterion?: Criterion, date?: string) => call<GameState>('POST', '/games', { mode, criterion, date }),
  game: (id: string) => call<GameState>('GET', `/games/${id}`),
  guess: (id: string, text: string, pick?: string) => call<{ outcome: GuessOutcome; state: GameState }>('POST', `/games/${id}/guess`, { text, ...(pick ? { pick } : {}) }),
  suggest: (q: string) => call<Suggestion[]>('GET', `/suggest?q=${encodeURIComponent(q)}`),
  finish: (id: string) => call<GameState>('POST', `/games/${id}/finish`),
  daily: () => call<DailyInfo>('GET', '/daily'),
  dailyHistory: () => call<DailyHistoryItem[]>('GET', '/daily/history'),
  war: (by: 'club' | 'country', period: 'week' | 'all') => call<WarBoard>('GET', `/war?by=${by}&period=${period}`),
  leaderboard: (p: { mode: SoloMode; criterion?: Criterion; period?: 'day' | 'week' | 'all'; ranking?: Ranking; date?: string }) => {
    const q = new URLSearchParams({ mode: p.mode, period: p.period ?? 'all', ranking: p.ranking ?? 'count' });
    if (p.date) q.set('date', p.date);
    for (const [k, v] of Object.entries(p.criterion ?? {})) if (v !== undefined) q.set(k, String(v));
    return call<{ total: number; rows: LeaderboardRow[]; me: LeaderboardRow | null }>('GET', '/leaderboard?' + q);
  },
  createRoom: (game: RoomGame, criterion: Criterion) => call<{ code: string }>('POST', '/rooms', { game, criterion }),
  roomSocketUrl: (code: string) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/api/rooms/${code}/ws?id=${encodeURIComponent(session?.id ?? '')}&secret=${encodeURIComponent(session?.secret ?? '')}`;
  },
};
