// Extra football facts from English Wikipedia (CC BY-SA 4.0), saved to scripts/wiki-data.json,
// which build-data.mjs merges with Wikidata. Wikipedia titles are mapped to Wikidata ids.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-wiki.mjs [--refresh]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const CACHE = path.join(ROOT, '.cache/wiki');
const OUT = path.join(ROOT, 'scripts/wiki-data.json');
const REFRESH = process.argv.includes('--refresh');
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'name-the-players-builder/0.1 (football trivia game)';
fs.mkdirSync(CACHE, { recursive: true });

async function api(params) {
  const key = crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  const file = path.join(CACHE, key + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await new Promise((r) => setTimeout(r, 400)); // be gentle with the API
      const res = await fetch(API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
      if (res.status === 429) {
        const wait = (+(res.headers.get('retry-after') ?? 0) || 10 * attempt) * 1000;
        console.warn(`  rate limited, waiting ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      fs.writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (e) {
      console.warn(`  attempt ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('Wikipedia API failed');
}

async function wikitext(title) {
  const j = await api({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' });
  if (j.error) { console.warn(`  missing page: ${title}`); return null; }
  return j.parse.wikitext;
}

/** Map article titles to Wikidata ids through Wikidata sitelinks (one SPARQL query per 250 titles). */
const qidCache = new Map();
async function qidsFor(titles) {
  const normTitle = (t) => { const x = t.replace(/_/g, ' ').trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
  const todo = [...new Set(titles.map(normTitle))].filter((t) => !qidCache.has(t));
  for (let i = 0; i < todo.length; i += 250) {
    const batch = todo.slice(i, i + 250);
    const query = `SELECT ?t ?item WHERE { VALUES ?t { ${batch.map((t) => JSON.stringify(t) + '@en').join(' ')} }
      ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t . }`;
    const key = crypto.createHash('sha1').update(query).digest('hex').slice(0, 16);
    const file = path.join(CACHE, 'wd-' + key + '.json');
    let rows;
    if (!REFRESH && fs.existsSync(file)) rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      for (let attempt = 1; attempt <= 5 && !rows; attempt++) {
        try {
          const res = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA }, body: new URLSearchParams({ query }) });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          rows = (await res.json()).results.bindings.map((b) => [b.t.value, b.item.value.split('/').pop()]);
          fs.writeFileSync(file, JSON.stringify(rows));
        } catch (e) { console.warn('  sparql', e.message); await new Promise((r) => setTimeout(r, 3000 * attempt)); }
      }
    }
    for (const t of batch) qidCache.set(t, null);
    for (const [t, q] of rows ?? []) qidCache.set(t, q);
  }
  return new Map(titles.map((t) => [t, qidCache.get(normTitle(t))]));
}

/** Winners of each edition from Wikidata (P1346), as national team names ("Argentina"). */
async function editionWinners() {
  const query = `SELECT ?label ?wl WHERE {
    VALUES ?comp { wd:Q19317 wd:Q260858 wd:Q18756 }
    ?e wdt:P3450 ?comp ; rdfs:label ?label ; wdt:P1346 ?w . FILTER(LANG(?label) = "en")
    ?w rdfs:label ?wl . FILTER(LANG(?wl) = "en")
  }`;
  const res = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA }, body: new URLSearchParams({ query }) });
  const out = new Map();
  for (const b of (await res.json()).results.bindings) {
    const name = b.wl.value.replace(/ (men's )?national (association )?football team$/i, '').trim();
    out.set(b.label.value, name);
  }
  return out;
}

const linkTarget = (s) => s.split('|')[0].split('#')[0].trim();
const clean = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

// ---------- International tournament squads ----------
const EDITIONS = [
  ...[1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026].map((y) => ({ code: 'WC' + y, squads: `${y} FIFA World Cup squads`, page: `${y} FIFA World Cup` })),
  ...[2000, 2004, 2008, 2012, 2016, 2020, 2024].map((y) => ({ code: 'EU' + y, squads: `UEFA Euro ${y} squads`, page: `UEFA Euro ${y}` })),
  ...[2001, 2004, 2007, 2011, 2015, 2019, 2021, 2024].map((y) => ({ code: 'CA' + y, squads: `${y} Copa América squads`, page: `${y} Copa América` })),
  { code: 'CA2016', squads: 'Copa América Centenario squads', page: 'Copa América Centenario' },
];
// FIFA codes used in infoboxes ({{fb|ARG}}) → squad section names.
const FB = { ARG: 'Argentina', BRA: 'Brazil', FRA: 'France', ITA: 'Italy', ESP: 'Spain', GER: 'Germany', POR: 'Portugal', GRE: 'Greece', CHI: 'Chile', URU: 'Uruguay', COL: 'Colombia', ENG: 'England', NED: 'Netherlands', BEL: 'Belgium', CRO: 'Croatia', MAR: 'Morocco', USA: 'United States', MEX: 'Mexico', JPN: 'Japan', PAR: 'Paraguay', PER: 'Peru', ECU: 'Ecuador', DEN: 'Denmark', SUI: 'Switzerland' };

const KNOWN_WINNERS = {
  '1998 FIFA World Cup': 'France', '2002 FIFA World Cup': 'Brazil', '2006 FIFA World Cup': 'Italy', '2010 FIFA World Cup': 'Spain',
  '2014 FIFA World Cup': 'Germany', '2018 FIFA World Cup': 'France', '2022 FIFA World Cup': 'Argentina',
  'UEFA Euro 2000': 'France', 'UEFA Euro 2004': 'Greece', 'UEFA Euro 2008': 'Spain', 'UEFA Euro 2012': 'Spain',
  'UEFA Euro 2016': 'Portugal', 'UEFA Euro 2020': 'Italy', 'UEFA Euro 2024': 'Spain',
  '2001 Copa América': 'Colombia', '2004 Copa América': 'Brazil', '2007 Copa América': 'Brazil', '2011 Copa América': 'Uruguay',
  '2015 Copa América': 'Chile', 'Copa América Centenario': 'Chile', '2019 Copa América': 'Brazil', '2021 Copa América': 'Argentina', '2024 Copa América': 'Argentina',
};

async function squads() {
  const wd = await editionWinners();
  // Wikidata P1346 is unreliable for past editions (Euro 2004 → Portugal, no Copa winners): hardcode them, keep WD only for the latest World Cup.
  const winnersByLabel = new Map(Object.entries(KNOWN_WINNERS));
  if (wd.get('2026 FIFA World Cup')) winnersByLabel.set('2026 FIFA World Cup', wd.get('2026 FIFA World Cup'));
  const players = {}; // qid -> codes
  const winners = {}; // code -> qids
  for (const ed of EDITIONS) {
    const text = await wikitext(ed.squads);
    if (!text) continue;
    let team = null;
    const byTeam = {};
    for (const line of clean(text).split('\n')) {
      const h = /^===\s*(.+?)\s*===\s*$/.exec(line);
      if (h) { team = h[1].replace(/\[\[|\]\]/g, '').split('|').pop().trim(); continue; }
      if (!team || !/\{\{\s*(nat fs (g )?player|national football squad player)/i.test(line)) continue;
      const m = /\|\s*name\s*=\s*\[\[([^\]]+)\]\]/.exec(line);
      // name={{sortname|First|Last|Article title (optional)|sort key}}
      const sn = /\|\s*name\s*=\s*\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)(?:\|([^|}]*))?/i.exec(line);
      const title = m ? linkTarget(m[1]) : sn ? (sn[3]?.trim() && !sn[3].includes('=') ? sn[3].trim() : `${sn[1].trim()} ${sn[2].trim()}`) : null;
      if (title) (byTeam[team] ??= []).push(title);
    }
    const titles = Object.values(byTeam).flat();
    const map = await qidsFor(titles);
    const champion = winnersByLabel.get(ed.page) ?? null;
    let n = 0;
    for (const [tm, ts] of Object.entries(byTeam)) {
      for (const t of ts) {
        const q = map.get(t);
        if (!q) continue;
        n++;
        (players[q] ??= []).push(ed.code);
        if (champion && tm === champion) (winners[ed.code] ??= []).push(q);
      }
    }
    console.log(`${ed.code}: ${Object.keys(byTeam).length} teams, ${n} players, champion ${champion ?? '?'} (${winners[ed.code]?.length ?? 0})`);
  }
  return { players, winners };
}

// ---------- Champions League: clubs per season (group stage / league phase) ----------
async function championsLeague() {
  const seasons = {}; // start year -> club qids
  for (let y = 2000; y <= 2026; y++) {
    const yy = String((y + 1) % 100).padStart(2, '0');
    const title = y >= 2024 ? `${y}–${yy} UEFA Champions League league phase` : `${y}–${yy} UEFA Champions League group stage`;
    const text = await wikitext(title);
    if (!text) continue;
    const sec = /==\s*Teams\s*==([\s\S]*?)\n==[^=]/.exec(clean(text));
    const body = sec ? sec[1] : clean(text).slice(0, 20000);
    const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => linkTarget(m[1]));
    const map = await qidsFor(links);
    seasons[y] = [...new Set([...map.values()].filter(Boolean))];
    console.log(`UCL ${y}: ${seasons[y].length} linked items`);
  }
  return seasons;
}

// ---------- Ballon d'Or rankings ----------
async function ballonDor() {
  const out = {}; // qid -> years
  for (let y = 2000; y <= 2025; y++) {
    if (y === 2020) continue; // not awarded
    const title = y >= 2010 && y <= 2015 ? `${y} FIFA Ballon d'Or` : `${y} Ballon d'Or`;
    const text = await wikitext(title);
    if (!text) continue;
    const titles = [];
    // Rows of the ranking tables: {{sortname|First|Last|dab}} or [[Player]] on the line after a rank.
    for (const tbl of clean(text).split('{|').slice(1)) {
      const t = tbl.split('|}')[0];
      if (!/rank|position|player/i.test(t.slice(0, 600))) continue;
      for (const m of t.matchAll(/\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)(?:\|([^|}]*))?(?:\|[^}]*)?\}\}/gi)) {
        const name = `${m[1].trim()} ${m[2].trim()}`;
        titles.push(m[3] && !/=/.test(m[3]) && m[3].trim() ? m[3].trim() : name);
      }
      for (const row of t.split('\n|-')) {
        const cells = row.split('\n').filter((l) => l.startsWith('|') || l.startsWith('!'));
        const playerCell = cells.find((c) => /\[\[/.test(c) && !/Forward|Midfielder|Defender|Goalkeeper|football club|F\.C\.|national/i.test(c));
        const m = playerCell && /\[\[([^\]]+)\]\]/.exec(playerCell);
        if (m && !/sortname/i.test(playerCell)) titles.push(linkTarget(m[1]));
      }
    }
    const map = await qidsFor(titles);
    let n = 0;
    for (const q of new Set(map.values())) if (q) { (out[q] ??= []).push(y); n++; }
    console.log(`Ballon d'Or ${y}: ${n}`);
  }
  return out;
}

// ---------- League top scorers ----------
const SCORER_PAGES = { PL: 'Premier League Golden Boot', L1: 'List of Ligue 1 top scorers', LL: 'Pichichi Trophy', SA: 'Capocannoniere', };
// No season-by-season Bundesliga list parses reliably and Wikidata P3279 stops in 2007: hardcoded (ties included).
const BL_SCORERS = {
  2000: ['Sergej Barbarez', 'Ebbe Sand'], 2001: ['Márcio Amoroso', 'Martin Max'], 2002: ['Thomas Christiansen', 'Giovane Élber'],
  2003: ['Aílton (footballer, born 1973)'], 2004: ['Marek Mintál'], 2005: ['Miroslav Klose'], 2006: ['Theofanis Gekas'], 2007: ['Luca Toni'],
  2008: ['Grafite'], 2009: ['Edin Džeko'], 2010: ['Mario Gómez'], 2011: ['Klaas-Jan Huntelaar'], 2012: ['Stefan Kießling'],
  2013: ['Robert Lewandowski'], 2014: ['Alexander Meier'], 2015: ['Robert Lewandowski'], 2016: ['Pierre-Emerick Aubameyang'],
  2017: ['Robert Lewandowski'], 2018: ['Robert Lewandowski'], 2019: ['Robert Lewandowski'], 2020: ['Robert Lewandowski'],
  2021: ['Robert Lewandowski'], 2022: ['Christopher Nkunku', 'Niclas Füllkrug'], 2023: ['Harry Kane'], 2024: ['Harry Kane'],
};
async function topScorers() {
  const out = {}; // qid -> ["PL2007", ...]
  for (const [lg, title] of Object.entries(SCORER_PAGES)) {
    const text = await wikitext(title);
    if (!text) continue;
    const rows = [];
    for (const row of clean(text).split('\n|-')) {
      const season = /\[\[(\d{4})[–-](\d{2,4})[^\]|]*(?:\|[^\]]*)?\]\]|(?:^|\|)\s*(\d{4})[–-](\d{2,4})\s*(?:\n|\|)/.exec(row);
      const y = season ? +(season[1] ?? season[3]) : null;
      if (!y || y < 2000) continue;
      const links = [...row.matchAll(/\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)(?:\|([^|}=]*))?/gi)].map((m) => (m[3]?.trim() || `${m[1].trim()} ${m[2].trim()}`));
      for (const m of row.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const t = linkTarget(m[1]);
        if (!/^\d{4}|F\.C\.|FC|football|season|League|Liga|Serie|Bundesliga|Ligue|Calcio|Club|United|City|national/i.test(t)) links.push(t);
      }
      for (const t of links) rows.push([y, t]);
    }
    const map = await qidsFor(rows.map((r) => r[1]));
    let n = 0;
    for (const [y, t] of rows) {
      const q = map.get(t);
      if (q) { (out[q] ??= []).push(lg + y); n++; }
    }
    console.log(`Top scorers ${lg}: ${n} rows`);
  }
  const bl = Object.entries(BL_SCORERS).flatMap(([y, ts]) => ts.map((t) => [+y, t]));
  const blMap = await qidsFor(bl.map((r) => r[1]));
  for (const [y, t] of bl) {
    const q = blMap.get(t);
    if (q) (out[q] ??= []).push('BL' + y); else console.warn('  BL scorer not found:', t);
  }
  console.log(`Top scorers BL: ${bl.filter(([, t]) => blMap.get(t)).length}/${bl.length}`);
  for (const q of Object.keys(out)) out[q] = [...new Set(out[q])];
  return out;
}

const result = {
  source: 'English Wikipedia, CC BY-SA 4.0',
  generatedAt: new Date().toISOString(),
  tournaments: await squads(),
  championsLeague: await championsLeague(),
  ballonDor: await ballonDor(),
  topScorers: await topScorers(),
};
fs.writeFileSync(OUT, JSON.stringify(result));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e3).toFixed(0) + ' kB');
