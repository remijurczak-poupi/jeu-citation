// Automatic check of "this answer should have counted" reports.
// Wikidata (our data source) misses some transfers, so the player's senior career is read from the
// infobox of their English Wikipedia article and compared with the theme's club, league and seasons.
import { clubIndex, data, getMatcher, normalizeCriterion } from './data';
import type { Criterion } from '../shared/types';

const UA = 'name-the-players/0.1 (football trivia game; report checker)';
export type Verdict = { verdict: 'accept' | 'reject' | 'manual'; reason: string };

/** Senior stints from an infobox: club title and calendar years ("2021–2024", "2024–", "2024"). */
export function parseInfobox(wikitext: string): { title: string; from: number; to: number | null }[] {
  const fields = new Map<string, string>();
  for (const m of wikitext.matchAll(/^\s*\|\s*(years|clubs)(\d+)\s*=\s*(.*)$/gm)) fields.set(m[1] + m[2], m[3]);
  const out: { title: string; from: number; to: number | null }[] = [];
  for (let i = 1; i <= 40; i++) {
    const years = fields.get('years' + i), clubs = fields.get('clubs' + i);
    if (!years || !clubs) continue;
    const link = clubs.match(/\[\[([^|\]]+)/);
    const y = years.replace(/&ndash;|–|—|-/g, '-').match(/(\d{4})\s*(-\s*(\d{4})?)?/);
    if (!link || !y) continue;
    const from = +y[1];
    const to = y[3] ? +y[3] : y[2] ? null : from; // "2024–" = still there; "2024" = within that year
    out.push({ title: link[1].trim(), from, to });
  }
  return out;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Seasons (start years) a stint surely covers, and the ones it may cover (transfer month unknown). */
function seasons(from: number, to: number | null) {
  const end = to ?? data.currentSeason + 1;
  const sure: number[] = [], maybe: number[] = [];
  for (let s = from - 1; s <= end; s++) {
    if (s >= from && s + 1 <= end) sure.push(s); // whole season inside the years given
    else if (s + 1 >= from && s <= end) maybe.push(s);
  }
  if (!sure.length && to === from) maybe.push(from - 1, from);
  return { sure, maybe };
}

const CAREER_KEYS: (keyof Criterion)[] = ['league', 'club', 'club2', 'from', 'to'];

export async function verifyReport(playerIdx: number, criterion: Criterion): Promise<Verdict> {
  const c = normalizeCriterion(criterion);
  const pl = data.players[playerIdx];
  // Facts other than the club career (nationality, position, trophies…) come from our data.
  const rest = { ...c };
  for (const k of CAREER_KEYS) delete rest[k];
  if (Object.keys(rest).length && !getMatcher(normalizeCriterion(rest)).scope.players.has(playerIdx)) {
    return { verdict: 'manual', reason: 'other filters of the theme (not the club career) do not match our data' };
  }
  if (!c.league && !c.club && !c.club2) return { verdict: 'manual', reason: 'theme without club or league' };

  const ent = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${pl.q}&props=sitelinks&sitefilter=enwiki&format=json`);
  const title = ent.entities?.[pl.q]?.sitelinks?.enwiki?.title as string | undefined;
  if (!title) return { verdict: 'manual', reason: 'no English Wikipedia article' };
  const page = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`);
  const stints = parseInfobox(page.parse?.wikitext ?? '');
  if (!stints.length) return { verdict: 'manual', reason: 'career not found in the Wikipedia infobox' };

  // Club article titles → Wikidata ids → our clubs.
  const titles = [...new Set(stints.map((s) => s.title))];
  const q = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`);
  const alias = new Map<string, string>();
  for (const r of [...(q.query?.normalized ?? []), ...(q.query?.redirects ?? [])]) alias.set(r.from, r.to);
  const qidOf = new Map<string, string>();
  for (const p of q.query?.pages ?? []) if (p.pageprops?.wikibase_item) qidOf.set(p.title, p.pageprops.wikibase_item);
  const resolve = (t: string) => { let x = t; for (let i = 0; i < 3 && alias.has(x); i++) x = alias.get(x)!; return qidOf.get(x); };

  const from = c.from ?? data.firstSeason, to = c.to ?? data.currentSeason;
  const club = c.club !== undefined ? clubIndex(c.club) : undefined;
  const club2 = c.club2 !== undefined ? clubIndex(c.club2) : undefined;
  const mine = stints.map((s) => ({ club: resolve(s.title) !== undefined ? clubIndex(resolve(s.title)!) : undefined, ...seasons(s.from, s.to) }));
  if (club2 !== undefined && !mine.some((s) => s.club === club2)) return { verdict: 'reject', reason: 'Wikipedia: never played for the second club' };
  const fits = (s: typeof mine[number], y: number) =>
    s.club !== undefined && y >= from && y <= to && (club === undefined || s.club === club) && (!c.league || (data.clubs[s.club].l[c.league] ?? []).includes(y));
  if (mine.some((s) => s.sure.some((y) => fits(s, y)))) return { verdict: 'accept', reason: `Wikipedia (${title}) confirms the club and season` };
  if (mine.some((s) => s.maybe.some((y) => fits(s, y)))) return { verdict: 'manual', reason: 'Wikipedia: only at the edge of a season (transfer month unknown)' };
  return { verdict: 'reject', reason: `Wikipedia (${title}): no matching club and season` };
}
