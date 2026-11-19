// Chain of teammates: each answer must have played with the previous player
// (same club, overlapping seasons). Shared by the solo mode and the room game.
import { data, getMatcher, playerStints, type Matcher } from './data';
import type { Criterion } from '../shared/types';

/** Seasons covered by a stint, or null when its dates are unknown. An open end means "until now" for active players. */
function span(p: number, s: number, e: number): [number, number] | null {
  if (s < 0) return null;
  if (e >= 0) return [s, e];
  return [s, data.players[p].x ? data.currentSeason : s];
}

let byClub: [number, number, number][][] | null = null; // club -> [player, from, to]
function clubRosters() {
  if (byClub) return byClub;
  byClub = data.clubs.map(() => []);
  for (const [p, c, s, e] of data.stints) {
    const sp = span(p, s, e);
    if (sp) byClub[c].push([p, sp[0], sp[1]]);
  }
  return byClub;
}

export interface Link { club: number; from: number; to: number }

/** Teammates of a player, with the first club and seasons they shared. */
export function teammates(p: number): Map<number, Link> {
  const out = new Map<number, Link>();
  const rosters = clubRosters();
  for (const [, c, s, e] of playerStints(p)) {
    const sp = span(p, s, e);
    if (!sp) continue;
    for (const [q, qs, qe] of rosters[c]) {
      if (q === p || out.has(q)) continue;
      const from = Math.max(sp[0], qs), to = Math.min(sp[1], qe);
      if (from <= to) out.set(q, { club: c, from, to });
    }
  }
  return out;
}

const cache = new Map<string, Matcher>();
/** Matcher accepting the teammates of `p` that also fit the theme. */
export function chainMatcher(p: number, c: Criterion): Matcher {
  const theme = getMatcher(c);
  const key = `chain:${p}:${theme.key}`;
  let m = cache.get(key);
  if (m) return m;
  const players = new Set<number>();
  for (const q of teammates(p).keys()) if (theme.scope.players.has(q)) players.add(q);
  m = { key, scope: { players } };
  cache.set(key, m);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return m;
}

/** A well-known player of the theme with plenty of teammates in it, to open the chain. */
export function chainStart(c: Criterion, rand: () => number = Math.random): number | null {
  const scope = [...getMatcher(c).scope.players].sort((a, b) => data.players[b].s - data.players[a].s);
  const pool = scope.slice(0, Math.max(20, Math.floor(scope.length * 0.1)));
  for (let tries = 0; tries < 30 && pool.length; tries++) {
    const i = Math.floor(rand() * pool.length);
    const p = pool[i];
    if (chainMatcher(p, c).scope.players.size >= 15) return p;
    pool.splice(i, 1);
  }
  return null;
}

export const seasonLabel = (from: number, to: number) => {
  const f = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  return from === to ? f(from) : `${f(from)} → ${f(to)}`;
};
export const clubLabel = (club: number) => data.clubs[club].n;
