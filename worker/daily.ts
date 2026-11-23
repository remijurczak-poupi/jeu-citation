import type { DailyStreak } from '../shared/types';
// Daily challenge: one theme per day, the same for everyone, alternating easy and hard days.
import { data, scopeSize } from './data';
import type { Criterion } from '../shared/types';

export const DAILY_EPOCH = Date.UTC(2026, 10, 19); // challenge #1 (move to the launch day)

/** Day in Paris time (the audience is European first), as YYYY-MM-DD. */
export function todayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(now));
}

export function dailyNumber(date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - DAILY_EPOCH) / 86400000) + 1;
}

function rng(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function topSeasons(clubIdx: number): number {
  return new Set(Object.values(data.clubs[clubIdx].l).flat()).size;
}

export type DailyPick = { criterion: Criterion; difficulty: 'easy' | 'hard' };

export const dailyDifficulty = (date: string): 'easy' | 'hard' => (dailyNumber(date) % 2 === 1 ? 'easy' : 'hard');

/**
 * Draws a day's theme from the current data. The result depends on the data (club sizes,
 * seasons…), so it changes after a data refresh: never call it directly to serve a day,
 * go through dailyChallenges(), which freezes the draw the first time a day is served.
 */
export function drawDailyCriterion(date: string): DailyPick {
  const difficulty = dailyDifficulty(date);
  const rand = rng('daily:' + date);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const leagues = data.leagues.map((l) => l.id);
  const lastFull = data.currentSeason - 1; // current season is still in progress
  const bigClubs = data.clubs.map((_, i) => i).filter((i) => topSeasons(i) >= 20);
  const midClubs = data.clubs.map((_, i) => i).filter((i) => topSeasons(i) >= 8 && topSeasons(i) < 20);

  for (let attempt = 0; attempt < 30; attempt++) {
    let c: Criterion;
    const r = rand();
    if (difficulty === 'easy') {
      if (r < 0.35) c = { league: pick(leagues) };
      else if (r < 0.8) c = { club: data.clubs[pick(bigClubs)].q };
      else {
        const from = data.firstSeason + Math.floor(rand() * (lastFull - data.firstSeason - 9));
        c = { league: pick(leagues), from, to: from + 9 };
      }
    } else {
      if (r < 0.4) {
        const y = data.firstSeason + Math.floor(rand() * (lastFull - data.firstSeason + 1));
        c = { league: pick(leagues), from: y, to: y };
      } else if (r < 0.75 && midClubs.length) c = { club: data.clubs[pick(midClubs)].q };
      else {
        const from = data.firstSeason + Math.floor(rand() * (lastFull - data.firstSeason - 4));
        c = { club: data.clubs[pick(bigClubs)].q, from, to: from + 4 };
      }
    }
    const size = scopeSize(c);
    if (size >= 40) return { criterion: c, difficulty };
  }
  return { criterion: { league: 'PL' }, difficulty };
}

/** The frozen challenge of each date (drawn and stored the first time a date is asked for). */
export async function dailyChallenges(db: D1Database, dates: string[]): Promise<Map<string, DailyPick>> {
  const out = new Map<string, DailyPick>();
  if (!dates.length) return out;
  const load = async (ds: string[]) => {
    const rows = await db.prepare(`SELECT date, criterion FROM daily_challenges WHERE date IN (${ds.map(() => '?').join(',')})`)
      .bind(...ds).all<{ date: string; criterion: string }>();
    for (const r of rows.results) out.set(r.date, { criterion: JSON.parse(r.criterion), difficulty: dailyDifficulty(r.date) });
  };
  await load(dates);
  const missing = dates.filter((d) => !out.has(d));
  if (missing.length) {
    const now = Date.now();
    const insert = db.prepare('INSERT OR IGNORE INTO daily_challenges (date, criterion, created_at) VALUES (?, ?, ?)');
    await db.batch(missing.map((d) => insert.bind(d, JSON.stringify(drawDailyCriterion(d).criterion), now)));
    await load(missing); // another request may have frozen the day first: keep its version
  }
  return out;
}

export async function dailyChallenge(db: D1Database, date: string): Promise<DailyPick> {
  return (await dailyChallenges(db, [date])).get(date)!;
}

/** Days in a row with a daily challenge played; today not played yet keeps yesterday's streak alive. */
export function dailyStreak(dates: string[], today: string): DailyStreak {
  const day = (d: string) => Math.round(Date.parse(d + 'T12:00:00Z') / 86400_000);
  const days = [...new Set(dates.map(day))].sort((a, b) => a - b);
  let best = 0, run = 0;
  for (let i = 0; i < days.length; i++) { run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
  const t = day(today);
  const playedToday = days.includes(t);
  const last = days[days.length - 1];
  const current = last === t || last === t - 1 ? run : 0;
  return { current, best, playedToday };
}

