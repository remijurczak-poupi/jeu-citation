import { describe, expect, it } from 'vitest';
import { boundedDistance, compact, surnameKeys } from '../worker/normalize';
import { clubIndex, data, getMatcher, matchGuess, scopeSize } from '../worker/data';
import { drawDailyCriterion } from '../worker/daily';
import { rarityTiers } from '../worker/rarity';
import type { Criterion } from '../shared/types';

const q = (name: string) => data.clubs.find((c) => c.n === name)!.q;
const guess = (c: Criterion, text: string, cited: string[] = []) => {
  const m = getMatcher(c);
  const ids = new Set(cited.map((t) => { const r = matchGuess(m, t, new Set()); return r.status === 'ok' ? r.player : -1; }));
  const r = matchGuess(m, text, ids);
  return { status: r.status, name: 'player' in r && r.player !== undefined ? data.players[r.player].n : undefined };
};

describe('normalize', () => {
  it('strips accents, case and punctuation', () => {
    expect(compact('Mesut Özil')).toBe('mesutozil');
    expect(compact("N'Golo Kanté")).toBe('ngolokante');
    expect(compact('Ødegaard')).toBe('odegaard');
  });
  it('derives surnames with particles', () => {
    expect(surnameKeys('Robin van Persie')).toEqual(expect.arrayContaining(['persie', 'vanpersie']));
    expect(surnameKeys('Kevin De Bruyne')).toEqual(expect.arrayContaining(['bruyne', 'debruyne']));
  });
  it('bounded distance', () => {
    expect(boundedDistance('zidane', 'zidnae', 1)).toBe(1);
    expect(boundedDistance('henry', 'hanry', 1)).toBe(1);
    expect(boundedDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
});

describe('themes', () => {
  it('Arsenal all-time contains Thierry Henry', () => {
    expect(guess({ club: q('Arsenal F.C.') }, 'Thierry Henry')).toMatchObject({ status: 'ok', name: 'Thierry Henry' });
  });
  it('accepts surname only and typos', () => {
    expect(guess({ club: q('Arsenal F.C.') }, 'henry').status).toBe('ok');
    expect(guess({ club: q('Arsenal F.C.') }, 'Tierry Henri').status).toBe('ok');
    expect(guess({ club: q('Arsenal F.C.') }, 'bergkamp').status).toBe('ok');
    expect(guess({ league: 'PL' }, 'gerard')).toMatchObject({ status: 'ok', name: 'Steven Gerrard' });
    expect(guess({ league: 'PL' }, 'Drogbaa').status).toBe('ok');
  });
  it('flags duplicates', () => {
    expect(guess({ club: q('Arsenal F.C.') }, 'Henry', ['Thierry Henry']).status).toBe('duplicate');
  });
  it('recognises a real player outside the theme', () => {
    const r = guess({ club: q('Arsenal F.C.') }, 'Zlatan Ibrahimović');
    expect(r.status).toBe('wrong');
    expect(r.name).toContain('Zlatan');
  });
  it('league membership is per season: Lille players of the 2000s count for Ligue 1', () => {
    expect(guess({ league: 'L1', from: 2008, to: 2010 }, 'Eden Hazard').status).toBe('ok');
    expect(guess({ league: 'PL', from: 2008, to: 2010 }, 'Eden Hazard').status).toBe('wrong');
  });
  it('Premier League 2007-08 has a sensible size', () => {
    const n = scopeSize({ league: 'PL', from: 2007, to: 2007 });
    expect(n).toBeGreaterThan(350);
    expect(n).toBeLessThan(900);
  });
  it('homonyms: a shared surname asks which one, then gives the one left', () => {
    const c = { club: q('Manchester United F.C.') };
    expect(guess(c, 'Neville').status).toBe('ambiguous');
    const second = guess(c, 'Neville', ['Gary Neville']);
    expect(second).toEqual({ status: 'ok', name: 'Phil Neville' });
  });
  it('club index lookups work', () => {
    expect(clubIndex(q('Paris Saint-Germain FC'))).toBeTypeOf('number');
  });
});

describe('daily', () => {
  it('is deterministic and alternates difficulty', () => {
    const a = drawDailyCriterion('2026-11-19');
    expect(drawDailyCriterion('2026-11-19')).toEqual(a);
    expect(a.difficulty).toBe('easy');
    expect(drawDailyCriterion('2026-11-20').difficulty).toBe('hard');
    for (let d = 20; d < 30; d++) expect(scopeSize(drawDailyCriterion(`2026-11-${d}`).criterion)).toBeGreaterThanOrEqual(40);
  });
});

describe('rarity', () => {
  it('gives more points to rarely cited players', () => {
    const games = Array.from({ length: 40 }, (_, i) => (i === 0 ? ['A', 'RARE'] : ['A', 'B']));
    games[1].push('MID'); games[2].push('MID'); games[3].push('MID');
    const t = rarityTiers(games);
    expect(t.get('A')).toBe(1);
    expect(t.get('RARE')).toBe(3);
    expect(t.get('MID')).toBe(2);
  });
});

describe('extra filters', () => {
  const has = (c: Criterion, name: string) => guess(c, name).status === 'ok';
  it('position and nationality', () => {
    expect(has({ league: 'PL', position: 'GK' }, 'Petr Čech')).toBe(true);
    expect(has({ league: 'PL', position: 'GK' }, 'Thierry Henry')).toBe(false);
    expect(has({ league: 'PL', nationality: 'FR' }, 'Thierry Henry')).toBe(true);
    expect(has({ league: 'PL', nationality: 'GB-ENG' }, 'Steven Gerrard')).toBe(true);
  });
  it('international and two clubs', () => {
    expect(has({ club: q('Arsenal F.C.'), international: true }, 'Thierry Henry')).toBe(true);
    expect(has({ club: q('Arsenal F.C.'), club2: q('FC Barcelona') }, 'Thierry Henry')).toBe(true);
    expect(has({ club: q('Arsenal F.C.'), club2: q('FC Barcelona') }, 'Dennis Bergkamp')).toBe(false);
  });
  it('tournaments alone are not limited to the big leagues', () => {
    expect(has({ tournament: 'WC2010' }, 'Diego Forlán')).toBe(true);
    expect(has({ tournament: 'WC2018', tournamentWon: true }, 'Kylian Mbappé')).toBe(true);
    expect(has({ tournament: 'WC2018', tournamentWon: true }, 'Luka Modrić')).toBe(false);
  });
  it('trophies', () => {
    expect(has({ club: q('Liverpool F.C.'), ucl: 'won' }, 'Steven Gerrard')).toBe(true);
    expect(has({ league: 'PL', champion: true }, 'Steven Gerrard')).toBe(false);
    expect(has({ league: 'PL', champion: true }, 'Frank Lampard')).toBe(true);
    expect(has({ ballonDor: true }, 'Lionel Messi')).toBe(true);
  });
});
