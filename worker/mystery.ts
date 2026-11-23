// Mystery player: second daily game. One hidden player a day, the same for everyone;
// players ask yes/no questions from a guided list and try to name them in 20 questions or fewer.
import { clubIndex, data, playerStints } from './data';
import type { Continent, LeagueId, MysteryNum, MysteryQuestion, MysteryReveal } from '../shared/types';
import { CONTINENTS, MYSTERY_NUMS } from '../shared/types';

export const MYSTERY_EPOCH = Date.UTC(2026, 10, 23); // mystery player #1

export function mysteryNumber(date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - MYSTERY_EPOCH) / 86400000) + 1;
}
/** Odd days easy (very famous players), even days hard. */
export const mysteryDifficulty = (date: string): 'easy' | 'hard' => (mysteryNumber(date) % 2 === 1 ? 'easy' : 'hard');

const CONTINENT_OF: Record<string, Continent> = {};
const add = (c: Continent, codes: string) => { for (const k of codes.split(' ')) CONTINENT_OF[k] = c; };
add('EU', 'AD AL AM AT AZ BA BE BG BY CH CY CZ DD DE DK EE ES ES-CT FI FO FR GB GB-ENG GB-JSY GB-NIR GB-SCT GB-UKM GB-WLS GE GI GR HR HU IE IL IS IT JE KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM SU TR UA XK YU');
add('AF', 'AO BF BI BJ CD CF CG CI CM CV DJ DZ EG ER GA GH GM GN GQ GW KE KM LR LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS TD TG TN TZ UG ZA ZM ZW');
add('SA', 'AR BO BR CL CO EC GY PE PY SR UY VE GF FR-973');
add('NA', 'AG AN BB BM CA CR CU CW DM DO GD GP GT HN HT JM KN LC MF MQ MS MX NI NL-CW PA PR SV TC TT US US-PR FR-971 FR-972 FR-MF');
add('AS', 'AE AF BD BH BN CN CN-HK HK ID IN IQ IR JO JP KG KH KP KR KW LA LB LK MN MY OM PH PK PS QA SA SG SY TH TJ TL TM TW UZ VN YE');
add('OC', 'AU FJ NC FR-NC NZ WS MP US-MP');
export const continentOf = (cc?: string): Continent | undefined => (cc ? CONTINENT_OF[cc] : undefined);

const LEAGUES = () => data.leagues.map((l) => l.id);
const lastSeason = (p: number, s: number, e: number) => (e >= 0 ? e : data.players[p].x ? data.currentSeason : s);

/** Leagues the player played in: a stint counts when it overlaps the club's seasons in that league,
 *  or when it started before 2000 (club seasons are only known since then). */
function leaguesOf(p: number): Set<LeagueId> {
  const out = new Set<LeagueId>();
  for (const [, club, s, e] of playerStints(p)) {
    for (const [lg, years] of Object.entries(data.clubs[club].l) as [LeagueId, number[]][]) {
      if (!years.length) continue;
      if (s < 0 || s < data.firstSeason) { out.add(lg); continue; }
      const end = lastSeason(p, s, e);
      if (years.some((y) => y >= s && y <= end)) out.add(lg);
    }
  }
  return out;
}
/** A season-based honour won with one of the player's clubs while he was there. */
function seasonHonour(p: number, has: (club: number, y: number) => boolean): boolean {
  for (const [, club, s, e] of playerStints(p)) {
    if (s < 0) continue;
    for (let y = s; y <= lastSeason(p, s, e); y++) if (has(club, y)) return true;
  }
  return false;
}

/** Seasons (start years, since 2000) the player spent at a club that was in a big-5 league that season. */
function bigSeasons(p: number): Set<number> {
  const out = new Set<number>();
  for (const [, club, s, e] of playerStints(p)) {
    if (s < 0) continue;
    const years = new Set(Object.values(data.clubs[club].l).flat());
    for (let y = Math.max(s, data.firstSeason); y <= lastSeason(p, s, e); y++) if (years.has(y)) out.add(y);
  }
  return out;
}
/** Clubs the player is at this season (active players only). */
function currentClubs(p: number): number[] {
  if (!data.players[p].x) return [];
  return playerStints(p).filter(([, , s, e]) => s >= 0 && lastSeason(p, s, e) >= data.currentSeason).map((st) => st[1]);
}
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
/** First letter of the last word of the displayed name (Kylian Mbappé → M, Neymar → N). */
export function initialOf(p: number): string {
  const words = data.players[p].n.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return fold(words[words.length - 1] ?? '').replace(/[^A-Z]/g, '').charAt(0);
}

export function numberOf(p: number, f: MysteryNum): number | undefined {
  const pl = data.players[p];
  switch (f) {
    case 'age': return pl.b ? new Date().getUTCFullYear() - pl.b : undefined;
    case 'birthYear': return pl.b;
    case 'height': return pl.h;
    case 'caps': return pl.i ?? 0;
    case 'clubs': return new Set(playerStints(p).map((s) => s[1])).size;
    case 'leagues': return leaguesOf(p).size;
    case 'debut': { const ys = [...bigSeasons(p)]; return ys.length ? Math.min(...ys) : undefined; }
    case 'seasons': return bigSeasons(p).size;
    case 'worldCups': return (pl.t ?? []).filter((t) => t.startsWith('WC')).length;
    case 'titles': {
      let n = 0;
      for (const [, club, s, e] of playerStints(p)) {
        if (s < 0) continue;
        const ch = Object.values(data.clubs[club].ch ?? {}).flat();
        for (let y = s; y <= lastSeason(p, s, e); y++) if (ch.includes(y)) n++;
      }
      return n;
    }
  }
}

/** Yes/no answer, or undefined when the question is not valid. */
export function answer(p: number, q: MysteryQuestion): boolean | undefined {
  const pl = data.players[p];
  const league = (v: unknown): v is LeagueId => LEAGUES().includes(v as LeagueId);
  switch (q?.k) {
    case 'num': {
      if (!MYSTERY_NUMS.includes(q.f) || !['gt', 'lt', 'eq'].includes(q.op) || !Number.isInteger(q.v) || q.v < 0 || q.v > 3000) return undefined;
      const n = numberOf(p, q.f);
      if (n === undefined) return false;
      return q.op === 'gt' ? n > q.v : q.op === 'lt' ? n < q.v : n === q.v;
    }
    case 'position': return ['GK', 'DF', 'MF', 'FW'].includes(q.v) ? !!pl.p?.includes(q.v) : undefined;
    case 'nation': return typeof q.v === 'string' && /^[A-Z]{2}(-[A-Z0-9]{2,3})?$/.test(q.v) ? pl.c?.[0] === q.v : undefined;
    case 'continent': return CONTINENTS.includes(q.v) ? continentOf(pl.c?.[0]) === q.v : undefined;
    case 'dual': return (pl.c?.length ?? 0) >= 2;
    case 'active': return !!pl.x;
    case 'international': return !!pl.i;
    case 'league': return league(q.v) ? leaguesOf(p).has(q.v) : undefined;
    case 'club': {
      const c = typeof q.v === 'string' ? clubIndex(q.v) : undefined;
      return c === undefined ? undefined : playerStints(p).some((s) => s[1] === c);
    }
    case 'clubNowIn':
      if (!league(q.v)) return undefined;
      return playerStints(p).some((s) => !!data.clubs[s[1]].l[q.v]?.includes(data.currentSeason));
    case 'nowLeague': {
      if (q.v !== 'other' && !league(q.v)) return undefined;
      const now = currentClubs(p);
      const inLeague = (lg: LeagueId) => now.some((c) => !!data.clubs[c].l[lg]?.includes(data.currentSeason));
      return q.v === 'other' ? !!pl.x && !LEAGUES().some(inLeague) : inLeague(q.v);
    }
    case 'nowClub': {
      const c = typeof q.v === 'string' ? clubIndex(q.v) : undefined;
      return c === undefined ? undefined : currentClubs(p).includes(c);
    }
    case 'season':
      if (!Number.isInteger(q.v) || q.v < data.firstSeason || q.v > data.currentSeason) return undefined;
      return bigSeasons(p).has(q.v);
    case 'champion':
      if (q.v !== undefined && !league(q.v)) return undefined;
      return seasonHonour(p, (club, y) => {
        const ch = data.clubs[club].ch ?? {};
        return q.v ? !!ch[q.v]?.includes(y) : Object.values(ch).some((ys) => ys.includes(y));
      });
    case 'ucl':
      if (q.v !== 'played' && q.v !== 'won') return undefined;
      return seasonHonour(p, (club, y) => !!(q.v === 'won' ? data.clubs[club].cw : data.clubs[club].cl)?.includes(y));
    case 'tournament': {
      if (!['WC', 'EU', 'CA'].includes(q.v) || (q.year !== undefined && !Number.isInteger(q.year))) return undefined;
      const code = q.v + (q.year ?? '');
      return !!(q.won ? pl.w : pl.t)?.some((t) => t.startsWith(code));
    }
    case 'topScorer':
      if (q.v !== undefined && !league(q.v)) return undefined;
      return !!pl.ts?.some((t) => !q.v || t.startsWith(q.v));
    case 'ballonDor': return !!pl.bd?.length;
    case 'initial': return typeof q.v === 'string' && /^[A-Z]$/.test(q.v) ? initialOf(p) === q.v : undefined;
    default: return undefined;
  }
}

/** Same question asked twice (it is not charged again). */
export const sameQuestion = (a: MysteryQuestion, b: MysteryQuestion) => JSON.stringify(normQ(a)) === JSON.stringify(normQ(b));
/** Keeps only the fields a question uses, in a fixed order. */
export function normQ(q: MysteryQuestion): MysteryQuestion {
  const o = q as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { k: o.k };
  if (o.k === 'num') { out.f = o.f; out.op = o.op; }
  if (o.v !== undefined && o.v !== null && o.v !== '') out.v = o.v;
  if (o.k === 'tournament' && o.year !== undefined && o.year !== null && o.year !== '') out.year = Number(o.year);
  if (o.k === 'tournament' && o.won === true) out.won = true;
  return out as unknown as MysteryQuestion;
}

let pools: { easy: number[]; hard: number[] } | null = null;
/** Candidates: born 1975 or later (careers the data knows well), a position, a nationality and a dated big-5 stint. */
function candidatePools() {
  if (pools) return pools;
  const ok = data.players
    .map((pl, p) => ({ pl, p }))
    .filter(({ pl, p }) => pl.b && pl.b >= 1975 && pl.p?.length && pl.c?.length && playerStints(p).some((s) => s[2] >= data.firstSeason))
    .sort((a, b) => b.pl.s - a.pl.s || a.p - b.p)
    .map(({ p }) => p);
  pools = { easy: ok.slice(0, 250), hard: ok.slice(250, 1000) };
  return pools;
}

function rng(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Picks the day's player, never one already used. The pick is then stored, so the day never changes afterwards. */
export function pickMystery(date: string, used: Set<string>): number {
  const pool = candidatePools()[mysteryDifficulty(date)];
  const fresh = pool.filter((p) => !used.has(data.players[p].q));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(rng('mystery:' + date)() * list.length)];
}

export function reveal(p: number): MysteryReveal {
  const pl = data.players[p];
  const clubs = playerStints(p)
    .map(([, club, s, e]) => ({ n: data.clubs[club].nf ?? data.clubs[club].n, ...(s >= 0 ? { from: s, to: lastSeason(p, s, e) } : {}) }))
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  // Merge back-to-back stints at the same club.
  const merged: MysteryReveal['clubs'] = [];
  for (const c of clubs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.n === c.n && prev.to !== undefined && c.from !== undefined && c.from <= prev.to + 1) prev.to = Math.max(prev.to, c.to!);
    else merged.push({ ...c });
  }
  return { q: pl.q, n: pl.n, ...(pl.b ? { b: pl.b } : {}), ...(pl.c?.[0] ? { c: pl.c[0] } : {}), ...(pl.p?.[0] ? { p: pl.p[0] } : {}), clubs: merged };
}
