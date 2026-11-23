// Club leagues (every club is one), clubs of the day and leagues anyone can create.
import { useEffect, useState } from 'react';
import { api, ApiError, getSession } from './api';
import { useI18n } from './i18n';
import { clubName } from './format';
import { loadFanClubs } from './clubs';
import { Leaderboard, ScoreList, Standing } from './ui';
import type { ClubDayBoard, ClubDayRow, LeagueBoard, LeagueDuration, LeagueSummary, LeagueView, Meta } from '../shared/types';

type Scope = 'world' | 'club' | 'clubs';

/** Daily challenge ranking: everyone, my club's supporters, or the clubs against each other. Each with its curve. */
export function DailyBoards({ date, meta }: { date?: string; meta: Meta }) {
  const { t, lang } = useI18n();
  const [scope, setScope] = useState<Scope>('world');
  const me = getSession();
  const myClub = me && me.club !== 'other' ? me.club : null;
  return (
    <div className="daily-boards">
      <div className="scope-tabs" role="tablist">
        {(['world', 'club', 'clubs'] as Scope[]).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>
            {s === 'world' ? `🌍 ${t.lg.scopeWorld}` : s === 'club' ? `🏟️ ${t.lg.scopeMyClub}` : `⚔️ ${t.lg.scopeClubs}`}
          </button>
        ))}
      </div>
      {scope === 'world' && <Leaderboard mode="daily" date={date} meta={meta} rarity />}
      {scope === 'club' && (myClub
        ? <><p className="hint">{t.lg.myClubHint(clubName(meta, myClub, lang, t))}</p><Leaderboard mode="daily" date={date} meta={meta} rarity club={myClub} /></>
        : <p className="hint">{t.lg.noClubHint} <a href="#/profile">{t.lg.pickClub}</a></p>)}
      {scope === 'clubs' && <ClubsOfDay date={date} meta={meta} />}
    </div>
  );
}

/** Clubs ranked by the average daily score of their supporters, with the clubs' curve and mine highlighted. */
export function ClubsOfDay({ date, meta }: { date?: string; meta: Meta }) {
  const { t, lang } = useI18n();
  const [board, setBoard] = useState<ClubDayBoard | null>(null);
  const [, setReady] = useState(false);
  useEffect(() => { loadFanClubs().then(() => setReady(true)).catch(() => {}); }, []);
  useEffect(() => { setBoard(null); api.clubsOfDay(date).then(setBoard).catch(() => {}); }, [date]);
  if (!board) return <p className="hint">…</p>;
  const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const row = (r: ClubDayRow, mine: boolean) => (
    <li key={r.key} className={mine ? 'me' : ''}>
      <span className="lb-rank">{r.rank ?? '–'}</span>
      <span className="lb-name">{clubName(meta, r.key, lang, t)}<small>{t.lg.clubPlayers(r.players)}</small></span>
      <span className="lb-score" title={t.lg.clubsAvg}>{nf.format(r.score)}</span>
    </li>
  );
  const me = board.me;
  return (
    <div className="leaderboard war">
      <p className="hint">{t.lg.clubsHint(board.min)}</p>
      {me && me.rank === null && <p className="ok-note">{t.lg.clubUnranked(me.players, board.min)}</p>}
      {board.total > 0 && <Standing total={board.total} me={me && me.rank !== null ? { rank: me.rank, score: Math.round(me.score) } : null} dist={board.dist} caption={t.lg.clubsDist} />}
      {board.rows.length === 0 ? <p className="hint">{t.war.empty}</p> : (
        <ol>
          {board.rows.map((r) => row(r, me?.key === r.key))}
          {me && me.rank !== null && !board.rows.some((r) => r.key === me.key) && <><li className="sep">…</li>{row(me, true)}</>}
        </ol>
      )}
    </div>
  );
}

const DURATIONS: LeagueDuration[] = ['week', 'month', '3months', '6months', 'year', 'none'];
const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const dateLabel = (d: string, lang: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));

/** My leagues, plus forms to create one or join one with a code. */
export function Leagues({ go }: { go: (path: string) => void }) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<LeagueSummary[] | null>(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState<LeagueDuration>('6months');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.leagues().then(setList).catch(() => setList([])); }, []);
  const run = async (f: () => Promise<string>) => {
    setBusy(true); setError('');
    try { go('/league/' + (await f())); } catch (e) { setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error); } finally { setBusy(false); }
  };
  return (
    <div className="leagues">
      <p className="hint">{t.lg.hint}</p>
      <h3>{t.lg.mine}</h3>
      {!list ? <p className="hint">…</p> : list.length === 0 ? <p className="hint">{t.lg.none}</p> : (
        <ul className="league-list">
          {list.map((l) => (
            <li key={l.code}>
              <a href={'#/league/' + l.code}>
                <strong>{l.name}</strong>
                <small>{t.lg.members(l.members)} · {l.end && l.end < todayParis() ? t.lg.over : t.lg.dates(dateLabel(l.start, lang), l.end && dateLabel(l.end, lang))}</small>
              </a>
              {l.myRank !== null && <span className="pill">{t.lg.myRank(l.myRank)}</span>}
            </li>
          ))}
        </ul>
      )}
      <form className="league-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(async () => (await api.createLeague(name.trim(), duration)).code); }}>
        <h3>{t.lg.create}</h3>
        <label>{t.lg.name}<input value={name} maxLength={40} placeholder={t.lg.namePlaceholder} onChange={(e) => setName(e.target.value)} /></label>
        <label>{t.lg.duration}
          <select value={duration} onChange={(e) => setDuration(e.target.value as LeagueDuration)}>
            {DURATIONS.map((d) => <option key={d} value={d}>{t.lg.durations[d]}</option>)}
          </select>
        </label>
        <button className="primary" disabled={busy || name.trim().length < 3}>{t.lg.createButton}</button>
      </form>
      <form className="league-form" onSubmit={(e) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (c) run(async () => (await api.joinLeague(c)).code); }}>
        <h3>{t.lg.join}</h3>
        <div className="inline">
          <input value={code} maxLength={8} placeholder={t.lg.codePlaceholder} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          <button disabled={busy || code.trim().length < 4}>{t.lg.joinButton}</button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** A league's page (also the invite link): standings over the whole period or one day, with the curve. */
export function LeaguePage({ code, meta, go }: { code: string; meta: Meta; go: (path: string) => void }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<LeagueView>('total');
  const [board, setBoard] = useState<LeagueBoard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () => api.league(code, view).then((b) => { setBoard(b); setError(''); }).catch((e) => setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error));
  useEffect(() => { load(); }, [code, view]);
  const act = async (f: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try { await f(); after ? after() : await load(); } catch (e) { setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error); } finally { setBusy(false); }
  };
  const invite = async () => {
    if (!board) return;
    const url = `${location.origin}/#/league/${board.code}`;
    const text = t.lg.inviteText(board.name);
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* cancelled */ }
  };
  if (!board) return <div className="card">{error ? <p className="error">{error}</p> : <p className="hint">…</p>}</div>;
  const over = !!board.end && board.end < todayParis();
  return (
    <div className="card league-page">
      <p className="eyebrow">{t.lg.eyebrow} · {board.code}</p>
      <h2>{board.name}</h2>
      <p className="hint">{t.lg.by(board.ownerPseudo)} · {t.lg.members(board.members)} · {t.lg.dates(dateLabel(board.start, lang), board.end && dateLabel(board.end, lang))}{over ? ` · ${t.lg.over}` : ''}</p>
      <div className="row-actions">
        {board.member
          ? <><button className="share-club" onClick={invite}>📣 {copied ? t.copied : t.lg.invite}</button><button onClick={() => go('/daily')}>{t.lg.playDaily}</button></>
          : !over && <button className="primary big" disabled={busy} onClick={() => act(() => api.joinLeague(board.code))}>{t.lg.joinCta}</button>}
      </div>
      <div className="leaderboard">
        <div className="tabs">
          {(['total', 'day'] as LeagueView[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'total' ? t.lg.total : t.lg.today}</button>)}
        </div>
        <p className="hint">{view === 'total' ? t.lg.totalHint : t.lg.dayHint}</p>
        {board.total > 0 && board.rows.some((r) => r.score > 0) && <Standing total={board.total} me={board.me} dist={board.dist} />}
        <ScoreList rows={board.rows} me={board.me} meta={meta} empty={t.lg.noScores} />
      </div>
      {error && <p className="error">{error}</p>}
      {board.member && !board.owner && <button className="link danger" disabled={busy} onClick={() => act(() => api.leaveLeague(board.code))}>{t.lg.leave}</button>}
      {board.owner && (
        <button className="link danger" disabled={busy} onClick={() => (confirm ? act(() => api.deleteLeague(board.code), () => go('/leaderboards')) : setConfirm(true))}>
          {confirm ? t.lg.removeConfirm : t.lg.remove}
        </button>
      )}
    </div>
  );
}
