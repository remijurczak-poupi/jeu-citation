import { fanClub, fanClubName } from './clubs';
import type { Criterion, Meta } from '../shared/types';
import type { Lang, T } from './i18n';

export const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

export function clubName(meta: Meta | null, q: string, lang: Lang, t?: T): string {
  if (q === 'other') return t?.otherClub ?? '—';
  const fan = fanClub(q);
  if (fan) return fanClubName(fan, lang);
  const c = meta?.clubs.find((x) => x.q === q);
  if (!c) return q;
  return (lang === 'fr' && c.nf) || c.n;
}

export const leagueName = (l: { id: string; name: Partial<Record<Lang, string>> & { en: string } }, lang: Lang) => l.name[lang] ?? l.name.en;

/** Human label for a theme: "Arsenal · Premier League · 2007-08 · Forwards · 🇫🇷". */
export function themeLabel(c: Criterion, meta: Meta | null, lang: Lang, t: T): string {
  const parts: string[] = [];
  if (c.club) parts.push(clubName(meta, c.club, lang));
  if (c.club2) parts.push(`+ ${clubName(meta, c.club2, lang)}`);
  if (c.league) { const l = meta?.leagues.find((x) => x.id === c.league); parts.push(l ? leagueName(l, lang) : c.league); }
  if (c.tournament) {
    const code = c.tournament.slice(0, 2);
    parts.push(`${c.tournamentWon ? t.f.winnersOf + ' ' : ''}${t.f.tournaments[code] ?? code}${c.tournament.length > 2 ? ' ' + c.tournament.slice(2) : ''}`);
  }
  if (!c.club && !c.league && !c.tournament) parts.push(t.allLeagues);
  if (c.tournament && !c.club && !c.league && c.from === undefined && c.to === undefined) return [...parts, ...extraLabels(c, lang, t)].join(' · ');
  const first = meta?.firstSeason ?? 2000;
  const cur = meta?.currentSeason ?? 2026;
  const from = c.from ?? first;
  const to = c.to ?? cur;
  if (from === to) parts.push(seasonLabel(from));
  else if (from !== first || to !== cur) parts.push(`${seasonLabel(from)} → ${seasonLabel(to)}`);
  else parts.push(t.since(seasonLabel(first)));
  return [...parts, ...extraLabels(c, lang, t)].join(' · ');
}

function extraLabels(c: Criterion, lang: Lang, t: T): string[] {
  const out: string[] = [];
  if (c.position) out.push(t.f.positionsPlural[c.position]);
  if (c.nationality) out.push(`${flag(c.nationality)} ${countryName(c.nationality, lang)}`);
  if (c.international === true) out.push(t.f.internationals);
  if (c.international === false) out.push(t.f.neverCapped);
  if (c.active === true) out.push(t.f.stillPlaying);
  if (c.active === false) out.push(t.f.retired);
  if (c.ageMin !== undefined || c.ageMax !== undefined) out.push(`${t.f.age} ${c.ageMin ?? ''}–${c.ageMax ?? ''}`);
  if (c.heightMin !== undefined || c.heightMax !== undefined) out.push(`${c.heightMin ?? ''}–${c.heightMax ?? ''} cm`);
  if (c.ucl === 'played') out.push(t.f.uclPlayed);
  if (c.ucl === 'won') out.push(t.f.uclWon);
  if (c.champion) out.push(t.f.champion);
  if (c.topScorer) out.push(t.f.topScorer);
  if (c.ballonDor) out.push(t.f.ballonDor);
  return out;
}

const SUBDIVISION_FLAGS: Record<string, string> = {
  'GB-ENG': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'GB-SCT': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  'GB-WLS': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
  'GB-NIR': '🇬🇧',
};
export const flag = (cc: string) =>
  SUBDIVISION_FLAGS[cc] ?? (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🏳️');

const HOME_NATIONS: Record<string, Record<Lang, string>> = {
  'GB-ENG': { en: 'England', fr: 'Angleterre', de: 'England', es: 'Inglaterra', it: 'Inghilterra', pt: 'Inglaterra' },
  'GB-SCT': { en: 'Scotland', fr: 'Écosse', de: 'Schottland', es: 'Escocia', it: 'Scozia', pt: 'Escócia' },
  'GB-WLS': { en: 'Wales', fr: 'Pays de Galles', de: 'Wales', es: 'Gales', it: 'Galles', pt: 'País de Gales' },
  'GB-NIR': { en: 'Northern Ireland', fr: 'Irlande du Nord', de: 'Nordirland', es: 'Irlanda del Norte', it: 'Irlanda del Nord', pt: 'Irlanda do Norte' },
};
export function countryName(cc: string, lang: Lang) {
  if (HOME_NATIONS[cc]) return HOME_NATIONS[cc][lang];
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}

export const COUNTRIES = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR', ...(
  'AF AL DZ AD AO AR AM AU AT AZ BH BD BY BE BJ BO BA BW BR BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DO EC EG SV ' +
  'GQ ER EE ET FJ FI FR GA GM GE DE GH GR GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KR KW KG LA LV LB LS LR LY LI LT LU ' +
  'MG MW MY MV ML MT MR MU MX MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG MK NO OM PK PS PA PY PE PH PL PT PR QA RO RU RW SA SN RS SL SG SK SI ' +
  'SO ZA ES LK SD SR SE CH SY TW TJ TZ TH TG TT TN TR TM UG UA AE GB US UY UZ VE VN YE ZM ZW'
).split(' ')];

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
