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

export interface MatchState {
  turn: number;
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

export type TimelineEvent = { t: number } & (
  | { type: 'pass'; from: number; to: Vec2 }
  | { type: 'receive'; playerId: number }
  | { type: 'intercept'; playerId: number }
  | { type: 'slide'; playerId: number }
  | { type: 'dead-ball' }
  | { type: 'out' }
  | { type: 'invalid-flick'; playerId: number; reason: string }
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
