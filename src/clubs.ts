// Clubs a player can support: much wider than the game's player base (see scripts/build-fan-clubs.mjs).
// Loaded on demand as its own cached file; club names fall back to the game's clubs until then.
import { boundedDistance, normalize } from '../worker/normalize';
import type { Lang } from './i18n';

export interface FanClub { q: string; n: string; c: string; t: number; s: number; tr?: Partial<Record<Lang, string>> }

let list: FanClub[] | null = null;
let byQ = new Map<string, FanClub>();
let loading: Promise<FanClub[]> | null = null;

export function loadFanClubs(): Promise<FanClub[]> {
  loading ??= import('./data/fan-clubs.json').then((m) => {
    list = m.default as FanClub[];
    byQ = new Map(list.map((c) => [c.q, c]));
    return list;
  });
  return loading;
}
export const fanClub = (q: string) => byQ.get(q);
export const fanClubName = (c: FanClub, lang: Lang) => c.tr?.[lang] ?? c.n;

let tokens: { c: FanClub; words: string[]; full: string }[] | null = null;
function index() {
  tokens ??= list!.flatMap((c) => [c.n, ...Object.values(c.tr ?? {})]
    .filter((n, i, a) => a.indexOf(n) === i)
    .map((n) => ({ c, full: normalize(n).replace(/ /g, ''), words: normalize(n).split(' ').filter(Boolean) })));
  return tokens;
}

/**
 * Clubs matching what the user typed, best first: every typed word must start a word of one of
 * the club's names (in any language); typos are forgiven when nothing matches exactly.
 * With nothing typed, the clubs of `country` (top divisions first).
 */
export function searchClubs(query: string, country?: string, limit = 30): FanClub[] {
  if (!list) return [];
  const words = normalize(query).split(' ').filter(Boolean);
  const rank = (a: FanClub, b: FanClub) => a.t - b.t || b.s - a.s;
  if (!words.length) return country ? list.filter((c) => c.c === country).sort(rank).slice(0, limit) : [];
  const score = new Map<FanClub, number>();
  const put = (c: FanClub, s: number) => { if (!score.has(c) || score.get(c)! > s) score.set(c, s); };
  const joined = words.join('');
  for (const e of index()) {
    if (e.full.startsWith(joined)) put(e.c, 0);
    else if (words.every((w) => e.words.some((x) => x.startsWith(w)))) put(e.c, 1);
  }
  if (score.size === 0) {
    for (const e of index()) {
      const ok = words.every((w) => w.length < 4 || e.words.some((x) => boundedDistance(x.slice(0, w.length), w, w.length >= 7 ? 2 : 1) <= (w.length >= 7 ? 2 : 1)));
      if (ok && words.some((w) => w.length >= 4)) put(e.c, 2);
    }
  }
  return [...score].sort((a, b) => a[1] - b[1] || (country ? +(b[0].c === country) - +(a[0].c === country) : 0) || rank(a[0], b[0])).slice(0, limit).map(([c]) => c);
}
