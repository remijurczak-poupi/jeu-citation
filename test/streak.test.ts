import { describe, expect, it } from 'vitest';
import { dailyStreak } from '../worker/daily';

describe('daily streak', () => {
  it('counts consecutive days, keeps yesterday alive, breaks on a gap', () => {
    expect(dailyStreak(['2026-11-18', '2026-11-19', '2026-11-20'], '2026-11-21')).toEqual({ current: 3, best: 3, playedToday: false });
    expect(dailyStreak(['2026-11-19', '2026-11-20', '2026-11-21'], '2026-11-21')).toEqual({ current: 3, best: 3, playedToday: true });
    expect(dailyStreak(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-19'], '2026-11-21')).toEqual({ current: 0, best: 3, playedToday: false });
    expect(dailyStreak([], '2026-11-21')).toEqual({ current: 0, best: 0, playedToday: false });
  });
});
