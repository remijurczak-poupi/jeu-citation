import { describe, expect, it } from 'vitest';
import { allPages, localizedPath, pagePath, renderPage, route, shortClubName, sitemap, slugify } from '../worker/seo';
import { data } from '../worker/data';

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <title>Old</title>
    <meta name="description" content="old" />
    <meta property="og:title" content="old" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
const opt = { origin: 'https://x.test', canonicalOrigin: 'https://x.test' };

describe('seo', () => {
  it('cleans club names and builds unique slugs', () => {
    expect(shortClubName('Manchester City F.C.')).toBe('Manchester City');
    expect(shortClubName('FC Barcelona')).toBe('Barcelona');
    expect(shortClubName('Real Madrid Club de Fútbol')).toBe('Real Madrid');
    expect(slugify('Brighton & Hove Albion')).toBe('brighton-and-hove-albion');
    expect(slugify('Atlético Madrid')).toBe('atletico-madrid');
    const paths = allPages().map(pagePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('routes club, pair, league and season pages in every language', () => {
    expect(route('/')).toEqual({ lang: 'en', page: { kind: 'home' } });
    expect(route('/fr')).toEqual({ redirect: '/fr/' });
    expect(route('/de/')).toEqual({ lang: 'de', page: { kind: 'home' } });
    const arsenal = route('/quiz/arsenal');
    expect(arsenal && 'page' in arsenal && arsenal.page.kind).toBe('club');
    expect(route('/quiz/arsenal/')).toEqual({ redirect: '/quiz/arsenal' });
    expect(route('/quiz/nope')).toEqual({ notFound: 'en' });
    const season = route('/it/league/serie-a/2005-06');
    expect(season && 'page' in season && season.page).toEqual({ kind: 'season', league: 'SA', season: 2005 });
    expect(route('/league/serie-a/2005-07')).toEqual({ notFound: 'en' });
    expect(route('/assets/index.js')).toBeNull();
  });

  it('redirects a club pair to one canonical order', () => {
    const pair = allPages().find((p) => p.kind === 'pair')!;
    const [, , a, b] = pagePath(pair).split('/');
    expect(route(`/quiz/${a}/${b}`)).toEqual({ lang: 'en', page: pair });
    expect(route(`/es/quiz/${b}/${a}`)).toEqual({ redirect: localizedPath('es', `/quiz/${a}/${b}`) });
  });

  it('renders head tags, hreflang and content', () => {
    const r = route('/fr/quiz/arsenal');
    if (!r || !('page' in r)) throw new Error('no page');
    const html = renderPage(TEMPLATE, r.lang, r.page, opt);
    expect(html).toContain('<html lang="fr">');
    expect(html).not.toContain('<title>Old</title>');
    expect(html).not.toContain('content="old"');
    expect(html).toContain('<title>Quiz Arsenal');
    expect(html).toContain('<link rel="canonical" href="https://x.test/fr/quiz/arsenal" />');
    expect(html).toContain('hreflang="x-default" href="https://x.test/quiz/arsenal"');
    expect(html).toContain('hreflang="pt" href="https://x.test/pt/quiz/arsenal"');
    expect(html).toContain('<h1>');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toMatch(/<div id="root"><\/div>\s*<section id="seo"/);
    expect(html).not.toContain('noindex');
    expect(renderPage(TEMPLATE, 'en', { kind: 'home' }, { ...opt, noindex: true })).toContain('<meta name="robots" content="noindex" />');
  });

  it('lists every page with its alternates in the sitemaps', () => {
    const xml = sitemap('https://x.test', 'de');
    expect(xml).toContain('<loc>https://x.test/de/quiz/arsenal</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://x.test/quiz/arsenal"');
    const count = (xml.match(/<url>/g) ?? []).length;
    expect(count).toBe(allPages().length);
    expect(count).toBeLessThan(50000);
    expect(data.clubs.length).toBeGreaterThan(0);
  });
});
