import { useEffect, useRef, useState } from 'react';
import { useLeaveGuard } from '../guard';
import { api } from '../api';
import { useI18n } from '../i18n';
import { fmtClock, themeLabel } from '../format';
import { ChainView, GuessInput, Leaderboard } from '../ui';
import type { Nav } from '../App';
import type { GameState, GuessOutcome, Meta, Suggestion } from '../../shared/types';
import { MODE_RULES } from '../../shared/types';

type Flash = { kind: 'ok' | 'duplicate' | 'wrong'; text: string; key: number };

export function GameScreen({ id, meta, nav }: { id: string; meta: Meta; nav: Nav }) {
  const { t, lang } = useI18n();
  const [g, setG] = useState<GameState | null>(null);
  const [offset, setOffset] = useState(0); // server clock - local clock
  const [now, setNow] = useState(Date.now());
  const [choices, setChoices] = useState<Suggestion[] | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [error, setError] = useState('');
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

  if (g.status === 'finished') return <Result g={g} meta={meta} nav={nav} theme={theme} title={title} />;

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
      <div className="flash-slot">{flash && <div key={flash.key} className={`flash ${flash.kind}`}>{flash.text}</div>}</div>
      {g.chain ? <ChainView links={g.chain} /> : (
        <ol className="found" reversed>
          {[...g.found].reverse().map((n, i) => <li key={g.found.length - i}>{n}</li>)}
        </ol>
      )}
      <button className="link danger" onClick={stop}>{t.giveUp}</button>
    </div>
  );
}

function Result({ g, meta, nav, theme, title }: { g: GameState; meta: Meta; nav: Nav; theme: string; title: string }) {
  const { t } = useI18n();
  // Best-game boards exist only for the big themes; other themes show the mode's weekly total.
  const rankedId = g.rankedTheme;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = location.origin + (g.mode === 'daily' ? '/' : '/#/solo');
    const text = t.shareText({ title: `${t.appName} · ${title}`, theme, count: g.count, rank: g.rank, total: g.total, url });
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch { /* cancelled */ }
  };
  const again = async () => {
    if (g.mode === 'daily') return nav.go('/');
    const n = await api.startGame(g.mode, g.criterion);
    nav.go(`/game/${n.id}`);
  };
  return (
    <div className="page narrow result">
      <section className="card result-card">
        <p className="whistle">{t.gameOver}</p>
        <p className="hint">{g.endReason ? t.endReasons[g.endReason] : ''}</p>
        <p className="result-theme">{title} · {theme}</p>
        <div className="result-score"><span className="huge">{g.count}</span><span>{g.count === 1 ? t.player : t.players}</span></div>
        {g.rank ? <p className="result-rank">🏆 {t.rank} {g.rank} / {g.total}</p> : null}
        <div className="actions">
          <button className="primary" onClick={share}>{copied ? t.copied : t.share}</button>
          {g.mode !== 'daily' && <button onClick={again}>{t.playAgain}</button>}
          <button onClick={() => nav.go('/')}>{t.backHome}</button>
        </div>
      </section>
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
