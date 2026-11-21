import { describe, expect, it } from 'vitest';
import { data, getMatcher, matchGuess, matchPick, normalizeCriterion, playerIndex, suggest } from '../worker/data';
import { applyGuess, newGame } from '../worker/solo';

const name = (p: number) => data.players[p].n;

describe('suggestions and homonyms', () => {
  it('suggests from the whole base after 3 letters, most famous first', () => {
    expect(suggest('fo')).toEqual([]);
    const s = suggest('fofa').map(name);
    expect(s).toContain('Youssouf Fofana');
    expect(s).toContain('Wesley Fofana');
    expect(suggest('zidan').map(name)[0]).toBe('Zinedine Zidane');
  });
  it('asks which one when a surname is shared by players of similar fame', () => {
    const m = getMatcher(normalizeCriterion({ league: 'L1' }));
    const r = matchGuess(m, 'Fofana', new Set());
    expect(r.status).toBe('ambiguous');
    // A clear favourite is still credited directly.
    expect(matchGuess(getMatcher(normalizeCriterion({ league: 'PL' })), 'Henry', new Set()).status).toBe('ok');
  });
  it('accepts an exact pick, refuses it outside the theme', () => {
    const m = getMatcher(normalizeCriterion({ league: 'L1' }));
    const seko = playerIndex(data.players.find((p) => p.n === 'Seko Fofana')!.q)!;
    expect(matchPick(m, seko, new Set()).status).toBe('ok');
    expect(matchPick(m, seko, new Set([seko])).status).toBe('duplicate');
    const kane = playerIndex(data.players.find((p) => p.n === 'Harry Kane')!.q)!;
    expect(matchPick(m, kane, new Set()).status).toBe('wrong');
  });
  it('an ambiguous answer costs nothing, even in hardcore', () => {
    const g = newGame('g', 'd', 'hardcore', { league: 'L1' }, 0);
    const r = applyGuess(g, 'Fofana', 1000);
    expect(r.outcome.status).toBe('ambiguous');
    expect(g.status).toBe('active');
    expect(g.errors).toBe(0);
    const pick = r.outcome.status === 'ambiguous' ? r.outcome.options.find((o) => o.n === 'Seko Fofana')!.q : '';
    expect(applyGuess(g, 'Seko Fofana', 2000, pick).outcome.status).toBe('ok');
  });
});

describe('words in any order', () => {
  const names = (q: string) => suggest(q).map((p) => data.players[p].n);
  it('finds Benjamin André from his surname first', () => {
    expect(names('andre benj')).toContain('Benjamin André');
    expect(names('André Benjamin')).toContain('Benjamin André');
    expect(names('benjamin andre')).toContain('Benjamin André');
  });
  it('accepts a typed answer in reverse order', () => {
    expect(matchGuess(getMatcher({ league: 'L1' }), 'André Benjamin', new Set())).toMatchObject({ status: 'ok' });
  });
});
