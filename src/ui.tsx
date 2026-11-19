// Shared UI pieces: stadium curtain transition, silhouettes, theme picker, leaderboard, profile form.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getSession, setSession } from './api';
import { useI18n } from './i18n';
import { clubName, COUNTRIES, countryName, flag, seasonLabel } from './format';
import type { Criterion, LeaderboardRow, LeagueId, Meta, Ranking, SoloMode } from '../shared/types';

// ---------- Stadium curtain ----------
/** One half of an illustrated (original, generic) stadium. The two halves meet on the halfway line. */
function StadiumHalf({ side }: { side: 'left' | 'right' }) {
  const id = side;
  return (
    <svg viewBox="0 0 500 1000" preserveAspectRatio={side === 'left' ? 'xMaxYMid slice' : 'xMinYMid slice'} className="stadium-svg" aria-hidden>
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#030b08" />
          <stop offset="1" stopColor="#0d2a1c" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffbe6" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fffbe6" stopOpacity="0" />
        </radialGradient>
        <pattern id={`crowd-${id}`} width="18" height="16" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="5" r="3" fill="#c8102e" opacity="0.85" />
          <circle cx="13" cy="4" r="3" fill="#f4f1e8" opacity="0.7" />
          <circle cx="8" cy="12" r="3" fill="#1d4ed8" opacity="0.8" />
          <circle cx="16" cy="12" r="2.6" fill="#facc15" opacity="0.6" />
        </pattern>
        <pattern id={`stripes-${id}`} width="500" height="80" patternUnits="userSpaceOnUse">
          <rect width="500" height="40" fill="#1f7a3f" />
          <rect y="40" width="500" height="40" fill="#1a6b37" />
        </pattern>
      </defs>
      <g transform={side === 'right' ? 'translate(500,0) scale(-1,1)' : undefined}>
        <rect width="500" height="1000" fill={`url(#sky-${id})`} />
        {/* floodlight */}
        <polygon points="90,140 0,640 260,640" fill="#fffbe6" opacity="0.06" />
        <rect x="84" y="140" width="10" height="260" fill="#1b2b24" />
        <rect x="52" y="110" width="74" height="44" rx="4" fill="#24362e" />
        {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={62 + c * 18} cy={120 + r * 12} r="5" fill="#fffbe6" />))}
        <circle cx="89" cy="132" r="70" fill={`url(#glow-${id})`} opacity="0.5" />
        {/* stands */}
        <polygon points="0,330 500,300 500,420 0,440" fill="#16241e" />
        <polygon points="0,340 500,312 500,410 0,430" fill={`url(#crowd-${id})`} opacity="0.75" />
        <polygon points="0,450 500,430 500,560 0,575" fill="#1a2a23" />
        <polygon points="0,458 500,440 500,552 0,566" fill={`url(#crowd-${id})`} opacity="0.9" />
        <rect y="575" width="500" height="18" fill="#0b1712" />
        <rect y="593" width="500" height="40" fill="#e6c229" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={20 + i * 125} y="603" width="80" height="20" rx="3" fill="#0b1f14" opacity="0.85" />)}
        {/* pitch */}
        <rect y="633" width="500" height="367" fill={`url(#stripes-${id})`} />
        <line x1="0" y1="660" x2="500" y2="660" stroke="#f4f1e8" strokeWidth="4" opacity="0.85" />
        <line x1="498" y1="660" x2="498" y2="1000" stroke="#f4f1e8" strokeWidth="5" opacity="0.9" />
        <circle cx="500" cy="830" r="120" fill="none" stroke="#f4f1e8" strokeWidth="5" opacity="0.9" />
        <circle cx="500" cy="830" r="8" fill="#f4f1e8" />
        <rect x="-10" y="760" width="90" height="140" fill="none" stroke="#f4f1e8" strokeWidth="4" opacity="0.7" />
      </g>
    </svg>
  );
}

export type CurtainState = 'open' | 'closing' | 'closed' | 'opening';
export function StadiumCurtain({ state, title }: { state: CurtainState; title?: string }) {
  return (
    <div className={`curtain curtain-${state}`} aria-hidden={state === 'open'}>
      <div className="curtain-half left"><StadiumHalf side="left" /></div>
      <div className="curtain-half right"><StadiumHalf side="right" /></div>
      {title && <div className="curtain-title">{title}</div>}
    </div>
  );
}

// ---------- Silhouette (past challenges): generic player, no real faces ----------
const KITS = [['#c8102e', '#f4f1e8'], ['#1d4ed8', '#f4f1e8'], ['#f4f1e8', '#111827'], ['#facc15', '#14532d'], ['#111827', '#facc15'], ['#16a34a', '#f4f1e8'], ['#7c3aed', '#f4f1e8'], ['#ea580c', '#111827']];
export function Silhouette({ number, seed, size = 72 }: { number: number; seed: number; size?: number }) {
  const [shirt, ink] = KITS[seed % KITS.length];
  const striped = seed % 3 === 0;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden className="silhouette">
      <circle cx="40" cy="18" r="11" fill="#0b1712" />
      <path d="M18 34 L30 28 Q40 33 50 28 L62 34 L58 48 L52 46 L52 70 L28 70 L28 46 L22 48 Z" fill={shirt} stroke="#0b1712" strokeWidth="1.5" />
      {striped && <path d="M34 30 L34 70 M46 30 L46 70" stroke={ink} strokeWidth="4" opacity="0.6" />}
      <text x="40" y="60" textAnchor="middle" fontFamily="Bebas Neue, sans-serif" fontSize="20" fill={ink}>{number}</text>
    </svg>
  );
}

// ---------- Theme picker ----------
export function ThemePicker({ meta, value, onChange }: { meta: Meta; value: Criterion; onChange: (c: Criterion) => void }) {
  const { t, lang } = useI18n();
  const [size, setSize] = useState<number | null>(null);
  const from = value.from ?? meta.firstSeason;
  const to = value.to ?? meta.currentSeason;
  const years = useMemo(() => Array.from({ length: meta.currentSeason - meta.firstSeason + 1 }, (_, i) => meta.firstSeason + i), [meta]);
  const clubs = useMemo(() => {
    return meta.clubs
      .filter((c) => {
        const seasons = value.league ? c.l[value.league] ?? [] : Object.values(c.l).flat();
        return seasons.some((y) => y >= from && y <= to);
      })
      .sort((a, b) => clubName(meta, a.q, lang).localeCompare(clubName(meta, b.q, lang)));
  }, [meta, value.league, from, to, lang]);

  useEffect(() => {
    let alive = true;
    setSize(null);
    const h = setTimeout(() => api.themeSize(value).then((r) => alive && setSize(r.size)).catch(() => {}), 250);
    return () => { alive = false; clearTimeout(h); };
  }, [value.league, value.club, value.from, value.to]);

  const set = (patch: Partial<Criterion>) => {
    const next = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof Criterion)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    if (next.from === meta.firstSeason) delete next.from;
    if (next.to === meta.currentSeason) delete next.to;
    onChange(next);
  };

  return (
    <div className="theme-picker">
      <label>
        <span>{t.league}</span>
        <select value={value.league ?? ''} onChange={(e) => set({ league: (e.target.value || undefined) as LeagueId | undefined })}>
          <option value="">{t.allLeagues}</option>
          {meta.leagues.map((l) => <option key={l.id} value={l.id}>{flag(l.country === 'GB' ? 'GB' : l.country)} {l.name[lang]}</option>)}
        </select>
      </label>
      <label>
        <span>{t.club}</span>
        <select value={value.club ?? ''} onChange={(e) => set({ club: e.target.value || undefined })}>
          <option value="">{t.any}</option>
          {value.club && !clubs.some((c) => c.q === value.club) && <option value={value.club}>{clubName(meta, value.club, lang)}</option>}
          {clubs.map((c) => <option key={c.q} value={c.q}>{clubName(meta, c.q, lang)}</option>)}
        </select>
      </label>
      <div className="row">
        <label>
          <span>{t.period} · {t.from}</span>
          <select value={from} onChange={(e) => { const f = +e.target.value; set({ from: f, to: Math.max(f, to) }); }}>
            {years.map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
          </select>
        </label>
        <label>
          <span>{t.to}</span>
          <select value={to} onChange={(e) => { const v = +e.target.value; set({ to: v, from: Math.min(from, v) }); }}>
            {years.map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
          </select>
        </label>
      </div>
      <p className={`theme-size ${size !== null && size < 15 ? 'bad' : ''}`}>
        {size === null ? '…' : size < 15 ? t.themeTooSmall : t.themeSize(size)}
      </p>
    </div>
  );
}

// ---------- Leaderboard ----------
export function Leaderboard({ mode, criterion, date, meta, rarity }: { mode: SoloMode; criterion?: Criterion; date?: string; meta: Meta | null; rarity?: boolean }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState<'day' | 'week' | 'all'>('all');
  const [ranking, setRanking] = useState<Ranking>('count');
  const [data, setData] = useState<{ total: number; rows: LeaderboardRow[]; me: LeaderboardRow | null } | null>(null);
  const key = JSON.stringify([mode, criterion, date, period, ranking]);
  useEffect(() => {
    let alive = true;
    setData(null);
    api.leaderboard({ mode, criterion, date, period, ranking }).then((d) => alive && setData(d)).catch(() => alive && setData({ total: 0, rows: [], me: null }));
    return () => { alive = false; };
  }, [key]);
  const row = (r: LeaderboardRow) => (
    <li key={r.rank + r.pseudo} className={r.me ? 'me' : ''}>
      <span className="lb-rank">{r.rank}</span>
      <span className="lb-flag" title={countryName(r.country, lang)}>{flag(r.country)}</span>
      <span className="lb-name">{r.pseudo}{r.me && <em> ({t.you})</em>}<small>{clubName(meta, r.club, lang, t)}</small></span>
      <span className="lb-score">{r.score}</span>
    </li>
  );
  return (
    <div className="leaderboard">
      <div className="tabs">
        {mode === 'daily' && rarity
          ? (['count', 'rarity'] as Ranking[]).map((r) => <button key={r} className={ranking === r ? 'on' : ''} onClick={() => setRanking(r)}>{r === 'count' ? t.byCount : t.byRarity}</button>)
          : mode !== 'daily' && (['day', 'week', 'all'] as const).map((p) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'day' ? t.today : p === 'week' ? t.thisWeek : t.allTime}</button>)}
      </div>
      {ranking === 'rarity' && <p className="hint">{t.rarityHint}</p>}
      {!data ? <p className="hint">…</p> : data.rows.length === 0 ? <p className="hint">{t.noScores}</p> : (
        <ol>
          {data.rows.map(row)}
          {data.me && !data.rows.some((r) => r.me) && <><li className="sep">…</li>{row(data.me)}</>}
        </ol>
      )}
    </div>
  );
}

// ---------- Profile ----------
export function ProfileForm({ meta, onDone }: { meta: Meta; onDone: () => void }) {
  const { t, lang } = useI18n();
  const s = getSession();
  const [pseudo, setPseudo] = useState(s?.pseudo ?? '');
  const [club, setClub] = useState(s?.club ?? '');
  const [country, setCountry] = useState(s?.country ?? (lang === 'fr' ? 'FR' : ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState('');
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const countries = useMemo(() => COUNTRIES.map((c) => ({ c, n: countryName(c, lang) })).sort((a, b) => a.n.localeCompare(b.n)), [lang]);
  const clubs = useMemo(() => [...meta.clubs].sort((a, b) => clubName(meta, a.q, lang).localeCompare(clubName(meta, b.q, lang))), [meta, lang]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.saveProfile({ pseudo, club, country });
      setSession({ id: r.id, secret: r.secret ?? s!.secret, pseudo: r.pseudo, club: r.club, country: r.country });
      if (r.secret) setNewSecret(r.secret); else onDone();
    } catch (e) {
      setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error);
    } finally { setBusy(false); }
  };
  const recover = async () => {
    setBusy(true); setError('');
    try { setSession(await api.recover(code)); onDone(); } catch (e) { setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error); } finally { setBusy(false); }
  };

  if (newSecret) return (
    <div className="card profile">
      <h2>{t.recoveryTitle}</h2>
      <p className="hint">{t.recoveryHint}</p>
      <code className="recovery">{newSecret}</code>
      <button className="primary" onClick={onDone}>OK</button>
    </div>
  );
  if (recovering) return (
    <div className="card profile">
      <h2>{t.recoveryTitle}</h2>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" />
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy} onClick={recover}>{t.recover}</button>
      <button className="link" onClick={() => setRecovering(false)}>←</button>
    </div>
  );
  return (
    <div className="card profile">
      <h2>{t.profileTitle}</h2>
      <p className="hint">{t.profileHint}</p>
      <label><span>{t.pseudo}</span><input value={pseudo} maxLength={16} onChange={(e) => setPseudo(e.target.value)} autoComplete="nickname" /></label>
      <label>
        <span>{t.supportedClub}</span>
        <select value={club} onChange={(e) => setClub(e.target.value)}>
          <option value="" disabled>—</option>
          {clubs.map((c) => <option key={c.q} value={c.q}>{clubName(meta, c.q, lang)}</option>)}
          <option value="other">{t.otherClub}</option>
        </select>
      </label>
      <label>
        <span>{t.country}</span>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="" disabled>—</option>
          {countries.map(({ c, n }) => <option key={c} value={c}>{flag(c)} {n}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !pseudo || !club || !country} onClick={submit}>{t.save}</button>
      {!s && <button className="link" onClick={() => setRecovering(true)}>{t.recoverAction}</button>}
      {s && <details className="recovery-box"><summary>{t.recoveryTitle}</summary><p className="hint">{t.recoveryHint}</p><code className="recovery">{s.secret}</code></details>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
