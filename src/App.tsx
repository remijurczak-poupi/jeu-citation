import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getSession } from './api';
import { dictionaries, I18n, initialLang, LANGS, useI18n, type Lang } from './i18n';
import { themeLabel } from './format';
import { Leaderboard, ProfileForm, Silhouette, StadiumCurtain, ThemePicker, War, type CurtainState } from './ui';
import { GameScreen } from './screens/Game';
import { RoomScreen, RoomHome } from './screens/Room';
import type { Criterion, DailyHistoryItem, DailyInfo, Meta, SoloMode } from '../shared/types';

// ---------- tiny hash router ----------
// Server-rendered quiz pages (/quiz/arsenal, /fr/league/serie-a…) describe themselves in window.__SEO__.
interface SeoInfo { lang: Lang; criterion: Criterion | null; alt: Record<Lang, string> }
const SEO = (window as { __SEO__?: SeoInfo }).__SEO__;
/** A quiz page without a hash opens the solo setup with its theme. */
const defaultRoute = () => (SEO?.criterion ? `/solo?c=${encodeURIComponent(JSON.stringify(SEO.criterion))}` : '/');

function useRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || defaultRoute());
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || defaultRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export interface Nav { go: (path: string) => void }

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    try { localStorage.setItem('lang', l); } catch { /* ignore */ }
    // On a page that exists in every language, go to its version in that language (own URL, own content).
    if (SEO && SEO.alt[l] && l !== SEO.lang) { location.href = SEO.alt[l] + location.hash; return; }
    setLangState(l);
  };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const i18n = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang]);

  const route = useRoute();
  const [shown, setShown] = useState(route);
  const [curtain, setCurtain] = useState<CurtainState>('closed');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hasProfile, setHasProfile] = useState(!!getSession());

  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, []);
  // Opening animation on first load.
  useEffect(() => { if (meta) { const h = setTimeout(() => setCurtain('opening'), 250); return () => clearTimeout(h); } }, [!!meta]);
  useEffect(() => { if (curtain === 'opening') { const h = setTimeout(() => setCurtain('open'), 700); return () => clearTimeout(h); } }, [curtain]);

  // Stadium closes, screen swaps behind it, stadium opens.
  useEffect(() => {
    if (route === shown) return;
    const bigMove = route.split('/')[1] !== shown.split('/')[1];
    if (!bigMove) { setShown(route); return; }
    setCurtain('closing');
    const h = setTimeout(() => { setShown(route); window.scrollTo(0, 0); setCurtain('closed'); setTimeout(() => setCurtain('opening'), 180); }, 520);
    return () => clearTimeout(h);
  }, [route]);

  const nav: Nav = { go: useCallback((p: string) => { location.hash = p; }, []) };
  const [shownPath, shownQuery = ''] = shown.split('?');
  const parts = shownPath.split('/').filter(Boolean);
  const preset = (() => { try { return JSON.parse(new URLSearchParams(shownQuery).get('c') ?? 'null') as Criterion | null; } catch { return null; } })();

  let screen;
  if (!meta) screen = null;
  else if (!hasProfile) screen = <div className="page narrow"><ProfileForm meta={meta} onDone={() => setHasProfile(true)} /></div>;
  else if (parts[0] === 'game' && parts[1]) screen = <GameScreen id={parts[1]} meta={meta} nav={nav} />;
  else if (parts[0] === 'solo') screen = <SoloSetup key={shownQuery} meta={meta} nav={nav} preset={preset} />;
  else if (parts[0] === 'room' && parts[1]) screen = <RoomScreen code={parts[1].toUpperCase()} meta={meta} nav={nav} />;
  else if (parts[0] === 'room') screen = <RoomHome meta={meta} nav={nav} />;
  else if (parts[0] === 'leaderboards') screen = <Leaderboards meta={meta} />;
  else if (parts[0] === 'profile') screen = <div className="page narrow"><ProfileForm meta={meta} onDone={() => nav.go('/')} /></div>;
  else screen = <Home meta={meta} nav={nav} />;

  return (
    <I18n.Provider value={i18n}>
      <header className="topbar">
        <a href="#/" className="logo"><span className="ball">⚽</span> {i18n.t.appName}</a>
        <nav>
          <a href="#/leaderboards" title={i18n.t.leaderboards}>🏆</a>
          {hasProfile && <a href="#/profile" title={i18n.t.profileTitle}>👤</a>}
          <select className="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={i18n.t.language}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.id.toUpperCase()}</option>)}
          </select>
        </nav>
      </header>
      <main>{screen}</main>
      <footer className="footer">{i18n.t.dataCredit}</footer>
      <StadiumCurtain state={curtain} title={curtain === 'closed' || curtain === 'closing' ? i18n.t.appName : undefined} />
    </I18n.Provider>
  );
}

// ---------- Home ----------
function Home({ meta, nav }: { meta: Meta; nav: Nav }) {
  const { t, lang } = useI18n();
  const [daily, setDaily] = useState<DailyInfo | null>(null);
  const [history, setHistory] = useState<DailyHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.daily().then(setDaily).catch(() => {});
    api.dailyHistory().then(setHistory).catch(() => {});
  }, []);
  const playDaily = async (date?: string) => {
    setBusy(true);
    try { const g = await api.startGame('daily', undefined, date); nav.go(`/game/${g.id}`); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <section className="hero">
        <h1>{t.tagline}</h1>
        <p className="hint">{meta.playerCount.toLocaleString(lang)} {t.players} · Premier League · Ligue 1 · La Liga · Serie A · Bundesliga</p>
      </section>

      {daily && (
        <section className="card daily">
          <div className="daily-head">
            <span className="badge">#{daily.number}</span>
            <h2>{t.dailyTitle}</h2>
            <span className={`pill ${daily.difficulty}`}>{daily.difficulty === 'easy' ? t.easy : t.hard}</span>
          </div>
          <p className="daily-theme">{themeLabel(daily.criterion, meta, lang, t)}</p>
          <p className="hint">{t.dailyHint} {daily.playerCount > 0 && `· ${t.peoplePlayed(daily.playerCount)}`}</p>
          {daily.played?.status === 'finished' ? (
            <>
              <p className="daily-score"><strong>{daily.played.count}</strong> {t.players}{daily.played.rank ? ` · ${t.rank} ${daily.played.rank}/${daily.played.total}` : ''}</p>
              <button onClick={() => nav.go(`/game/${daily.played!.id}`)}>{t.seeResult}</button>
              <Leaderboard mode="daily" date={daily.date} meta={meta} rarity />
            </>
          ) : (
            <button className="primary big" disabled={busy} onClick={() => (daily.played ? nav.go(`/game/${daily.played.id}`) : playDaily())}>{t.play}</button>
          )}
        </section>
      )}

      <div className="grid2">
        <a className="card tile" href="#/solo">
          <span className="tile-icon">⏱️</span>
          <h2>{t.soloTitle}</h2>
          <p className="hint">{t.soloHint}</p>
        </a>
        <a className="card tile" href="#/room">
          <span className="tile-icon">💣</span>
          <h2>{t.friendsTitle}</h2>
          <p className="hint">{t.friendsHint}</p>
        </a>
      </div>

      {history.length > 0 && (
        <section className="card">
          <h2>{t.history}</h2>
          <p className="hint">{t.historyHint}</p>
          <div className="history">
            {history.map((h) => (
              <button key={h.date} className="history-item" onClick={() => playDaily(h.date)} disabled={busy}>
                <Silhouette number={h.number} seed={h.number * 7 + (h.difficulty === 'hard' ? 3 : 0)} />
                <span className="history-num">#{h.number}</span>
                <span className="history-theme">{themeLabel(h.criterion, meta, lang, t)}</span>
                {h.myCount !== null && <span className="history-mine">✅ {h.myCount}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- Solo setup ----------
const SOLO: SoloMode[] = ['timed1', 'timed3', 'timed10', 'unlimited', 'hardcore', 'streak', 'chain'];
function SoloSetup({ meta, nav, preset }: { meta: Meta; nav: Nav; preset?: Criterion | null }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SoloMode>('timed3');
  const [criterion, setCriterion] = useState<Criterion>(() => (preset && typeof preset === 'object' ? preset : {}));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true); setError('');
    try { const g = await api.startGame(mode, criterion); nav.go(`/game/${g.id}`); }
    catch (e) { setError(t.errorsMap[(e as { code: string }).code] ?? t.errorsMap.server_error); }
    finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <section className="card">
        <h2>{t.mode}</h2>
        <div className="modes">
          {SOLO.map((m) => (
            <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              <strong>{t.modes[m]}</strong>
              <small>{t.modeHints[m]}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>{t.theme}</h2>
        <ThemePicker meta={meta} value={criterion} onChange={setCriterion} />
      </section>
      {error && <p className="error">{error}</p>}
      <button className="primary big" disabled={busy} onClick={start}>{t.start}</button>
    </div>
  );
}

// ---------- Leaderboards ----------
function Leaderboards({ meta }: { meta: Meta }) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<SoloMode>('daily');
  const [criterion, setCriterion] = useState<Criterion>({});
  return (
    <div className="page narrow">
      <section className="card">
        <h2>{t.leaderboards}</h2>
        <div className="modes compact">
          {(['daily', ...SOLO] as SoloMode[]).map((m) => <button key={m} className={`mode ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}><strong>{t.modes[m]}</strong></button>)}
        </div>
        {mode !== 'daily' && <ThemePicker meta={meta} value={criterion} onChange={setCriterion} />}
        {mode !== 'daily' && <p className="hint">{themeLabel(criterion, meta, lang, t)}</p>}
        <Leaderboard mode={mode} criterion={mode === 'daily' ? undefined : criterion} meta={meta} rarity={mode === 'daily'} />
      </section>
      <section className="card">
        <h2>{t.war.title}</h2>
        <p className="hint">{t.war.hint}</p>
        <War meta={meta} />
      </section>
    </div>
  );
}
