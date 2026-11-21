import { useLeaveGuard } from '../guard';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { clubName, flag, fmtClock, themeLabel } from '../format';
import { ChainView, GuessInput, ThemePicker } from '../ui';
import type { Nav } from '../App';
import { DUEL_DEFAULT_SECONDS, DUEL_SECONDS } from '../../shared/types';
import type { Criterion, GuessOutcome, Meta, Suggestion, RoomClientMsg, RoomGame, RoomServerMsg, RoomState } from '../../shared/types';

const GAMES: RoomGame[] = ['bomb', 'duel', 'chain', 'royale'];
const ICON: Record<RoomGame, string> = { bomb: '💣', duel: '⚽', chain: '🔗', royale: '👑' };

export function RoomHome({ meta, nav }: { meta: Meta; nav: Nav }) {
  const { t } = useI18n();
  const [game, setGame] = useState<RoomGame>('bomb');
  const [criterion, setCriterion] = useState<Criterion>({});
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true); setError('');
    try { const r = await api.createRoom(game, criterion); nav.go(`/room/${r.code}`); }
    catch (e) { setError(t.errorsMap[(e as ApiError).code] ?? t.errorsMap.server_error); }
    finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <section className="card">
        <h2>{t.rooms.join}</h2>
        <form className="join" onSubmit={(e) => { e.preventDefault(); if (code.trim().length === 5) nav.go(`/room/${code.trim().toUpperCase()}`); }}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t.rooms.code} maxLength={5} autoCapitalize="characters" />
          <button className="primary" disabled={code.trim().length !== 5}>{t.rooms.join}</button>
        </form>
      </section>
      <section className="card">
        <h2>{t.rooms.create}</h2>
        <div className="modes two">
          {GAMES.map((g) => (
            <button key={g} className={`mode ${game === g ? 'on' : ''}`} onClick={() => setGame(g)}>
              <strong>{ICON[g]} {t.rooms[g]}</strong>
              <small>{t.rooms[`${g}Hint`]}</small>
            </button>
          ))}
        </div>
        <ThemePicker meta={meta} value={criterion} onChange={setCriterion} />
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy} onClick={create}>{t.rooms.create}</button>
      </section>
    </div>
  );
}

export function RoomScreen({ code, meta, nav }: { code: string; meta: Meta; nav: Nav }) {
  const { t, lang } = useI18n();
  const [s, setS] = useState<RoomState | null>(null);
  const [me, setMe] = useState('');
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editTheme, setEditTheme] = useState(false);
  const [mine, setMine] = useState<{ o: GuessOutcome; key: number } | null>(null); // battle royale: my own answers
  const [now, setNow] = useState(Date.now());
  const [choices, setChoices] = useState<Suggestion[] | null>(null);
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);
  useLeaveGuard(s?.phase === 'playing');

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = async () => {
      await api.ensureSession().catch(() => {});
      if (closed) return;
      const sock = new WebSocket(api.roomSocketUrl(code));
      ws.current = sock;
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as RoomServerMsg;
        if (m.t === 'state') { setS(m.state); setOffset(m.state.serverNow - Date.now()); }
        else if (m.t === 'you') setMe(m.id);
        else if (m.t === 'outcome') {
          if (m.outcome.status === 'ambiguous') setChoices(m.outcome.options);
          else setMine({ o: m.outcome, key: Date.now() });
        }
        else if (m.t === 'error') setError(t.errorsMap[m.message] ?? m.message);
      };
      sock.onclose = (ev) => {
        if (closed || ev.code === 4000 || ev.code === 4001) return;
        retry = setTimeout(connect, 1500);
      };
    };
    // Check the room exists before opening the socket.
    fetch(`/api/rooms/${code}`).then((r) => (r.ok ? connect() : setError(t.errorsMap.room_not_found)));
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [code]);

  const send = (m: RoomClientMsg) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(m));
  if (error && !s) return <div className="page narrow"><p className="error">{error}</p><button onClick={() => nav.go('/room')}>←</button></div>;
  if (!s) return <div className="page narrow"><p className="hint">…</p></div>;

  const host = s.players.find((p) => p.host)?.id === me;
  const name = (id: string | null) => s.players.find((p) => p.id === id)?.pseudo ?? '?';
  const link = `${location.origin}/#/room/${s.code}`;
  const invite = async () => {
    try {
      if (navigator.share) await navigator.share({ text: `${t.appName} · ${t.rooms[s.game]} · ${s.code}`, url: link });
      else { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch { /* cancelled */ }
  };
  const ev = s.lastEvent;
  const royale = s.game === 'royale';
  const alive = s.players.find((p) => p.id === me)?.lives ?? 0;
  const canType = s.phase === 'playing' && (royale ? alive > 0 : s.turn === me);
  const left = s.deadline ? Math.max(0, s.deadline - (now + offset)) : null;
  const banner = !ev ? null
    : royale && ev.kind === 'ok' ? null
    : ev.kind === 'boom' ? t.rooms.boom(name(ev.player))
    : ev.kind === 'timeout' ? t.rooms.timeout(name(ev.player))
    : ev.kind === 'out' ? t.rooms.out((ev.players ?? [ev.player]).map(name).join(', '))
    : ev.kind === 'restart' ? t.rooms.restart
    : ev.kind === 'hit' ? t.rooms.hit(name(ev.player))
    : ev.kind === 'ok' ? `${name(ev.player)} : ${ev.name} ✅`
    : ev.kind === 'duplicate' ? `${name(ev.player)} : ${t.duplicate} (${ev.name}) ❌`
    : `${name(ev.player)} : ${ev.name ? t.wrongKnown(ev.name) : t.wrong} ❌`;

  return (
    <div className="page narrow room">
      <section className="card">
        <div className="room-head">
          <span className="badge">{ICON[s.game]} {t.rooms[s.game]}</span>
          <span className="room-code">{s.code}</span>
        </div>
        <p className="room-theme">{themeLabel(s.criterion, meta, lang, t)}</p>
        {s.phase === 'lobby' && (
          <>
            <p className="hint">{t.rooms.invite}</p>
            <button onClick={invite}>{copied ? t.copied : `🔗 ${t.share}`}</button>
          </>
        )}
      </section>

      {s.phase === 'playing' && s.game === 'bomb' && <BombTable s={s} me={me} />}
      {s.phase === 'playing' && s.game === 'duel' && <DuelTrack s={s} me={me} offset={offset} />}

      {s.phase === 'playing' && left !== null && (
        <div className="room-clock">
          {royale && <small>{t.rooms.round(s.round)}</small>}
          <span className={`big-num ${left < 5000 ? 'low' : ''}`}>{fmtClock(left)}</span>
        </div>
      )}
      {s.phase === 'playing' && s.game === 'chain' && s.chain && <ChainView links={s.chain} />}

      {s.phase === 'playing' && (
        <>
          {!royale && <p className={`turn ${s.turn === me ? 'mine' : ''}`}>{s.turn === me ? t.rooms.yourTurn : t.rooms.turnOf(name(s.turn))}</p>}
          {royale && mine && mine.o.status !== 'invalid' && mine.o.status !== 'ambiguous' && (
            <div key={mine.key} className={`flash ${mine.o.status}`}>
              {mine.o.status === 'ok' ? `${t.ok} ${mine.o.name}` : mine.o.status === 'duplicate' ? `${t.duplicate} : ${mine.o.name}` : mine.o.name ? t.wrongKnown(mine.o.name) : t.wrong}
            </div>
          )}
          {canType && (
            <GuessInput onGuess={(text, pick) => send({ t: 'guess', text, ...(pick ? { pick } : {}) })} suggestions criterion={s.criterion} choices={choices} onClearChoices={() => setChoices(null)} placeholder={t.typeHere} />
          )}
        </>
      )}
      {banner && <div key={JSON.stringify(ev) + s.round} className={`flash ${ev!.kind === 'ok' ? 'ok' : 'wrong'}`}>{banner}</div>}

      {s.phase === 'ended' && (
        <section className="card result-card">
          <p className="whistle">{s.winner ? t.rooms.winner(name(s.winner)) : t.gameOver}</p>
          {host ? <button className="primary big" onClick={() => send({ t: 'start' })}>{t.rooms.rematch}</button> : <p className="hint">{t.rooms.onlyHost}</p>}
        </section>
      )}

      <section className="card">
        <ul className="room-players">
          {s.players.map((p) => (
            <li key={p.id} className={`${p.connected ? '' : 'off'} ${p.lives <= 0 && s.phase !== 'lobby' ? 'out' : ''}`}>
              <span>{flag(p.country)}</span>
              <span className="lb-name">{p.pseudo}{p.host && ' 👑'}{p.id === me && <em> ({t.you})</em>}<small>{clubName(meta, p.club, lang, t)}</small></span>
              {(s.game === 'bomb' || s.game === 'chain') && s.phase !== 'lobby' && <span className="lives">{'❤️'.repeat(Math.max(0, p.lives))}</span>}
              {royale && s.phase !== 'lobby' && <span className="royale-score"><strong>{p.roundFound ?? 0}</strong> <small>{t.rooms.thisRound}</small> · {p.found ?? 0} <small>{t.rooms.total}</small></span>}
            </li>
          ))}
        </ul>
        {s.phase === 'lobby' && (host ? (
          <>
            {s.game === 'duel' && (
              <div className="variant">
                <span className="hint">{t.rooms.ballSpeed}</span>
                <div className="tabs">
                  {DUEL_SECONDS.map((n) => <button key={n} className={(s.duelSeconds ?? DUEL_DEFAULT_SECONDS) === n ? 'on' : ''} onClick={() => send({ t: 'settings', duelSeconds: n })}>{n} s</button>)}
                </div>
              </div>
            )}
            {editTheme ? <ThemePicker meta={meta} value={s.criterion} onChange={(c) => send({ t: 'criterion', criterion: c })} /> : <button className="link" onClick={() => setEditTheme(true)}>{t.rooms.changeTheme}</button>}
            <button className="primary big" disabled={s.players.filter((p) => p.connected).length < 2} onClick={() => send({ t: 'start' })}>{t.rooms.startGame}</button>
          </>
        ) : <p className="hint">{s.players.length < 2 ? t.rooms.waiting : t.rooms.onlyHost}</p>)}
        {error && <p className="error">{error}</p>}
      </section>

      {s.cited.length > 0 && (
        <section className="card">
          <h3>{t.rooms.cited} ({s.cited.length})</h3>
          <p className="cited">{[...s.cited].reverse().join(' · ')}</p>
        </section>
      )}
    </div>
  );
}

function BombTable({ s, me }: { s: RoomState; me: string }) {
  const alive = s.players;
  const n = alive.length;
  return (
    <div className="bomb-table">
      <div className="table-felt" />
      {alive.map((p, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const holder = s.turn === p.id;
        return (
          <div key={p.id} className={`seat ${holder ? 'holder' : ''} ${p.lives <= 0 ? 'out' : ''} ${p.id === me ? 'me' : ''}`} style={{ left: `${50 + Math.cos(a) * 40}%`, top: `${50 + Math.sin(a) * 40}%` }}>
            <span className="seat-flag">{flag(p.country)}</span>
            <span className="seat-name">{p.pseudo}</span>
            {holder && <span className="bomb">💣</span>}
          </div>
        );
      })}
    </div>
  );
}

const GOAL_W = 46; // px, goal depth on each side of the pitch
const BALL_R = 16;

/** Side view of the pitch: a goal at each end, the ball rolls towards the player who must answer. */
function DuelTrack({ s, me, offset }: { s: RoomState; me: string; offset: number }) {
  const [, tick] = useState(0);
  const pitch = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => { tick((x) => x + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const b = s.ball!;
  const pos = Math.min(1, Math.max(0, b.pos + b.dir * b.speed * (Date.now() + offset - b.at)));
  const width = pitch.current?.clientWidth ?? 320;
  const travel = width - 2 * (GOAL_W + BALL_R);
  const x = GOAL_W + BALL_R + pos * travel;
  const angle = ((x - width / 2) / BALL_R) * (180 / Math.PI); // rolling without slipping
  const [p0, p1] = s.players;
  const target = b.dir === -1 ? 0 : 1;
  return (
    <div className="duel2">
      <div className="duel2-names">
        <span className={`${p0?.id === me ? 'me' : ''} ${target === 0 ? 'threat' : ''}`}>{flag(p0?.country ?? '')} {p0?.pseudo}</span>
        <span className={`${p1?.id === me ? 'me' : ''} ${target === 1 ? 'threat' : ''}`}>{p1?.pseudo} {flag(p1?.country ?? '')}</span>
      </div>
      <div className="duel2-pitch" ref={pitch}>
        <Goal side="left" threat={target === 0} />
        <Goal side="right" threat={target === 1} />
        <div className="duel2-shadow" style={{ left: x }} />
        <svg className="duel2-ball" style={{ left: x - BALL_R, transform: `rotate(${angle}deg)` }} width={BALL_R * 2} height={BALL_R * 2} viewBox="-20 -20 40 40" aria-hidden>
          <circle r="19" fill="#fbfbf7" stroke="#1d1d1d" strokeWidth="1.5" />
          <polygon points="0,-7 6.7,-2.2 4.1,5.7 -4.1,5.7 -6.7,-2.2" fill="#1d1d1d" />
          <path d="M0,-7 L0,-14 M6.7,-2.2 L13.3,-4.3 M4.1,5.7 L8.2,11.3 M-4.1,5.7 L-8.2,11.3 M-6.7,-2.2 L-13.3,-4.3" stroke="#1d1d1d" strokeWidth="1.5" />
          <path d="M-5,-19 L0,-14 L5,-19 Z M17.5,-8 L13.3,-4.3 L16,2 Z M10,16.5 L8.2,11.3 L3,16 Z M-10,16.5 L-8.2,11.3 L-3,16 Z M-17.5,-8 L-13.3,-4.3 L-16,2 Z" fill="#1d1d1d" />
        </svg>
      </div>
    </div>
  );
}

function Goal({ side, threat }: { side: 'left' | 'right'; threat: boolean }) {
  return (
    <svg className={`duel2-goal ${side} ${threat ? 'threat' : ''}`} width={GOAL_W} height="74" viewBox="0 0 46 74" aria-hidden>
      <defs>
        <pattern id={`net-${side}`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 0 L6 6 M6 0 L0 6" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />
        </pattern>
      </defs>
      {/* net (back of the goal), then the posts seen from the side */}
      <polygon points="40,4 6,14 6,74 40,74" fill={`url(#net-${side})`} />
      <path d="M40 74 L40 4 L6 14 L6 74" fill="none" stroke="#e9e9e2" strokeWidth="2" />
      <rect x="38" y="2" width="5" height="72" rx="2" fill="#fff" />
    </svg>
  );
}
