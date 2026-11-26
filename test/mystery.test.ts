import { describe, expect, it } from 'vitest';
import { answer, hintOf, initialOf, mysteryNumber, normQ, pickMystery, reveal, sameQuestion } from '../worker/mystery';
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
    expect(answer(mbappe, { k: 'initial', v: 'M' } as never)).toBeUndefined(); // initials are hints only
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

describe('more mystery questions', () => {
  const messi = idx('Lionel Messi');
  const q = (n: string) => data.players[idx(n)].q;
  it('answers the extra questions', () => {
    expect(answer(messi, { k: 'teammate', v: q('Neymar') })).toBe(true);
    expect(answer(messi, { k: 'teammate', v: q('Kylian Mbappé') })).toBe(true);
    expect(answer(messi, { k: 'teammate', v: q('Lionel Messi') })).toBe(false);
    expect(answer(messi, { k: 'teammate', v: 'Q0' })).toBeUndefined();
    expect(answer(messi, { k: 'home' })).toBe(false);
    expect(answer(messi, { k: 'abroad' })).toBe(true);
    expect(answer(idx('Kylian Mbappé'), { k: 'home' })).toBe(true);
    expect(answer(messi, { k: 'citizen', v: 'ES' })).toBe(true);
    expect(answer(messi, { k: 'multiPos' })).toBe(true);
    expect(answer(idx('Neymar'), { k: 'mononym' })).toBe(true);
    expect(answer(messi, { k: 'mononym' })).toBe(false);
    expect(answer(idx('Cristiano Ronaldo'), { k: 'returned' })).toBe(true);
    expect(answer(messi, { k: 'returned' })).toBe(false);
    expect(answer(idx('Olivier Giroud'), { k: 'lowerDiv', v: 'L1' })).toBe(true);
    expect(answer(messi, { k: 'lowerDiv' })).toBe(false);
    expect(answer(messi, { k: 'anyTournament', won: true })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'copas', op: 'gt', v: 5 })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'loyalty', op: 'gt', v: 15 })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'uclWins', op: 'eq', v: 4 })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'countries', op: 'eq', v: 2 })).toBe(true);
    expect(answer(messi, { k: 'num', f: 'lastSeason', op: 'eq', v: 2022 })).toBe(true);
  });
});

describe('mystery extras and hints', () => {
  const messi = idx('Lionel Messi');
  const ronaldo = idx('Cristiano Ronaldo');
  it('uses the whole career, birthplace and youth clubs', () => {
    expect(answer(messi, { k: 'playedCountry', v: 'US' })).toBe(true);
    expect(answer(messi, { k: 'nowCountry', v: 'US' })).toBe(true);
    expect(answer(messi, { k: 'playedContinent', v: 'NA' })).toBe(true);
    expect(answer(messi, { k: 'bornCountry', v: 'AR' })).toBe(true);
    expect(answer(messi, { k: 'bornHome' })).toBe(true);
    expect(answer(messi, { k: 'youthCountry', v: 'AR' })).toBe(true);
    expect(answer(messi, { k: 'youthHome' })).toBe(true);
    expect(answer(ronaldo, { k: 'playedCountry', v: 'SA' })).toBe(true);
    expect(answer(ronaldo, { k: 'playedCountry', v: 'PT' })).toBe(true);
    expect(answer(ronaldo, { k: 'num', f: 'allCountries', op: 'eq', v: 5 })).toBe(true);
    expect(answer(idx('Kylian Mbappé'), { k: 'playedCountry', v: 'FR' })).toBe(true); // Monaco counts as France
  });
  it('gives hints', () => {
    expect(hintOf(messi, 'last', '2026-11-23')).toEqual({ v: 'M' });
    expect(hintOf(messi, 'first', '2026-11-23')).toEqual({ v: 'L' });
    expect(hintOf(idx('Neymar'), 'first', '2026-11-23')).toEqual({ v: '', n: '' });
    expect(hintOf(messi, 'club1', '2026-11-23')?.n).toBe('FC Barcelona');
    expect(hintOf(messi, 'club3', '2026-11-23')?.v).toBeTruthy();
  });
});
