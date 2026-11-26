// Solo games: the server holds the state, validates each answer and computes the score.
import { type Matcher, criterionKey, data, getMatcher, matchGuess, matchPick, normalizeCriterion, playerIndex, playerName, rankedThemeId, describeList } from './data';
import { chainMatcher, clubLabel, seasonLabel, teammates } from './chain';
import { dailyNumber } from './daily';

let qidIndex: Map<string, number> | null = null;
export function playerByQ(q: string): number | undefined {
  qidIndex ??= new Map(data.players.map((p, i) => [p.q, i]));
  return qidIndex.get(q);
}
import { MODE_RULES, type ChainLink, type Criterion, type GameState, type GuessOutcome, type SoloMode } from '../shared/types';

export const GRACE_MS = 2500; // network latency allowance after the timer ends
export const MIN_GUESS_INTERVAL_MS = 150;
/** Ranked daily challenge: a human needs more than half a second per name, a script does not. */
export const MIN_DAILY_GUESS_INTERVAL_MS = 500;
export const MAX_GUESSES = 2000;

export interface GameRow {
  id: string;
  device_id: string;
  mode: SoloMode;
  criterion: string;
  board_key: string;
  daily_date: string | null;
  started_at: number;
  deadline: number | null;
  last_at: number;
  status: 'active' | 'finished';
  found: string; // JSON array of player Wikidata ids, in citation order
  count: number;
  points: number;
  errors: number;
  guesses: number;
  end_reason: GameState['endReason'] | null;
  version: number;
  challenge?: string | null; // code of the challenge this game answers
}

export function boardKey(mode: SoloMode, c: Criterion, dailyDate?: string) {
  return mode === 'daily' ? `daily:${dailyDate}` : `${mode}:${criterionKey(c)}`;
}

export function newGame(id: string, deviceId: string, mode: SoloMode, criterion: Criterion, now: number, dailyDate?: string): GameRow {
  const c = normalizeCriterion(criterion);
  const rules = MODE_RULES[mode];
  const deadline = rules.duration ? now + rules.duration * 1000 : rules.streakSeconds ? now + rules.streakSeconds * 1000 : rules.idleSeconds ? now + rules.idleSeconds * 1000 : null;
  return {
    id, device_id: deviceId, mode, criterion: JSON.stringify(c), board_key: boardKey(mode, c, dailyDate),
    daily_date: dailyDate ?? null, started_at: now, deadline, last_at: now, status: 'active', found: '[]',
    count: 0, points: 0, errors: 0, guesses: 0, end_reason: null, version: 0,
  };
}

/** Ends the game if its timer ran out. Returns true if the row changed. */
export function expire(g: GameRow, now: number): boolean {
  if (g.status !== 'active' || g.deadline === null || now <= g.deadline + GRACE_MS) return false;
  g.status = 'finished';
  const rules = MODE_RULES[g.mode];
  g.end_reason = rules.duration || rules.streakSeconds ? 'time' : 'idle';
  return true;
}

/** Theme matcher plus the answers accepted by hand for it (see accepted_answers). */
const extraCache = new Map<string, Matcher>();
function withAccepted(m: Matcher, accepted: number[]): Matcher {
  const extra = accepted.filter((p) => !m.scope.players.has(p));
  if (!extra.length) return m;
  const key = `${m.key}+${extra.sort((a, b) => a - b).join(',')}`;
  let out = extraCache.get(key);
  if (!out) {
    out = { key, scope: { players: new Set([...m.scope.players, ...extra]) } };
    extraCache.set(key, out);
    if (extraCache.size > 30) extraCache.delete(extraCache.keys().next().value!);
  }
  return out;
}

export function applyGuess(g: GameRow, text: string, now: number, pick?: string, accepted: number[] = []): { outcome: GuessOutcome; changed: boolean } {
  if (expire(g, now)) return { outcome: { status: 'invalid' }, changed: true };
  if (g.status !== 'active') return { outcome: { status: 'invalid' }, changed: false };
  const minInterval = g.daily_date ? MIN_DAILY_GUESS_INTERVAL_MS : MIN_GUESS_INTERVAL_MS;
  if ((g.guesses > 0 && now - g.last_at < minInterval) || g.guesses >= MAX_GUESSES) return { outcome: { status: 'invalid' }, changed: false };
  const rules = MODE_RULES[g.mode];
  const found: string[] = JSON.parse(g.found);
  const cited = new Set(found.map(playerByQ).filter((p): p is number => p !== undefined));
  const criterion = JSON.parse(g.criterion) as Criterion;
  const last = g.mode === 'chain' ? playerByQ(found[found.length - 1]) : undefined;
  const matcher = last !== undefined ? chainMatcher(last, criterion) : withAccepted(getMatcher(criterion), accepted);
  const picked = pick !== undefined ? playerIndex(pick) : undefined;
  if (pick !== undefined && picked === undefined) return { outcome: { status: 'invalid' }, changed: false };
  const res = picked !== undefined ? matchPick(matcher, picked, cited) : matchGuess(matcher, text, cited, !!rules.suddenDeath);
  if (res.status === 'invalid') return { outcome: res, changed: false };
  if (res.status === 'ambiguous') return { outcome: { status: 'ambiguous', options: describeList(res.options, criterion) }, changed: false };
  g.guesses++;
  g.last_at = now;
  let outcome: GuessOutcome;
  if (res.status === 'ok') {
    found.push(data.players[res.player].q);
    g.found = JSON.stringify(found);
    g.count++;
    g.points++;
    outcome = { status: 'ok', name: playerName(res.player) };
    if (rules.streakSeconds) g.deadline = now + rules.streakSeconds * 1000;
  } else {
    g.errors++;
    outcome = res.status === 'duplicate' ? { status: 'duplicate', name: playerName(res.player) } : { status: 'wrong', name: res.player !== undefined ? playerName(res.player) : undefined };
    if (rules.suddenDeath) {
      g.status = 'finished';
      g.end_reason = res.status === 'duplicate' ? 'duplicate' : 'mistake';
    }
  }
  if (rules.idleSeconds && g.status === 'active') g.deadline = now + rules.idleSeconds * 1000;
  return { outcome, changed: true };
}

export function finish(g: GameRow, now: number) {
  if (expire(g, now) || g.status !== 'active') return;
  g.status = 'finished';
  g.end_reason = 'quit';
}

export const scoreOf = (g: GameRow) => g.count;

/**
 * A score no human could reach: more than SUSPECT_PER_MINUTE right answers a minute, over at least
 * SUSPECT_MIN_COUNT answers. Typing (even with suggestions) tops out well below; a script does not.
 * Such scores stay out of every ranking until the admin clears them (/#/admin).
 */
export const SUSPECT_MIN_COUNT = 40;
export const SUSPECT_PER_MINUTE = 45;
export function isSuspect(count: number, startedAt: number, lastAt: number): boolean {
  if (count < SUSPECT_MIN_COUNT) return false;
  const minutes = Math.max(lastAt - startedAt, 1) / 60_000;
  return count / minutes > SUSPECT_PER_MINUTE;
}


export function toState(g: GameRow, now: number, extra?: Partial<GameState>): GameState {
  const found: string[] = JSON.parse(g.found);
  return {
    id: g.id,
    mode: g.mode,
    criterion: JSON.parse(g.criterion),
    startedAt: g.started_at,
    deadline: g.deadline,
    serverNow: now,
    status: g.status,
    count: g.count,
    errors: g.errors,
    found: found.map((q) => data.players[playerByQ(q) ?? -1]?.n ?? '?'),
    ...(g.mode === 'chain' ? { chain: chainLinks(found) } : {}),
    ...(g.mode !== 'daily' && rankedThemeId(JSON.parse(g.criterion)) ? { rankedTheme: rankedThemeId(JSON.parse(g.criterion)) } : {}),
    ...(g.end_reason ? { endReason: g.end_reason } : {}),
    ...(g.daily_date ? { dailyDate: g.daily_date, dailyNumber: dailyNumber(g.daily_date) } : {}),
    ...(g.board_key.startsWith('archive:') ? { dailyDate: g.board_key.slice(8), dailyNumber: dailyNumber(g.board_key.slice(8)), archive: true } : {}),
    ...(g.challenge ? { challenge: g.challenge } : {}),
    ...extra,
  };
}

function chainLinks(found: string[]): ChainLink[] {
  const ps = found.map(playerByQ);
  return ps.map((p, i) => {
    if (p === undefined) return { name: '?' };
    const prev = i > 0 ? ps[i - 1] : undefined;
    const l = prev !== undefined ? teammates(prev).get(p) : undefined;
    return { name: data.players[p].n, ...(l ? { club: clubLabel(l.club), seasons: seasonLabel(l.from, l.to) } : {}) };
  });
}
