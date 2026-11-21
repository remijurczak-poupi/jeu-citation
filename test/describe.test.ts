import { describe, expect, it } from 'vitest';
import { data, describeList, suggest } from '../worker/data';

const idx = (name: string) => data.players.findIndex((p) => p.n === name);

describe('describeList', () => {
  it('shows only names when there is no homonym', () => {
    const r = describeList(suggest('van der wiel'), { league: 'L1', from: 2007, to: 2016 });
    expect(r.length).toBeGreaterThan(0);
    for (const s of r) expect(Object.keys(s).sort()).toEqual(['n', 'q']);
  });
  it('tells exact homonyms apart without details tied to the theme', () => {
    const byName = new Map<string, number[]>();
    data.players.forEach((p, i) => byName.set(p.n, [...(byName.get(p.n) ?? []), i]));
    const pair = [...byName.values()].find((v) => v.length >= 2 && v.every((i) => data.players[i].c?.length && data.players[i].b))!;
    const plain = describeList(pair);
    expect(plain.some((s) => s.club || s.from !== undefined || s.c || s.y || s.p)).toBe(true);
    const r = describeList(pair, { nationality: 'FR', ageMin: 20, league: 'L1', position: 'DF' });
    for (const s of r) { expect(s.c).toBeUndefined(); expect(s.y).toBeUndefined(); expect(s.club).toBeUndefined(); expect(s.p).toBeUndefined(); expect(s.from).toBeUndefined(); }
    expect(idx('Thierry Henry')).toBeGreaterThanOrEqual(0);
  });
});
