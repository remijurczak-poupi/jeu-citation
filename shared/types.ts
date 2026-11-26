// Types shared by the Worker API and the React client.

export type LeagueId = 'PL' | 'L1' | 'LL' | 'SA' | 'BL';

/** A theme: players who match all the given filters. Seasons are start years (2007 = 2007-08). */
export type Position = 'GK' | 'DF' | 'MF' | 'FW';
/** Tournament codes: WC = World Cup, EU = Euro, CA = Copa América, optionally with the year (WC2006). */
export type TournamentCode = string;

export interface Criterion {
  league?: LeagueId;
  club?: string; // Wikidata id of the club
  club2?: string; // must also have played for this club (any time)
  from?: number;
  to?: number;
  position?: Position;
  nationality?: string; // ISO 3166-1 alpha-2, or GB-ENG / GB-SCT / GB-WLS / GB-NIR
  international?: boolean; // capped by a senior national team (true) or never (false)
  active?: boolean; // still playing
  ageMin?: number;
  ageMax?: number;
  heightMin?: number; // cm
  heightMax?: number;
  tournament?: TournamentCode;
  tournamentWon?: boolean; // won that tournament
  ucl?: 'played' | 'won'; // Champions League, with a club of the theme's scope, in a season of the theme's period
  champion?: boolean; // league champion (of the theme's league if set)
  topScorer?: boolean; // league top scorer (of the theme's league if set)
  ballonDor?: boolean; // ranked in a Ballon d'Or vote
}
export const CRITERION_KEYS: (keyof Criterion)[] = [
  'league', 'club', 'club2', 'from', 'to', 'position', 'nationality', 'international', 'active', 'ageMin', 'ageMax',
  'heightMin', 'heightMax', 'tournament', 'tournamentWon', 'ucl', 'champion', 'topScorer', 'ballonDor',
];

export type SoloMode = 'timed1' | 'timed3' | 'timed10' | 'timed15' | 'timed30' | 'timed60' | 'unlimited' | 'hardcore' | 'streak10' | 'streak' | 'streak30' | 'chain' | 'daily';

/** Solo modes as shown in the setup: a group, with its variants (timer lengths) when it has several. */
export const SOLO_GROUPS: { id: string; modes: SoloMode[]; default: SoloMode }[] = [
  { id: 'timed', modes: ['timed1', 'timed3', 'timed10', 'timed15', 'timed30', 'timed60'], default: 'timed3' },
  { id: 'unlimited', modes: ['unlimited'], default: 'unlimited' },
  { id: 'hardcore', modes: ['hardcore'], default: 'hardcore' },
  { id: 'streak', modes: ['streak10', 'streak', 'streak30'], default: 'streak' },
  { id: 'chain', modes: ['chain'], default: 'chain' },
];
export const SOLO_MODES: SoloMode[] = SOLO_GROUPS.flatMap((g) => g.modes);

/** Timers in seconds. duration = total time; streakSeconds = time left resets on each right answer;
 * idleSeconds = game ends after this long without an answer; suddenDeath = one mistake or duplicate ends it. */
export const MODE_RULES: Record<SoloMode, { duration?: number; streakSeconds?: number; idleSeconds?: number; suddenDeath?: boolean }> = {
  timed1: { duration: 60 },
  timed3: { duration: 180 },
  timed10: { duration: 600 },
  timed15: { duration: 900 },
  timed30: { duration: 1800 },
  timed60: { duration: 3600 },
  daily: { duration: 300 },
  unlimited: { idleSeconds: 600 },
  hardcore: { idleSeconds: 60, suddenDeath: true },
  streak10: { streakSeconds: 10 },
  streak: { streakSeconds: 20 },
  streak30: { streakSeconds: 30 },
  chain: { streakSeconds: 30 }, // each answer must be a teammate of the previous player
};

/** l = seasons (start years) played in each league, since the first season of the dataset. */
export interface MetaClub { q: string; n: string; nf?: string; l: Record<string, number[]> }
export interface MetaTournament { code: string; years: number[] }
export interface Meta {
  firstSeason: number;
  currentSeason: number;
  leagues: { id: LeagueId; name: { en: string; fr: string }; country: string }[];
  clubs: MetaClub[];
  playerCount: number;
  nationalities: string[]; // codes present in the data, most frequent first
  tournaments: MetaTournament[];
  auth?: { google: string | null; email: boolean }; // optional sign-in methods configured on the server
}

export type SignInResult = { status: 'linked'; email: string } | { status: 'no_profile' } | { status: 'signed_in'; email: string; session: Profile & { id: string; secret: string } };

export interface Profile { pseudo: string; club: string; country: string }

export interface GameState {
  id: string;
  mode: SoloMode;
  criterion: Criterion;
  startedAt: number;
  deadline: number | null; // ms epoch, null = no timer
  serverNow: number;
  status: 'active' | 'finished';
  count: number;
  errors: number;
  found: string[]; // player names, in citation order
  endReason?: 'time' | 'mistake' | 'duplicate' | 'quit' | 'idle';
  rank?: number;
  total?: number;
  dailyDate?: string;
  dailyNumber?: number;
  archive?: boolean; // replay of a past daily challenge, not ranked
  chain?: ChainLink[]; // chain mode: the starting player then each answer, with the club they shared
  rankedTheme?: string; // id in RANKED_THEMES when the theme has a best-game board
  challenge?: string; // code of the friend's challenge this game answers
}
/** End-of-game extras: well-known players missed, rarest ones found, and (daily) each answer's rarity tier for the share card. */
export interface GameRecap {
  missed: string[];
  rarest: { name: string; pct?: number }[];
  tiers?: number[]; // daily only: 1 to 3 per found player, in citation order
}
export interface Challenge {
  code: string; mode: SoloMode; criterion: Criterion;
  from: { pseudo: string; country: string; count: number };
  takers: { pseudo: string; country: string; count: number; me?: boolean }[];
}
export interface DailyStreak { current: number; best: number; playedToday: boolean }
export interface ChainLink { name: string; club?: string; seasons?: string }

/** A player proposed while typing (from the whole base, so it never reveals the answers). */
/** A player in a list. Details (birth year, nationality, position, main club, seasons) only come with homonyms, and never one tied to the theme. */
export interface Suggestion { q: string; n: string; y?: number; c?: string; p?: Position; club?: string; from?: number; to?: number }
export type GuessOutcome =
  | { status: 'ambiguous'; options: Suggestion[] } // several well-known players share this name: pick one (not counted)
  | { status: 'ok'; name: string }
  | { status: 'duplicate'; name: string }
  | { status: 'wrong'; name?: string }
  | { status: 'invalid' };

export interface DailyInfo {
  date: string;
  number: number;
  criterion: Criterion;
  difficulty: 'easy' | 'hard';
  played: GameState | null;
  playerCount: number; // players who took today's challenge
  streak?: DailyStreak; // days in a row the player took the challenge
}
export interface DailyHistoryItem { date: string; number: number; criterion: Criterion; difficulty: 'easy' | 'hard'; myCount: number | null }

export interface LeaderboardRow { rank: number; pseudo: string; club: string; country: string; score: number; me?: boolean }
/** count = players cited; rarity = daily only, points from how few of the day's players cited each answer. */
export type Ranking = 'count' | 'rarity';

// ----- Multiplayer rooms -----
export type RoomGame = 'bomb' | 'duel' | 'chain' | 'royale';
export const DUEL_SECONDS = [15, 25, 35];
export const DUEL_DEFAULT_SECONDS = 25;
export interface RoomPlayer { id: string; pseudo: string; club: string; country: string; lives: number; connected: boolean; host: boolean; found?: number; roundFound?: number }
export interface RoomState {
  code: string;
  game: RoomGame;
  criterion: Criterion;
  phase: 'lobby' | 'playing' | 'ended';
  players: RoomPlayer[];
  turn: string | null; // bomb: holder; duel: player the ball is heading to; chain: player who must answer; royale: null (everyone plays)
  deadline?: number; // chain: end of the current turn; royale: end of the current round
  ball?: { pos: number; dir: -1 | 1; speed: number; at: number }; // duel: pos 0 = first player, 1 = second
  round: number;
  cited: string[];
  winner: string | null;
  chain?: ChainLink[]; // chain: the current chain, oldest first
  duelSeconds?: number; // duel: time for the ball to go from the centre to a goal (host setting)
  lastEvent?: { kind: 'ok' | 'wrong' | 'duplicate' | 'boom' | 'hit' | 'timeout' | 'out' | 'restart'; player: string; name?: string; players?: string[] };
  serverNow: number;
}
export type RoomClientMsg = { t: 'start' } | { t: 'guess'; text: string; pick?: string } | { t: 'criterion'; criterion: Criterion } | { t: 'settings'; duelSeconds: number };
export type RoomServerMsg = { t: 'state'; state: RoomState } | { t: 'error'; message: string } | { t: 'you'; id: string } | { t: 'outcome'; outcome: GuessOutcome };

// ----- Clubs & countries war -----
/** key = club Wikidata id or country code; points = sum of the supporters' daily challenge counts. */
export interface WarRow { rank: number; key: string; points: number; players: number }
export type WarMetric = 'points' | 'supporters';
/** points: daily challenge points (period week | all); supporters: profiles that played in the period (week | month). */
export interface WarBoard { by: 'club' | 'country'; metric: WarMetric; period: string; rows: WarRow[]; me: WarRow | null; total: number }
export interface ClubStanding { q: string; rank: number | null; active: number; supporters: number; clubs: number }

// ----- Rankings -----
/** Themes with a best-game leaderboard: the 5 leagues together, each league, the World Cup. */
export const RANKED_THEMES: { id: string; criterion: Criterion }[] = [
  { id: 'all', criterion: {} },
  { id: 'PL', criterion: { league: 'PL' } },
  { id: 'L1', criterion: { league: 'L1' } },
  { id: 'LL', criterion: { league: 'LL' } },
  { id: 'SA', criterion: { league: 'SA' } },
  { id: 'BL', criterion: { league: 'BL' } },
  { id: 'WC', criterion: { tournament: 'WC' } },
];
/** total = players named over the period, all themes together; best = best single game on a ranked theme. */
export type BoardKind = 'total' | 'best';
export type BoardPeriod = 'day' | 'week' | 'month' | 'year' | 'all';
/** "Top 5 % in Ligue 1": share of players with fewer players named (all modes, all time) in that league. */
export interface Badge { scope: string; top: number; rank: number; total: number }

// ----- Mystery player (second daily game) -----
/** Continents, from the player's sporting nationality. */
export type Continent = 'EU' | 'AF' | 'SA' | 'NA' | 'AS' | 'OC';
export const CONTINENTS: Continent[] = ['EU', 'AF', 'SA', 'NA', 'AS', 'OC'];
/** Numbers a question can compare ("more than", "less than", "exactly"). */
export type MysteryNum =
  | 'age' // this year minus birth year
  | 'birthYear' | 'height' | 'caps'
  | 'clubs' // big-5 clubs played for
  | 'leagues' // big-5 leagues played in
  | 'debut' // first season in a big-5 league (start year)
  | 'seasons' // seasons played in the big 5 since 2000
  | 'worldCups' // World Cups played
  | 'titles' // league titles won since 2000
  | 'euros' | 'copas'
  | 'tournaments' // World Cups + Euros + Copas played
  | 'countries' // big-5 countries played in
  | 'loyalty' // most seasons at a single club
  | 'lastSeason' // last season in a big-5 league (start year)
  | 'uclSeasons' // Champions League seasons with his club
  | 'uclWins'
  | 'topScorerTimes' // times league top scorer
  | 'ballonDorTimes' // times ranked in the Ballon d'Or
  | 'allClubs' // senior clubs, any league
  | 'allCountries'; // countries played in, any league
export const MYSTERY_NUMS: MysteryNum[] = ['age', 'birthYear', 'height', 'caps', 'clubs', 'leagues', 'debut', 'seasons', 'worldCups', 'titles',
  'euros', 'copas', 'tournaments', 'countries', 'loyalty', 'lastSeason', 'uclSeasons', 'uclWins', 'topScorerTimes', 'ballonDorTimes', 'allClubs', 'allCountries'];
export type MysteryCmp = 'gt' | 'lt' | 'eq';
/** A yes/no question about the day's mystery player, built from a guided list (no free text). */
export type MysteryQuestion =
  | { k: 'num'; f: MysteryNum; op: MysteryCmp; v: number }
  | { k: 'position'; v: Position }
  | { k: 'nation'; v: string } // sporting nationality (first one listed)
  | { k: 'continent'; v: Continent }
  | { k: 'dual' } // more than one nationality
  | { k: 'active' }
  | { k: 'international' }
  | { k: 'league'; v: LeagueId } // played in that league
  | { k: 'club'; v: string } // played for that big-5 club, any time
  | { k: 'clubNowIn'; v: LeagueId } // played for a club that is in that league this season
  | { k: 'nowLeague'; v: LeagueId | 'other' } // plays in that league now ('other' = active, outside the big 5)
  | { k: 'nowClub'; v: string } // plays for that club now
  | { k: 'season'; v: number } // played in the big 5 in that season (start year)
  | { k: 'champion'; v?: LeagueId } // league champion (since 2000)
  | { k: 'ucl'; v: 'played' | 'won' }
  | { k: 'tournament'; v: 'WC' | 'EU' | 'CA'; year?: number; won?: boolean }
  | { k: 'topScorer'; v?: LeagueId }
  | { k: 'ballonDor' }
  // Name initials are hints only (10 questions each), not questions.
  | { k: 'mononym' } // known by a single name (Neymar, Kaká)
  | { k: 'citizen'; v: string } // holds that nationality (any of them)
  | { k: 'multiPos' } // listed at several positions
  | { k: 'anyTournament'; won?: boolean } // World Cup, Euro or Copa América
  | { k: 'teammate'; v: string; n?: string } // n = name, for display; shared a club and a season with that player (Wikidata id)
  | { k: 'home' } // played in a big-5 league of his own country
  | { k: 'abroad' } // played in a big-5 league outside his country
  | { k: 'returned' } // came back to a club he had left
  | { k: 'playedCountry'; v: string } // played for a club of that country (any league)
  | { k: 'playedContinent'; v: Continent }
  | { k: 'nowCountry'; v: string } // his club now is in that country
  | { k: 'youthClub'; v: string } // trained at that club (youth career)
  | { k: 'youthCountry'; v: string }
  | { k: 'youthHome' } // trained in the country he represents
  | { k: 'bornCountry'; v: string }
  | { k: 'bornContinent'; v: Continent }
  | { k: 'bornHome' } // born in the country he represents
  | { k: 'lowerDiv'; v?: LeagueId }; // played a season below the top flight with a club of that country (known clubs only)
export const MYSTERY_MAX = 50; // questions + guesses
/** Paid hints: they cost several questions. */
export type MysteryHint = 'first' | 'last' | 'club3' | 'club1';
export const MYSTERY_HINTS: { id: MysteryHint; cost: number }[] = [
  { id: 'first', cost: 10 }, // first-name initial
  { id: 'last', cost: 10 }, // last-name initial
  { id: 'club3', cost: 10 }, // one of his 3 main clubs (drawn by day, the same for everyone)
  { id: 'club1', cost: 20 }, // his main club
];
export type MysteryStep =
  | { q: MysteryQuestion; a: boolean }
  | { guess: string; a: boolean }
  | { hint: MysteryHint; v: string; n?: string; cost: number }; // v = letter or club id, n = club name ('' = single name)
/** Clubs outside the big 5 and countries the extra questions can name. */
export interface MysteryMeta { clubs: { q: string; n: string; nf?: string; c: string }[]; clubCountries: string[]; birthCountries: string[] }
export interface MysteryReveal {
  q: string; n: string; b?: number; c?: string; p?: Position;
  clubs: { n: string; from?: number; to?: number; c?: string }[];
  born?: { n: string; c: string }; // birthplace
  youth?: string[]; // youth clubs
}
export interface MysteryState {
  date: string;
  number: number;
  difficulty: 'easy' | 'hard';
  status: 'active' | 'won' | 'lost';
  steps: MysteryStep[];
  used: number;
  archive: boolean; // past day: not ranked
  reveal?: MysteryReveal; // once finished
}
export interface MysteryInfo {
  date: string;
  number: number;
  difficulty: 'easy' | 'hard';
  game: MysteryState | null;
  players: number; // ranked games finished today
  solved: number;
}
export interface MysteryBoard {
  total: number;
  lost: number;
  dist: number[]; // dist[i] = players who found it with i + 1 questions
  rows: { rank: number; pseudo: string; club: string; country: string; used: number; me?: boolean }[];
  me: { rank: number; used: number } | null;
}
export interface MysteryHistoryItem { date: string; number: number; difficulty: 'easy' | 'hard'; mine: { status: MysteryState['status']; used: number } | null }
