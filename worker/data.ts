// Football dataset (built from Wikidata by scripts/build-data.mjs) and theme ("criterion") logic.
import raw from '../src/data/football.json';
import { boundedDistance, compact, surnameKeys, tolerance } from './normalize';
import type { Criterion, LeagueId } from '../shared/types';

export interface Club { q: string; n: string; nf?: string; l: Record<string, number[]> }
export interface Player { q: string; n: string; a?: string[]; s: number; b?: number }
/** [playerIdx, clubIdx, firstSeason|-1, lastSeason|-1, apps|-1] */
export type Stint = [number, number, number, number, number];
export interface FootballData {
  firstSeason: number;
  currentSeason: number;
  leagues: { id: LeagueId; qid: string; name: { en: string; fr: string }; country: string }[];
  clubs: Club[];
  players: Player[];
  stints: Stint[];
}

export const data = raw as unknown as FootballData;

let stintsByPlayer: Stint[][] | null = null;
let clubByQ: Map<string, number> | null = null;
let anySeasonByClub: Set<number>[] | null = null;
function prepare() {
  if (stintsByPlayer) return;
  stintsByPlayer = data.players.map(() => []);
  for (const s of data.stints) stintsByPlayer[s[0]].push(s);
  clubByQ = new Map(data.clubs.map((c, i) => [c.q, i]));
  anySeasonByClub = data.clubs.map((c) => new Set(Object.values(c.l).flat()));
}
export function playerStints(p: number): Stint[] {
  prepare();
  return stintsByPlayer![p];
}
export function clubIndex(q: string): number | undefined {
  prepare();
  return clubByQ!.get(q);
}

export function normalizeCriterion(c: Criterion): Criterion {
  const from = Math.max(data.firstSeason, Math.min(c.from ?? data.firstSeason, data.currentSeason));
  const to = Math.min(data.currentSeason, Math.max(c.to ?? data.currentSeason, from));
  const out: Criterion = {};
  if (c.league && data.leagues.some((l) => l.id === c.league)) out.league = c.league;
  if (c.club && clubIndex(c.club) !== undefined) out.club = c.club;
  if (from !== data.firstSeason) out.from = from;
  if (to !== data.currentSeason) out.to = to;
  return out;
}

export const criterionKey = (c: Criterion) =>
  `${c.league ?? '*'}|${c.club ?? '*'}|${c.from ?? data.firstSeason}-${c.to ?? data.currentSeason}`;

export interface Scope { players: Set<number> }

/** All players valid for a theme. A club counts for a league only in the seasons it actually played in it. */
export function computeScope(c: Criterion): Scope {
  prepare();
  const from = c.from ?? data.firstSeason;
  const to = c.to ?? data.currentSeason;
  const fullPeriod = from === data.firstSeason && to === data.currentSeason;
  const clubFilter = c.club !== undefined ? clubIndex(c.club) : undefined;
  const players = new Set<number>();
  data.players.forEach((_, p) => {
    for (const [, club, s, e] of stintsByPlayer![p]) {
      if (clubFilter !== undefined && club !== clubFilter) continue;
      const leagueYears = c.league ? data.clubs[club].l[c.league] : undefined;
      if (c.league && !leagueYears) continue;
      if (s === -1) {
        // Undated stint: we can't tell which seasons, so it only counts for a club theme without period or league.
        if (fullPeriod && !c.league && clubFilter !== undefined) { players.add(p); return; }
        continue;
      }
      for (let y = Math.max(s, from); y <= Math.min(e, to); y++) {
        const inScope = c.league ? leagueYears!.includes(y) : clubFilter !== undefined || anySeasonByClub![club].has(y);
        if (inScope) { players.add(p); return; }
      }
    }
  });
  return { players };
}

// ---------- Name matching ----------

interface Entry { k: string; p: number; sur: boolean; mask: number }

/** Set of letters in a key as a bitmask: one edit changes at most 2 bits, a cheap filter before edit distance. */
function letterMask(k: string): number {
  let m = 0;
  for (let i = 0; i < k.length; i++) {
    const c = k.charCodeAt(i);
    m |= 1 << (c >= 97 ? c - 97 : 26 + (c % 6));
  }
  return m >>> 0;
}
function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
}
export interface Matcher {
  key: string;
  scope: Scope;
  full: Map<string, number[]>;
  sur: Map<string, number[]>;
  byLen: Map<number, Entry[]>;
}

function keysOf(pl: Player): { full: string[]; sur: string[] } {
  const names = [pl.n, ...(pl.a ?? [])];
  const full = new Set<string>();
  const sur = new Set<string>();
  for (const n of names) {
    const k = compact(n.replace(/\(.*?\)/g, ''));
    if (k.length >= 2) full.add(k);
    for (const s of surnameKeys(n)) sur.add(s);
  }
  for (const k of full) sur.delete(k);
  return { full: [...full], sur: [...sur] };
}

let keyCache: { full: string[]; sur: string[] }[] | null = null;
function playerKeys(p: number) {
  keyCache ??= new Array(data.players.length);
  return (keyCache[p] ??= keysOf(data.players[p]));
}

function buildMatcher(key: string, scope: Scope, players: Iterable<number>): Matcher {
  const full = new Map<string, number[]>();
  const sur = new Map<string, number[]>();
  const byLen = new Map<number, Entry[]>();
  const push = (m: Map<string, number[]>, k: string, p: number) => {
    const arr = m.get(k);
    if (arr) { if (!arr.includes(p)) arr.push(p); } else m.set(k, [p]);
  };
  for (const p of players) {
    const ks = playerKeys(p);
    for (const k of ks.full) { push(full, k, p); }
    for (const k of ks.sur) { push(sur, k, p); }
  }
  for (const [m, isSur] of [[full, false], [sur, true]] as const)
    for (const [k, ps] of m) for (const p of ps) {
      const list = byLen.get(k.length) ?? [];
      list.push({ k, p, sur: isSur, mask: letterMask(k) });
      byLen.set(k.length, list);
    }
  return { key, scope, full, sur, byLen };
}

const matcherCache = new Map<string, Matcher>();
export function getMatcher(c: Criterion): Matcher {
  const key = criterionKey(c);
  let m = matcherCache.get(key);
  if (m) { matcherCache.delete(key); matcherCache.set(key, m); return m; }
  const scope = computeScope(c);
  m = buildMatcher(key, scope, scope.players);
  matcherCache.set(key, m);
  if (matcherCache.size > 40) matcherCache.delete(matcherCache.keys().next().value!);
  return m;
}

let globalMatcher: Matcher | null = null;
function getGlobal(): Matcher {
  return (globalMatcher ??= buildMatcher('global', { players: new Set() }, data.players.keys()));
}

export type GuessResult =
  | { status: 'ok'; player: number }
  | { status: 'duplicate'; player: number }
  | { status: 'wrong'; player?: number } // player = recognised but not in theme
  | { status: 'invalid' };

function fuzzy(m: Matcher, k: string, sur: boolean, strict: boolean): number[] {
  const max = Math.max(0, tolerance(k.length, sur) - (strict ? 1 : 0));
  if (max === 0) return [];
  let best = max + 1;
  let found: number[] = [];
  const mask = letterMask(k);
  for (let len = k.length - max; len <= k.length + max; len++) {
    for (const e of m.byLen.get(len) ?? []) {
      if (e.sur !== sur) continue;
      // Surname typos must keep the first letter (limits false positives on short names).
      if (sur && e.k[0] !== k[0]) continue;
      if (popcount(mask ^ e.mask) > 2 * Math.min(max, best)) continue;
      const d = boundedDistance(k, e.k, Math.min(max, best));
      if (d < best) { best = d; found = [e.p]; }
      else if (d === best && d <= max && !found.includes(e.p)) found.push(e.p);
    }
  }
  return best <= max ? found : [];
}

/** Resolve free text to a player of the theme. Homonyms: the most famous not-yet-cited player wins. */
export function matchGuess(m: Matcher, input: string, cited: Set<number>, strict = false): GuessResult {
  const k = compact(input);
  if (k.length < 2 || k.length > 60) return { status: 'invalid' };
  const stages: (() => number[])[] = [
    () => m.full.get(k) ?? [],
    () => m.sur.get(k) ?? [],
    () => fuzzy(m, k, false, strict),
    () => fuzzy(m, k, true, strict),
  ];
  for (const stage of stages) {
    const cands = stage();
    if (!cands.length) continue;
    const sorted = [...cands].sort((a, b) => data.players[b].s - data.players[a].s);
    const fresh = sorted.find((p) => !cited.has(p));
    if (fresh === undefined) return { status: 'duplicate', player: sorted[0] };
    return { status: 'ok', player: fresh };
  }
  // Not in the theme: is it a real player we know? (better feedback)
  const g = getGlobal();
  const known = g.full.get(k);
  if (known?.length) return { status: 'wrong', player: [...known].sort((a, b) => data.players[b].s - data.players[a].s)[0] };
  return { status: 'wrong' };
}

export const playerName = (p: number) => data.players[p].n;
export const scopeSize = (c: Criterion) => getMatcher(c).scope.players.size;
