// Mystery player: second daily game. Ask yes/no questions from a guided list, then name the player.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useI18n, type Lang, type T } from '../i18n';
import { clubName, countryName, flag, leagueName, seasonLabel } from '../format';
import { GuessInput, ordinal, Silhouette, topShareValue } from '../ui';
import type { Nav } from '../App';
import type { MysteryHint, MysteryStep, MysteryMeta, Continent, LeagueId, Meta, MysteryBoard, MysteryCmp, MysteryHistoryItem, MysteryInfo, MysteryNum, MysteryQuestion, MysteryState, Position, Suggestion } from '../../shared/types';
import { CONTINENTS, MYSTERY_HINTS, MYSTERY_MAX } from '../../shared/types';

// ---------- questions as text ----------
const YEAR_NUMS: MysteryNum[] = ['birthYear', 'debut', 'lastSeason'];
const SEASON_NUMS: MysteryNum[] = ['debut', 'lastSeason'];
function leagueLabel(meta: Meta, id: string, lang: Lang) {
  const l = meta.leagues.find((x) => x.id === id);
  return l ? leagueName(l, lang) : id;
}
/** Clubs outside the big 5 (loaded once from the server). */
let extraClubs: MysteryMeta | null = null;
let extraPending: Promise<MysteryMeta> | null = null;
function useMysteryMeta(): MysteryMeta | null {
  const [x, setX] = useState(extraClubs);
  useEffect(() => {
    if (extraClubs) return;
    extraPending ??= api.mysteryMeta().then((r) => (extraClubs = r));
    extraPending.then(setX).catch(() => {});
  }, []);
  return x;
}
export function questionText(q: MysteryQuestion, t: T, meta: Meta, lang: Lang): string {
  const m = t.mystery;
  const anyClubName = (cq: string) => {
    const e = extraClubs?.clubs.find((c) => c.q === cq);
    return e ? (lang === 'fr' && e.nf) || e.n : clubName(meta, cq, lang);
  };
  switch (q.k) {
    case 'num': {
      const tpl = m.num[q.f]?.[q.op === 'gt' ? 0 : q.op === 'lt' ? 1 : 2] ?? '';
      return tpl.replace('{v}', SEASON_NUMS.includes(q.f) ? seasonLabel(q.v) : String(q.v));
    }
    case 'position': return m.q.position(t.f.positions[q.v]);
    case 'nation': return m.q.nation(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'continent': return m.q.continent(m.continents[q.v]);
    case 'dual': return m.q.dual;
    case 'active': return m.q.active;
    case 'international': return m.q.international;
    case 'league': return m.q.league(leagueLabel(meta, q.v, lang));
    case 'club': return m.q.club(anyClubName(q.v));
    case 'clubNowIn': return m.q.clubNowIn(leagueLabel(meta, q.v, lang));
    case 'nowLeague': return q.v === 'other' ? m.q.nowOther : m.q.nowLeague(leagueLabel(meta, q.v, lang));
    case 'nowClub': return m.q.nowClub(anyClubName(q.v));
    case 'season': return m.q.season(seasonLabel(q.v));
    case 'champion': return m.q.champion(q.v ? leagueLabel(meta, q.v, lang) : '');
    case 'ucl': return q.v === 'won' ? m.q.uclWon : m.q.uclPlayed;
    case 'tournament': return m.q.tournament(q.v, `${t.f.tournaments[q.v] ?? q.v}${q.year ? ' ' + q.year : ''}`, !!q.won);
    case 'topScorer': return m.q.topScorer(q.v ? leagueLabel(meta, q.v, lang) : '');
    case 'ballonDor': return m.q.ballonDor;
    case 'mononym': return m.q.mononym;
    case 'citizen': return m.q.citizen(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'multiPos': return m.q.multiPos;
    case 'anyTournament': return q.won ? m.q.anyTournamentWon : m.q.anyTournament;
    case 'teammate': return m.q.teammate(q.n ?? '…');
    case 'home': return m.q.home;
    case 'abroad': return m.q.abroad;
    case 'returned': return m.q.returned;
    case 'playedCountry': return m.q.playedCountry(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'playedContinent': return m.q.playedContinent(m.continents[q.v]);
    case 'nowCountry': return m.q.nowCountry(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'youthClub': return m.q.youthClub(anyClubName(q.v));
    case 'youthCountry': return m.q.youthCountry(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'youthHome': return m.q.youthHome;
    case 'bornCountry': return m.q.bornCountry(`${flag(q.v)} ${countryName(q.v, lang)}`);
    case 'bornContinent': return m.q.bornContinent(m.continents[q.v]);
    case 'bornHome': return m.q.bornHome;
    case 'lowerDiv': return m.q.lowerDiv(q.v ? m.lower[q.v] : '');
  }
}

/** "Last-name initial: M", "One of his 3 main clubs: Arsenal". */
function hintText(s: Extract<MysteryStep, { hint: string }>, t: T, meta: Meta, lang: Lang): string {
  const m = t.mystery;
  if (s.hint === 'first' || s.hint === 'last') return `${m.hints[s.hint]} : ${s.v || m.singleName}`;
  const e = extraClubs?.clubs.find((c) => c.q === s.v);
  const name = e ? (lang === 'fr' && e.nf) || e.n : meta.clubs.some((c) => c.q === s.v) ? clubName(meta, s.v, lang) : s.n ?? s.v;
  return `${m.hints[s.hint]} : ${name}`;
}

function Hints({ g, busy, onHint }: { g: MysteryState | null; busy: boolean; onHint: (h: MysteryHint) => void }) {
  const { t } = useI18n();
  const m = t.mystery;
  const used = g?.used ?? 0;
  const taken = new Set((g?.steps ?? []).flatMap((s) => ('hint' in s ? [s.hint] : [])));
  return (
    <section className="card">
      <h3>{m.hintsTitle}</h3>
      <p className="hint">{m.hintsHint}</p>
      <div className="mq-hints">
        {MYSTERY_HINTS.map((h) => (
          <button key={h.id} disabled={busy || taken.has(h.id) || used + h.cost >= MYSTERY_MAX} onClick={() => onHint(h.id)}>
            <span>💡 {m.hints[h.id]}</span><small>{taken.has(h.id) ? '✓' : m.cost(h.cost)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- question builder ----------
type Param = 'clubCountry' | 'birthCountry' | 'player' | 'lowerOpt' | 'none' | 'num' | 'position' | 'nation' | 'continent' | 'league' | 'leagueOpt' | 'leagueOther' | 'club' | 'season' | 'tournament';
interface Tpl { id: string; cat: 'who' | 'career' | 'clubs' | 'world' | 'honours'; param: Param; num?: MysteryNum; def?: number; min?: number; max?: number }
const TEMPLATES: Tpl[] = [
  { id: 'position', cat: 'who', param: 'position' },
  { id: 'multiPos', cat: 'who', param: 'none' },
  { id: 'nation', cat: 'who', param: 'nation' },
  { id: 'citizen', cat: 'who', param: 'nation' },
  { id: 'continent', cat: 'who', param: 'continent' },
  { id: 'bornCountry', cat: 'who', param: 'birthCountry' },
  { id: 'bornContinent', cat: 'who', param: 'continent' },
  { id: 'bornHome', cat: 'who', param: 'none' },
  { id: 'age', cat: 'who', param: 'num', num: 'age', def: 30, min: 15, max: 60 },
  { id: 'birthYear', cat: 'who', param: 'num', num: 'birthYear', def: 1990, min: 1960, max: 2010 },
  { id: 'height', cat: 'who', param: 'num', num: 'height', def: 180, min: 155, max: 210 },
  { id: 'dual', cat: 'who', param: 'none' },
  { id: 'international', cat: 'who', param: 'none' },
  { id: 'caps', cat: 'who', param: 'num', num: 'caps', def: 20, min: 0, max: 250 },
  { id: 'active', cat: 'career', param: 'none' },
  { id: 'nowLeague', cat: 'career', param: 'leagueOther' },
  { id: 'nowClub', cat: 'clubs', param: 'club' },
  { id: 'league', cat: 'career', param: 'league' },
  { id: 'club', cat: 'clubs', param: 'club' },
  { id: 'clubNowIn', cat: 'clubs', param: 'league' },
  { id: 'clubs', cat: 'clubs', param: 'num', num: 'clubs', def: 3, min: 0, max: 20 },
  { id: 'leagues', cat: 'career', param: 'num', num: 'leagues', def: 1, min: 0, max: 5 },
  { id: 'debut', cat: 'career', param: 'num', num: 'debut', def: 2010, min: 2000, max: 2026 },
  { id: 'seasons', cat: 'career', param: 'num', num: 'seasons', def: 10, min: 0, max: 27 },
  { id: 'season', cat: 'career', param: 'season' },
  { id: 'lastSeason', cat: 'career', param: 'num', num: 'lastSeason', def: 2015, min: 2000, max: 2026 },
  { id: 'loyalty', cat: 'clubs', param: 'num', num: 'loyalty', def: 5, min: 0, max: 27 },
  { id: 'countries', cat: 'world', param: 'num', num: 'countries', def: 1, min: 0, max: 5 },
  { id: 'home', cat: 'world', param: 'none' },
  { id: 'abroad', cat: 'world', param: 'none' },
  { id: 'returned', cat: 'clubs', param: 'none' },
  { id: 'lowerDiv', cat: 'career', param: 'lowerOpt' },
  { id: 'teammate', cat: 'clubs', param: 'player' },
  { id: 'playedCountry', cat: 'world', param: 'clubCountry' },
  { id: 'playedContinent', cat: 'world', param: 'continent' },
  { id: 'nowCountry', cat: 'world', param: 'clubCountry' },
  { id: 'allClubs', cat: 'clubs', param: 'num', num: 'allClubs', def: 4, min: 0, max: 25 },
  { id: 'allCountries', cat: 'world', param: 'num', num: 'allCountries', def: 2, min: 0, max: 12 },
  { id: 'youthClub', cat: 'clubs', param: 'club' },
  { id: 'youthCountry', cat: 'world', param: 'clubCountry' },
  { id: 'youthHome', cat: 'world', param: 'none' },
  { id: 'champion', cat: 'honours', param: 'leagueOpt' },
  { id: 'titles', cat: 'honours', param: 'num', num: 'titles', def: 1, min: 0, max: 20 },
  { id: 'uclPlayed', cat: 'honours', param: 'none' },
  { id: 'uclWon', cat: 'honours', param: 'none' },
  { id: 'uclSeasons', cat: 'honours', param: 'num', num: 'uclSeasons', def: 5, min: 0, max: 25 },
  { id: 'uclWins', cat: 'honours', param: 'num', num: 'uclWins', def: 1, min: 0, max: 10 },
  { id: 'anyTournament', cat: 'honours', param: 'none' },
  { id: 'anyTournamentWon', cat: 'honours', param: 'none' },
  { id: 'tournament', cat: 'honours', param: 'tournament' },
  { id: 'worldCups', cat: 'honours', param: 'num', num: 'worldCups', def: 1, min: 0, max: 6 },
  { id: 'euros', cat: 'honours', param: 'num', num: 'euros', def: 1, min: 0, max: 6 },
  { id: 'copas', cat: 'honours', param: 'num', num: 'copas', def: 1, min: 0, max: 8 },
  { id: 'tournaments', cat: 'honours', param: 'num', num: 'tournaments', def: 2, min: 0, max: 15 },
  { id: 'topScorer', cat: 'honours', param: 'leagueOpt' },
  { id: 'topScorerTimes', cat: 'honours', param: 'num', num: 'topScorerTimes', def: 1, min: 0, max: 10 },
  { id: 'ballonDor', cat: 'honours', param: 'none' },
  { id: 'ballonDorTimes', cat: 'honours', param: 'num', num: 'ballonDorTimes', def: 3, min: 0, max: 20 },
  { id: 'mononym', cat: 'who', param: 'none' },
];
const CATS = ['who', 'career', 'clubs', 'world', 'honours'] as const;

interface Values { op: MysteryCmp; n: Record<string, number>; pos: Position; nation: string; continent: Continent; league: LeagueId; leagueOpt: LeagueId | ''; leagueOther: LeagueId | 'other'; club: string; season: number; tour: 'WC' | 'EU' | 'CA'; year: string; won: boolean; mate?: { q: string; n: string }; country: string; bornIn: string }

function build(tpl: Tpl, v: Values): MysteryQuestion {
  switch (tpl.id) {
    case 'position': return { k: 'position', v: v.pos };
    case 'nation': return { k: 'nation', v: v.nation };
    case 'continent': return { k: 'continent', v: v.continent };
    case 'dual': return { k: 'dual' };
    case 'international': return { k: 'international' };
    case 'active': return { k: 'active' };
    case 'nowLeague': return { k: 'nowLeague', v: v.leagueOther };
    case 'nowClub': return { k: 'nowClub', v: v.club };
    case 'league': return { k: 'league', v: v.league };
    case 'club': return { k: 'club', v: v.club };
    case 'clubNowIn': return { k: 'clubNowIn', v: v.league };
    case 'season': return { k: 'season', v: v.season };
    case 'champion': return v.leagueOpt ? { k: 'champion', v: v.leagueOpt } : { k: 'champion' };
    case 'uclPlayed': return { k: 'ucl', v: 'played' };
    case 'uclWon': return { k: 'ucl', v: 'won' };
    case 'tournament': return { k: 'tournament', v: v.tour, ...(v.year ? { year: +v.year } : {}), ...(v.won ? { won: true } : {}) };
    case 'topScorer': return v.leagueOpt ? { k: 'topScorer', v: v.leagueOpt } : { k: 'topScorer' };
    case 'ballonDor': return { k: 'ballonDor' };
    case 'mononym': return { k: 'mononym' };
    case 'citizen': return { k: 'citizen', v: v.nation };
    case 'multiPos': return { k: 'multiPos' };
    case 'anyTournament': return { k: 'anyTournament' };
    case 'anyTournamentWon': return { k: 'anyTournament', won: true };
    case 'teammate': return { k: 'teammate', v: v.mate?.q ?? '', n: v.mate?.n };
    case 'home': return { k: 'home' };
    case 'abroad': return { k: 'abroad' };
    case 'returned': return { k: 'returned' };
    case 'playedCountry': return { k: 'playedCountry', v: v.country };
    case 'playedContinent': return { k: 'playedContinent', v: v.continent };
    case 'nowCountry': return { k: 'nowCountry', v: v.country };
    case 'youthClub': return { k: 'youthClub', v: v.club };
    case 'youthCountry': return { k: 'youthCountry', v: v.country };
    case 'youthHome': return { k: 'youthHome' };
    case 'bornCountry': return { k: 'bornCountry', v: v.bornIn };
    case 'bornContinent': return { k: 'bornContinent', v: v.continent };
    case 'bornHome': return { k: 'bornHome' };
    case 'lowerDiv': return v.leagueOpt ? { k: 'lowerDiv', v: v.leagueOpt } : { k: 'lowerDiv' };
    default: return { k: 'num', f: tpl.num!, op: v.op, v: v.n[tpl.id] ?? tpl.def! };
  }
}
const qKey = (q: MysteryQuestion) => { const { n: _n, ...rest } = q as MysteryQuestion & { n?: string }; return JSON.stringify(rest, Object.keys(rest).sort()); };

function QuestionBuilder({ meta, asked, busy, onAsk }: { meta: Meta; asked: Set<string>; busy: boolean; onAsk: (q: MysteryQuestion) => void }) {
  const { t, lang } = useI18n();
  const m = t.mystery;
  const [cat, setCat] = useState<(typeof CATS)[number]>('who');
  const [tplId, setTplId] = useState('position');
  const [v, setV] = useState<Values>({
    op: 'gt', n: {}, pos: 'FW', nation: meta.nationalities[0] ?? 'FR', continent: 'EU', league: 'PL', leagueOpt: '', leagueOther: 'PL',
    club: '', season: meta.currentSeason - 1, tour: 'WC', year: '', won: false, country: 'PT', bornIn: 'FR',
  });
  const set = (p: Partial<Values>) => setV((x) => ({ ...x, ...p }));
  const mm = useMysteryMeta();
  const clubs = useMemo(() => [
    ...meta.clubs.map((c) => ({ q: c.q, name: clubName(meta, c.q, lang) })),
    ...(mm?.clubs ?? []).map((c) => ({ q: c.q, name: `${(lang === 'fr' && c.nf) || c.n} ${flag(c.c)}` })),
  ].sort((a, b) => a.name.localeCompare(b.name, lang)), [meta, lang, mm]);
  const byName = (list: string[]) => [...list].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang));
  const clubCountries = useMemo(() => byName(mm?.clubCountries ?? ['GB', 'FR', 'ES', 'IT', 'DE', 'PT']), [mm, lang]);
  const birthCountries = useMemo(() => byName(mm?.birthCountries ?? ['FR']), [mm, lang]);
  const nations = useMemo(() => [...meta.nationalities].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang)), [meta, lang]);
  const tpl = TEMPLATES.find((x) => x.id === tplId)!;
  const [mateChoices, setMateChoices] = useState<Suggestion[] | null>(null);
  const pickMate = async (text: string, pick?: string) => {
    if (pick) { set({ mate: { q: pick, n: text } }); return; }
    const list = await api.suggest(text).catch(() => []);
    if (list.length === 1) set({ mate: { q: list[0].q, n: list[0].n } }); else setMateChoices(list);
  };
  const club = v.club || clubs[0]?.q || '';
  const q = build(tpl, { ...v, club });
  const already = asked.has(qKey(q));
  const incomplete = q.k === 'teammate' && !q.v;
  const years = meta.tournaments.find((x) => x.code === v.tour)?.years ?? [];
  const isYear = tpl.num && YEAR_NUMS.includes(tpl.num);

  return (
    <div className="mq-builder">
      <div className="tabs mq-cats">{CATS.map((c) => (
        <button key={c} className={c === cat ? 'on' : ''} onClick={() => { setCat(c); setTplId(TEMPLATES.find((x) => x.cat === c)!.id); }}>{m.cats[c]}</button>
      ))}</div>
      <div className="mq-tpls">{TEMPLATES.filter((x) => x.cat === cat).map((x) => (
        <button key={x.id} className={x.id === tplId ? 'on' : ''} onClick={() => setTplId(x.id)}>{m.templates[x.id]}</button>
      ))}</div>
      <div className="mq-params">
        {tpl.param === 'num' && <>
          <div className="mq-ops">{(['gt', 'lt', 'eq'] as const).map((op) => (
            <button key={op} className={v.op === op ? 'on' : ''} onClick={() => set({ op })}>{(isYear ? m.opsYear : m.ops)[op]}</button>
          ))}</div>
          {tpl.num === 'debut' ? (
            <select value={v.n[tpl.id] ?? tpl.def} onChange={(e) => set({ n: { ...v.n, [tpl.id]: +e.target.value } })}>
              {Array.from({ length: meta.currentSeason - meta.firstSeason + 1 }, (_, i) => meta.firstSeason + i).map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
            </select>
          ) : (
            <div className="mq-stepper">
              <button aria-label="−" onClick={() => set({ n: { ...v.n, [tpl.id]: Math.max(tpl.min!, (v.n[tpl.id] ?? tpl.def!) - 1) } })}>−</button>
              <input type="number" inputMode="numeric" min={tpl.min} max={tpl.max} value={v.n[tpl.id] ?? tpl.def}
                onChange={(e) => set({ n: { ...v.n, [tpl.id]: Math.max(tpl.min!, Math.min(tpl.max!, Math.round(+e.target.value || 0))) } })} />
              <button aria-label="+" onClick={() => set({ n: { ...v.n, [tpl.id]: Math.min(tpl.max!, (v.n[tpl.id] ?? tpl.def!) + 1) } })}>+</button>
            </div>
          )}
        </>}
        {tpl.param === 'position' && <div className="mq-ops">{(['GK', 'DF', 'MF', 'FW'] as const).map((p) => (
          <button key={p} className={v.pos === p ? 'on' : ''} onClick={() => set({ pos: p })}>{t.f.positions[p]}</button>
        ))}</div>}
        {tpl.param === 'nation' && (
          <select value={v.nation} onChange={(e) => set({ nation: e.target.value })}>
            {nations.map((c) => <option key={c} value={c}>{flag(c)} {countryName(c, lang)}</option>)}
          </select>
        )}
        {tpl.param === 'clubCountry' && (
          <select value={v.country} onChange={(e) => set({ country: e.target.value })}>
            {clubCountries.map((c) => <option key={c} value={c}>{flag(c)} {countryName(c, lang)}</option>)}
          </select>
        )}
        {tpl.param === 'birthCountry' && (
          <select value={v.bornIn} onChange={(e) => set({ bornIn: e.target.value })}>
            {birthCountries.map((c) => <option key={c} value={c}>{flag(c)} {countryName(c, lang)}</option>)}
          </select>
        )}
        {tpl.param === 'continent' && <div className="mq-ops wrap">{CONTINENTS.map((c) => (
          <button key={c} className={v.continent === c ? 'on' : ''} onClick={() => set({ continent: c })}>{m.continents[c]}</button>
        ))}</div>}
        {tpl.param === 'player' && <>
          {v.mate && <p className="mq-mate">✓ {v.mate.n} <button className="link" onClick={() => set({ mate: undefined })}>✕</button></p>}
          {!v.mate && <GuessInput onGuess={pickMate} suggestions choices={mateChoices} onClearChoices={() => setMateChoices(null)} placeholder={m.matePlaceholder} />}
        </>}
        {tpl.param === 'lowerOpt' && (
          <div className="mq-ops wrap">
            <button className={v.leagueOpt === '' ? 'on' : ''} onClick={() => set({ leagueOpt: '' })}>{m.any}</button>
            {meta.leagues.map((l) => <button key={l.id} className={v.leagueOpt === l.id ? 'on' : ''} onClick={() => set({ leagueOpt: l.id })}>{m.lower[l.id]}</button>)}
          </div>
        )}
        {(tpl.param === 'league' || tpl.param === 'leagueOpt' || tpl.param === 'leagueOther') && (
          <div className="mq-ops wrap">
            {tpl.param === 'leagueOpt' && <button className={v.leagueOpt === '' ? 'on' : ''} onClick={() => set({ leagueOpt: '' })}>{m.any}</button>}
            {meta.leagues.map((l) => {
              const on = tpl.param === 'league' ? v.league === l.id : tpl.param === 'leagueOpt' ? v.leagueOpt === l.id : v.leagueOther === l.id;
              const pick = () => set(tpl.param === 'league' ? { league: l.id } : tpl.param === 'leagueOpt' ? { leagueOpt: l.id } : { leagueOther: l.id });
              return <button key={l.id} className={on ? 'on' : ''} onClick={pick}>{leagueName(l, lang)}</button>;
            })}
            {tpl.param === 'leagueOther' && <button className={v.leagueOther === 'other' ? 'on' : ''} onClick={() => set({ leagueOther: 'other' })}>{m.other}</button>}
          </div>
        )}
        {tpl.param === 'club' && (
          <select value={club} onChange={(e) => set({ club: e.target.value })}>
            {clubs.map((c) => <option key={c.q} value={c.q}>{c.name}</option>)}
          </select>
        )}
        {tpl.param === 'season' && (
          <select value={v.season} onChange={(e) => set({ season: +e.target.value })}>
            {Array.from({ length: meta.currentSeason - meta.firstSeason + 1 }, (_, i) => meta.currentSeason - i).map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
          </select>
        )}
        {tpl.param === 'tournament' && <>
          <div className="mq-ops">{(['WC', 'EU', 'CA'] as const).map((c) => (
            <button key={c} className={v.tour === c ? 'on' : ''} onClick={() => set({ tour: c, year: '' })}>{t.f.tournaments[c]}</button>
          ))}</div>
          <div className="mq-inline">
            <select value={v.year} onChange={(e) => set({ year: e.target.value })} aria-label={m.edition}>
              <option value="">{m.edition} : {m.any}</option>
              {[...years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <label className="mq-check"><input type="checkbox" checked={v.won} onChange={(e) => set({ won: e.target.checked })} /> {m.wonIt}</label>
          </div>
        </>}
      </div>
      <p className="mq-preview">{questionText(q, t, meta, lang)}</p>
      <button className="primary big" disabled={busy || already || incomplete} onClick={() => onAsk(q)}>{already ? m.already : m.ask}</button>
    </div>
  );
}

// ---------- game screen ----------
export function MysteryScreen({ meta, nav, date }: { meta: Meta; nav: Nav; date?: string }) {
  const { t, lang } = useI18n();
  const m = t.mystery;
  const [info, setInfo] = useState<MysteryInfo | null>(null);
  const [g, setG] = useState<MysteryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Suggestion[] | null>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean; key: number } | null>(null);
  const [error, setError] = useState('');
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);

  useEffect(() => {
    setInfo(null); setG(null);
    api.mystery(date).then((i) => { setInfo(i); setG(i.game); }).catch(() => setError(t.errorsMap.server_error));
  }, [date]);

  const run = async <R,>(f: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    try { return await f(); } catch { setError(t.errorsMap.server_error); return undefined; } finally { setBusy(false); }
  };
  const ask = async (q: MysteryQuestion) => {
    const s = await run(() => api.mysteryAsk(q, date));
    if (!s) return;
    const last = s.steps[s.steps.length - 1];
    if (last && 'q' in last) setFlash({ text: `${questionText(last.q, t, meta, lang)} ${last.a ? m.yes : m.no}`, ok: last.a, key: Date.now() });
    setG(s);
  };
  const guess = async (text: string, pick?: string) => {
    const r = await run(() => api.mysteryGuess(pick ? { pick } : { text }, date));
    if (!r) return;
    if (r.choose) { setChoices(r.choose); return; }
    if (r.state) {
      const last = r.state.steps[r.state.steps.length - 1];
      if (last && 'guess' in last && !last.a) setFlash({ text: m.wrongGuess(last.guess), ok: false, key: Date.now() });
      setG(r.state);
    }
  };
  const hint = async (h: MysteryHint) => { const s = await run(() => api.mysteryHint(h, date)); if (s) setG(s); };
  const giveUp = async () => { setConfirmGiveUp(false); const s = await run(() => api.mysteryGiveUp(date)); if (s) setG(s); };

  if (error) return <div className="page narrow"><p className="error">{error}</p></div>;
  if (!info) return <div className="page narrow"><p className="hint">…</p></div>;

  const asked = new Set((g?.steps ?? []).flatMap((s) => ('q' in s ? [qKey(s.q)] : [])));
  const used = g?.used ?? 0;
  const head = (
    <div className="daily-head">
      <span className="badge">#{info.number}</span>
      <h2>{m.title}</h2>
      <span className={`pill ${info.difficulty}`}>{info.difficulty === 'easy' ? t.easy : t.hard}</span>
    </div>
  );

  if (g && g.status !== 'active') {
    return (
      <div className="page narrow">
        <section className="card daily">{head}<MysteryResult g={g} meta={meta} /></section>
        <Steps g={g} meta={meta} />
        <MysteryHistory nav={nav} current={info.date} />
      </div>
    );
  }

  return (
    <div className="page narrow mystery">
      <section className="card">
        {head}
        <p className="hint">{m.hint}</p>
        {g?.archive && <p className="hint">{m.archiveNote}</p>}
        <div className="mq-counter">
          <span><strong>{used}</strong> / {MYSTERY_MAX} {m.questions.toLowerCase()}</span>
          <span className="mq-bar"><span style={{ width: `${(used / MYSTERY_MAX) * 100}%` }} /></span>
          <small>{m.left(MYSTERY_MAX - used)}</small>
        </div>
      </section>
      <section className="card">
        <h3>{m.askTitle}</h3>
        <QuestionBuilder meta={meta} asked={asked} busy={busy} onAsk={ask} />
        <div className="flash-slot">{flash && <div key={flash.key} className={`flash ${flash.ok ? 'ok' : 'wrong'}`}>{flash.text}</div>}</div>
      </section>
      <Hints g={g} busy={busy} onHint={hint} />
      <section className="card">
        <h3>{m.guessTitle}</h3>
        <GuessInput onGuess={guess} suggestions choices={choices} onClearChoices={() => setChoices(null)} placeholder={m.guessPlaceholder} />
      </section>
      {g && <Steps g={g} meta={meta} />}
      {!g?.steps.length && <p className="hint center">{m.nothingYet}</p>}
      {g && g.steps.length > 0 && (confirmGiveUp ? (
        <div className="row"><button className="link danger" onClick={giveUp}>{m.giveUpConfirm}</button><button className="link" onClick={() => setConfirmGiveUp(false)}>{t.stay}</button></div>
      ) : <button className="link danger" onClick={() => setConfirmGiveUp(true)}>{m.giveUp}</button>)}
      <MysteryHistory nav={nav} current={info.date} />
    </div>
  );
}

function Steps({ g, meta }: { g: MysteryState; meta: Meta }) {
  const { t, lang } = useI18n();
  if (!g.steps.length) return null;
  return (
    <section className="card">
      <h3>{t.mystery.questions}</h3>
      <ol className="mq-steps" reversed>
        {[...g.steps].reverse().map((s, i) => (
          'hint' in s ? (
            <li key={g.steps.length - i} className="hint-step">
              <span>💡 {hintText(s, t, meta, lang)}</span>
              <strong>−{s.cost}</strong>
            </li>
          ) : <li key={g.steps.length - i} className={s.a ? 'yes' : 'no'}>
            <span>{'q' in s ? questionText(s.q, t, meta, lang) : `🎯 ${s.guess} ?`}</span>
            <strong>{s.a ? t.mystery.yes : t.mystery.no}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Share text: number, result, one square per question (green = yes, red = no), the right guess as a ball. */
function shareCard(g: MysteryState, t: T): string {
  const m = t.mystery;
  const lines = [`${t.appName} · ${m.shareTitle} #${g.number}`];
  lines.push(g.status === 'won' ? `🕵️ ${m.won(g.used)}` : `🕵️ ${m.lost}`);
  const sq = g.steps.map((s) => ('hint' in s ? '💡' : 'guess' in s ? (s.a ? '⚽' : '❌') : s.a ? '🟩' : '🟥'));
  for (let i = 0; i < sq.length; i += 10) lines.push(sq.slice(i, i + 10).join(''));
  lines.push(location.origin + '/#/mystery');
  return lines.join('\n');
}

function MysteryResult({ g, meta }: { g: MysteryState; meta: Meta }) {
  const { t, lang } = useI18n();
  const m = t.mystery;
  const [copied, setCopied] = useState(false);
  const r = g.reveal;
  const share = async () => {
    const text = shareCard(g, t);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch { /* cancelled */ }
  };
  return (
    <div className="mq-result">
      <p className="daily-theme">{g.status === 'won' ? m.won(g.used) : m.lost}</p>
      {r && (
        <div className="mq-reveal">
          <small>{m.itWas}</small>
          <strong>{r.c ? flag(r.c) + ' ' : ''}{r.n}</strong>
          <span className="hint">{[r.p && t.f.positions[r.p], r.b && m.born(r.b), r.c && countryName(r.c, lang)].filter(Boolean).join(' · ')}</span>
          {r.born && <span className="hint">{m.bornIn(r.born.n, r.born.c ? flag(r.born.c) : '')}</span>}
          {r.youth?.length ? <span className="hint">{m.trainedAt(r.youth.join(', '))}</span> : null}
          <ul className="mq-clubs">{r.clubs.map((c, i) => <li key={i}>{c.c ? flag(c.c) + ' ' : ''}{c.n}{c.from !== undefined ? ` (${c.from}–${c.to ?? ''})` : ''}</li>)}</ul>
        </div>
      )}
      <div className="actions"><button className="primary" onClick={share}>{copied ? t.copied : t.share}</button></div>
      {g.archive ? <p className="hint">{m.archiveNote}</p> : <MysteryBoardView date={g.date} meta={meta} />}
    </div>
  );
}

export function MysteryBoardView({ date }: { date?: string; meta?: Meta }) {
  const { t, lang } = useI18n();
  const m = t.mystery;
  const [b, setB] = useState<MysteryBoard | null>(null);
  useEffect(() => { api.mysteryBoard(date).then(setB).catch(() => {}); }, [date]);
  if (!b) return null;
  if (!b.total) return <p className="hint">{m.noResults}</p>;
  const found = b.total - b.lost;
  let last = b.dist.length - 1;
  while (last > 9 && !b.dist[last]) last--;
  const counts = b.dist.slice(0, last + 1);
  const peak = Math.max(1, ...counts);
  const W = 320, H = 80, bw = W / counts.length;
  const mine = b.me ? b.me.used - 1 : -1;
  return (
    <div className="leaderboard standing">
      {b.me && (
        <div className="standing-head">
          <span className="standing-rank">{m.rankLine(ordinal(b.me.rank, lang), new Intl.NumberFormat(lang).format(found))}</span>
          <span className="standing-top">{t.topShare(topShareValue(b.me.rank, found, lang))}</span>
        </div>
      )}
      {found > 0 && (
        <figure className="dist">
          <figcaption>{m.distTitle}</figcaption>
          <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={m.distTitle}>
            <line x1="0" x2={W} y1={H} y2={H} className="dist-axis" />
            {counts.map((n, i) => {
              const h = n ? Math.max(3, (n / peak) * (H - 6)) : 0;
              return h > 0 ? <rect key={i} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx="2" className={i === mine ? 'dist-bar mine' : 'dist-bar'}><title>{`${i + 1} : ${n}`}</title></rect> : null;
            })}
            {[1, 5, 10, 20, 30, 40, 50].filter((x) => x <= counts.length).map((x) => <text key={x} x={(x - 0.5) * bw} y={H + 13} className="dist-tick" textAnchor="middle">{x}</text>)}
          </svg>
        </figure>
      )}
      <p className="hint">{m.playedToday(b.total, found)}{b.lost ? ` · ${m.lostCount(b.lost)}` : ''}</p>
      {b.rows.length > 0 && (
        <ol>{b.rows.map((r, i) => (
          <li key={i} className={r.me ? 'me' : ''}>
            <span className="lb-rank">{r.rank}</span>
            <span className="lb-flag">{r.country ? flag(r.country) : ''}</span>
            <span className="lb-name">{r.pseudo}</span>
            <span className="lb-score">{r.used}</span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}

function MysteryHistory({ nav, current }: { nav: Nav; current: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<MysteryHistoryItem[]>([]);
  useEffect(() => { api.mysteryHistory().then(setItems).catch(() => {}); }, []);
  const list = items.filter((h) => h.date !== current);
  if (!list.length) return null;
  return (
    <section className="card">
      <h2>{t.mystery.history}</h2>
      <p className="hint">{t.historyHint}</p>
      <div className="history">
        {list.map((h) => (
          <button key={h.date} className="history-item" onClick={() => nav.go(`/mystery/${h.date}`)}>
            <Silhouette number={h.number} seed={h.number * 13 + 5} />
            <span className="history-num">#{h.number}</span>
            <span className="history-theme">{h.difficulty === 'easy' ? t.easy : t.hard}</span>
            {h.mine && h.mine.status !== 'active' && <span className="history-mine">{h.mine.status === 'won' ? t.mystery.found(h.mine.used) : t.mystery.notFound}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Card on the home and daily pages. */
export function MysteryCard({ nav }: { nav: Nav }) {
  const { t } = useI18n();
  const m = t.mystery;
  const [info, setInfo] = useState<MysteryInfo | null>(null);
  useEffect(() => { api.mystery().then(setInfo).catch(() => {}); }, []);
  if (!info) return null;
  const g = info.game;
  return (
    <section className="card daily mystery-card">
      <div className="daily-head">
        <span className="badge">#{info.number}</span>
        <h2>{m.title}</h2>
        <span className={`pill ${info.difficulty}`}>{info.difficulty === 'easy' ? t.easy : t.hard}</span>
      </div>
      <p className="daily-theme">🕵️ ?</p>
      <p className="hint">{m.hint}{info.players > 0 ? ` · ${m.playedToday(info.players, info.solved)}` : ''}</p>
      {g && g.status !== 'active' ? (
        <>
          <p className="daily-score">{g.status === 'won' ? m.won(g.used) : m.lost}</p>
          <button onClick={() => nav.go('/mystery')}>{t.seeResult}</button>
        </>
      ) : (
        <button className="primary big" onClick={() => nav.go('/mystery')}>{g ? `${m.resume} (${g.used}/${MYSTERY_MAX})` : m.play}</button>
      )}
    </section>
  );
}
