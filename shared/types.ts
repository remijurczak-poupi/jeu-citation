// Types shared by the Worker API and the React client.

export type LeagueId = 'PL' | 'L1' | 'LL' | 'SA' | 'BL';

/** A theme: players who match all the given filters. Seasons are start years (2007 = 2007-08). */
export interface Criterion {
  league?: LeagueId;
  club?: string; // Wikidata id of the club
  from?: number;
  to?: number;
}

export type SoloMode = 'timed1' | 'timed3' | 'timed10' | 'unlimited' | 'hardcore' | 'streak' | 'daily';

/** Timers in seconds. duration = total time; streakSeconds = time left resets on each right answer;
 * idleSeconds = game ends after this long without an answer; suddenDeath = one mistake or duplicate ends it. */
export const MODE_RULES: Record<SoloMode, { duration?: number; streakSeconds?: number; idleSeconds?: number; suddenDeath?: boolean }> = {
  timed1: { duration: 60 },
  timed3: { duration: 180 },
  timed10: { duration: 600 },
  daily: { duration: 300 },
  unlimited: { idleSeconds: 600 },
  hardcore: { idleSeconds: 60, suddenDeath: true },
  streak: { streakSeconds: 15 },
};

/** l = seasons (start years) played in each league, since the first season of the dataset. */
export interface MetaClub { q: string; n: string; nf?: string; l: Record<string, number[]> }
export interface Meta {
  firstSeason: number;
  currentSeason: number;
  leagues: { id: LeagueId; name: { en: string; fr: string }; country: string }[];
  clubs: MetaClub[];
  playerCount: number;
}

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
  archive?: boolean; // replay of a past daily challenge, not ranked
}

export type GuessOutcome =
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
}
export interface DailyHistoryItem { date: string; number: number; criterion: Criterion; difficulty: 'easy' | 'hard'; myCount: number | null }

export interface LeaderboardRow { rank: number; pseudo: string; club: string; country: string; score: number; me?: boolean }
/** count = players cited; rarity = daily only, points from how few of the day's players cited each answer. */
export type Ranking = 'count' | 'rarity';

// ----- Multiplayer rooms -----
export type RoomGame = 'bomb' | 'duel';
export interface RoomPlayer { id: string; pseudo: string; club: string; country: string; lives: number; connected: boolean; host: boolean }
export interface RoomState {
  code: string;
  game: RoomGame;
  criterion: Criterion;
  phase: 'lobby' | 'playing' | 'ended';
  players: RoomPlayer[];
  turn: string | null; // bomb: holder; duel: player the ball is heading to
  ball?: { pos: number; dir: -1 | 1; speed: number; at: number }; // duel: pos 0 = first player, 1 = second
  round: number;
  cited: string[];
  winner: string | null;
  lastEvent?: { kind: 'ok' | 'wrong' | 'duplicate' | 'boom' | 'hit'; player: string; name?: string };
  serverNow: number;
}
export type RoomClientMsg = { t: 'start' } | { t: 'guess'; text: string } | { t: 'criterion'; criterion: Criterion };
export type RoomServerMsg = { t: 'state'; state: RoomState } | { t: 'error'; message: string } | { t: 'you'; id: string };
