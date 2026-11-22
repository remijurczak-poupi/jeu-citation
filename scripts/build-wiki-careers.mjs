// Club careers read from the infobox of each player's English Wikipedia article (CC BY-SA 4.0),
// saved to scripts/wiki-careers.json. build-data.mjs adds the seasons Wikidata is missing
// (e.g. a recent transfer nobody entered in Wikidata yet) and closes stints Wikidata leaves open.
// Only whole seasons are kept: "2021–2024" at a club gives 2021-22, 2022-23 and 2023-24.
// Wikipedia allows about 10 such requests a minute, so each run re-reads the active players and a
// quarter of the retired ones (all of them on the first run, or with --all) and keeps the rest.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-wiki-careers.mjs [--refresh] [--all]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { infoboxSeasons, parseInfobox } from '../worker/infobox.ts';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CACHE = path.join(ROOT, '.cache/wiki-careers');
const OUT = path.join(ROOT, 'scripts/wiki-careers.json');
const DATA = path.join(ROOT, 'src/data/football.json');
const REFRESH = process.argv.includes('--refresh');
const ALL = process.argv.includes('--all');
const GAP_MS = 6500; // stay under Wikipedia's limit instead of bouncing on 429s
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
    await sleep(GAP_MS);
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
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).players ?? {} : {};
const firstRun = !Object.keys(previous).length;
const week = Math.floor(Date.now() / (7 * 864e5));
const hash = (q) => [...q].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const due = (p) => ALL || firstRun || p.x || hash(p.q) % 4 === week % 4;
const qids = data.players.filter((p) => /^Q\d+$/.test(p.q) && due(p)).map((p) => p.q);
console.log(`${qids.length} of ${data.players.length} players to read this time`);

// 1. Article titles of our clubs and every redirect to them ("Marseille", "OM"…), to read the infobox links.
const clubOf = new Map();
const norm = (t) => { const x = t.replace(/_/g, ' ').replace(/#.*$/, '').trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
const clubTitles = await sparql(`SELECT ?c ?t WHERE {
  VALUES ?c { ${[...ourClubs].map((q) => 'wd:' + q).join(' ')} }
  ?a schema:about ?c ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t .
}`);
const clubByTitle = new Map(clubTitles.results.bindings.map((b) => [b.t.value, b.c.value.split('/').pop()]));
for (const [t, q] of clubByTitle) clubOf.set(norm(t), q);
for (const batch of chunk([...clubByTitle.keys()], 50)) {
  let cont = {};
  for (;;) {
    const json = await wiki({ action: 'query', prop: 'redirects', rdlimit: 'max', rdnamespace: '0', titles: batch.join('|'), ...cont });
    for (const page of json.query?.pages ?? []) for (const r of page.redirects ?? []) if (clubByTitle.has(page.title)) clubOf.set(norm(r.title), clubByTitle.get(page.title));
    if (!json.continue) break;
    cont = json.continue;
  }
}
console.log(`${clubByTitle.size} club articles, ${clubOf.size} titles and redirects`);

// 2. English Wikipedia article of every player.
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

// 3. Infoboxes, 50 articles per request.
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

// 4. Keep our clubs only, with the seasons each stint surely covers. null end = still at the club.
// Players not read this time keep last run's careers.
const out = Object.fromEntries(Object.entries(previous).filter(([q]) => !careers.has(q) && !titleOf.has(q)));
let n = 0;
for (const [q, stints] of careers) {
  const rows = [];
  for (const s of stints) {
    const club = clubOf.get(norm(s.title));
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
console.log(`wrote ${OUT}: ${Object.keys(out).length} players (${careers.size} read now), ${n} new stints at our clubs`);
