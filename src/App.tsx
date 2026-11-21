import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getSession } from './api';
import { leaveGuarded } from './guard';
import { loadFanClubs } from './clubs';
import { dictionaries, I18n, initialLang, LANGS, useI18n, type Lang } from './i18n';
import { themeLabel } from './format';
import { Badges, ClubPage, Leaderboard, LoginLink, ProfileForm, RankedThemePicker, Silhouette, StadiumCurtain, ThemePicker, War, type CurtainState } from './ui';
import { ChallengePage, GameScreen } from './screens/Game';
import { RoomScreen, RoomHome } from './screens/Room';
import type { BoardKind, Criterion, DailyHistoryItem, DailyInfo, Meta, SoloMode } from '../shared/types';
import { MODE_RULES, SOLO_GROUPS } from '../shared/types';

// ---------- tiny hash router ----------
function useRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export interface Nav { go: (path: string) => void }

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem('lang', l); } catch { /* ignore */ } };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const i18n = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang]);

  const route = useRoute();
  const [shown, setShown] = useState(route);
  const [curtain, setCurtain] = useState<CurtainState>('closed');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hasProfile, setHasProfile] = useState(!!getSession());
  const [, setFanReady] = useState(false); // re-render with club names once the clubs list is in

  useEffect(() => { api.meta().then(setMeta).catch(() => {}); loadFanClubs().then(() => setFanReady(true)).catch(() => {}); }, []);
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

  const [leaving, setLeaving] = useState<string | null>(null);
  const guardClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const to = e.currentTarget.getAttribute('href')!.slice(1);
    if (leaveGuarded() && to !== route) { e.preventDefault(); setLeaving(to); }
  };
  const t0 = i18n.t;
  const sections = [
    { id: 'daily', icon: '📅', label: t0.nav.daily },
    { id: 'solo', icon: '⏱️', label: t0.nav.solo },
    { id: 'room', icon: '👥', label: t0.nav.multi },
    { id: 'leaderboards', icon: '🏆', label: t0.nav.boards },
  ];
  const head = route.split('/').filter(Boolean)[0] ?? '';
  const section = head === 'game' ? '' : head === 'club' ? 'leaderboards' : head;
  const nav: Nav = { go: useCallback((p: string) => { location.hash = p; }, []) };
  const parts = shown.split('/').filter(Boolean);

  let screen;
  if (!meta) screen = null;
  else if (parts[0] === 'club' && parts[1]) screen = <div className="page narrow"><ClubPage meta={meta} q={parts[1]} onSupport={() => (getSession() ? nav.go('/leaderboards') : nav.go('/profile/' + parts[1]))} /></div>;
  else if (parts[0] === 'challenge' && parts[1]) screen = <div className="page narrow"><ChallengePage code={parts[1]} meta={meta} nav={nav} /></div>;
  else if (parts[0] === 'profile' && parts[1]) screen = <div className="page narrow"><ProfileForm meta={meta} presetClub={parts[1]} onDone={() => { setHasProfile(true); nav.go('/leaderboards'); }} /></div>;
  else if (parts[0] === 'login' && parts[1]) screen = <div className="page narrow"><LoginLink token={parts[1]} onDone={() => { setHasProfile(!!getSession()); nav.go('/'); }} /></div>;
  else if (parts[0] === 'game' && parts[1]) screen = <GameScreen id={parts[1]} meta={meta} nav={nav} />;
  else if (parts[0] === 'daily') screen = <Home meta={meta} nav={nav} dailyOnly />;
  else if (parts[0] === 'solo') screen = <SoloSetup meta={meta} nav={nav} />;
  else if (parts[0] === 'room' && parts[1]) screen = <RoomScreen code={parts[1].toUpperCase()} meta={meta} nav={nav} />;
  else if (parts[0] === 'room') screen = <RoomHome meta={meta} nav={nav} />;
  else if (parts[0] === 'leaderboards') screen = <Leaderboards meta={meta} />;
  else if (parts[0] === 'profile') screen = <div className="page narrow"><ProfileForm meta={meta} onDone={() => nav.go('/')} /></div>;
  else screen = <Home meta={meta} nav={nav} />;

  return (
    <I18n.Provider value={i18n}>
      <header className="topbar">
        <a href="#/" className="logo" onClick={guardClick}><span className="ball">⚽</span> <span className="logo-text">{i18n.t.appName}</span></a>
        <nav className="mainnav">{sections.map((x) => <a key={x.id} href={'#/' + x.id} className={section === x.id ? 'on' : ''} onClick={guardClick}>{x.label}</a>)}</nav>
        <nav className="side">
          {<a href="#/profile" title={i18n.t.profileTitle} onClick={guardClick}>👤</a>}
          <select className="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={i18n.t.language}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.id.toUpperCase()}</option>)}
          </select>
        </nav>
      </header>
      <nav className="tabbar">{sections.map((x) => <a key={x.id} href={'#/' + x.id} className={section === x.id ? 'on' : ''} onClick={guardClick}><span>{x.icon}</span>{x.label}</a>)}</nav>
      {leaving && (
        <div className="modal-back" onClick={() => setLeaving(null)}>
          <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{i18n.t.leaveTitle}</h2>
            <p className="hint">{i18n.t.leaveText}</p>
            <div className="row">
              <button className="primary" onClick={() => setLeaving(null)}>{i18n.t.stay}</button>
              <button className="link danger" onClick={() => { const to = leaving; setLeaving(null); location.hash = to; }}>{i18n.t.leaveConfirm}</button>
            </div>
          </div>
        </div>
      )}
      <main>{screen}</main>
      <footer className="footer">{i18n.t.dataCredit}</footer>
      <StadiumCurtain state={curtain} title={curtain === 'closed' || curtain === 'closing' ? i18n.t.appName : undefined} />
    </I18n.Provider>
  );
}

// ---------- Home ----------
function Home({ meta, nav, dailyOnly }: { meta: Meta; nav: Nav; dailyOnly?: boolean }) {
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
      {!dailyOnly && <section className="hero">
        <h1>{t.tagline}</h1>
        <p className="hint">{meta.playerCount.toLocaleString(lang)} {t.players} · Premier League · Ligue 1 · La Liga · Serie A · Bundesliga</p>
      </section>}

      {daily && (
        <section className="card daily">
          <div className="daily-head">
            <span className="badge">#{daily.number}</span>
            <h2>{t.dailyTitle}</h2>
            <span className={`pill ${daily.difficulty}`}>{daily.difficulty === 'easy' ? t.easy : t.hard}</span>
          </div>
          <p className="daily-theme">{themeLabel(daily.criterion, meta, lang, t)}</p>
          <p className="hint">{t.dailyHint} {daily.playerCount > 0 && `· ${t.peoplePlayed(daily.playerCount)}`}</p>
          <Streak daily={daily} />
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

      {!dailyOnly && <div className="grid2">
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
      </div>}

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

// ---------- Daily streak & reminder ----------
/** A recurring calendar event (.ics) opening the daily challenge: works on every phone, no notification permission. */
function calendarReminder(time: string, title: string) {
  const [h, m] = time.split(':').map(Number);
  const start = new Date(); start.setHours(h, m, 0, 0);
  if (start.getTime() < Date.now()) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + 10 * 60_000);
  const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const url = `${location.origin}/#/daily`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Name the Players//Daily//EN', 'BEGIN:VEVENT',
    `UID:daily-${Date.now()}@name-the-players`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    'RRULE:FREQ=DAILY', `SUMMARY:⚽ ${title}`, `URL:${url}`, `DESCRIPTION:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'name-the-players-daily.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function Streak({ daily }: { daily: DailyInfo }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState('19:00');
  const st = daily.streak;
  return (
    <div className="streak">
      <span className="streak-count">{st && st.current > 0 ? <>🔥 {t.streakDays(st.current)}{st.best > st.current && <small> · {t.streakBest(st.best)}</small>}</> : <small>{t.streakStart}</small>}</span>
      <button className="link" onClick={() => setOpen(!open)}>⏰ {t.remindMe}</button>
      {open && (
        <div className="reminder">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button onClick={() => { calendarReminder(time, t.reminderEvent); setOpen(false); }}>{t.addToCalendar}</button>
        </div>
      )}
    </div>
  );
}

// ---------- Solo setup ----------
const groupOf = (m: SoloMode) => SOLO_GROUPS.find((g) => g.modes.includes(m))!;
const variantLabel = (m: SoloMode, t: ReturnType<typeof useI18n>['t']) => {
  const r = MODE_RULES[m];
  return r.streakSeconds ? `${r.streakSeconds} s` : t.modes[m];
};

/** Mode groups, then the timer lengths of the selected group when it has several. */
function ModePicker({ mode, onChange, compact }: { mode: SoloMode | null; onChange: (m: SoloMode) => void; compact?: boolean }) {
  const { t } = useI18n();
  const group = mode ? groupOf(mode) : null;
  return (
    <>
      <div className={`modes ${compact ? 'compact' : ''}`}>
        {SOLO_GROUPS.map((g) => (
          <button key={g.id} className={`mode ${group?.id === g.id ? 'on' : ''}`} onClick={() => onChange(group?.id === g.id && mode ? mode : g.default)}>
            <strong>{t.groups[g.id] ?? t.modes[g.default]}</strong>
            {!compact && <small>{t.groupHints[g.id]}</small>}
          </button>
        ))}
      </div>
      {group && group.modes.length > 1 && (
        <div className="variant">
          <span className="hint">{group.id === 'streak' ? t.perAnswer : t.duration}</span>
          <div className="tabs">
            {group.modes.map((m) => <button key={m} className={m === mode ? 'on' : ''} onClick={() => onChange(m)}>{variantLabel(m, t)}</button>)}
          </div>
        </div>
      )}
    </>
  );
}
function SoloSetup({ meta, nav }: { meta: Meta; nav: Nav }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SoloMode>('timed3');
  const [criterion, setCriterion] = useState<Criterion>({});
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
        <ModePicker mode={mode} onChange={setMode} />
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
  const { t } = useI18n();
  const [mode, setMode] = useState<SoloMode>('daily');
  const [kind, setKind] = useState<BoardKind>('best');
  const [theme, setTheme] = useState('all');
  return (
    <div className="page narrow">
      <section className="card">
        <h2>{t.leaderboards}</h2>
        <Badges meta={meta} />
        <div className="modes compact">
          <button className={`mode ${mode === 'daily' ? 'on' : ''}`} onClick={() => setMode('daily')}><strong>{t.modes.daily}</strong></button>
        </div>
        <ModePicker mode={mode === 'daily' ? null : mode} onChange={setMode} compact />
        <div className="kind-tabs">
          {(['best', 'total'] as BoardKind[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              <strong>{k === 'best' ? t.boardBest : t.boardTotal}</strong>
              <small>{k === 'best' ? (mode === 'daily' ? t.dailyTitle : t.boardBestHint) : t.boardTotalHint}</small>
            </button>
          ))}
        </div>
        {kind === 'best' && mode !== 'daily' && <RankedThemePicker value={theme} onChange={setTheme} meta={meta} />}
        <Leaderboard mode={mode} kind={kind} theme={theme} meta={meta} rarity={mode === 'daily'} />
      </section>
      <section className="card">
        <h2>{t.war.title}</h2>
        <p className="hint">{t.war.hint}</p>
        <War meta={meta} />
      </section>
    </div>
  );
}
