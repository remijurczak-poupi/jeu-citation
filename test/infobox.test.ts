import { describe, expect, it } from 'vitest';
import { infoboxSeasons } from '../worker/infobox';

describe('seasons covered by an infobox stint', () => {
  it('keeps only whole seasons as sure', () => {
    expect(infoboxSeasons(2020, 2024, 2026)).toEqual({ sure: [2020, 2021, 2022, 2023], maybe: [2019, 2024] });
  });
  it('runs an open stint to the current season', () => {
    expect(infoboxSeasons(2024, null, 2026).sure).toEqual([2024, 2025, 2026]);
  });
  it('treats a single year (a loan) as uncertain', () => {
    expect(infoboxSeasons(2025, 2025, 2026)).toEqual({ sure: [], maybe: [2024, 2025, 2024, 2025] });
  });
});
