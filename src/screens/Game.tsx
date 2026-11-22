import { useEffect, useRef, useState } from 'react';
import { useLeaveGuard } from '../guard';
import { api, getSession } from '../api';
import { useI18n, type Lang, type T } from '../i18n';
import { fmtClock, themeLabel } from '../format';
import { ChainView, GuessInput, Leaderboard, ordinal, ProfileForm, topShareValue } from '../ui';
import { flag } from '../format';
import type { Nav } from '../App';
import type { Challenge, Criterion, GameRecap, GameState, GuessOutcome, Meta, Suggestion } from '../../shared/types';
import { MODE_RULES } from '../../shared/types';

type Flash = { kind: 'ok' | 'duplicate' | 'wrong'; text: string; key: number };
type Refused = { text: string; recognised?: string };

export function GameScreen({ id, meta, nav }: { id: string; meta: Meta; nav: Nav }) {
  const { t, lang } = useI18n();
  const [g, setG] = useState<GameState | null>(null);
  const [offset, setOffset] = useState(0); // server clock - local clock
  const [now, setNow] = useState(Date.now());
  const [choices, setChoices] = useState<Suggestion[] | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [error, setError] = useState('');
  const [refused, setRefused] = useState<Refused[]>([]);
  const queue = useRef(Promise.resolve());
  const ending = useRef(false);

  const accept = (s: GameState) => { setOffset(s.serverNow - Date.now()); setG(s); };
  useEffect(() => { api.game(id).then(accept).catch(() => setError(t.errorsMap.server_error)); }, [id]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(h); }, []);

  const remaining = g?.deadline ? g.deadline - (now + offset) : null;
  useEffect(() => {
    if (g?.status === 'active' && remaining !== null && remaining <= 0 && !ending.current) {
      ending.current = true;
      // Let the server confirm the end (it owns the clock).
      setTimeout(() => api.game(id).then((s) => { ending.current = false; accept(s); }), 2700);
    }
  }, [remaining !== null && remaining <= 0, g?.status]);

  const show = (o: GuessOutcome) => {
    if (o.status === 'invalid') return;
    if (o.status === 'ambiguous') { setChoices(o.options); return; }
    const textMsg = o.status === 'ok' ? `${t.ok} ${o.name}` : o.status === 'duplicate' ? `${t.duplicate} : ${o.name}` : o.name ? t.wrongKnown(o.name) : t.wrong;
    setFlash({ kind: o.status, text: textMsg, key: Date.now() });
    if ('vibrate' in navigator && o.status !== 'ok') navigator.vibrate?.(60);
  };

  const submit = (value: string, pick?: string) => {
    if (g?.status !== 'active') return;
    queue.current = queue.current.then(async () => {
      try {
        const r = await api.guess(id, value, pick);
        show(r.outcome);
        if (r.outcome.status === 'wrong') setRefused((l) => [...l, { text: value, recognised: (r.outcome as { name?: string }).name }]);
        accept(r.state);
      } catch { /* network hiccup: the answer is dropped */ }
    });
  };

  const stop = () => api.finish(id).then(accept);

  useLeaveGuard(g?.status === 'active');
  if (error) return <div className="page narrow"><p className="error">{error}</p></div>;
  if (!g) return <div className="page narrow"><p className="hint">…</p></div>;

  const theme = themeLabel(g.criterion, meta, lang, t);
  const title = g.mode === 'daily' ? t.dailyTitle : t.modes[g.mode];

  if (g.status === 'finished') return <Result g={g} meta={meta} nav={nav} theme={theme} title={title} refused={refused} onRefresh={() => api.game(id).then(accept)} />;

  const rules = MODE_RULES[g.mode];
  const low = remaining !== null && remaining < (rules.streakSeconds ? 5000 : 10000);
  return (
    <div className="page narrow game">
      <div className="scoreboard">
        <div className="sb-theme"><small>{title}</small><strong>{theme}</strong></div>
        <div className="sb-row">
          <div className="sb-cell"><small>{t.found}</small><span className="big-num">{g.count}</span></div>
          {remaining !== null && (rules.duration || rules.streakSeconds) ? (
            <div className={`sb-cell clock ${low ? 'low' : ''}`}><small>{t.timeLeft}</small><span className="big-num">{fmtClock(remaining)}</span></div>
          ) : null}
          <div className="sb-cell"><small>{t.errors}</small><span className="big-num">{g.errors}</span></div>
        </div>
        {rules.streakSeconds && remaining !== null && (
          <div className="streak-bar"><span style={{ width: `${Math.max(0, Math.min(100, (remaining / (rules.streakSeconds * 1000)) * 100))}%` }} /></div>
        )}
      </div>
      <GuessInput onGuess={submit} suggestions={g.mode !== 'hardcore'} criterion={g.criterion} choices={choices} onClearChoices={() => setChoices(null)} placeholder={t.typeHere} />
      <div className="flash-slot">
        {flash && <div key={flash.key} className={`flash ${flash.kind}`}>{flash.text}</div>}
        {flash?.kind === 'wrong' && refused.length > 0 && <ReportButton key={refused.length} gameId={g.id} criterion={g.criterion} item={refused[refused.length - 1]} onAccepted={() => api.game(id).then(accept)} />}
      </div>
      {g.chain ? <ChainView links={g.chain} /> : (
        <ol className="found" reversed>
          {[...g.found].reverse().map((n, i) => <li key={g.found.length - i}>{n}</li>)}
        </ol>
      )}
      <button className="link danger" onClick={stop}>{t.giveUp}</button>
    </div>
  );
}

/** "My answer was right": sends the refused answer for a manual check. */
function ReportButton({ gameId, criterion, item, inline, onAccepted }: { gameId: string; criterion: Criterion; item: Refused; inline?: boolean; onAccepted?: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'busy' | 'accept' | 'reject' | 'done'>('idle');
  const send = async () => {
    setState('busy');
    try {
      const r = await api.report({ gameId, text: item.text, recognised: item.recognised, criterion });
      setState(r.verdict === 'accept' ? 'accept' : r.verdict === 'reject' ? 'reject' : 'done');
      if (r.verdict === 'accept') onAccepted?.();
    } catch { setState('idle'); }
  };
  if (state === 'busy') return <span className="report done">{t.reportChecking}</span>;
  if (state === 'accept') return <span className="report done">✓ {t.reportAccepted}</span>;
  if (state === 'reject') return <span className="report rejected">{t.reportRejected}</span>;
  if (state === 'done') return <span className="report done">✓ {t.reported}</span>;
  return <button className={`report ${inline ? 'inline' : ''}`} onClick={send}>{inline ? t.report : t.reportAsk(item.text)}</button>;
}

const SQUARE = ['', '🟩', '🟨', '🟪'];
/** Wordle-style share text for the daily challenge: score, rank, one square per answer by rarity, no names. */
function dailyCard(g: GameState, tiers: number[] | undefined, t: T, lang: Lang, difficulty: string) {
  const lines = [`${t.appName} #${g.dailyNumber ?? ''} · ${difficulty}`];
  lines.push(`⚽ ${g.count} ${g.count === 1 ? t.player : t.players}${g.rank && g.total ? ` · 🏆 ${t.topShare(topShareValue(g.rank, g.total, lang))}` : ''}`);
  if (tiers?.length) {
    const sq = tiers.slice(0, 30).map((x) => SQUARE[x] ?? SQUARE[1]);
    for (let i = 0; i < sq.length; i += 10) lines.push(sq.slice(i, i + 10).join(''));
    if (tiers.length > 30) lines.push(`+${tiers.length - 30}`);
  }
  lines.push(location.origin + '/#/daily');
  return lines.join('\n');
}

async function shareText(text: string, url?: string) {
  if (navigator.share) { await navigator.share(url ? { text, url } : { text }); return false; }
  await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
  return true;
}

function Result({ g, meta, nav, theme, title, refused, onRefresh }: { g: GameState; meta: Meta; nav: Nav; theme: string; title: string; refused: Refused[]; onRefresh: () => void }) {
  const { t, lang } = useI18n();
  // Best-game boards exist only for the big themes; other themes show the mode's weekly total.
  const rankedId = g.rankedTheme;
  const [copied, setCopied] = useState<'' | 'share' | 'challenge'>('');
  const [recap, setRecap] = useState<GameRecap | null>(null);
  const [guest, setGuest] = useState(!!getSession()?.guest);
  useEffect(() => { api.recap(g.id).then(setRecap).catch(() => {}); }, [g.id]);
  const flashCopied = (k: 'share' | 'challenge') => { setCopied(k); setTimeout(() => setCopied(''), 1500); };
  const share = async () => {
    const text = g.mode === 'daily' && g.dailyNumber
      ? dailyCard(g, recap?.tiers, t, lang, isHardDaily(g) ? t.hard : t.easy)
      : t.shareText({ title: `${t.appName} · ${title}`, theme, count: g.count, rank: g.rank, total: g.total, url: location.origin + '/#/solo' });
    try { if (await shareText(text)) flashCopied('share'); } catch { /* cancelled */ }
  };
  const challenge = async () => {
    try {
      const { code } = await api.createChallenge(g.id);
      if (await shareText(t.challengeText({ count: g.count, mode: title, theme }), `${location.origin}/#/challenge/${code}`)) flashCopied('challenge');
    } catch { /* cancelled */ }
  };
  const again = async () => {
    if (g.mode === 'daily') return nav.go('/daily');
    const n = g.challenge ? await api.acceptChallenge(g.challenge) : await api.startGame(g.mode, g.criterion);
    nav.go(`/game/${n.id}`);
  };
  return (
    <div className="page narrow result">
      <section className="card result-card">
        <p className="whistle">{t.gameOver}</p>
        <p className="hint">{g.endReason ? t.endReasons[g.endReason] : ''}</p>
        <p className="result-theme">{title} · {theme}</p>
        <div className="result-score"><span className="huge">{g.count}</span><span>{g.count === 1 ? t.player : t.players}</span></div>
        {g.rank && g.total ? <p className="result-rank">🏆 {t.rankOutOf(ordinal(g.rank, lang), new Intl.NumberFormat(lang).format(g.total))} · {t.topShare(topShareValue(g.rank, g.total, lang))}</p> : null}
        <div className="actions">
          {g.mode !== 'daily' && <button className="primary" onClick={again}>{t.playAgain}</button>}
          <button className={g.mode === 'daily' ? 'primary' : ''} onClick={share}>{copied === 'share' ? t.copied : t.share}</button>
          {g.mode !== 'daily' && <button onClick={challenge}>⚔️ {copied === 'challenge' ? t.copied : t.challengeFriend}</button>}
        </div>
      </section>
      {g.challenge && <ChallengeBoard code={g.challenge} />}
      {guest && (
        <section className="guest-cta">
          <h2>{t.guestTitle}</h2>
          <p className="hint">{t.guestHint}</p>
          <ProfileForm meta={meta} onDone={() => setGuest(false)} compact />
        </section>
      )}
      {recap && (recap.rarest.length > 0 || recap.missed.length > 0) && (
        <section className="card recap">
          {recap.rarest.length > 0 && <>
            <h2>💎 {t.rarestTitle}</h2>
            <ul className="rarest">{recap.rarest.map((r) => <li key={r.name}><strong>{r.name}</strong>{r.pct !== undefined && <small>{t.citedIn(r.pct)}</small>}</li>)}</ul>
          </>}
          {recap.missed.length > 0 && <>
            <h2>🙈 {t.missedTitle}</h2>
            <p className="missed">{recap.missed.join(' · ')}</p>
          </>}
        </section>
      )}
      {refused.length > 0 && (
        <section className="card">
          <h2>{t.refusedTitle}</h2>
          <p className="hint">{t.refusedHint}</p>
          <ul className="refused">{refused.map((r, i) => <li key={i}><span>{r.text}{r.recognised ? <small> → {r.recognised}</small> : null}</span><ReportButton gameId={g.id} criterion={g.criterion} item={r} inline onAccepted={onRefresh} /></li>)}</ul>
        </section>
      )}
      {!g.archive && <section className="card">
        <h2>{t.leaderboards}</h2>
        {g.mode === 'daily'
          ? <Leaderboard mode="daily" date={g.dailyDate} meta={meta} rarity />
          : rankedId ? <Leaderboard mode={g.mode} theme={rankedId} meta={meta} />
          : <><p className="hint">{t.boardTotal} · {t.boardTotalHint}</p><Leaderboard mode={g.mode} kind="total" meta={meta} /></>}
      </section>}
      {g.chain ? (
        <section className="card">
          <h2>{t.modes.chain}</h2>
          <ChainView links={g.chain} done />
        </section>
      ) : g.found.length > 0 && (
        <section className="card">
          <h2>{t.found}</h2>
          <ol className="found">{g.found.map((n, i) => <li key={i}>{n}</li>)}</ol>
        </section>
      )}
    </div>
  );
}
const isHardDaily = (g: GameState) => (g.dailyNumber ?? 1) % 2 === 0;

/** Scores of everyone who took a friend's challenge. */
function ChallengeBoard({ code }: { code: string }) {
  const { t } = useI18n();
  const [ch, setCh] = useState<Challenge | null>(null);
  useEffect(() => { api.challenge(code).then(setCh).catch(() => {}); }, [code]);
  if (!ch) return null;
  const rows = [{ pseudo: ch.from.pseudo, country: ch.from.country, count: ch.from.count, host: true, me: false }, ...ch.takers.map((r) => ({ ...r, host: false, me: !!r.me }))]
    .sort((a, b) => b.count - a.count);
  const mine = ch.takers.find((r) => r.me);
  return (
    <section className="card">
      <h2>⚔️ {t.challengeBoard}</h2>
      {mine && <p className="challenge-verdict">{mine.count > ch.from.count ? t.challengeWon(ch.from.pseudo) : mine.count === ch.from.count ? t.challengeDraw : t.challengeLost(ch.from.pseudo, ch.from.count - mine.count)}</p>}
      <ol className="lb-list">
        {rows.map((r, i) => (
          <li key={i} className={r.me ? 'me' : ''}>
            <span className="lb-rank">{i + 1}</span>
            <span className="lb-flag">{flag(r.country)}</span>
            <span className="lb-name">{r.pseudo}{r.host && <small>{t.challenger}</small>}</span>
            <span className="lb-score">{r.count}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Landing page of a challenge link. */
export function ChallengePage({ code, meta, nav }: { code: string; meta: Meta; nav: Nav }) {
  const { t, lang } = useI18n();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.challenge(code).then(setCh).catch(() => setError(t.errorsMap.challenge_not_found ?? t.errorsMap.server_error)); }, [code]);
  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (!ch) return <p className="hint">…</p>;
  const go = async () => { setBusy(true); try { const g = await api.acceptChallenge(code); nav.go(`/game/${g.id}`); } finally { setBusy(false); } };
  return (
    <>
      <div className="card challenge-page">
        <p className="eyebrow">⚔️ {t.challengeTitle}</p>
        <h2>{flag(ch.from.country)} {ch.from.pseudo}</h2>
        <p className="challenge-lead">{t.challengeLead(ch.from.count)}</p>
        <p className="result-theme">{t.modes[ch.mode]} · {themeLabel(ch.criterion, meta, lang, t)}</p>
        <p className="hint">{t.modeHints[ch.mode]}</p>
        <button className="primary big" disabled={busy} onClick={go}>{t.acceptChallenge}</button>
      </div>
      {ch.takers.length > 0 && <ChallengeBoard code={code} />}
    </>
  );
}
