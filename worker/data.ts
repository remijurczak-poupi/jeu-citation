// Football dataset (built from Wikidata by scripts/build-data.mjs) and theme ("criterion") logic.
import raw from '../src/data/football.json';
import { boundedDistance, compact, surnameKeys, tolerance } from './normalize';
import type { Criterion, LeagueId, Position } from '../shared/types';

export interface Club {
  q: string; n: string; nf?: string;
  l: Record<string, number[]>; // seasons per league
  cl?: number[]; // seasons in the Champions League (group stage / league phase)
  cw?: number[]; // Champions League won
  ch?: Record<string, number[]>; // league titles per league
}
export interface Player {
  q: string; n: string; a?: string[]; s: number; b?: number;
  p?: Position[]; // positions
  c?: string[]; // nationalities, sporting one first
  i?: number; // senior caps (present = international)
  h?: number; // height in cm
  t?: string[]; // tournaments played (WC2006…)
  w?: string[]; // tournaments won
  x?: 1; // still active
  bd?: number[]; // Ballon d'Or ranking years
  ts?: string[]; // league top scorer (PL2007…)
}
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

const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];
const int = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const bool = (v: unknown) => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' ? false : undefined);

/** Cleans a theme coming from a client: unknown values are dropped, defaults are omitted. */
export function normalizeCriterion(c: Criterion): Criterion {
  const from = Math.max(data.firstSeason, Math.min(int(c.from, 1900, 3000) ?? data.firstSeason, data.currentSeason));
  const to = Math.min(data.currentSeason, Math.max(int(c.to, 1900, 3000) ?? data.currentSeason, from));
  const out: Criterion = {};
  if (c.league && data.leagues.some((l) => l.id === c.league)) out.league = c.league;
  if (typeof c.club === 'string' && clubIndex(c.club) !== undefined) out.club = c.club;
  if (typeof c.club2 === 'string' && clubIndex(c.club2) !== undefined && c.club2 !== out.club) out.club2 = c.club2;
  if (from !== data.firstSeason) out.from = from;
  if (to !== data.currentSeason) out.to = to;
  if (c.position && POSITIONS.includes(c.position)) out.position = c.position;
  if (typeof c.nationality === 'string' && /^[A-Z]{2}(-[A-Z]{3})?$/.test(c.nationality)) out.nationality = c.nationality;
  const intl = bool(c.international); if (intl !== undefined) out.international = intl;
  const act = bool(c.active); if (act !== undefined) out.active = act;
  const ageMin = int(c.ageMin, 15, 60); if (ageMin !== undefined) out.ageMin = ageMin;
  const ageMax = int(c.ageMax, 15, 90); if (ageMax !== undefined) out.ageMax = ageMax;
  const hMin = int(c.heightMin, 150, 215); if (hMin !== undefined) out.heightMin = hMin;
  const hMax = int(c.heightMax, 150, 215); if (hMax !== undefined) out.heightMax = hMax;
  if (typeof c.tournament === 'string' && /^(WC|EU|CA)(\d{4})?$/.test(c.tournament)) {
    out.tournament = c.tournament;
    if (bool(c.tournamentWon)) out.tournamentWon = true;
  }
  if (c.ucl === 'played' || c.ucl === 'won') out.ucl = c.ucl;
  if (bool(c.champion)) out.champion = true;
  if (bool(c.topScorer)) out.topScorer = true;
  if (bool(c.ballonDor)) out.ballonDor = true;
  return out;
}

/** Stable key of a theme (leaderboards, citation stats). Unchanged for themes that only use league/club/period. */
export function criterionKey(c: Criterion): string {
  const base = `${c.league ?? '*'}|${c.club ?? '*'}|${c.from ?? data.firstSeason}-${c.to ?? data.currentSeason}`;
  const extra = (Object.keys(c) as (keyof Criterion)[])
    .filter((k) => !['league', 'club', 'from', 'to'].includes(k) && c[k] !== undefined)
    .sort()
    .map((k) => `${k}=${c[k]}`);
  return extra.length ? `${base}|${extra.join(',')}` : base;
}

export interface Scope { players: Set<number> }

const nowYear = () => new Date().getUTCFullYear();

/** Checks on the player's own attributes (no club history involved). */
function attributesOk(pl: Player, c: Criterion): boolean {
  if (c.position && !pl.p?.includes(c.position)) return false;
  if (c.nationality && !pl.c?.includes(c.nationality)) return false;
  if (c.international !== undefined && !!pl.i !== c.international) return false;
  if (c.active !== undefined && !!pl.x !== c.active) return false;
  if (c.ageMin !== undefined || c.ageMax !== undefined) {
    if (!pl.b) return false;
    const age = nowYear() - pl.b;
    if (c.ageMin !== undefined && age < c.ageMin) return false;
    if (c.ageMax !== undefined && age > c.ageMax) return false;
  }
  if (c.heightMin !== undefined || c.heightMax !== undefined) {
    if (!pl.h) return false;
    if (c.heightMin !== undefined && pl.h < c.heightMin) return false;
    if (c.heightMax !== undefined && pl.h > c.heightMax) return false;
  }
  if (c.tournament) {
    const list = c.tournamentWon ? pl.w : pl.t;
    if (!list?.some((t) => t.startsWith(c.tournament!))) return false;
  }
  if (c.ballonDor && !pl.bd?.length) return false;
  if (c.topScorer) {
    const from = c.from ?? data.firstSeason;
    const to = c.to ?? data.currentSeason;
    const ok = pl.ts?.some((code) => (!c.league || code.startsWith(c.league)) && +code.slice(2) >= from && +code.slice(2) <= to);
    if (!ok) return false;
  }
  return true;
}

/**
 * All players valid for a theme. A club counts for a league only in the seasons it actually played in it.
 * Themes built only on a tournament (no league, club or period) are not limited to the 5 big leagues.
 */
export function computeScope(c: Criterion): Scope {
  prepare();
  const from = c.from ?? data.firstSeason;
  const to = c.to ?? data.currentSeason;
  const fullPeriod = from === data.firstSeason && to === data.currentSeason;
  const clubFilter = c.club !== undefined ? clubIndex(c.club) : undefined;
  const club2 = c.club2 !== undefined ? clubIndex(c.club2) : undefined;
  const seasonRule = !!(c.ucl || c.champion);
  const needStints = !!(c.league || clubFilter !== undefined || !fullPeriod || seasonRule || !c.tournament);
  const players = new Set<number>();
  data.players.forEach((pl, p) => {
    if (!attributesOk(pl, c)) return;
    const stints = stintsByPlayer![p];
    if (club2 !== undefined && !stints.some((s) => s[1] === club2)) return;
    if (!needStints) { players.add(p); return; }
    for (const [, club, s, e] of stints) {
      if (clubFilter !== undefined && club !== clubFilter) continue;
      const cl = data.clubs[club];
      const leagueYears = c.league ? cl.l[c.league] : undefined;
      if (c.league && !leagueYears) continue;
      if (s === -1) {
        // Undated stint: we can't tell which seasons, so it only counts for a club theme without period or league.
        if (fullPeriod && !c.league && !seasonRule && clubFilter !== undefined) { players.add(p); return; }
        continue;
      }
      for (let y = Math.max(s, from); y <= Math.min(e, to); y++) {
        const inScope = c.league ? leagueYears!.includes(y) : clubFilter !== undefined || anySeasonByClub![club].has(y);
        if (!inScope) continue;
        if (c.ucl === 'played' && !cl.cl?.includes(y)) continue;
        if (c.ucl === 'won' && !cl.cw?.includes(y)) continue;
        if (c.champion && !(c.league ? cl.ch?.[c.league]?.includes(y) : Object.values(cl.ch ?? {}).some((ys) => ys.includes(y)))) continue;
        players.add(p);
        return;
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
}

/** Name keys of a player: precomputed by the data build (k, u), or derived from names. */
function keysOf(pl: Player & { k?: string[]; u?: string[] }): { full: string[]; sur: string[] } {
  if (pl.k) return { full: pl.k, sur: pl.u ?? [] };
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

/**
 * One global index of every name key, built once per Worker instance at startup (outside request CPU time).
 * A theme only needs its set of valid players: lookups filter the global index by that set.
 */
interface Index { full: Map<string, number[]>; sur: Map<string, number[]>; byLen: Map<number, Entry[]> }
function buildIndex(): Index {
  const full = new Map<string, number[]>();
  const sur = new Map<string, number[]>();
  const byLen = new Map<number, Entry[]>();
  const push = (m: Map<string, number[]>, k: string, p: number, isSur: boolean) => {
    const arr = m.get(k);
    if (arr) { if (arr.includes(p)) return; arr.push(p); } else m.set(k, [p]);
    let list = byLen.get(k.length);
    if (!list) byLen.set(k.length, (list = []));
    list.push({ k, p, sur: isSur, mask: letterMask(k) });
  };
  data.players.forEach((pl, p) => {
    const ks = keysOf(pl);
    for (const k of ks.full) push(full, k, p, false);
    for (const k of ks.sur) push(sur, k, p, true);
  });
  return { full, sur, byLen };
}
const index: Index = buildIndex();
prepare();

const matcherCache = new Map<string, Matcher>();
export function getMatcher(c: Criterion): Matcher {
  const key = criterionKey(c);
  let m = matcherCache.get(key);
  if (m) { matcherCache.delete(key); matcherCache.set(key, m); return m; }
  m = { key, scope: computeScope(c) };
  matcherCache.set(key, m);
  if (matcherCache.size > 60) matcherCache.delete(matcherCache.keys().next().value!);
  return m;
}

export type GuessResult =
  | { status: 'ok'; player: number }
  | { status: 'duplicate'; player: number }
  | { status: 'wrong'; player?: number } // player = recognised but not in theme
  | { status: 'invalid' };

function fuzzy(scope: Set<number>, k: string, sur: boolean, strict: boolean): number[] {
  const max = Math.max(0, tolerance(k.length, sur) - (strict ? 1 : 0));
  if (max === 0) return [];
  let best = max + 1;
  let found: number[] = [];
  const mask = letterMask(k);
  for (let len = k.length - max; len <= k.length + max; len++) {
    for (const e of index.byLen.get(len) ?? []) {
      if (e.sur !== sur || !scope.has(e.p)) continue;
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
  const scope = m.scope.players;
  const inScope = (ps: number[] | undefined) => (ps ?? []).filter((p) => scope.has(p));
  const stages: (() => number[])[] = [
    () => inScope(index.full.get(k)),
    () => inScope(index.sur.get(k)),
    () => fuzzy(scope, k, false, strict),
    () => fuzzy(scope, k, true, strict),
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
  const known = index.full.get(k);
  if (known?.length) return { status: 'wrong', player: [...known].sort((a, b) => data.players[b].s - data.players[a].s)[0] };
  return { status: 'wrong' };
}

export const playerName = (p: number) => data.players[p].n;
export const scopeSize = (c: Criterion) => getMatcher(c).scope.players.size;
