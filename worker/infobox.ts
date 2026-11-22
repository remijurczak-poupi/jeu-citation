// Senior career read from the infobox of an English Wikipedia footballer article.
// Shared by the report checker (worker/verify.ts) and the weekly data build (scripts/build-wiki-careers.mjs).
// No imports: the build script loads this file directly with Node.

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

/** Seasons (start years) a stint surely covers, and the ones it may cover (transfer month unknown). */
export function infoboxSeasons(from: number, to: number | null, currentSeason: number) {
  const end = to ?? currentSeason + 1;
  const sure: number[] = [], maybe: number[] = [];
  for (let s = from - 1; s <= end; s++) {
    if (s >= from && s + 1 <= end) sure.push(s); // whole season inside the years given
    else if (s + 1 >= from && s <= end) maybe.push(s);
  }
  if (!sure.length && to === from) maybe.push(from - 1, from);
  return { sure, maybe };
}

