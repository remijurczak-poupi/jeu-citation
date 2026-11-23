import { describe, expect, it } from 'vitest';
import { answer, initialOf, mysteryNumber, normQ, pickMystery, reveal, sameQuestion } from '../worker/mystery';
import { data, playerIndex } from '../worker/data';

const idx = (name: string) => data.players.findIndex((p) => p.n === name);

describe('mystery player answers', () => {
  const messi = idx('Lionel Messi');
  const mbappe = idx('Kylian Mbappé');
  const psg = data.clubs.find((c) => c.n.startsWith('Paris Saint-Germain'))!.q;
  const real = data.clubs.find((c) => c.n.startsWith('Real Madrid'))!.q;
  it('answers identity questions', () => {
    expect(answer(messi, { k: 'nation', v: 'AR' })).toBe(true);
    expect(answer(messi, { k: 'nation', v: 'ES' })).toBe(false); // sporting nationality only
    expect(answer(messi, { k: 'continent', v: 'SA' })).toBe(true);
    expect(answer(messi, { k: 'dual' })).toBe(true);
    expect(answer(mbappe, { k: 'position', v: 'FW' })).toBe(true);
    expect(answer(mbappe, { k: 'num', f: 'birthYear', op: 'eq', v: 1998 })).toBe(true);
    expect(answer(mbappe, { k: 'num', f: 'height', op: 'gt', v: 180 })).toBe(false);
    expect(answer(mbappe, { k: 'initial', v: 'M' })).toBe(true);
    expect(initialOf(idx('Ronaldo'))).toBe('R');
  });
  it('answers career questions', () => {
    expect(answer(messi, { k: 'club', v: psg })).toBe(true);
    expect(answer(messi, { k: 'league', v: 'L1' })).toBe(true);
    expect(answer(messi, { k: 'league', v: 'PL' })).toBe(false);
    expect(answer(messi, { k: 'num', f: 'clubs', op: 'eq', v: 2 })).toBe(true);
    expect(answer(messi, { k: 'nowLeague', v: 'other' })).toBe(true);
    expect(answer(mbappe, { k: 'nowClub', v: real })).toBe(true);
    expect(answer(mbappe, { k: 'nowLeague', v: 'LL' })).toBe(true);
    expect(answer(mbappe, { k: 'clubNowIn', v: 'L1' })).toBe(true);
    expect(answer(mbappe, { k: 'season', v: 2016 })).toBe(true);
    expect(answer(mbappe, { k: 'num', f: 'debut', op: 'eq', v: 2015 })).toBe(true);
    expect(answer(idx('Ronaldo'), { k: 'club', v: data.clubs.find((c) => c.n === 'FC Barcelona')!.q })).toBe(true); // before 2000 too
  });
  it('answers honours questions', () => {
    expect(answer(messi, { k: 'tournament', v: 'WC', won: true })).toBe(true);
    expect(answer(messi, { k: 'tournament', v: 'WC', year: 2022, won: true })).toBe(true);
    expect(answer(messi, { k: 'tournament', v: 'EU' })).toBe(false);
    expect(answer(messi, { k: 'ucl', v: 'won' })).toBe(true);
    expect(answer(messi, { k: 'champion', v: 'LL' })).toBe(true);
    expect(answer(messi, { k: 'topScorer', v: 'PL' })).toBe(false);
    expect(answer(messi, { k: 'ballonDor' })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'worldCups', op: 'gt', v: 4 })).toBe(true);
  });
  it('rejects bad questions', () => {
    expect(answer(messi, { k: 'nope' } as never)).toBeUndefined();
    expect(answer(messi, { k: 'club', v: 'Q0' })).toBeUndefined();
    expect(answer(messi, { k: 'num', f: 'age', op: 'xx', v: 3 } as never)).toBeUndefined();
  });
  it('spots a repeated question whatever the extra fields', () => {
    expect(sameQuestion({ k: 'league', v: 'PL', junk: 1 } as never, normQ({ k: 'league', v: 'PL' }))).toBe(true);
    expect(sameQuestion({ k: 'num', f: 'age', op: 'gt', v: 30 }, { k: 'num', f: 'age', op: 'lt', v: 30 })).toBe(false);
  });
});

describe('mystery player pick', () => {
  it('is stable for a day and avoids players already used', () => {
    const a = pickMystery('2026-11-23', new Set());
    expect(pickMystery('2026-11-23', new Set())).toBe(a);
    expect(pickMystery('2026-11-23', new Set([data.players[a].q]))).not.toBe(a);
    expect(mysteryNumber('2026-11-23')).toBe(1);
    expect(playerIndex(data.players[a].q)).toBe(a);
    expect(reveal(a).clubs.length).toBeGreaterThan(0);
  });
});
