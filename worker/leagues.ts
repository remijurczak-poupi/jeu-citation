// Leagues and club rankings: pure helpers (the routes live in index.ts).
import type { ClubDayRow, LeagueDuration } from '../shared/types';

/** A club's daily score is the average of all its supporters who played that day, ranked from CLUB_MIN_PLAYERS. */
export const CLUB_MIN_PLAYERS = 3;


/**
 * Clubs of the day from each supporter's daily score (average of all of them, Rémi's choice 2026-11-23):
 * big clubs don't win just by numbers. Clubs with too few players are listed unranked (rank null).
 */
export function clubDayRanking(scores: { club: string; score: number }[]): ClubDayRow[] {
  const by = new Map<string, number[]>();
  for (const s of scores) (by.get(s.club) ?? by.set(s.club, []).get(s.club)!).push(s.score);
  const rows = [...by].map(([key, list]) => {
    const score = Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
    return { rank: null as number | null, key, score, players: list.length };
  });
  const ranked = rows.filter((r) => r.players >= CLUB_MIN_PLAYERS).sort((a, b) => b.score - a.score || b.players - a.players);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].score === r.score ? ranked[i - 1].rank : i + 1; });
  const unranked = rows.filter((r) => r.players < CLUB_MIN_PLAYERS).sort((a, b) => b.players - a.players || b.score - a.score);
  return [...ranked, ...unranked];
}

export const LEAGUE_DURATIONS: LeagueDuration[] = ['week', 'month', '3months', '6months', 'year', 'none'];

/** Last day (inclusive, YYYY-MM-DD) of a league starting on `start`, or null when it never ends. */
export function leagueEnd(start: string, duration: LeagueDuration): string | null {
  if (duration === 'none') return null;
  const d = new Date(start + 'T12:00:00Z');
  if (duration === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const months = { month: 1, '3months': 3, '6months': 6, year: 12 }[duration];
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // 31 January + 1 month = 28/29 February, not 3 March.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** League names: 3 to 40 letters, digits, spaces and simple punctuation. */
export function cleanLeagueName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}\p{Emoji_Presentation} _.,'!&#@()-]{3,40}$/u.test(n)) return null;
  return n;
}
