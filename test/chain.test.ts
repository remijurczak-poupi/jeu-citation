import { describe, expect, it } from 'vitest';
import { data, matchGuess } from '../worker/data';
import { chainMatcher, chainStart, teammates } from '../worker/chain';
import { applyGuess, newGame, toState } from '../worker/solo';

const byName = (n: string) => data.players.findIndex((p) => p.n === n);

describe('chain of teammates', () => {
  const henry = byName('Thierry Henry');
  it('finds teammates with the club and shared seasons', () => {
    const tm = teammates(henry);
    const l = tm.get(byName('Dennis Bergkamp'));
    expect(l && data.clubs[l.club].n).toBe('Arsenal F.C.');
    expect(tm.has(byName('Lionel Messi'))).toBe(true); // Barcelona 2007-2010
    expect(tm.has(byName('Cristiano Ronaldo'))).toBe(false);
  });
  it('accepts only teammates of the last player', () => {
    const m = chainMatcher(henry, {});
    expect(matchGuess(m, 'Pires', new Set()).status).toBe('ok');
    const r = matchGuess(m, 'Cristiano Ronaldo', new Set());
    expect(r.status).toBe('wrong');
  });
  it('starts from a well-known player of the theme', () => {
    const p = chainStart({ league: 'PL' }, () => 0.3);
    expect(p).not.toBeNull();
    expect(chainMatcher(p!, { league: 'PL' }).scope.players.size).toBeGreaterThanOrEqual(15);
  });
  it('plays a solo chain', () => {
    const g = newGame('g1', 'd1', 'chain', {}, 1000);
    g.found = JSON.stringify([data.players[henry].q]);
    expect(applyGuess(g, 'Bergkamp', 2000).outcome.status).toBe('ok');
    expect(applyGuess(g, 'Henry', 3000).outcome.status).toBe('duplicate'); // Bergkamp → Henry is already in the chain
    expect(applyGuess(g, 'Overmars', 4000).outcome.status).toBe('ok');
    const s = toState(g, 5000);
    expect(s.count).toBe(2);
    expect(s.chain!.map((l) => l.name)).toEqual(['Thierry Henry', 'Dennis Bergkamp', 'Marc Overmars']);
    expect(s.chain![1].club).toBe('Arsenal F.C.');
    expect(g.deadline).toBe(4000 + 30_000);
  });
});
