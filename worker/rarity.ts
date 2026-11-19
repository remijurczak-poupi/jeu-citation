/**
 * Rarity points for the daily challenge, based only on how often the day's participants cited each player:
 * cited by under 5% of games = 3 pts, under 20% = 2 pts, otherwise 1. Everyone gets 1 pt until 10 games exist.
 */
export function rarityTiers(gamesFound: string[][]): Map<string, number> {
  const total = gamesFound.length;
  const freq = new Map<string, number>();
  for (const f of gamesFound) for (const q of new Set(f)) freq.set(q, (freq.get(q) ?? 0) + 1);
  const pts = new Map<string, number>();
  for (const [q, n] of freq) {
    const share = n / Math.max(total, 1);
    pts.set(q, total < 10 ? 1 : share < 0.05 ? 3 : share < 0.2 ? 2 : 1);
  }
  return pts;
}
