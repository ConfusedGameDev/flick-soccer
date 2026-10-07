// Shared engine types. Nothing in src/engine may import the DOM or Pixi:
// the same code runs in the browser, in tests, and later on the server.

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 'home' | 'away';

export interface PlayerState {
  /** Unique across both teams; also the index into MatchState.players. */
  id: number;
  team: Team;
  /** Shirt number, 1..11. */
  number: number;
  keeper: boolean;
  pos: Vec2;
}

export interface Possession {
  team: Team;
  playerId: number;
}

export type Score = Record<Team, number>;

/**
 * - playing: the next call is resolveTurn
 * - duel: a dead ball; the client runs the mash duel and calls resolveDuel
 * - half-time: positions are reset; the client shows a cover and calls continueMatch
 * - full-time: the match is over
 */
export type MatchStatus = 'playing' | 'duel' | 'half-time' | 'full-time';

export interface MatchState {
  /** 1-based turn within the current half. */
  turn: number;
  half: 1 | 2;
  score: Score;
  status: MatchStatus;
  /** Who kicked off the first half; the other side kicks off the second. */
  kickoff: Team;
  players: PlayerState[];
  ball: Vec2;
  possession: Possession;
}

/** One pull-back-and-release gesture. `dir` is a unit vector in the direction of travel. */
export interface Flick {
  playerId: number;
  dir: Vec2;
  /** 0..1, fraction of the maximum pull. */
  strength: number;
}

export interface Plan {
  team: Team;
  flicks: Flick[];
}

/** What a flick means, decided by who was flicked and from where. */
export type FlickKind = 'pass' | 'shot' | 'run' | 'slide' | 'dive' | 'invalid';

export type TimelineEvent = { t: number } & (
  | { type: 'pass'; from: number; to: Vec2 }
  | { type: 'shot'; from: number; to: Vec2 }
  | { type: 'run'; playerId: number }
  | { type: 'slide'; playerId: number }
  | { type: 'dive'; playerId: number }
  | { type: 'receive'; playerId: number }
  | { type: 'intercept'; playerId: number }
  | { type: 'save'; playerId: number }
  | { type: 'goal'; team: Team }
  | { type: 'corner'; team: Team }
  | { type: 'throw-in'; team: Team }
  | { type: 'goal-kick'; team: Team }
  | { type: 'dead-ball' }
  | { type: 'invalid-flick'; playerId: number; reason: string }
  | { type: 'half-time' }
  | { type: 'full-time' }
  | { type: 'end' }
);

/** Positions at time `t`. `players` is indexed like MatchState.players. */
export interface Keyframe {
  t: number;
  ball: Vec2;
  players: Vec2[];
}

export interface TurnResult {
  state: MatchState;
  keyframes: Keyframe[];
  events: TimelineEvent[];
}
