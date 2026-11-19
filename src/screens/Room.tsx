import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { clubName, flag, fmtClock, themeLabel } from '../format';
import { ChainView, ThemePicker } from '../ui';
import type { Nav } from '../App';
import type { Criterion, GuessOutcome, Meta, RoomClientMsg, RoomGame, RoomServerMsg, RoomState } from '../../shared/types';

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
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editTheme, setEditTheme] = useState(false);
  const [mine, setMine] = useState<{ o: GuessOutcome; key: number } | null>(null); // battle royale: my own answers
  const [now, setNow] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(api.roomSocketUrl(code));
      ws.current = sock;
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as RoomServerMsg;
        if (m.t === 'state') { setS(m.state); setOffset(m.state.serverNow - Date.now()); }
        else if (m.t === 'you') setMe(m.id);
        else if (m.t === 'outcome') setMine({ o: m.outcome, key: Date.now() });
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
          {royale && mine && mine.o.status !== 'invalid' && (
            <div key={mine.key} className={`flash ${mine.o.status}`}>
              {mine.o.status === 'ok' ? `${t.ok} ${mine.o.name}` : mine.o.status === 'duplicate' ? `${t.duplicate} : ${mine.o.name}` : mine.o.name ? t.wrongKnown(mine.o.name) : t.wrong}
            </div>
          )}
          {canType && (
            <form className="guess-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ t: 'guess', text: text.trim() }); setText(''); } }}>
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t.typeHere} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" />
            </form>
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

function DuelTrack({ s, me, offset }: { s: RoomState; me: string; offset: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => { tick((x) => x + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const b = s.ball!;
  const pos = Math.min(1, Math.max(0, b.pos + b.dir * b.speed * (Date.now() + offset - b.at)));
  const [p0, p1] = s.players;
  return (
    <div className="duel">
      <div className={`duel-player ${p0?.id === me ? 'me' : ''}`}>{flag(p0?.country ?? '')}<span>{p0?.pseudo}</span></div>
      <div className="duel-pitch">
        <div className="duel-line" />
        <div className="duel-ball" style={{ left: `${pos * 100}%` }}>⚽</div>
      </div>
      <div className={`duel-player ${p1?.id === me ? 'me' : ''}`}>{flag(p1?.country ?? '')}<span>{p1?.pseudo}</span></div>
    </div>
  );
}
