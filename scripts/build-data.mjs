// Builds src/data/football.json from Wikidata.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-data.mjs [--refresh]
// Raw SPARQL responses are cached in .cache/ so the build can be re-run offline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { compact, surnameKeys } from '../worker/normalize.ts';

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
const ALIAS_LANGS = ['en', 'fr', 'es', 'it', 'de', 'pt'];
// Tournament codes: WC = FIFA World Cup, EU = UEFA Euro, CA = Copa América, CL = Champions League.
const TOURNAMENTS = [
  { code: 'WC', qid: 'Q19317', since: 1998 },
  { code: 'EU', qid: 'Q260858', since: 2000 },
];
// Home nations have no ISO 3166-1 code; their teams are told apart by label.
const HOME_NATIONS = { England: 'GB-ENG', Scotland: 'GB-SCT', Wales: 'GB-WLS', Northern: 'GB-NIR' };

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

  // 1b. Since 2020 some seasons list "men's team" items (Q103229495) instead of the club: map them to their parent club (P361).
  const teamParentRows = await sparql(
    `SELECT ?t ?club WHERE {
      VALUES ?t { ${Object.keys(clubSeasons).map((c) => 'wd:' + c).join(' ')} }
      ?t wdt:P31 wd:Q103229495 ; wdt:P361 ?club . ?club wdt:P31/wdt:P279* wd:Q476028 .
    }`,
    'team-parents',
  );
  for (const r of teamParentRows) {
    const t = qid(r.t), c = qid(r.club);
    if (!clubSeasons[t] || t === c) continue;
    for (const [lg, ys] of Object.entries(clubSeasons[t])) for (const y of ys) ((clubSeasons[c] ??= {})[lg] ??= new Set()).add(y);
    delete clubSeasons[t];
  }
  console.log(`team items mapped to clubs: ${teamParentRows.length}`);

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
  // 2b. Trophies from Wikidata: league champions (P1346 on league seasons) and Champions League winners.
  const champRows = await sparql(
    `SELECT ?league ?label ?winner WHERE {
      VALUES ?league { ${LEAGUES.map((l) => 'wd:' + l.qid).join(' ')} wd:Q18278 }
      ?season wdt:P3450 ?league ; rdfs:label ?label ; p:P1346 ?ws . FILTER(LANG(?label) = "en")
      ?ws ps:P1346 ?winner . FILTER NOT EXISTS { ?ws pq:P642 ?of }
      ?winner wdt:P31/wdt:P279* wd:Q476028 .
    }`,
    'champions',
  );
  const clubTitles = {}; // club -> { PL: [years], CL: [years] }
  for (const r of champRows) {
    const m = /^(\d{4})/.exec(r.label.v);
    if (!m || +m[1] < FIRST_SEASON) continue;
    const lg = qid(r.league) === 'Q18278' ? 'CL' : leagueByQ[qid(r.league)].id;
    ((clubTitles[qid(r.winner)] ??= {})[lg] ??= new Set()).add(+m[1]);
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

  // Since 2020 Wikidata lists some Bundesliga seasons with duplicate "team" items (VfL Wolfsburg Q97906010…)
  // that share the club's English label: fold them into the oldest item, which holds the players' stints.
  const byLabel = {};
  for (const c of clubQs) if (clubNames[c]?.en) (byLabel[clubNames[c].en] ??= []).push(c);
  for (const qs of Object.values(byLabel)) {
    if (qs.length < 2) continue;
    qs.sort((a, b) => +a.slice(1) - +b.slice(1));
    const [main, ...dups] = qs;
    for (const d of dups) {
      for (const [lg, ys] of Object.entries(clubSeasons[d])) for (const y of ys) ((clubSeasons[main][lg] ??= new Set())).add(y);
      for (const [k, ys] of Object.entries(clubTitles[d] ?? {})) for (const y of ys) ((clubTitles[main] ??= {})[k] ??= new Set()).add(y);
      delete clubSeasons[d]; delete clubTitles[d];
      clubQs.splice(clubQs.indexOf(d), 1);
      console.log(`  merged duplicate club item ${d} into ${main} (${clubNames[main].en})`);
    }
  }

  // Titles up to the 2024-25 season are hardcoded (Wikidata P1346 is patchy: Bundesliga 2020-24 missing, La Liga 2018 doubled…);
  // later seasons still come from Wikidata.
  const KNOWN_TITLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/titles.json'), 'utf8'));
  const qByName = Object.fromEntries(clubQs.filter((c) => clubNames[c]?.en).map((c) => [clubNames[c].en, c]));
  for (const t of Object.values(clubTitles)) for (const ys of Object.values(t)) for (const y of [...ys]) if (y <= KNOWN_TITLES.until) ys.delete(y);
  for (const [lg, byYear] of Object.entries(KNOWN_TITLES.champions)) {
    for (const [y, name] of Object.entries(byYear)) {
      if (!name) continue;
      const c = qByName[name];
      if (!c) { if (lg !== 'CL') console.warn(`WARNING: title holder not found: ${lg} ${y} ${name}`); continue; }
      ((clubTitles[c] ??= {})[lg] ??= new Set()).add(+y);
    }
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

  // 5. International tournaments (Wikidata P1344 "participant in"): World Cup since 1998, Euro since 2000.
  const tournaments = new Map(); // player -> Set(codes like WC2006, EU2008)
  for (const t of TOURNAMENTS) {
    const rows = await sparql(
      `SELECT ?e ?label ?p WHERE {
        ?e wdt:P3450 wd:${t.qid} ; rdfs:label ?label . FILTER(LANG(?label) = "en")
        ?p wdt:P1344 ?e ; wdt:P106 wd:Q937857 .
      }`,
      'tour-' + t.code,
    );
    for (const r of rows) {
      const m = /(\d{4})/.exec(r.label.v);
      if (!m || /qualif/i.test(r.label.v) || +m[1] < t.since) continue;
      const p = qid(r.p);
      (tournaments.get(p) ?? tournaments.set(p, new Set()).get(p)).add(t.code + m[1]);
    }
  }
  // Wikipedia extras (scripts/build-wiki.mjs): squads of every edition, Champions League clubs, Ballon d'Or, top scorers.
  const wikiFile = path.join(ROOT, 'scripts/wiki-data.json');
  const wiki = fs.existsSync(wikiFile) ? JSON.parse(fs.readFileSync(wikiFile, 'utf8')) : null;
  const won = new Map(); // player -> Set(codes)
  if (wiki) {
    for (const [q, codes] of Object.entries(wiki.tournaments.players)) for (const c of codes) (tournaments.get(q) ?? tournaments.set(q, new Set()).get(q)).add(c);
    for (const [code, qs] of Object.entries(wiki.tournaments.winners)) for (const q of qs) (won.get(q) ?? won.set(q, new Set()).get(q)).add(code);
  } else console.warn('WARNING: scripts/wiki-data.json missing, run scripts/build-wiki.mjs first');
  const keptSet = new Set(kept.map((k) => k.q));
  const extraQs = [...tournaments.keys()].filter((q) => !keptSet.has(q));
  console.log(`tournament players: ${tournaments.size} (${extraQs.length} not in the league base)`);

  // 6. Names, aliases and notoriety.
  const names = new Map();
  const fetchNames = async (ids, tag) => {
    for (const [i, batch] of chunk(ids, 400).entries()) {
      const rows = await sparql(
        `SELECT ?p ?sl ?label ?alias WHERE {
          VALUES ?p { ${batch.map((c) => 'wd:' + c).join(' ')} }
          ?p wikibase:sitelinks ?sl .
          OPTIONAL { ?p rdfs:label ?label . FILTER(LANG(?label) IN (${NAME_LANGS.map((l) => `"${l}"`).join(',')},"mul")) }
          OPTIONAL { ?p skos:altLabel ?alias . FILTER(LANG(?alias) IN (${ALIAS_LANGS.map((l) => `"${l}"`).join(',')},"mul")) }
        }`,
        tag + i,
      );
      for (const r of rows) {
        const p = qid(r.p);
        const e = names.get(p) ?? { sl: +r.sl, labels: {}, aliases: new Set() };
        if (r.label) e.labels[r.label.l] = r.label.v;
        if (r.alias) e.aliases.add(r.alias.v);
        names.set(p, e);
      }
      if (i % 10 === 0) console.log(`${tag} batch ${i}`);
    }
  };
  await fetchNames(kept.map((k) => k.q), 'names');
  await fetchNames(extraQs, 'names-x');

  // 7. Player attributes: positions, nationality, height, birth, senior national team, still active.
  const allQs = [...kept.map((k) => k.q), ...extraQs];
  const attrs = new Map(allQs.map((q) => [q, { pos: new Set(), nat: new Set(), sportNat: new Set() }]));
  const POS = { Q201330: 'GK', Q336286: 'DF', Q193592: 'MF', Q280658: 'FW' };
  // Senior men's national teams -> country code.
  const teamRows = await sparql(
    `SELECT ?t ?tl ?code WHERE {
      ?t wdt:P31 wd:Q135408445 ; rdfs:label ?tl . FILTER(LANG(?tl) = "en")
      OPTIONAL { ?t wdt:P17 ?c . ?c wdt:P297 ?code }
    }`,
    'national-teams',
  );
  const nationalTeams = new Map();
  for (const r of teamRows) {
    const code = HOME_NATIONS[r.tl.v.split(' ')[0]] ?? r.code;
    if (code && !nationalTeams.has(qid(r.t))) nationalTeams.set(qid(r.t), code);
  }
  console.log(`national teams: ${nationalTeams.size}`);
  for (const [i, batch] of chunk(allQs, 300).entries()) {
    const values = batch.map((c) => 'wd:' + c).join(' ');
    const posRows = await sparql(
      `SELECT DISTINCT ?p ?main WHERE {
        VALUES ?p { ${values} } VALUES ?main { ${Object.keys(POS).map((k) => 'wd:' + k).join(' ')} }
        ?p wdt:P413 ?pos . ?pos wdt:P279* ?main .
      }`,
      'pos' + i,
    );
    for (const r of posRows) attrs.get(qid(r.p))?.pos.add(POS[qid(r.main)]);
    const bioRows = await sparql(
      `SELECT ?p ?h ?birth ?cit ?sport WHERE {
        VALUES ?p { ${values} }
        OPTIONAL { ?p p:P2048/psn:P2048/wikibase:quantityAmount ?h }
        OPTIONAL { ?p wdt:P569 ?birth }
        OPTIONAL { ?p wdt:P27 ?c1 . ?c1 wdt:P297 ?cit }
        OPTIONAL { ?p wdt:P1532 ?c2 . ?c2 wdt:P297|wdt:P300 ?sport }
      }`,
      'bio' + i,
    );
    for (const r of bioRows) {
      const a = attrs.get(qid(r.p));
      if (!a) continue;
      if (r.h && !a.h) { const h = Math.round(+r.h * 100); if (h > 150 && h < 215) a.h = h; }
      if (r.birth && !a.birth) a.birth = +r.birth.slice(0, 4);
      if (r.cit) a.nat.add(r.cit);
      if (r.sport) a.sportNat.add(r.sport);
    }
    const ntRows = await sparql(
      `SELECT ?p ?t ?caps WHERE {
        VALUES ?p { ${values} }
        ?p p:P54 ?st . ?st ps:P54 ?t .
        OPTIONAL { ?st pq:P1350 ?caps }
      }`,
      'nt3-' + i,
    );
    for (const r of ntRows) {
      const a = attrs.get(qid(r.p));
      const code = nationalTeams.get(qid(r.t));
      if (!a || !code) continue;
      a.nt = code;
      a.caps = Math.max(a.caps ?? 0, r.caps ? +r.caps : 0);
    }
    const actRows = await sparql(
      `SELECT ?p (MAX(YEAR(?st)) AS ?y) WHERE {
        VALUES ?p { ${values} }
        ?p p:P54 ?s . ?s ps:P54 ?club ; pq:P580 ?st .
        FILTER NOT EXISTS { ?s pq:P582 ?e }
        ?club wdt:P31 wd:Q476028 .
      } GROUP BY ?p`,
      'act' + i,
    );
    for (const r of actRows) { const a = attrs.get(qid(r.p)); if (a) a.openSince = +r.y; }
    if (i % 10 === 0) console.log(`attributes batch ${i}`);
  }

  // 8. Assemble compact output.
  const uclByClub = new Map();
  for (const [y, qs] of Object.entries(wiki?.championsLeague ?? {})) for (const q of qs) (uclByClub.get(q) ?? uclByClub.set(q, new Set()).get(q)).add(+y);
  const clubsUsed = [...new Set(kept.flatMap((k) => k.stints.map((s) => s.club)))];
  const clubIdx = new Map(clubsUsed.map((c, i) => [c, i]));
  const clubs = clubsUsed.map((c) => ({
    q: c,
    n: clubNames[c]?.en ?? clubNames[c]?.fr ?? c,
    ...(clubNames[c]?.fr && clubNames[c].fr !== clubNames[c].en ? { nf: clubNames[c].fr } : {}),
    l: Object.fromEntries(Object.entries(clubSeasons[c]).map(([lg, ys]) => [lg, [...ys].sort((a, b) => a - b)])),
    ...(uclByClub.get(c) ? { cl: [...uclByClub.get(c)].sort((a, b) => a - b) } : {}),
    ...(clubTitles[c]?.CL ? { cw: [...clubTitles[c].CL].sort((a, b) => a - b) } : {}),
    ...(Object.keys(clubTitles[c] ?? {}).some((k) => k !== 'CL')
      ? { ch: Object.fromEntries(Object.entries(clubTitles[c]).filter(([k]) => k !== 'CL').map(([k, ys]) => [k, [...ys].sort((a, b) => a - b)])) }
      : {}),
  }));
  const players = [];
  const stints = [];
  const looksLikeName = (s) => s && !/^Q\d+$/.test(s) && s.length <= 60;
  const nowYear = new Date().getUTCFullYear();
  for (const k of [...kept, ...extraQs.map((q) => ({ q, birth: null, stints: [] }))]) {
    const n = names.get(k.q);
    if (!n) continue;
    const display = n.labels.en ?? n.labels.mul ?? n.labels.fr ?? Object.values(n.labels)[0];
    if (!looksLikeName(display)) continue;
    const alt = new Set([...Object.values(n.labels), ...n.aliases].filter(looksLikeName));
    alt.delete(display);
    const idx = players.length;
    const at = attrs.get(k.q);
    const birth = k.birth ?? at?.birth;
    // Nationality: senior national team first, then sporting nationality, then citizenships.
    const nat = [...new Set([at?.nt, ...(at?.sportNat ?? []), ...(at?.nat ?? [])].filter(Boolean))];
    const lastSeason = Math.max(-1, ...k.stints.map((s) => s.e ?? -1));
    const active = !!at?.openSince && at.openSince >= nowYear - 6 && (!birth || nowYear - birth <= 41)
      || (lastSeason >= CURRENT_SEASON && (!birth || nowYear - birth <= 41) && !(at && at.openSince === undefined && k.stints.every((s) => s.end)));
    // Precomputed name keys (see worker/data.ts): full names/aliases, and surname forms.
    const full = new Set();
    const sur = new Set();
    for (const nm of [display, ...alt]) {
      const key = compact(nm.replace(/\(.*?\)/g, ''));
      if (key.length >= 2) full.add(key);
      for (const sk of surnameKeys(nm)) sur.add(sk);
    }
    for (const key of full) sur.delete(key);
    players.push({
      q: k.q, n: display, k: [...full], ...(sur.size ? { u: [...sur] } : {}), s: n.sl, ...(birth ? { b: birth } : {}),
      ...(at?.pos.size ? { p: [...at.pos] } : {}),
      ...(nat.length ? { c: nat } : {}),
      ...(at?.nt ? { i: at.caps || 1 } : {}),
      ...(at?.h ? { h: at.h } : {}),
      ...(tournaments.has(k.q) ? { t: [...tournaments.get(k.q)].sort() } : {}),
      ...(won.has(k.q) ? { w: [...won.get(k.q)].sort() } : {}),
      ...(wiki?.ballonDor[k.q] ? { bd: wiki.ballonDor[k.q] } : {}),
      ...(wiki?.topScorers[k.q] ? { ts: wiki.topScorers[k.q] } : {}),
      ...(active ? { x: 1 } : {}),
    });
    for (const s of k.stints) stints.push([idx, clubIdx.get(s.club), s.s ?? -1, s.e ?? -1, s.apps ?? -1]);
  }
  const out = {
    version: 2,
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
