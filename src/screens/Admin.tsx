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
  const res = await fetch('/api/admin' + path, { method, headers: { 'Content-Type': 'application/json', 'x-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'server_error');
  return json as R;
}

export function AdminPage({ meta }: { meta: Meta }) {
  const [key, setKey] = useState(readKey);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    if (!key) return;
    setRows(null); setError('');
    admin<ReportRow[]>('GET', `/reports?status=${tab}`, key).then(setRows).catch((e: Error) => {
      setError(e.message === 'bad_admin_key' ? 'Mot de passe incorrect.' : e.message === 'admin_not_configured' ? 'Le mot de passe admin n’est pas encore configuré (secret ADMIN_KEY).' : 'Erreur serveur.');
      if (e.message === 'bad_admin_key') { setKey(''); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
    });
  };
  useEffect(load, [key, tab]);

  if (!key) return (
    <div className="card admin">
      <h2>Administration</h2>
      <p className="hint">Les signalements sont vérifiés automatiquement sur Wikipédia ; seuls les cas douteux restent ici. Entre le mot de passe admin (le secret ADMIN_KEY). Il reste dans ce navigateur.</p>
      <form onSubmit={(e) => { e.preventDefault(); try { localStorage.setItem(KEY, draft); } catch { /* ignore */ } setKey(draft); }}>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="current-password" />
        <button className="primary" disabled={!draft}>Entrer</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
  return (
    <div className="card admin">
      <h2>Signalements</h2>
      <div className="tabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>À traiter</button>
        <button className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>Traités</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? <p className="hint">…</p> : rows.length === 0 ? <p className="hint">Aucun signalement.</p> : (
        <ul className="reports">{rows.map((r) => <ReportItem key={r.id} r={r} meta={meta} adminKey={key} onDone={load} />)}</ul>
      )}
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
