// Club careers read from the infobox of each player's English Wikipedia article (CC BY-SA 4.0),
// saved to scripts/wiki-careers.json. build-data.mjs adds the seasons Wikidata is missing
// (e.g. a recent transfer nobody entered in Wikidata yet) and closes stints Wikidata leaves open.
// Only whole seasons are kept: "2021–2024" at a club gives 2021-22, 2022-23 and 2023-24.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-wiki-careers.mjs [--refresh]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { infoboxSeasons, parseInfobox } from '../worker/infobox.ts';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CACHE = path.join(ROOT, '.cache/wiki-careers');
const OUT = path.join(ROOT, 'scripts/wiki-careers.json');
const DATA = path.join(ROOT, 'src/data/football.json');
const REFRESH = process.argv.includes('--refresh');
const API = 'https://en.wikipedia.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'name-the-players-builder/0.1 (football trivia game)';
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function cached(key, fetcher) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= 8; attempt++) {
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
    if (res.status === 429) err.retryAfter = +(res.headers.get('retry-after') ?? 0) || 20;
    throw err;
  }
  return res.json();
}

const wiki = (params) =>
  cached(JSON.stringify(params), async () => {
    await sleep(250); // be gentle with the API
    return http(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ format: 'json', formatversion: '2', ...params }),
    });
  });

const sparql = (query) =>
  cached(query, () =>
    http(SPARQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: new URLSearchParams({ query }),
    }),
  );

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const ourClubs = new Set(data.clubs.map((c) => c.q));
const qids = data.players.map((p) => p.q).filter((q) => /^Q\d+$/.test(q));

// 1. English Wikipedia article of every player.
const titleOf = new Map();
for (const [i, batch] of chunk(qids, 400).entries()) {
  const json = await sparql(`SELECT ?p ?t WHERE {
    VALUES ?p { ${batch.map((q) => 'wd:' + q).join(' ')} }
    ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
  }`);
  for (const b of json.results.bindings) titleOf.set(b.p.value.split('/').pop(), b.t.value);
  if (i % 10 === 0) console.log(`articles batch ${i}: ${titleOf.size} found`);
}
console.log(`${titleOf.size} of ${qids.length} players have an English article`);

// 2. Infoboxes, 50 articles per request.
const careers = new Map(); // player -> parsed stints
const qidByTitle = new Map([...titleOf].map(([q, t]) => [t, q]));
const batches = chunk([...titleOf.values()], 50);
for (const [i, batch] of batches.entries()) {
  const json = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') });
  const back = new Map();
  for (const r of [...(json.query?.normalized ?? []), ...(json.query?.redirects ?? [])]) back.set(r.to, back.get(r.from) ?? r.from);
  for (const page of json.query?.pages ?? []) {
    const text = page.revisions?.[0]?.slots?.main?.content;
    const q = qidByTitle.get(page.title) ?? qidByTitle.get(back.get(page.title));
    if (!text || !q) continue;
    const stints = parseInfobox(text.slice(0, 20000)); // the infobox is at the top
    if (stints.length) careers.set(q, stints);
  }
  if (i % 50 === 0) console.log(`infoboxes ${i + 1}/${batches.length}: ${careers.size} careers`);
}

// 3. Club links (often redirects or short names) → Wikidata ids.
const linkTitles = [...new Set([...careers.values()].flatMap((s) => s.map((x) => x.title)))];
const clubOf = new Map();
for (const batch of chunk(linkTitles, 50)) {
  const json = await wiki({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: batch.join('|') });
  const alias = new Map();
  for (const r of [...(json.query?.normalized ?? []), ...(json.query?.redirects ?? [])]) alias.set(r.from, r.to);
  const qidOf = new Map();
  for (const p of json.query?.pages ?? []) if (p.pageprops?.wikibase_item) qidOf.set(p.title, p.pageprops.wikibase_item);
  for (const t of batch) {
    let x = t;
    for (let k = 0; k < 3 && alias.has(x); k++) x = alias.get(x);
    if (qidOf.has(x)) clubOf.set(t, qidOf.get(x));
  }
}
console.log(`${clubOf.size} of ${linkTitles.length} club links resolved`);

// 4. Keep our clubs only, with the seasons each stint surely covers. null end = still at the club.
const out = {};
let n = 0;
for (const [q, stints] of careers) {
  const rows = [];
  for (const s of stints) {
    const club = clubOf.get(s.title);
    if (!club || !ourClubs.has(club)) continue;
    const { sure } = infoboxSeasons(s.from, s.to, data.currentSeason);
    if (!sure.length) continue;
    const first = sure[0], last = sure[sure.length - 1];
    rows.push([club, first, s.to === null ? null : Math.min(last, data.currentSeason)]);
  }
  if (rows.length) { out[q] = rows; n += rows.length; }
}
const result = {
  source: 'English Wikipedia infoboxes (CC BY-SA 4.0)',
  generatedAt: new Date().toISOString(),
  players: out,
};
fs.writeFileSync(OUT, JSON.stringify(result));
console.log(`wrote ${OUT}: ${Object.keys(out).length} players, ${n} stints at our clubs`);
