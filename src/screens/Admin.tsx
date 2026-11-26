// Admin page (French only, for the site owner): review "this answer should have counted" reports.
// Protected by the ADMIN_KEY secret, typed once and kept in this browser.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { themeLabel } from '../format';
import type { Criterion, Meta, Suggestion } from '../../shared/types';

interface ReportRow {
  id: number; text: string; recognised: string | null; criterion: Criterion; note: string | null; created_at: number; status: string; game_id: string | null; pseudo: string | null; resolution: string | null;
  player: { q: string; n: string; career: string; inTheme: boolean } | null;
}
const KEY = 'ntp-admin-key';
const STATUS: Record<string, string> = { accepted: 'Acceptée', rejected: 'Rejetée', auto_accepted: 'Acceptée automatiquement', auto_rejected: 'Rejetée automatiquement' };
const readKey = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };

async function admin<R>(method: string, path: string, key: string, body?: unknown): Promise<R> {
  const res = await fetch('/api/admin' + path, { method, headers: { 'Content-Type': 'application/json', 'x-admin-key': encodeURIComponent(key) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const j = json as { error?: string; got?: number; want?: number };
    throw Object.assign(new Error(j.error ?? 'server_error'), { got: j.got, want: j.want });
  }
  return json as R;
}

export function AdminPage({ meta }: { meta: Meta }) {
  const [key, setKey] = useState(readKey);
  const [section, setSection] = useState<'reports' | 'suspects'>('reports');
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    if (!key) return;
    setRows(null); setError('');
    admin<ReportRow[]>('GET', `/reports?status=${tab}`, key).then(setRows).catch((e: Error) => {
      setError(e.message === 'bad_admin_key' ? `Mot de passe incorrect (tu as saisi ${(e as Error & { got?: number }).got ?? '?'} caractères, le site en attend ${(e as Error & { want?: number }).want ?? '?'}).` : e.message === 'admin_not_configured' ? 'Le mot de passe admin n’est pas encore configuré (secret ADMIN_KEY).' : 'Erreur serveur.');
      if (e.message === 'bad_admin_key') { setKey(''); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
    });
  };
  useEffect(() => { if (section === 'reports') load(); }, [key, tab, section]);

  if (!key) return (
    <div className="card admin">
      <h2>Administration</h2>
      <p className="hint">Les signalements sont vérifiés automatiquement sur Wikipédia ; seuls les cas douteux restent ici. Entre le mot de passe admin (le secret ADMIN_KEY). Il reste dans ce navigateur.</p>
      <form onSubmit={(e) => { e.preventDefault(); try { localStorage.setItem(KEY, draft.trim()); } catch { /* ignore */ } setKey(draft.trim()); }}>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="current-password" />
        <button className="primary" disabled={!draft}>Entrer</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
  return (
    <div className="card admin">
      <div className="tabs">
        <button className={section === 'reports' ? 'on' : ''} onClick={() => setSection('reports')}>Signalements</button>
        <button className={section === 'suspects' ? 'on' : ''} onClick={() => setSection('suspects')}>Scores suspects</button>
      </div>
      {section === 'suspects' ? <Suspects meta={meta} adminKey={key} /> : <>
      <h2>Signalements</h2>
      <div className="tabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>À traiter</button>
        <button className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>Traités</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? <p className="hint">…</p> : rows.length === 0 ? <p className="hint">Aucun signalement.</p> : (
        <ul className="reports">{rows.map((r) => <ReportItem key={r.id} r={r} meta={meta} adminKey={key} onDone={load} />)}</ul>
      )}
      </>}
    </div>
  );
}

function ReportItem({ r, meta, adminKey, onDone }: { r: ReportRow; meta: Meta; adminKey: string; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [player, setPlayer] = useState(r.player && !r.player.inTheme ? r.player : null);
  const [search, setSearch] = useState(r.player ? '' : r.text);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (r.status !== 'open' || search.trim().length < 3) { setFound([]); return; }
    const h = setTimeout(() => api.suggest(search).then(setFound).catch(() => {}), 200);
    return () => clearTimeout(h);
  }, [search]);
  const choose = async (q: string) => { setPlayer(await admin('GET', `/player?q=${q}`, adminKey)); setFound([]); setSearch(''); };
  const act = async (action: string) => {
    setBusy(true);
    try { await admin('POST', `/reports/${r.id}`, adminKey, { action, player: player?.q }); onDone(); } finally { setBusy(false); }
  };
  return (
    <li className="report-item">
      <div className="report-head">
        <strong>« {r.text} »</strong>
        <small>{new Date(r.created_at).toLocaleString(lang)} · {r.pseudo ?? 'anonyme'}</small>
      </div>
      <p className="hint">Thème : {themeLabel(r.criterion, meta, lang, t)}</p>
      {r.player ? (
        <p className="hint">Reconnu comme <b>{r.player.n}</b> ({r.player.career || 'aucun club connu'}) · {r.player.inTheme ? 'il est déjà dans le thème aujourd’hui' : 'hors thème d’après nos données'}</p>
      ) : <p className="hint">Joueur non reconnu par le jeu.</p>}
      {r.note && <p className="hint">Note : {r.note}</p>}
      {r.resolution && <p className="hint">Vérification automatique : {r.resolution}</p>}
      {r.status === 'open' ? (
        <>
          {player && <p className="report-player">Joueur à accepter : <b>{player.n}</b> <small>{player.career}</small></p>}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un autre joueur…" />
          {found.length > 0 && <ul className="suggest static">{found.map((s) => <li key={s.q} onClick={() => choose(s.q)}><span className="suggest-name">{s.n}</span><small>{s.club ?? ''}</small></li>)}</ul>}
          <div className="row">
            <button className="primary" disabled={busy || !player} onClick={() => act('accept')}>Accepter pour ce thème</button>
            <button disabled={busy} onClick={() => act('reject')}>Rejeter</button>
          </div>
        </>
      ) : (
        <div className="row"><span className={`pill ${r.status.endsWith('accepted') ? 'easy' : 'hard'}`}>{STATUS[r.status] ?? r.status}</span><button className="link" disabled={busy} onClick={() => act('reopen')}>Rouvrir</button></div>
      )}
    </li>
  );
}

interface SuspectRow { game_id: string; mode: string; count: number; errors: number; seconds: number; created_at: number; flag: string; criterion: Criterion; pseudo: string | null }
const FLAG: Record<string, string> = { cleared: 'Validé', removed: 'Retiré (triche)' };

/** Scores no human could reach (too many answers a minute), kept out of the rankings until reviewed. */
function Suspects({ meta, adminKey }: { meta: Meta; adminKey: string }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<SuspectRow[] | null>(null);
  const [error, setError] = useState('');
  const load = () => { setRows(null); setError(''); admin<SuspectRow[]>('GET', `/suspects?status=${tab}`, adminKey).then(setRows).catch(() => setError('Erreur serveur.')); };
  useEffect(load, [tab]);
  const act = async (id: string, action: string) => { await admin('POST', `/suspects/${id}`, adminKey, { action }).catch(() => setError('Erreur serveur.')); load(); };
  return (
    <>
      <h2>Scores suspects</h2>
      <p className="hint">Parties avec plus de 45 bonnes réponses par minute : hors classement tant que tu n’as pas décidé. Le joueur ne voit rien.</p>
      <div className="tabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>À traiter</button>
        <button className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>Traités</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? <p className="hint">…</p> : rows.length === 0 ? <p className="hint">Aucun score suspect.</p> : (
        <ul className="reports">{rows.map((r) => (
          <li key={r.game_id} className="report-item">
            <div className="report-head">
              <strong>{r.count} joueurs en {Math.floor(r.seconds / 60)} min {r.seconds % 60} s</strong>
              <small>{new Date(r.created_at).toLocaleString(lang)} · {r.pseudo ?? '?'}</small>
            </div>
            <p className="hint">Mode : {r.mode} · Thème : {themeLabel(r.criterion, meta, lang, t)} · {r.errors} erreur(s) · {Math.round((r.count * 60) / Math.max(r.seconds, 1))} par minute</p>
            {tab === 'open' ? (
              <div className="row">
                <button className="primary" onClick={() => act(r.game_id, 'clear')}>C’est un humain : remettre au classement</button>
                <button onClick={() => act(r.game_id, 'remove')}>Triche : retirer</button>
              </div>
            ) : (
              <div className="row"><span className={`pill ${r.flag === 'cleared' ? 'easy' : 'hard'}`}>{FLAG[r.flag] ?? r.flag}</span><button className="link" onClick={() => act(r.game_id, 'reopen')}>Rouvrir</button></div>
            )}
          </li>
        ))}</ul>
      )}
    </>
  );
}
