// Extra facts for the mystery player game, for the players that can be picked (about 1,200):
// - full senior career, every club and its country (Wikidata P54, any league, not only the big 5);
// - birthplace and its country (Wikidata P19);
// - youth clubs, from the English Wikipedia infobox (youthclubsN), mapped to Wikidata items.
// Saved to src/data/mystery-extra.json. Wikidata is CC0, Wikipedia CC BY-SA 4.0.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-mystery-extra.mjs [--refresh] [--no-wiki]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CACHE = path.join(ROOT, '.cache/mystery-extra');
const OUT = path.join(ROOT, 'src/data/mystery-extra.json');
const DATA = path.join(ROOT, 'src/data/football.json');
const REFRESH = process.argv.includes('--refresh');
const NO_WIKI = process.argv.includes('--no-wiki');
const GAP_MS = 6500; // Wikipedia allows about 10 requests a minute
const API = 'https://en.wikipedia.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'name-the-players-builder/0.1 (football trivia game)';
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function cached(key, fetcher, tries = 8) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const json = await fetcher();
      fs.writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (e) {
      const wait = e.retryAfter ?? 5 * attempt;
      console.warn(`  ${e.message}, retry in ${wait}s`);
      await sleep(wait * 1000);
    }
  }
  throw new Error('giving up on ' + key.slice(0, 80));
}
async function http(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status);
    if (res.status === 429) err.retryAfter = +(res.headers.get('retry-after') ?? 0) || 30;
    throw err;
  }
  return res.json();
}
const sparql = (query) => cached(query, () => http(SPARQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
  body: new URLSearchParams({ query }),
}));
const wiki = (params) => cached(JSON.stringify(params), async () => {
  await sleep(GAP_MS);
  return http(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ format: 'json', formatversion: '2', ...params }) });
});
const qid = (uri) => uri.split('/').pop();
const year = (v) => (v ? +v.slice(0, 4) : null);

// Same candidates as worker/mystery.ts (with a margin): born 1975 or later, position, nationality, a big-5 season since 2000.
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const dated = new Set(data.stints.filter((s) => s[2] >= data.firstSeason).map((s) => s[0]));
const players = data.players
  .map((p, i) => ({ p, i }))
  .filter(({ p, i }) => p.b >= 1975 && p.p?.length && p.c?.length && dated.has(i) && /^Q\d+$/.test(p.q))
  .sort((a, b) => b.p.s - a.p.s)
  .slice(0, 1200)
  .map(({ p }) => p.q);
console.log(`${players.length} candidate players`);

// 1. Senior clubs (Wikidata P54), with start/end years and the club's country. National teams are left out.
const clubs = new Map(); // club q -> { n, c }
const careers = new Map(); // player -> [club, from, to][]
for (const batch of chunk(players, 150)) {
  const json = await sparql(`SELECT ?p ?club ?from ?to WHERE {
    VALUES ?p { ${batch.map((q) => 'wd:' + q).join(' ')} }
    ?p p:P54 ?st . ?st ps:P54 ?club .
    FILTER NOT EXISTS { ?club wdt:P31/wdt:P279* wd:Q6979593 }
    OPTIONAL { ?st pq:P580 ?from } OPTIONAL { ?st pq:P582 ?to }
  }`);
  for (const b of json.results.bindings) {
    const p = qid(b.p.value), c = qid(b.club.value);
    (careers.get(p) ?? careers.set(p, []).get(p)).push([c, year(b.from?.value), year(b.to?.value)]);
    clubs.set(c, null);
  }
}
console.log(`${careers.size} careers, ${clubs.size} clubs`);

// Club names, countries, and whether a club is a youth or reserve side (kept apart from the senior career).
async function describeClubs(ids) {
  const out = new Map();
  for (const batch of chunk(ids, 300)) {
    const json = await sparql(`SELECT ?c ?en ?fr ?cc ?youth WHERE {
      VALUES ?c { ${batch.map((q) => 'wd:' + q).join(' ')} }
      OPTIONAL { ?c rdfs:label ?en FILTER(lang(?en) = "en") }
      OPTIONAL { ?c rdfs:label ?fr FILTER(lang(?fr) = "fr") }
      OPTIONAL { ?c wdt:P17/wdt:P297 ?cc }
      BIND(EXISTS { ?c wdt:P31/wdt:P279* ?t . VALUES ?t { wd:Q2412834 } } AS ?youth)
    }`);
    for (const b of json.results.bindings) {
      const q = qid(b.c.value);
      if (out.has(q) && out.get(q).c) continue;
      out.set(q, { n: b.en?.value ?? q, ...(b.fr && b.fr.value !== b.en?.value ? { nf: b.fr.value } : {}), c: b.cc?.value ?? '', y: b.youth?.value === 'true' });
    }
  }
  return out;
}
const clubInfo = await describeClubs([...clubs.keys()]);

// 2. Birthplace and its country.
const born = new Map();
for (const batch of chunk(players, 300)) {
  const json = await sparql(`SELECT ?p ?place ?en ?fr ?cc WHERE {
    VALUES ?p { ${batch.map((q) => 'wd:' + q).join(' ')} }
    ?p wdt:P19 ?place .
    OPTIONAL { ?place rdfs:label ?en FILTER(lang(?en) = "en") }
    OPTIONAL { ?place rdfs:label ?fr FILTER(lang(?fr) = "fr") }
    OPTIONAL { ?place wdt:P17/wdt:P297 ?cc }
  }`);
  for (const b of json.results.bindings) {
    const p = qid(b.p.value);
    if (born.has(p) && born.get(p).c) continue;
    born.set(p, { n: b.en?.value ?? '', ...(b.fr && b.fr.value !== b.en?.value ? { nf: b.fr.value } : {}), c: b.cc?.value ?? '' });
  }
}
console.log(`${born.size} birthplaces`);

// 3. Youth clubs from the English Wikipedia infobox (youthclubsN), titles mapped to Wikidata items.
const youth = new Map(); // player -> club q[]
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
if (!NO_WIKI) {
  try {
    const titleOf = new Map();
    for (const batch of chunk(players, 400)) {
      const json = await sparql(`SELECT ?p ?t WHERE {
        VALUES ?p { ${batch.map((q) => 'wd:' + q).join(' ')} }
        ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
      }`);
      for (const b of json.results.bindings) titleOf.set(qid(b.p.value), b.t.value);
    }
    const byTitle = new Map([...titleOf].map(([q, t]) => [t, q]));
    const youthTitles = new Map(); // player -> titles
    for (const [i, batch] of chunk([...titleOf.values()], 50).entries()) {
      const json = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') });
      const back = new Map();
      for (const r of [...(json.query?.normalized ?? []), ...(json.query?.redirects ?? [])]) back.set(r.to, back.get(r.from) ?? r.from);
      for (const page of json.query?.pages ?? []) {
        const text = page.revisions?.[0]?.slots?.main?.content?.slice(0, 20000);
        const q = byTitle.get(page.title) ?? byTitle.get(back.get(page.title));
        if (!text || !q) continue;
        const titles = [...text.matchAll(/^\s*\|\s*youth_?clubs\d+\s*=\s*(.*)$/gm)].flatMap((m) => [...m[1].matchAll(/\[\[([^|\]#]+)/g)].map((x) => x[1].trim()));
        youthTitles.set(q, titles);
      }
      if (i % 5 === 0) console.log(`infoboxes ${i + 1}: ${youthTitles.size}`);
    }
    // Club titles -> Wikidata items (following redirects).
    const itemOf = new Map();
    for (const batch of chunk([...new Set([...youthTitles.values()].flat())], 50)) {
      const json = await wiki({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: batch.join('|') });
      const back = new Map();
      for (const r of [...(json.query?.normalized ?? []), ...(json.query?.redirects ?? [])]) back.set(r.to, back.get(r.from) ?? r.from);
      for (const page of json.query?.pages ?? []) {
        const item = page.pageprops?.wikibase_item;
        if (!item) continue;
        itemOf.set(page.title, item);
        if (back.has(page.title)) itemOf.set(back.get(page.title), item);
      }
    }
    for (const [p, titles] of youthTitles) youth.set(p, [...new Set(titles.map((t) => itemOf.get(t)).filter(Boolean))]);
    console.log(`${youth.size} youth careers`);
  } catch (e) {
    console.warn(`Wikipedia youth clubs skipped: ${e.message}`);
  }
}
// Keep last run's youth clubs when Wikipedia could not be read this time.
if (!youth.size && previous?.players) for (const [p, x] of Object.entries(previous.players)) if (x.y) youth.set(p, x.y);

// Reserve and youth sides of a club count as that club ("FC Barcelona B" -> FC Barcelona) when Wikidata says so (P361 part of / P127 owned by).
const youthItems = [...new Set([...youth.values()].flat())];
const missing = youthItems.filter((q) => !clubInfo.has(q));
for (const [q, v] of await describeClubs(missing)) clubInfo.set(q, v);
const parentOf = new Map();
for (const batch of chunk([...clubInfo.keys()], 300)) {
  const json = await sparql(`SELECT ?c ?parent WHERE { VALUES ?c { ${batch.map((q) => 'wd:' + q).join(' ')} } ?c wdt:P361|wdt:P127 ?parent . ?parent wdt:P31/wdt:P279* wd:Q476028 . }`);
  for (const b of json.results.bindings) parentOf.set(qid(b.c.value), qid(b.parent.value));
}
const missingParents = [...new Set(parentOf.values())].filter((q) => !clubInfo.has(q));
for (const [q, v] of await describeClubs(missingParents)) clubInfo.set(q, v);
// Then by name: "AS Monaco Reserves and Academy", "Sporting C.P. Youth and Academy", "FC Schalke 04 II" -> the senior club.
const YOUTH_NAME = /(^academy of |\s+((under-?\d\ds?|u-?\d\ds?) and academy|reserves? and (academy|youth (team|squads))|youth and academy|youth (academy|sector|team)|academy|reserves?|youth|juvenil a|juvenil|primavera|castilla|cantera|atlètic|under-?\d\ds?|u-?\d\ds?))$/i;
const B_TEAM = /\s+(ii|b|c)$/i; // only a youth side when a senior club of that name exists ("Willem II" stays)
const plain = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w && !['fc', 'cf', 'sc', 'ac', 'as', 'afc', 'cp', 'sfc', 'club', 'de', 'futbol', 'football', 'calcio', 'sv', 'vfb', 'vfl', 'tsg', 'rc', 'ss', 'us', 'ogc', 'sk', 'bc', 'fbpa'].includes(w)).join(' ');
const seniorByName = new Map();
for (const c of data.clubs) seniorByName.set(plain(c.nf ?? c.n), c.q), seniorByName.set(plain(c.n), c.q);
for (const [q, v] of clubInfo) if (v && !v.y && !YOUTH_NAME.test(v.n) && !seniorByName.has(plain(v.n))) seniorByName.set(plain(v.n), q);
for (const [q, v] of clubInfo) {
  if (!v || parentOf.has(q)) continue;
  let n = v.n;
  for (let i = 0; i < 3 && (YOUTH_NAME.test(n) || B_TEAM.test(n)); i++) n = n.replace(YOUTH_NAME, '').replace(B_TEAM, '');
  if (n === v.n) continue;
  const parent = seniorByName.get(plain(n));
  if (parent && parent !== q) parentOf.set(q, parent);
}
const isYouthSide = (q) => !!clubInfo.get(q)?.y || YOUTH_NAME.test(clubInfo.get(q)?.n ?? '') || (B_TEAM.test(clubInfo.get(q)?.n ?? '') && parentOf.has(q));
const missingParents2 = [...new Set(parentOf.values())].filter((q) => !clubInfo.has(q));
for (const [q, v] of await describeClubs(missingParents2)) clubInfo.set(q, v);
const main = (q) => parentOf.get(q) ?? q;

// 4. Output. Clubs that appear in the careers, with name and country. Players: s = senior stints, y = youth clubs, b = birthplace.
const usedClubs = new Set();
const out = {};
for (const p of players) {
  const b = data.players.find((x) => x.q === p)?.b ?? 0;
  const senior = (careers.get(p) ?? [])
    // Youth sides and stints that ended before 17 are the youth career, not the senior one.
    .filter(([c, , to]) => clubInfo.get(c) && !isYouthSide(c) && !(to !== null && to < b + 17))
    .map(([c, from, to]) => [main(c), from, to])
    .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  const yc = youth.get(p) ?? [];
  const entry = {};
  if (senior.length) entry.s = senior;
  if (yc.length) entry.y = [...new Set(yc.map(main))];
  if (born.get(p)) entry.b = born.get(p);
  if (!Object.keys(entry).length) continue;
  for (const [c] of entry.s ?? []) usedClubs.add(c);
  for (const c of entry.y ?? []) usedClubs.add(c);
  out[p] = entry;
}
const result = {
  source: 'Wikidata (CC0) and English Wikipedia infoboxes (CC BY-SA 4.0)',
  generatedAt: new Date().toISOString(),
  clubs: Object.fromEntries([...usedClubs].filter((q) => clubInfo.get(q)).map((q) => { const { n, nf, c } = clubInfo.get(q); return [q, { n, ...(nf ? { nf } : {}), c }]; })),
  players: out,
};
fs.writeFileSync(OUT, JSON.stringify(result));
const withYouth = Object.values(out).filter((x) => x.y).length;
console.log(`wrote ${OUT}: ${Object.keys(out).length} players, ${withYouth} with youth clubs, ${usedClubs.size} clubs`);
