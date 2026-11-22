import { describe, expect, it } from 'vitest';
import { parseInfobox } from '../worker/verify';

describe('Wikipedia infobox career', () => {
  it('reads senior clubs and years, loans included', () => {
    const t = `{{Infobox football biography
| youthyears1 = 2010–2020 | youthclubs1 = [[FC Nantes]]
| years1 = 2020–2024
| clubs1 = [[FC Nantes|Nantes]]
| years2 = 2024–
| clubs2 = [[Olympique de Marseille|Marseille]]
| years3 = 2025
| clubs3 = → [[Stade Rennais F.C.|Rennes]] (loan)
| nationalyears1 = 2023–
}}`;
    expect(parseInfobox(t)).toEqual([
      { title: 'FC Nantes', from: 2020, to: 2024 },
      { title: 'Olympique de Marseille', from: 2024, to: null },
      { title: 'Stade Rennais F.C.', from: 2025, to: 2025 },
    ]);
  });
});

import { afterEach, vi } from 'vitest';
import { verifyReport } from '../worker/verify';
import { data, playerIndex } from '../worker/data';

describe('automatic report check', () => {
  afterEach(() => vi.unstubAllGlobals());
  // Made-up Wikipedia/Wikidata answers (not the real career): Nantes 2020–2024 then Marseille from 2024.
  const stub = () => vi.stubGlobal('fetch', async (url: string) => {
    const u = decodeURIComponent(String(url));
    const body = u.includes('wbgetentities') ? { entities: { Q105426428: { sitelinks: { enwiki: { title: 'Quentin Merlin' } } } } }
      : u.includes('action=parse') ? { parse: { wikitext: '| years1 = 2020–2024\n| clubs1 = [[FC Nantes]]\n| years2 = 2024–\n| clubs2 = [[Olympique de Marseille|Marseille]]\n' } }
      : { query: { pages: [{ title: 'FC Nantes', pageprops: { wikibase_item: 'Q192071' } }, { title: 'Olympique de Marseille', pageprops: { wikibase_item: 'Q132885' } }] } };
    return new Response(JSON.stringify(body));
  });
  const merlin = playerIndex('Q105426428')!;
  const om = data.clubs.find((c) => c.n.includes('Marseille') && c.l.L1)!.q;
  it('accepts a transfer Wikidata misses', async () => {
    stub();
    expect((await verifyReport(merlin, { club: om, from: 2000 })).verdict).toBe('accept');
    expect((await verifyReport(merlin, { league: 'L1', from: 2025 })).verdict).toBe('accept');
  });
  it('rejects when Wikipedia shows no matching club or season', async () => {
    stub();
    expect((await verifyReport(merlin, { club: om, to: 2015 })).verdict).toBe('reject');
    expect((await verifyReport(merlin, { league: 'PL' })).verdict).toBe('reject');
  });
});
