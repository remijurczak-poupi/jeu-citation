// Solo games: the server holds the state, validates each answer and computes the score.
import { criterionKey, data, getMatcher, matchGuess, normalizeCriterion, playerName } from './data';
import { chainMatcher, clubLabel, seasonLabel, teammates } from './chain';

let qidIndex: Map<string, number> | null = null;
export function playerByQ(q: string): number | undefined {
  qidIndex ??= new Map(data.players.map((p, i) => [p.q, i]));
  return qidIndex.get(q);
}
import { MODE_RULES, type ChainLink, type Criterion, type GameState, type GuessOutcome, type SoloMode } from '../shared/types';

export const GRACE_MS = 2500; // network latency allowance after the timer ends
export const MIN_GUESS_INTERVAL_MS = 150;
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

export function applyGuess(g: GameRow, text: string, now: number): { outcome: GuessOutcome; changed: boolean } {
  if (expire(g, now)) return { outcome: { status: 'invalid' }, changed: true };
  if (g.status !== 'active') return { outcome: { status: 'invalid' }, changed: false };
  if ((g.guesses > 0 && now - g.last_at < MIN_GUESS_INTERVAL_MS) || g.guesses >= MAX_GUESSES) return { outcome: { status: 'invalid' }, changed: false };
  const rules = MODE_RULES[g.mode];
  const found: string[] = JSON.parse(g.found);
  const cited = new Set(found.map(playerByQ).filter((p): p is number => p !== undefined));
  const criterion = JSON.parse(g.criterion) as Criterion;
  const last = g.mode === 'chain' ? playerByQ(found[found.length - 1]) : undefined;
  const matcher = last !== undefined ? chainMatcher(last, criterion) : getMatcher(criterion);
  const res = matchGuess(matcher, text, cited, !!rules.suddenDeath);
  if (res.status === 'invalid') return { outcome: res, changed: false };
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
    ...(g.end_reason ? { endReason: g.end_reason } : {}),
    ...(g.daily_date ? { dailyDate: g.daily_date } : {}),
    ...(g.board_key.startsWith('archive:') ? { dailyDate: g.board_key.slice(8), archive: true } : {}),
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
