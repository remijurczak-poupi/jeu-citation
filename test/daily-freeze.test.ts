import { describe, expect, it } from 'vitest';
import { dailyChallenge, dailyChallenges, drawDailyCriterion } from '../worker/daily';

/** Minimal in-memory stand-in for the daily_challenges table. */
function fakeDb(rows = new Map<string, string>()) {
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: (args as string[]).filter((d) => rows.has(d)).map((d) => ({ date: d, criterion: rows.get(d)! })) }),
    run: async () => { const [d, c] = args as string[]; if (!rows.has(d)) rows.set(d, c); },
  });
  const db = { prepare: (sql: string) => stmt(sql), batch: async (s: ReturnType<typeof stmt>[]) => { for (const x of s) await x.run(); } };
  return { db: db as unknown as D1Database, rows };
}

describe('daily challenge freezing', () => {
  it('keeps a stored day as it was, whatever the current data draws', async () => {
    const stored = { club: 'Q_SOME_CLUB_PLAYED_THAT_DAY' };
    const { db } = fakeDb(new Map([['2026-11-22', JSON.stringify(stored)]]));
    const day = await dailyChallenge(db, '2026-11-22');
    expect(day.criterion).toEqual(stored);
    expect(day.difficulty).toBe(drawDailyCriterion('2026-11-22').difficulty);
  });

  it('draws and stores a day the first time, then serves the stored version', async () => {
    const { db, rows } = fakeDb();
    const first = await dailyChallenges(db, ['2026-11-23', '2026-11-24']);
    expect(rows.size).toBe(2);
    expect(first.get('2026-11-23')!.criterion).toEqual(drawDailyCriterion('2026-11-23').criterion);
    rows.set('2026-11-23', JSON.stringify({ league: 'L1' })); // what was frozen wins over a redraw
    expect((await dailyChallenge(db, '2026-11-23')).criterion).toEqual({ league: 'L1' });
  });
});
