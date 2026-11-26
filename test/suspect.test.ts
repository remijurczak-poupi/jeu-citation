import { describe, expect, it } from 'vitest';
import { isSuspect } from '../worker/solo';

const min = 60_000;
describe('scores set aside', () => {
  it('keeps human paces', () => {
    expect(isSuspect(120, 0, 5 * min)).toBe(false); // 24 a minute: a very good player in the daily challenge
    expect(isSuspect(39, 0, 10_000)).toBe(false); // short bursts are fine
  });
  it('sets aside script paces', () => {
    expect(isSuspect(400, 0, 5 * min)).toBe(true); // 80 a minute
    expect(isSuspect(50, 0, 30_000)).toBe(true);
  });
});
