// Compares a freshly built src/data/football.json with the previous one and refuses big drops,
// so that a Wikidata outage or a vandalised item never ships a half-empty game.
// Usage: node scripts/check-data.mjs <old.json> <new.json>
import fs from 'node:fs';

const [oldFile, newFile] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const before = load(oldFile);
const after = load(newFile);
const MAX_DROP = 0.03; // at most 3 % fewer players, clubs or stints

let ok = true;
for (const key of ['players', 'clubs', 'stints']) {
  const a = before[key].length;
  const b = after[key].length;
  const drop = (a - b) / a;
  console.log(`${key}: ${a} -> ${b} (${b >= a ? '+' : ''}${b - a})`);
  if (drop > MAX_DROP) {
    console.error(`  too many ${key} lost (${(drop * 100).toFixed(1)} %), keeping the old data`);
    ok = false;
  }
}
// Every league season must keep (nearly) all its clubs.
const clubsPerSeason = (d) => {
  const m = new Map();
  for (const c of d.clubs) for (const [lg, years] of Object.entries(c.l ?? {})) for (const y of years) m.set(lg + ' ' + y, (m.get(lg + ' ' + y) ?? 0) + 1);
  return m;
};
const seasonsAfter = clubsPerSeason(after);
for (const [season, n] of clubsPerSeason(before)) {
  const m = seasonsAfter.get(season) ?? 0;
  if (m < n - 2) {
    console.error(`  ${season}: ${n} clubs before, ${m} now`);
    ok = false;
  }
}
const known = new Set(before.players.map((p) => p.q));
const added = after.players.filter((p) => !known.has(p.q));
console.log(`new players: ${added.length}${added.length ? ' (e.g. ' + added.slice(0, 5).map((p) => p.n).join(', ') + ')' : ''}`);
process.exit(ok ? 0 : 1);
