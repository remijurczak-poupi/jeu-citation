// Builds src/data/football.json from Wikidata.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-data.mjs [--refresh]
// Raw SPARQL responses are cached in .cache/ so the build can be re-run offline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'src/data/football.json');
const REFRESH = process.argv.includes('--refresh');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'name-the-players-builder/0.1 (football trivia game; https://github.com/)';

export const LEAGUES = [
  { id: 'PL', qid: 'Q9448', name: { en: 'Premier League', fr: 'Premier League' }, country: 'GB' },
  { id: 'L1', qid: 'Q13394', name: { en: 'Ligue 1', fr: 'Ligue 1' }, country: 'FR' },
  { id: 'LL', qid: 'Q324867', name: { en: 'La Liga', fr: 'Liga' }, country: 'ES' },
  { id: 'SA', qid: 'Q15804', name: { en: 'Serie A', fr: 'Serie A' }, country: 'IT' },
  { id: 'BL', qid: 'Q82595', name: { en: 'Bundesliga', fr: 'Bundesliga' }, country: 'DE' },
];
const FIRST_SEASON = 2000;
// Season "2026" = 2026-27. Updated by date: a season starts in July.
const now = new Date();
const CURRENT_SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const NAME_LANGS = ['en', 'fr', 'es', 'it', 'de', 'pt', 'nl'];

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

async function sparql(query, tag) {
  const key = tag + '-' + crypto.createHash('sha1').update(query).digest('hex').slice(0, 10);
  const file = path.join(CACHE, key + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          'User-Agent': UA,
        },
        body: new URLSearchParams({ query }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
      const json = await res.json();
      const rows = json.results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v['xml:lang'] ? { v: v.value, l: v['xml:lang'] } : v.value])),
      );
      fs.writeFileSync(file, JSON.stringify(rows));
      return rows;
    } catch (e) {
      console.warn(`  ${tag} attempt ${attempt} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error('SPARQL failed: ' + tag);
}

const qid = (uri) => uri.slice(uri.lastIndexOf('/') + 1);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Season (start year) a date belongs to. Year-precision dates (Jan 1st) are treated as summer moves. */
function seasonOf(dateStr, isEnd) {
  if (!dateStr) return null;
  const m = /^(-?\d+)-(\d\d)-(\d\d)/.exec(dateStr);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const yearPrecision = mo === 1 && d === 1;
  if (yearPrecision) return isEnd ? y - 1 : y;
  if (isEnd) return mo >= 10 ? y : y - 1; // leaving in Aug 2009 → last season 2008-09; in Jan 2010 → 2009-10
  return mo >= 6 ? y : y - 1; // joining in Jan 2008 → season 2007-08
}

async function main() {
  // 1. League seasons and their clubs.
  const leagueByQ = Object.fromEntries(LEAGUES.map((l) => [l.qid, l]));
  const seasonsRows = await sparql(
    `SELECT ?league ?season ?seasonLabel ?start ?club WHERE {
      VALUES ?league { ${LEAGUES.map((l) => 'wd:' + l.qid).join(' ')} }
      ?season wdt:P3450 ?league .
      OPTIONAL { ?season wdt:P580 ?start }
      ?season wdt:P1923 ?club .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`,
    'seasons',
  );
  // clubSeasons[clubQ][leagueId] = Set(years)
  const clubSeasons = {};
  const seasonsKnown = {}; // leagueId -> Set(years)
  for (const r of seasonsRows) {
    const lg = leagueByQ[qid(r.league)];
    const lbl = typeof r.seasonLabel === 'object' ? r.seasonLabel.v : r.seasonLabel;
    let year = null;
    const m = /^(\d{4})/.exec(lbl || '');
    if (m) year = +m[1];
    else if (r.start) year = seasonOf(r.start, false);
    if (year == null || year < FIRST_SEASON) continue;
    const c = qid(r.club);
    ((clubSeasons[c] ??= {})[lg.id] ??= new Set()).add(year);
    (seasonsKnown[lg.id] ??= new Set()).add(year);
  }

  // 2. Seasons missing from Wikidata: hand-filled overrides, then current members for the ongoing season.
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/season-overrides.json'), 'utf8'));
  for (const [lg, seasons] of Object.entries(overrides)) {
    if (lg.startsWith('_')) continue;
    for (const [y, clubsQ] of Object.entries(seasons)) {
      for (const c of Object.keys(clubSeasons)) clubSeasons[c][lg]?.delete(+y);
      for (const c of clubsQ) ((clubSeasons[c] ??= {})[lg] ??= new Set()).add(+y);
      (seasonsKnown[lg] ??= new Set()).add(+y);
    }
  }
  const currentRows = await sparql(
    `SELECT ?league ?club WHERE {
      VALUES ?league { ${LEAGUES.map((l) => 'wd:' + l.qid).join(' ')} }
      ?club wdt:P118 ?league ; wdt:P31/wdt:P279* wd:Q476028 .
    }`,
    'current',
  );
  const currentByLeague = {};
  for (const r of currentRows) (currentByLeague[leagueByQ[qid(r.league)].id] ??= new Set()).add(qid(r.club));
  const inSeason = (lg, y) => Object.keys(clubSeasons).filter((c) => clubSeasons[c][lg]?.has(y));
  const report = {};
  for (const lg of LEAGUES) {
    const known = seasonsKnown[lg.id] ?? new Set();
    for (let y = FIRST_SEASON; y <= CURRENT_SEASON; y++) {
      if (known.has(y)) continue;
      let fill;
      if (y === CURRENT_SEASON) fill = [...(currentByLeague[lg.id] ?? [])];
      else {
        // Unknown past season: only clubs present the season before and after (no guessing on promotions).
        const after = new Set(inSeason(lg.id, y + 1));
        fill = inSeason(lg.id, y - 1).filter((c) => after.has(c));
        console.warn(`WARNING ${lg.id} ${y}: season missing, add it to scripts/season-overrides.json`);
      }
      for (const c of fill) ((clubSeasons[c] ??= {})[lg.id] ??= new Set()).add(y);
    }
    report[lg.id] = Object.fromEntries(
      Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i).map((y) => [y, inSeason(lg.id, y).length]),
    );
  }
  // Sanity check: every season should have 18 or 20 clubs.
  for (const [lg, counts] of Object.entries(report)) {
    const odd = Object.entries(counts).filter(([, n]) => n !== 18 && n !== 20);
    if (odd.length) console.warn(`CHECK ${lg}: unusual club counts`, Object.fromEntries(odd));
  }
  // 3. Club labels.
  const clubQs = Object.keys(clubSeasons);
  const clubRows = await sparql(
    `SELECT ?club ?label ?short WHERE {
      VALUES ?club { ${clubQs.map((c) => 'wd:' + c).join(' ')} }
      ?club rdfs:label ?label . FILTER(LANG(?label) IN ("en","fr"))
      OPTIONAL { ?club wdt:P1813 ?short . FILTER(LANG(?short) IN ("en","fr","mul")) }
    }`,
    'clubs',
  );
  const clubNames = {};
  for (const r of clubRows) {
    const c = qid(r.club);
    (clubNames[c] ??= {})[r.label.l] = r.label.v;
  }

  // 4. Club memberships (stints) of footballers at those clubs.
  const stintRows = [];
  for (const [i, batch] of chunk(clubQs, 25).entries()) {
    const rows = await sparql(
      `SELECT ?p ?club ?start ?end ?apps ?birth WHERE {
        VALUES ?club { ${batch.map((c) => 'wd:' + c).join(' ')} }
        ?p p:P54 ?st . ?st ps:P54 ?club .
        ?p wdt:P106 wd:Q937857 .
        OPTIONAL { ?st pq:P580 ?start }
        OPTIONAL { ?st pq:P582 ?end }
        OPTIONAL { ?st pq:P1350 ?apps }
        OPTIONAL { ?p wdt:P569 ?birth }
      }`,
      'stints' + i,
    );
    stintRows.push(...rows);
    console.log(`stints batch ${i}: ${rows.length}`);
  }

  // Group per player.
  const byPlayer = new Map();
  for (const r of stintRows) {
    const p = qid(r.p);
    const e = byPlayer.get(p) ?? { birth: null, stints: new Map() };
    if (r.birth && !e.birth) e.birth = +r.birth.slice(0, 4);
    const key = qid(r.club) + '|' + (r.start ?? '') + '|' + (r.end ?? '');
    const prev = e.stints.get(key);
    const apps = r.apps != null ? +r.apps : null;
    if (!prev) e.stints.set(key, { club: qid(r.club), start: r.start ?? null, end: r.end ?? null, apps });
    else if (apps != null && (prev.apps == null || apps > prev.apps)) prev.apps = apps;
    byPlayer.set(p, e);
  }

  // Resolve seasons for each stint, keep players with at least one top-5 season since 2000.
  const kept = [];
  for (const [p, e] of byPlayer) {
    const stints = [...e.stints.values()].map((s) => ({ ...s, s: seasonOf(s.start, false), e: seasonOf(s.end, true) }));
    stints.sort((a, b) => (a.s ?? 9999) - (b.s ?? 9999));
    for (const [i, s] of stints.entries()) {
      if (s.s != null && s.e == null) {
        // Open-ended: until the next dated stint, else ongoing (only plausible for active-age players).
        const next = stints.slice(i + 1).find((n) => n.s != null && n.s > s.s);
        if (next) s.e = Math.max(s.s, next.s - 1);
        else s.e = e.birth && CURRENT_SEASON - e.birth > 40 ? s.s : CURRENT_SEASON;
      }
      if (s.e != null && s.s != null && s.e < s.s) s.e = s.s;
      if (s.s == null && s.e != null) s.s = s.e;
    }
    let relevant = false;
    for (const s of stints) {
      const cs = clubSeasons[s.club];
      if (!cs) continue;
      if (s.s == null) {
        // Undated stint: keep if the player's career plausibly overlaps 2000+.
        if (e.birth && e.birth >= 1964) relevant = true;
        continue;
      }
      for (const years of Object.values(cs)) for (let y = Math.max(s.s, FIRST_SEASON); y <= s.e; y++) if (years.has(y)) relevant = true;
    }
    if (relevant) kept.push({ q: p, birth: e.birth, stints: stints.filter((s) => clubSeasons[s.club]) });
  }
  console.log(`players: ${byPlayer.size} candidates, ${kept.length} kept`);

  // 5. Names, aliases and notoriety.
  const names = new Map();
  for (const [i, batch] of chunk(kept.map((k) => k.q), 400).entries()) {
    const rows = await sparql(
      `SELECT ?p ?sl ?label ?alias WHERE {
        VALUES ?p { ${batch.map((c) => 'wd:' + c).join(' ')} }
        ?p wikibase:sitelinks ?sl .
        OPTIONAL { ?p rdfs:label ?label . FILTER(LANG(?label) IN (${NAME_LANGS.map((l) => `"${l}"`).join(',')},"mul")) }
        OPTIONAL { ?p skos:altLabel ?alias . FILTER(LANG(?alias) IN ("en","fr","mul")) }
      }`,
      'names' + i,
    );
    for (const r of rows) {
      const p = qid(r.p);
      const e = names.get(p) ?? { sl: +r.sl, labels: {}, aliases: new Set() };
      if (r.label) e.labels[r.label.l] = r.label.v;
      if (r.alias) e.aliases.add(r.alias.v);
      names.set(p, e);
    }
    if (i % 10 === 0) console.log(`names batch ${i}`);
  }

  // 6. Assemble compact output.
  const clubsUsed = [...new Set(kept.flatMap((k) => k.stints.map((s) => s.club)))];
  const clubIdx = new Map(clubsUsed.map((c, i) => [c, i]));
  const clubs = clubsUsed.map((c) => ({
    q: c,
    n: clubNames[c]?.en ?? clubNames[c]?.fr ?? c,
    ...(clubNames[c]?.fr && clubNames[c].fr !== clubNames[c].en ? { nf: clubNames[c].fr } : {}),
    l: Object.fromEntries(Object.entries(clubSeasons[c]).map(([lg, ys]) => [lg, [...ys].sort((a, b) => a - b)])),
  }));
  const players = [];
  const stints = [];
  const looksLikeName = (s) => s && !/^Q\d+$/.test(s) && s.length <= 60;
  for (const k of kept) {
    const n = names.get(k.q);
    if (!n) continue;
    const display = n.labels.en ?? n.labels.mul ?? n.labels.fr ?? Object.values(n.labels)[0];
    if (!looksLikeName(display)) continue;
    const alt = new Set([...Object.values(n.labels), ...n.aliases].filter(looksLikeName));
    alt.delete(display);
    const idx = players.length;
    players.push({ q: k.q, n: display, ...(alt.size ? { a: [...alt] } : {}), s: n.sl, ...(k.birth ? { b: k.birth } : {}) });
    for (const s of k.stints) stints.push([idx, clubIdx.get(s.club), s.s ?? -1, s.e ?? -1, s.apps ?? -1]);
  }
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    firstSeason: FIRST_SEASON,
    currentSeason: CURRENT_SEASON,
    currentSeasonFromLiveMembership: true,
    leagues: LEAGUES,
    clubs,
    players,
    stints,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: ${players.length} players, ${clubs.length} clubs, ${stints.length} stints, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
