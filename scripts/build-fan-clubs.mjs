// Builds src/data/fan-clubs.json: the clubs a player can say they support in their profile.
// Much wider than the game's player base: the top 2 to 4 divisions of many football countries,
// from Wikidata (current league membership, P118 without end date). Run: node scripts/build-fan-clubs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/fan-clubs.json');
const UA = 'name-the-players-builder/0.1 (football trivia game)';
const LANGS = ['en', 'fr', 'de', 'es', 'it', 'pt'];

// [league item, tier, country code used when the club has none (and always for the UK nations)]
const LEAGUES = [
  ['Q9448', 1, 'GB-ENG'], ['Q19510', 2, 'GB-ENG'], ['Q19565', 3, 'GB-ENG'], ['Q48837', 4, 'GB-ENG'], ['Q58916', 5, 'GB-ENG'],
  ['Q14377162', 1, 'GB-SCT'], ['Q14468438', 2, 'GB-SCT'], ['Q14468449', 3, 'GB-SCT'], ['Q218555', 1, 'GB-WLS'],
  ['Q13394', 1, 'FR'], ['Q217374', 2, 'FR'], ['Q1061291', 3, 'FR'],
  ['Q324867', 1, 'ES'], ['Q35615', 2, 'ES'], ['Q100146559', 3, 'ES'],
  ['Q15804', 1, 'IT'], ['Q194052', 2, 'IT'], ['Q607965', 3, 'IT'],
  ['Q82595', 1, 'DE'], ['Q152665', 2, 'DE'], ['Q154069', 3, 'DE'],
  ['Q182994', 1, 'PT'], ['Q754488', 2, 'PT'], ['Q167541', 1, 'NL'], ['Q610823', 2, 'NL'],
  ['Q216022', 1, 'BE'], ['Q23925620', 2, 'BE'], ['Q485568', 1, 'TR'], ['Q1141692', 2, 'TR'], ['Q1780954', 3, 'TR'],
  ['Q202699', 1, 'CH'], ['Q669073', 2, 'CH'], ['Q219592', 1, 'AT'], ['Q650236', 2, 'AT'],
  ['Q235114', 1, 'GR'], ['Q63980269', 2, 'GR'], ['Q204752', 1, 'DK'], ['Q162031', 2, 'DK'],
  ['Q201671', 1, 'NO'], ['Q353508', 2, 'NO'], ['Q202243', 1, 'SE'], ['Q692009', 2, 'SE'],
  ['Q44763', 1, 'PL'], ['Q163046', 2, 'PL'], ['Q217016', 1, 'CZ'], ['Q1261184', 2, 'CZ'],
  ['Q162604', 1, 'HR'], ['Q235307', 1, 'RS'], ['Q206073', 1, 'UA'], ['Q182165', 1, 'RU'], ['Q162533', 2, 'RU'],
  ['Q237753', 1, 'RO'], ['Q386384', 2, 'RO'], ['Q276085', 1, 'HU'], ['Q12837728', 1, 'BG'], ['Q238113', 1, 'SK'],
  ['Q275005', 1, 'SI'], ['Q155965', 1, 'CY'], ['Q477309', 1, 'IL'], ['Q831202', 1, 'IE'], ['Q2474177', 2, 'IE'],
  ['Q206813', 1, 'BR'], ['Q610175', 2, 'BR'], ['Q2037826', 3, 'BR'], ['Q223170', 1, 'AR'], ['Q934724', 2, 'AR'],
  ['Q764690', 1, 'MX'], ['Q18543', 1, 'US'], ['Q1362411', 2, 'US'], ['Q1033349', 1, 'CO'], ['Q606832', 1, 'CL'],
  ['Q287453', 1, 'UY'], ['Q606652', 1, 'PE'], ['Q2289847', 1, 'EC'], ['Q954911', 1, 'PY'],
  ['Q255633', 1, 'SA'], ['Q2656109', 2, 'SA'], ['Q60681', 1, 'QA'], ['Q5334350', 1, 'AE'], ['Q194641', 1, 'IR'],
  ['Q276445', 1, 'JP'], ['Q1140581', 2, 'JP'], ['Q2386334', 1, 'KR'], ['Q5100359', 2, 'KR'], ['Q209318', 1, 'CN'],
  ['Q219586', 1, 'AU'], ['Q16056350', 1, 'IN'],
  ['Q570246', 1, 'MA'], ['Q2623014', 2, 'MA'], ['Q647746', 1, 'DZ'], ['Q2573693', 2, 'DZ'], ['Q794235', 1, 'TN'],
  ['Q680619', 1, 'EG'], ['Q1188284', 1, 'SN'], ['Q988698', 1, 'CI'], ['Q850132', 1, 'CM'], ['Q830826', 1, 'NG'], ['Q603439', 1, 'ZA'],
];

async function sparql(query) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    console.warn('retry', res.status);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error('SPARQL failed');
}
const qid = (u) => u.split('/').pop();

const tierOf = new Map(LEAGUES.map(([q, t, c]) => [q, { t, c }]));
const clubs = new Map();
// Small batches: the public endpoint times out on big joins.
for (let i = 0; i < LEAGUES.length; i += 8) {
  const batch = LEAGUES.slice(i, i + 8);
  const rows = await sparql(`SELECT ?club ?league ?iso ?sl WHERE {
    VALUES ?league { ${batch.map(([q]) => 'wd:' + q).join(' ')} }
    ?club p:P118 ?st . ?st ps:P118 ?league . VALUES ?type { wd:Q476028 wd:Q847017 wd:Q103229495 } ?club wdt:P31 ?type .
    FILTER NOT EXISTS { ?st pq:P582 [] } FILTER NOT EXISTS { ?club wdt:P576 [] }
    OPTIONAL { ?club wdt:P17/wdt:P297 ?iso }
    ?club wikibase:sitelinks ?sl .
  }`);
  for (const r of rows) {
    const q = qid(r.club.value);
    const lg = tierOf.get(qid(r.league.value));
    const c = clubs.get(q);
    if (!c) clubs.set(q, { q, names: {}, t: lg.t, c: lg.c, iso: r.iso?.value, sl: +r.sl.value });
    else c.t = Math.min(c.t, lg.t);
  }
  console.log('leagues', i + batch.length, '/', LEAGUES.length, '→', clubs.size, 'clubs');
}
const ids = [...clubs.keys()];
for (let i = 0; i < ids.length; i += 250) {
  const rows = await sparql(`SELECT ?club ?lang ?label WHERE {
    VALUES ?club { ${ids.slice(i, i + 250).map((q) => 'wd:' + q).join(' ')} }
    ?club rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang IN (${LANGS.map((l) => `"${l}"`).join(',')}))
  }`);
  for (const r of rows) clubs.get(qid(r.club.value)).names[r.lang.value] = r.label.value;
}
const list = [...clubs.values()]
  .filter((c) => c.names.en || Object.keys(c.names).length)
  .map((c) => {
    const n = c.names.en ?? Object.values(c.names)[0];
    const country = c.c.startsWith('GB-') || !c.iso ? c.c : c.iso;
    const tr = Object.fromEntries(LANGS.filter((l) => l !== 'en' && c.names[l] && c.names[l] !== n).map((l) => [l, c.names[l]]));
    return { q: c.q, n, c: country, t: c.t, s: c.sl, ...(Object.keys(tr).length ? { tr } : {}) };
  })
  // Same name and country twice (duplicate items): keep the best known.
  .sort((a, b) => b.s - a.s);
const seen = new Set();
const out = list.filter((c) => { const k = c.n.toLowerCase() + '|' + c.c; if (seen.has(k)) return false; seen.add(k); return true; });
// Every club of the game's player base can be supported too (some have since dropped down).
const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/football.json'), 'utf8'));
const leagueCountry = { PL: 'GB-ENG', L1: 'FR', LL: 'ES', SA: 'IT', BL: 'DE' };
const have = new Set(out.map((c) => c.q));
for (const c of game.clubs) {
  if (have.has(c.q)) continue;
  const lg = Object.keys(c.l)[0];
  out.push({ q: c.q, n: c.n, c: leagueCountry[lg] ?? 'GB-ENG', t: 3, s: 0, ...(c.nf ? { tr: { fr: c.nf } } : {}) });
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(out.length, 'clubs,', (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
