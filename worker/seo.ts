// Pages for search engines: server-rendered HTML for every club, club pair, league and season quiz,
// in every site language, plus robots.txt and sitemaps.
//
// Each page is the normal app (the SPA still loads and runs) with real content added below it:
// title, description, canonical URL, hreflang alternates, structured data, a heading, facts about
// the quiz and links to related quizzes. The "Play" button opens the solo setup with the theme preset.
import { data, computeScope } from './data';
import { SEO_LANGS, SEO_TEXT, OG_LOCALE, type SeoLang, type SeoText } from './seo-text';
import type { Criterion, LeagueId } from '../shared/types';

/** Brand shown in titles. The name is not final: change it here. */
export const BRAND = 'Name the Players';

/** Minimum players for a club page / club pair page to exist (fewer = thin page, not worth indexing). */
export const MIN_CLUB_PLAYERS = 30;
export const MIN_PAIR_PLAYERS = 10;

// ---------- names and slugs ----------

export function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Names as people type them in a search engine. */
const SHORT_NAMES: Record<string, string> = {
  'Real Madrid Club de Fútbol': 'Real Madrid',
  'Cádiz Club de Fútbol': 'Cádiz',
  'Montpellier Hérault Sport Club': 'Montpellier',
  'Sociedad Deportiva Huesca': 'Huesca',
  'Unión Deportiva Almería': 'Almería',
  'Club Deportivo Numancia de Soria': 'Numancia',
  'RCD Espanyol de Barcelona': 'Espanyol',
  'Club Atlético Osasuna': 'Osasuna',
  'Real Betis Balompié': 'Real Betis',
  'Albacete Balompié': 'Albacete',
  'Deportivo de A Coruña': 'Deportivo La Coruña',
  'En Avant de Guingamp': 'Guingamp',
  'Ars et Labor Ferrara Calcio': 'SPAL',
  'FC Bayern Munich': 'Bayern Munich',
  'Paris Saint-Germain FC': 'Paris Saint-Germain',
  'RC Strasbourg Alsace': 'Strasbourg',
  'Evian Thonon Gaillard F.C.': 'Evian TG',
};
export function shortClubName(n: string): string {
  if (SHORT_NAMES[n]) return SHORT_NAMES[n];
  const out = n.replace(/^(F\.C\.|FC|A\.F\.C\.|AFC|CF)\s+/, '').replace(/\s+(F\.C\.|FC|A\.F\.C\.|AFC|CF|C\.F\.)$/, '').trim();
  return out || n;
}

export const LEAGUE_SLUGS: Record<LeagueId, string> = { PL: 'premier-league', L1: 'ligue-1', LL: 'la-liga', SA: 'serie-a', BL: 'bundesliga' } as Record<LeagueId, string>;
const leagueBySlug = new Map(Object.entries(LEAGUE_SLUGS).map(([id, slug]) => [slug, id as LeagueId]));
const leagueName = (id: LeagueId, lang: SeoLang) => {
  const l = data.leagues.find((x) => x.id === id)!;
  return (l.name as Partial<Record<SeoLang, string>>)[lang] ?? l.name.en;
};
export const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

// ---------- indexes (built once per Worker instance, on first use) ----------

interface Indexes {
  slugOf: string[];
  nameOf: string[];
  bySlug: Map<string, number>;
  clubCount: number[]; // players in the club quiz
  pairs: Map<number, { other: number; n: number }[]>; // per club, pairs with enough players, most first
  pairCount: Map<string, number>; // "a:b" with a's slug < b's slug
  seasonsOf: Record<string, number[]>; // league -> seasons
}
let idx: Indexes | null = null;
function indexes(): Indexes {
  if (idx) return idx;
  const nameOf = data.clubs.map((c) => shortClubName(c.n));
  const slugOf: string[] = [];
  const bySlug = new Map<string, number>();
  nameOf.forEach((n, i) => {
    let s = slugify(n);
    if (bySlug.has(s)) s = `${s}-${data.clubs[i].q.toLowerCase()}`;
    slugOf.push(s);
    bySlug.set(s, i);
  });

  // Same rules as computeScope for { club } and { club, club2 } themes without any other filter:
  // the club stint must overlap the data period (or be undated), the second club can be any time.
  const first = data.firstSeason;
  const last = data.currentSeason;
  const inScope: Set<number>[] = data.players.map(() => new Set());
  const all: Set<number>[] = data.players.map(() => new Set());
  for (const [p, club, s, e] of data.stints) {
    all[p].add(club);
    if (s === -1 || (e >= first && s <= last)) inScope[p].add(club);
  }
  const clubCount = data.clubs.map(() => 0);
  const pairCount = new Map<string, number>();
  data.players.forEach((_, p) => {
    for (const a of inScope[p]) {
      clubCount[a]++;
      for (const b of all[p]) {
        if (b === a || slugOf[a] > slugOf[b]) continue;
        const k = `${a}:${b}`;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  });
  const pairs = new Map<number, { other: number; n: number }[]>();
  for (const [k, n] of pairCount) {
    if (n < MIN_PAIR_PLAYERS) continue;
    const [a, b] = k.split(':').map(Number);
    if (clubCount[a] < MIN_CLUB_PLAYERS || clubCount[b] < MIN_CLUB_PLAYERS) continue;
    (pairs.get(a) ?? pairs.set(a, []).get(a)!).push({ other: b, n });
    (pairs.get(b) ?? pairs.set(b, []).get(b)!).push({ other: a, n });
  }
  for (const list of pairs.values()) list.sort((x, y) => y.n - x.n || slugOf[x.other].localeCompare(slugOf[y.other]));

  const seasonsOf: Record<string, number[]> = {};
  for (const l of data.leagues) {
    const ys = new Set<number>();
    for (const c of data.clubs) for (const y of c.l[l.id] ?? []) if (y >= first && y <= last) ys.add(y);
    seasonsOf[l.id] = [...ys].sort((a, b) => a - b);
  }
  idx = { slugOf, nameOf, bySlug, clubCount, pairs, pairCount, seasonsOf };
  return idx;
}
const hasClubPage = (c: number) => indexes().clubCount[c] >= MIN_CLUB_PLAYERS;
function pairOrder(a: number, b: number): [number, number] {
  const { slugOf } = indexes();
  return slugOf[a] < slugOf[b] ? [a, b] : [b, a];
}
function hasPairPage(a: number, b: number) {
  const [x, y] = pairOrder(a, b);
  return hasClubPage(x) && hasClubPage(y) && (indexes().pairCount.get(`${x}:${y}`) ?? 0) >= MIN_PAIR_PLAYERS;
}

// ---------- pages and URLs ----------

export type Page =
  | { kind: 'home' }
  | { kind: 'hub' }
  | { kind: 'club'; club: number }
  | { kind: 'pair'; a: number; b: number } // a's slug < b's slug
  | { kind: 'league'; league: LeagueId }
  | { kind: 'season'; league: LeagueId; season: number };

/** Path of a page, without the language prefix. */
export function pagePath(page: Page): string {
  const { slugOf } = indexes();
  switch (page.kind) {
    case 'home': return '/';
    case 'hub': return '/quiz';
    case 'club': return `/quiz/${slugOf[page.club]}`;
    case 'pair': return `/quiz/${slugOf[page.a]}/${slugOf[page.b]}`;
    case 'league': return `/league/${LEAGUE_SLUGS[page.league]}`;
    case 'season': return `/league/${LEAGUE_SLUGS[page.league]}/${seasonLabel(page.season)}`;
  }
}
/** English has no prefix (x-default), other languages live under /fr/, /de/… */
export function localizedPath(lang: SeoLang, path: string): string {
  if (lang === 'en') return path;
  return path === '/' ? `/${lang}/` : `/${lang}${path}`;
}

export type Route = { lang: SeoLang; page: Page } | { redirect: string } | { notFound: SeoLang } | null;

/** Maps a URL path to a page. null = not an SEO path (let the assets handle it). */
export function route(pathname: string): Route {
  let path = pathname;
  let lang: SeoLang = 'en';
  const m = path.match(/^\/(fr|de|es|it|pt)(\/.*)?$/);
  if (m) {
    lang = m[1] as SeoLang;
    if (m[2] === undefined) return { redirect: `/${lang}/` };
    path = m[2];
  }
  if (path === '/') return { lang, page: { kind: 'home' } };
  if (path.length > 1 && path.endsWith('/')) return { redirect: localizedPath(lang, path.replace(/\/+$/, '')) };
  const parts = path.split('/').filter(Boolean);
  const { bySlug } = indexes();
  if (parts[0] === 'quiz') {
    if (parts.length === 1) return { lang, page: { kind: 'hub' } };
    const a = bySlug.get(parts[1]);
    if (parts.length === 2 && a !== undefined && hasClubPage(a)) return { lang, page: { kind: 'club', club: a } };
    const b = parts[2] !== undefined ? bySlug.get(parts[2]) : undefined;
    if (parts.length === 3 && a !== undefined && b !== undefined && a !== b && hasPairPage(a, b)) {
      const [x, y] = pairOrder(a, b);
      const page: Page = { kind: 'pair', a: x, b: y };
      return x === a ? { lang, page } : { redirect: localizedPath(lang, pagePath(page)) };
    }
    return { notFound: lang };
  }
  if (parts[0] === 'league') {
    const league = leagueBySlug.get(parts[1] ?? '');
    if (league && parts.length === 2) return { lang, page: { kind: 'league', league } };
    const season = parts[2]?.match(/^(\d{4})-\d{2}$/);
    if (league && parts.length === 3 && season && parts[2] === seasonLabel(+season[1]) && indexes().seasonsOf[league].includes(+season[1])) {
      return { lang, page: { kind: 'season', league, season: +season[1] } };
    }
    return { notFound: lang };
  }
  // Language root with an unknown sub-path (e.g. /fr/xyz): the app, in that language, not indexed.
  return m ? { notFound: lang } : null;
}

/** Theme played when clicking "Play" on the page. */
export function criterionOf(page: Page): Criterion | null {
  const q = (i: number) => data.clubs[i].q;
  switch (page.kind) {
    case 'club': return { club: q(page.club) };
    case 'pair': return { club: q(page.a), club2: q(page.b) };
    case 'league': return { league: page.league };
    case 'season': return { league: page.league, from: page.season, to: page.season };
    default: return null;
  }
}

// ---------- facts ----------

interface Facts { count: number; nationalities: number; top: [string, number][]; internationalsPct: number }
const factsCache = new Map<string, Facts>();
function factsOf(c: Criterion): Facts {
  const key = JSON.stringify(c);
  const hit = factsCache.get(key);
  if (hit) return hit;
  const players = computeScope(c).players;
  const nat = new Map<string, number>();
  let caps = 0;
  for (const p of players) {
    const pl = data.players[p];
    const cc = pl.c?.[0];
    if (cc) nat.set(cc, (nat.get(cc) ?? 0) + 1);
    if (pl.i) caps++;
  }
  const f: Facts = {
    count: players.size,
    nationalities: nat.size,
    top: [...nat].sort((a, b) => b[1] - a[1]).slice(0, 3),
    internationalsPct: players.size ? Math.round((caps / players.size) * 100) : 0,
  };
  if (factsCache.size > 400) factsCache.delete(factsCache.keys().next().value!);
  factsCache.set(key, f);
  return f;
}

const HOME_NATIONS: Record<string, string> = { 'GB-ENG': 'GB', 'GB-SCT': 'GB', 'GB-WLS': 'GB', 'GB-NIR': 'GB' };
const HOME_NATION_NAMES: Record<string, Record<SeoLang, string>> = {
  'GB-ENG': { en: 'England', fr: 'Angleterre', de: 'England', es: 'Inglaterra', it: 'Inghilterra', pt: 'Inglaterra' },
  'GB-SCT': { en: 'Scotland', fr: 'Écosse', de: 'Schottland', es: 'Escocia', it: 'Scozia', pt: 'Escócia' },
  'GB-WLS': { en: 'Wales', fr: 'Pays de Galles', de: 'Wales', es: 'Gales', it: 'Galles', pt: 'País de Gales' },
  'GB-NIR': { en: 'Northern Ireland', fr: 'Irlande du Nord', de: 'Nordirland', es: 'Irlanda del Norte', it: 'Irlanda del Nord', pt: 'Irlanda do Norte' },
};
function countryName(cc: string, lang: SeoLang) {
  if (HOME_NATIONS[cc]) return HOME_NATION_NAMES[cc][lang];
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}

// ---------- HTML ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const fmt = (n: number, lang: SeoLang) => n.toLocaleString(lang === 'en' ? 'en-GB' : lang);

interface Built {
  title: string;
  description: string;
  h1: string;
  intro: string;
  facts: string[];
  sections: { title: string; links: { href: string; text: string }[] }[];
  how?: boolean;
  crumbs: { href: string; text: string }[];
}

function build(page: Page, lang: SeoLang): Built {
  const t: SeoText = SEO_TEXT[lang];
  const ix = indexes();
  const L = (p: Page) => localizedPath(lang, pagePath(p));
  const home = { href: L({ kind: 'home' }), text: t.home };
  const hub = { href: L({ kind: 'hub' }), text: t.quizzes };
  const clubLink = (c: number) => ({ href: L({ kind: 'club', club: c }), text: ix.nameOf[c] });
  const leagueLinks = () => data.leagues.map((l) => ({ href: L({ kind: 'league', league: l.id }), text: leagueName(l.id, lang) }));
  const natFacts = (f: Facts) => [
    t.nationalities(fmt(f.nationalities, lang)),
    t.internationals(f.internationalsPct),
    t.topNationalities(f.top.map(([cc, n]) => `${countryName(cc, lang)} (${n})`).join(', ')),
  ];
  const topFlight = (c: number) => new Set(Object.values(data.clubs[c].l).flat()).size;

  switch (page.kind) {
    case 'home': {
      const n = fmt(data.players.length, lang);
      const popular = data.clubs.map((_, i) => i).filter(hasClubPage).sort((a, b) => topFlight(b) - topFlight(a) || ix.clubCount[b] - ix.clubCount[a]).slice(0, 30);
      return {
        title: `${t.homeTitle} | ${BRAND}`, description: t.homeDesc(n), h1: t.homeH1, intro: t.homeIntro(n), facts: [],
        sections: [
          { title: t.leaguesTitle, links: leagueLinks() },
          { title: t.clubsTitle, links: [...popular.sort((a, b) => ix.nameOf[a].localeCompare(ix.nameOf[b])).map(clubLink), { href: hub.href, text: `${t.allClubs} →` }] },
        ],
        how: true, crumbs: [],
      };
    }
    case 'hub': {
      const sections = data.leagues.map((l) => ({
        title: leagueName(l.id, lang),
        links: data.clubs.map((_, i) => i)
          .filter((i) => hasClubPage(i) && mainLeague(i) === l.id)
          .sort((a, b) => ix.nameOf[a].localeCompare(ix.nameOf[b]))
          .map(clubLink),
      }));
      return { title: `${t.hubTitle} | ${BRAND}`, description: t.hubDesc, h1: t.hubH1, intro: t.hubDesc, facts: [], sections, how: true, crumbs: [home] };
    }
    case 'club': {
      const name = ix.nameOf[page.club];
      const f = factsOf(criterionOf(page)!);
      const n = fmt(f.count, lang);
      const pairs = (ix.pairs.get(page.club) ?? []).slice(0, 16);
      const leagues = Object.keys(data.clubs[page.club].l) as LeagueId[];
      return {
        title: `${t.clubTitle(name)} | ${BRAND}`, description: t.clubDesc(name, n), h1: t.clubH1(name), intro: t.clubIntro(name, n),
        facts: [t.toFind(n), t.topFlightSeasons(topFlight(page.club)), ...natFacts(f)],
        sections: [
          ...(pairs.length ? [{ title: t.alsoPlayedFor(name), links: pairs.map(({ other }) => { const [a, b] = pairOrder(page.club, other); return { href: L({ kind: 'pair', a, b }), text: ix.nameOf[other] }; }) }] : []),
          { title: t.leaguesTitle, links: leagues.map((id) => ({ href: L({ kind: 'league', league: id }), text: leagueName(id, lang) })) },
        ],
        crumbs: [home, hub],
      };
    }
    case 'pair': {
      const [a, b] = [ix.nameOf[page.a], ix.nameOf[page.b]];
      const f = factsOf(criterionOf(page)!);
      const n = fmt(f.count, lang);
      const more = (c: number, other: number) => (ix.pairs.get(c) ?? []).filter((p) => p.other !== other).slice(0, 8)
        .map(({ other: o }) => { const [x, y] = pairOrder(c, o); return { href: L({ kind: 'pair', a: x, b: y }), text: `${ix.nameOf[c]} + ${ix.nameOf[o]}` }; });
      return {
        title: `${t.pairTitle(a, b)} | ${BRAND}`, description: t.pairDesc(a, b, n), h1: t.pairH1(a, b), intro: t.pairIntro(a, b, n),
        facts: [t.toFind(n), ...natFacts(f)],
        sections: [
          { title: t.clubsTitle, links: [clubLink(page.a), clubLink(page.b)] },
          { title: t.alsoPlayedFor(a), links: more(page.a, page.b) },
          { title: t.alsoPlayedFor(b), links: more(page.b, page.a) },
        ].filter((s) => s.links.length),
        crumbs: [home, hub, clubLink(page.a)],
      };
    }
    case 'league': {
      const name = leagueName(page.league, lang);
      const f = factsOf(criterionOf(page)!);
      const n = fmt(f.count, lang);
      const seasons = ix.seasonsOf[page.league];
      return {
        title: `${t.leagueTitle(name)} | ${BRAND}`, description: t.leagueDesc(name, n), h1: t.leagueH1(name), intro: t.leagueDesc(name, n),
        facts: [t.toFind(n), ...natFacts(f)],
        sections: [
          { title: t.seasons, links: [...seasons].reverse().map((y) => ({ href: L({ kind: 'season', league: page.league, season: y }), text: seasonLabel(y) })) },
          { title: t.clubs, links: data.clubs.map((_, i) => i).filter((i) => hasClubPage(i) && data.clubs[i].l[page.league]).sort((x, y) => ix.nameOf[x].localeCompare(ix.nameOf[y])).map(clubLink) },
        ],
        crumbs: [home, { href: L({ kind: 'hub' }), text: t.quizzes }],
      };
    }
    case 'season': {
      const name = leagueName(page.league, lang);
      const s = seasonLabel(page.season);
      const f = factsOf(criterionOf(page)!);
      const n = fmt(f.count, lang);
      const clubs = data.clubs.map((_, i) => i).filter((i) => data.clubs[i].l[page.league]?.includes(page.season));
      const champ = clubs.find((i) => data.clubs[i].ch?.[page.league]?.includes(page.season));
      const seasons = ix.seasonsOf[page.league];
      const at = seasons.indexOf(page.season);
      const near = [seasons[at - 1], seasons[at + 1]].filter((y) => y !== undefined);
      return {
        title: `${t.seasonTitle(name, s)} | ${BRAND}`, description: t.seasonDesc(name, s, n), h1: t.seasonH1(name, s), intro: t.seasonDesc(name, s, n),
        facts: [t.toFind(n), ...(champ !== undefined ? [t.champion(ix.nameOf[champ])] : []), ...natFacts(f)],
        sections: [
          { title: t.clubs, links: clubs.filter(hasClubPage).sort((x, y) => ix.nameOf[x].localeCompare(ix.nameOf[y])).map(clubLink) },
          { title: t.seasons, links: near.map((y) => ({ href: L({ kind: 'season', league: page.league, season: y }), text: `${name} ${seasonLabel(y)}` })) },
        ],
        crumbs: [home, { href: L({ kind: 'league', league: page.league }), text: name }],
      };
    }
  }
}

/** League where a club spent the most seasons (to group clubs on the hub page). */
function mainLeague(c: number): LeagueId {
  const l = data.clubs[c].l;
  return (Object.keys(l) as LeagueId[]).sort((a, b) => l[b].length - l[a].length)[0];
}

export interface RenderOptions { origin: string; canonicalOrigin: string; noindex?: boolean }

/** The app's index.html with the page's head tags and content added. */
export function renderPage(template: string, lang: SeoLang, page: Page, opt: RenderOptions): string {
  const t = SEO_TEXT[lang];
  const b = build(page, lang);
  const path = pagePath(page);
  const url = (l: SeoLang) => opt.canonicalOrigin + localizedPath(l, path);
  const criterion = criterionOf(page);
  const playHref = criterion ? `#/solo?c=${encodeURIComponent(JSON.stringify(criterion))}` : '#/';

  const ld: unknown[] = [];
  if (page.kind === 'home') {
    ld.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND, url: url(lang), inLanguage: lang, description: b.description });
  } else {
    ld.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [...b.crumbs, { href: localizedPath(lang, path), text: b.h1 }].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.text, item: opt.canonicalOrigin + c.href })),
    });
  }

  const head = [
    `<title>${esc(b.title)}</title>`,
    `<meta name="description" content="${esc(b.description)}" />`,
    opt.noindex ? `<meta name="robots" content="noindex" />` : '',
    `<link rel="canonical" href="${esc(url(lang))}" />`,
    ...SEO_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(url(l))}" />`),
    `<link rel="alternate" hreflang="x-default" href="${esc(url('en'))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(BRAND)}" />`,
    `<meta property="og:title" content="${esc(b.h1)}" />`,
    `<meta property="og:description" content="${esc(b.description)}" />`,
    `<meta property="og:url" content="${esc(url(lang))}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
    `<meta name="twitter:card" content="summary" />`,
    ...ld.map((x) => `<script type="application/ld+json">${jsonForScript(x)}</script>`),
    `<script>window.__SEO__=${jsonForScript({ lang, criterion, alt: Object.fromEntries(SEO_LANGS.map((l) => [l, localizedPath(l, path)])) })}</script>`,
  ].filter(Boolean).join('\n    ');

  const links = (ls: { href: string; text: string }[]) => `<ul class="seo-links">${ls.map((l) => `<li><a href="${esc(l.href)}">${esc(l.text)}</a></li>`).join('')}</ul>`;
  const body = `<section id="seo" class="seo"><div class="seo-inner">
${b.crumbs.length ? `<nav class="seo-crumbs">${b.crumbs.map((c) => `<a href="${esc(c.href)}">${esc(c.text)}</a>`).join(' › ')}</nav>` : ''}
<h1>${esc(b.h1)}</h1>
<p>${esc(b.intro)}</p>
${b.facts.length ? `<ul class="seo-facts">${b.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<p><a class="seo-play" href="${esc(playHref)}">${esc(criterion ? t.play : t.playHome)}</a></p>
${b.how ? `<h2>${esc(t.howTitle)}</h2><ol>${t.howSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
${b.sections.map((s) => `<h2>${esc(s.title)}</h2>${links(s.links)}`).join('\n')}
</div></section>`;

  return template
    .replace(/<html[^>]*>/, `<html lang="${lang}">`)
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta\s+name="description"[^>]*>/g, '')
    .replace(/\s*<meta\s+property="og:[^"]*"[^>]*>/g, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace(/(<div id="root"><\/div>)/, `$1\n    ${body}`);
}

// ---------- robots & sitemaps ----------

export function robotsTxt(canonicalOrigin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${canonicalOrigin}/sitemap.xml\n`;
}

/** Every indexable page (language-independent). */
export function allPages(): Page[] {
  const ix = indexes();
  const pages: Page[] = [{ kind: 'home' }, { kind: 'hub' }];
  for (const l of data.leagues) {
    pages.push({ kind: 'league', league: l.id });
    for (const y of ix.seasonsOf[l.id]) pages.push({ kind: 'season', league: l.id, season: y });
  }
  data.clubs.forEach((_, c) => { if (hasClubPage(c)) pages.push({ kind: 'club', club: c }); });
  for (const k of ix.pairCount.keys()) {
    const [a, b] = k.split(':').map(Number);
    if (hasPairPage(a, b)) pages.push({ kind: 'pair', a, b });
  }
  return pages;
}

export function sitemapIndex(canonicalOrigin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SEO_LANGS.map((l) => `<sitemap><loc>${canonicalOrigin}/sitemap-${l}.xml</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
}

export function sitemap(canonicalOrigin: string, lang: SeoLang): string {
  const urls = allPages().map((p) => {
    const path = pagePath(p);
    const alts = [...SEO_LANGS.map((l) => [l, l] as const), ['x-default', 'en'] as const]
      .map(([h, l]) => `<xhtml:link rel="alternate" hreflang="${h}" href="${esc(canonicalOrigin + localizedPath(l, path))}"/>`).join('');
    return `<url><loc>${esc(canonicalOrigin + localizedPath(lang, path))}</loc>${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

