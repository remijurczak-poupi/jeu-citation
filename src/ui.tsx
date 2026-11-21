// Shared UI pieces: stadium curtain transition, silhouettes, theme picker, leaderboard, profile form.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, getSession, setSession } from './api';
import { useI18n } from './i18n';
import { clubName, COUNTRIES, countryName, flag, leagueName, seasonLabel } from './format';
import type { Suggestion, WarBoard, WarRow, ChainLink, Criterion, LeaderboardRow, LeagueId, Meta, Position, Ranking, SoloMode } from '../shared/types';

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
  }, [JSON.stringify(value)]);

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
          {meta.leagues.map((l) => <option key={l.id} value={l.id}>{flag(l.country)} {leagueName(l, lang)}</option>)}
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
      <MoreFilters meta={meta} value={value} set={set} clubs={clubs} />
      <p className={`theme-size ${size !== null && size < 15 ? 'bad' : ''}`}>
        {size === null ? '…' : size < 15 ? t.themeTooSmall : t.themeSize(size)}
      </p>
    </div>
  );
}

const EXTRA_KEYS: (keyof Criterion)[] = ['club2', 'position', 'nationality', 'international', 'active', 'ageMin', 'ageMax', 'heightMin', 'heightMax', 'tournament', 'ucl', 'champion', 'topScorer', 'ballonDor'];

/** Optional filters, folded by default so the basic picker stays simple. */
function MoreFilters({ meta, value, set, clubs }: { meta: Meta; value: Criterion; set: (p: Partial<Criterion>) => void; clubs: Meta['clubs'] }) {
  const { t, lang } = useI18n();
  const active = EXTRA_KEYS.filter((k) => value[k] !== undefined).length;
  const [open, setOpen] = useState(active > 0);
  const tri = (v: boolean | undefined) => (v === undefined ? '' : v ? 'yes' : 'no');
  const fromTri = (s: string) => (s === '' ? undefined : s === 'yes');
  const nats = useMemo(() => meta.nationalities.map((c) => ({ c, n: countryName(c, lang) })).sort((a, b) => a.n.localeCompare(b.n)), [meta, lang]);
  const allClubs = useMemo(() => [...meta.clubs].sort((a, b) => clubName(meta, a.q, lang).localeCompare(clubName(meta, b.q, lang))), [meta, lang]);
  const num = (s: string) => (s === '' ? undefined : +s);
  if (!open) return <button type="button" className="link more" onClick={() => setOpen(true)}>+ {t.f.more}{active ? ` (${active})` : ''}</button>;
  return (
    <div className="more-filters">
      <div className="row">
        <label><span>{t.f.position}</span>
          <select value={value.position ?? ''} onChange={(e) => set({ position: (e.target.value || undefined) as Position | undefined })}>
            <option value="">{t.any}</option>
            {(['GK', 'DF', 'MF', 'FW'] as Position[]).map((p) => <option key={p} value={p}>{t.f.positions[p]}</option>)}
          </select>
        </label>
        <label><span>{t.f.nationality}</span>
          <select value={value.nationality ?? ''} onChange={(e) => set({ nationality: e.target.value || undefined })}>
            <option value="">{t.any}</option>
            {nats.map(({ c, n }) => <option key={c} value={c}>{flag(c)} {n}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label><span>{t.f.international}</span>
          <select value={tri(value.international)} onChange={(e) => set({ international: fromTri(e.target.value) })}>
            <option value="">{t.any}</option><option value="yes">{t.f.yes}</option><option value="no">{t.f.no}</option>
          </select>
        </label>
        <label><span>{t.f.active}</span>
          <select value={tri(value.active)} onChange={(e) => set({ active: fromTri(e.target.value) })}>
            <option value="">{t.any}</option><option value="yes">{t.f.stillPlaying}</option><option value="no">{t.f.retired}</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label><span>{t.f.age} ({t.from})</span><input type="number" min={15} max={90} value={value.ageMin ?? ''} onChange={(e) => set({ ageMin: num(e.target.value) })} /></label>
        <label><span>{t.f.age} ({t.to})</span><input type="number" min={15} max={90} value={value.ageMax ?? ''} onChange={(e) => set({ ageMax: num(e.target.value) })} /></label>
      </div>
      <div className="row">
        <label><span>{t.f.height} ({t.from}, cm)</span><input type="number" min={150} max={215} value={value.heightMin ?? ''} onChange={(e) => set({ heightMin: num(e.target.value) })} /></label>
        <label><span>{t.f.height} ({t.to}, cm)</span><input type="number" min={150} max={215} value={value.heightMax ?? ''} onChange={(e) => set({ heightMax: num(e.target.value) })} /></label>
      </div>
      <label><span>{t.f.tournament}</span>
        <select value={value.tournament ?? ''} onChange={(e) => set({ tournament: e.target.value || undefined, tournamentWon: e.target.value ? value.tournamentWon : undefined })}>
          <option value="">{t.any}</option>
          {meta.tournaments.map((tr) => (
            <optgroup key={tr.code} label={t.f.tournaments[tr.code] ?? tr.code}>
              <option value={tr.code}>{t.f.tournaments[tr.code] ?? tr.code} · {t.f.anyEdition}</option>
              {tr.years.map((y) => <option key={y} value={tr.code + y}>{t.f.tournaments[tr.code] ?? tr.code} {y}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {value.tournament && (
        <label className="check"><input type="checkbox" checked={!!value.tournamentWon} onChange={(e) => set({ tournamentWon: e.target.checked || undefined })} /> {t.f.wonIt}</label>
      )}
      <label><span>{t.f.ucl}</span>
        <select value={value.ucl ?? ''} onChange={(e) => set({ ucl: (e.target.value || undefined) as Criterion['ucl'] })}>
          <option value="">{t.any}</option><option value="played">{t.f.uclPlayed}</option><option value="won">{t.f.uclWon}</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={!!value.champion} onChange={(e) => set({ champion: e.target.checked || undefined })} /> {t.f.champion}</label>
      <label className="check"><input type="checkbox" checked={!!value.topScorer} onChange={(e) => set({ topScorer: e.target.checked || undefined })} /> {t.f.topScorer}</label>
      <label className="check"><input type="checkbox" checked={!!value.ballonDor} onChange={(e) => set({ ballonDor: e.target.checked || undefined })} /> {t.f.ballonDor}</label>
      <label><span>{t.f.club2}</span>
        <select value={value.club2 ?? ''} onChange={(e) => set({ club2: e.target.value || undefined })}>
          <option value="">{t.any}</option>
          {allClubs.filter((c) => c.q !== value.club).map((c) => <option key={c.q} value={c.q}>{clubName(meta, c.q, lang)}</option>)}
        </select>
      </label>
      {void clubs}
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

// ---------- Chain of teammates ----------
/** The chain, newest first: the player to link from is on top. */
export function ChainView({ links, done }: { links: ChainLink[]; done?: boolean }) {
  const { t } = useI18n();
  const last = links[links.length - 1];
  return (
    <div className="chain">
      {!done && last && <p className="chain-now"><small>{t.chainNow}</small><strong>{last.name}</strong></p>}
      <ol className="chain-links">
        {[...links].reverse().map((l, i) => (
          <li key={links.length - i} className={i === 0 && !done ? 'head' : ''}>
            <span className="chain-name">{l.name}</span>
            {l.club && <small>{t.chainVia(l.club, l.seasons ?? '')}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- Clubs & countries war ----------
export function War({ meta }: { meta: Meta }) {
  const { t, lang } = useI18n();
  const [by, setBy] = useState<'club' | 'country'>('club');
  const [period, setPeriod] = useState<'week' | 'all'>('week');
  const [board, setBoard] = useState<WarBoard | null>(null);
  useEffect(() => { setBoard(null); api.war(by, period).then(setBoard).catch(() => {}); }, [by, period]);
  const label = (k: string) => (by === 'club' ? clubName(meta, k, lang, t) : `${flag(k)} ${countryName(k, lang)}`);
  const row = (r: WarRow, me?: boolean) => (
    <li key={r.key} className={me ? 'me' : ''}>
      <span className="lb-rank">{r.rank}</span>
      <span className="lb-name">{label(r.key)}<small>{t.war.supporters(r.players)}</small></span>
      <span className="lb-score">{r.points}</span>
    </li>
  );
  return (
    <div className="leaderboard war">
      <div className="tabs">
        {(['club', 'country'] as const).map((b) => <button key={b} className={by === b ? 'on' : ''} onClick={() => setBy(b)}>{b === 'club' ? t.war.clubs : t.war.countries}</button>)}
        {(['week', 'all'] as const).map((p) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'week' ? t.war.week : t.war.all}</button>)}
      </div>
      {!board ? <p className="hint">…</p> : board.rows.length === 0 ? <p className="hint">{t.war.empty}</p> : (
        <ol>
          {board.rows.map((r) => row(r, board.me?.key === r.key))}
          {board.me && !board.rows.some((r) => r.key === board.me!.key) && <><li className="sep">…</li>{row(board.me, true)}</>}
        </ol>
      )}
    </div>
  );
}

// ---------- Answer input with suggestions ----------
/**
 * Free text answer box. With `suggestions`, players of the whole base whose name starts with
 * the typed letters (3 or more) are listed: tap one, or use the arrows then Enter, to answer
 * with that exact player. Enter alone sends the text (tolerant matching).
 * `choices` lists homonyms to pick from when the server found the typed name ambiguous.
 */
export function GuessInput({ onGuess, suggestions, choices, onClearChoices, placeholder }: {
  onGuess: (text: string, pick?: string) => void;
  suggestions: boolean;
  choices?: Suggestion[] | null;
  onClearChoices?: () => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [list, setList] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = text.trim();
    if (!suggestions || q.length < 3) { setList([]); setActive(-1); return; }
    const n = ++seq.current;
    const h = setTimeout(() => api.suggest(q).then((r) => { if (n === seq.current) { setList(r); setActive(-1); } }).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [text, suggestions]);

  const shown = choices?.length ? choices : list;
  const send = (pick?: Suggestion) => {
    const value = text.trim();
    if (!pick && !value) return;
    onGuess(pick ? pick.n : value, pick?.q);
    setText(''); setList([]); setActive(-1); seq.current++;
    onClearChoices?.();
    input.current?.focus();
  };
  const key = (e: React.KeyboardEvent) => {
    if (!shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? shown.length - 1 : a - 1)); }
    else if (e.key === 'Escape') { setList([]); onClearChoices?.(); }
  };
  return (
    <form className="guess-form" onSubmit={(e) => { e.preventDefault(); send(active >= 0 ? shown[active] : undefined); }}>
      <input
        ref={input}
        autoFocus
        value={text}
        onChange={(e) => { setText(e.target.value); if (choices?.length) onClearChoices?.(); }}
        onKeyDown={key}
        placeholder={placeholder}
        autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} enterKeyHint="send" maxLength={80}
        role="combobox" aria-expanded={shown.length > 0} aria-autocomplete="list"
      />
      {shown.length > 0 && (
        <ul className="suggest" role="listbox">
          {choices?.length ? <li className="suggest-title">{t.whichOne}</li> : null}
          {shown.map((o, i) => (
            <li key={o.q} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); send(o); }}>
              <span className="suggest-name">{o.n}</span>
              <small>{[o.c && flag(o.c), o.p && t.f.positions[o.p], o.y].filter(Boolean).join(' · ')}</small>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
