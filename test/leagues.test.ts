import { describe, expect, it } from 'vitest';
import { cleanLeagueName, clubDayRanking, leagueEnd } from '../worker/leagues';

describe('clubDayRanking', () => {
  it('ranks clubs by the average of all their supporters, from 3 players', () => {
    const rows = clubDayRanking([
      ...[40, 10, 10, 0].map((score) => ({ club: 'Q1', score })), // avg 15
      ...[20, 20, 20].map((score) => ({ club: 'Q2', score })), // avg 20
      { club: 'Q3', score: 90 }, { club: 'Q3', score: 80 }, // 2 players: unranked
    ]);
    expect(rows.map((r) => [r.key, r.rank, r.score, r.players])).toEqual([
      ['Q2', 1, 20, 3],
      ['Q1', 2, 15, 4],
      ['Q3', null, 85, 2],
    ]);
  });
  it('gives tied clubs the same rank', () => {
    const rows = clubDayRanking(['A', 'B', 'C'].flatMap((club) => [10, 10, 10].map((score) => ({ club, score: club === 'C' ? 5 : score }))));
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});

describe('leagueEnd', () => {
  it('counts the last day inclusively', () => {
    expect(leagueEnd('2026-11-23', 'week')).toBe('2026-11-29');
    expect(leagueEnd('2026-11-23', '6months')).toBe('2027-05-22');
    expect(leagueEnd('2026-11-23', 'year')).toBe('2027-11-22');
    expect(leagueEnd('2026-11-23', 'none')).toBeNull();
  });
  it('does not overflow short months', () => {
    expect(leagueEnd('2027-01-31', 'month')).toBe('2027-02-27');
  });
});

describe('cleanLeagueName', () => {
  it('trims and checks length', () => {
    expect(cleanLeagueName('  La  bande du lundi ')).toBe('La bande du lundi');
    expect(cleanLeagueName('ab')).toBeNull();
    expect(cleanLeagueName('<script>')).toBeNull();
  });
});
