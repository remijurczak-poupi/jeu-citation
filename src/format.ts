import type { Criterion, Meta } from '../shared/types';
import type { Lang, T } from './i18n';

export const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

export function clubName(meta: Meta | null, q: string, lang: Lang, t?: T): string {
  if (q === 'other') return t?.otherClub ?? '—';
  const c = meta?.clubs.find((x) => x.q === q);
  if (!c) return q;
  return (lang === 'fr' && c.nf) || c.n;
}

/** Human label for a theme: "Arsenal · Premier League · 2007-08". */
export function themeLabel(c: Criterion, meta: Meta | null, lang: Lang, t: T): string {
  const parts: string[] = [];
  if (c.club) parts.push(clubName(meta, c.club, lang));
  if (c.league) parts.push(meta?.leagues.find((l) => l.id === c.league)?.name[lang] ?? c.league);
  if (!c.club && !c.league) parts.push(t.allLeagues);
  const first = meta?.firstSeason ?? 2000;
  const cur = meta?.currentSeason ?? 2026;
  const from = c.from ?? first;
  const to = c.to ?? cur;
  if (from === to) parts.push(seasonLabel(from));
  else if (from !== first || to !== cur) parts.push(`${seasonLabel(from)} → ${seasonLabel(to)}`);
  else parts.push(lang === 'fr' ? `depuis ${seasonLabel(first)}` : `since ${seasonLabel(first)}`);
  return parts.join(' · ');
}

export const flag = (cc: string) =>
  cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🏳️';

export function countryName(cc: string, lang: Lang) {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}

export const COUNTRIES = (
  'AF AL DZ AD AO AR AM AU AT AZ BH BD BY BE BJ BO BA BW BR BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DO EC EG SV ' +
  'GQ ER EE ET FJ FI FR GA GM GE DE GH GR GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KR KW KG LA LV LB LS LR LY LI LT LU ' +
  'MG MW MY MV ML MT MR MU MX MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG MK NO OM PK PS PA PY PE PH PL PT PR QA RO RU RW SA SN RS SL SG SK SI ' +
  'SO ZA ES LK SD SR SE CH SY TW TJ TZ TH TG TT TN TR TM UG UA AE GB US UY UZ VE VN YE ZM ZW'
).split(' ');

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
