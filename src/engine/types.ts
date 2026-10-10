// Shared engine types. Nothing in src/engine may import the DOM or Pixi:
// the same code runs in the browser, in tests, and later on the server.

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 'home' | 'away';

export interface PlayerStats {
  pass: number;
  shot: number;
  speed: number;
  tackle: number;
  keeping: number;
}

export interface PlayerState {
  /** Unique across both teams; also the index into MatchState.players. */
  id: number;
  team: Team;
  /** Shirt number, 1..11. */
  number: number;
  keeper: boolean;
  /** Short display name (surname). */
  name: string;
  /** Club in the pool, '' for baseline squads; club-mates power the Chemistry tactic. */
  club: string;
  stats: PlayerStats;
  /** Where this player stands at a kickoff (world frame). */
  kickoff: Vec2;
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

export type Booster = 'longer-slide' | 'double-speed' | 'extra-flick' | 'unstoppable-pass' | 'super-keeper';

/** A coin face: the kickoff toss. */
export type Coin = 'heads' | 'tails';

export interface TeamMeta {
  /** Held boosters, at most MAX_BOOSTERS. */
  boosters: Booster[];
  /** Tactics cards in play for the whole match (season run); absent means none. */
  tactics?: Tactic[];
  /** Turns to wait before the keeper game can be used again; absent means it is ready. */
  keeperCooldown?: number;
}

/** Passive rules a team carries through a season run; effects live in engine/tactics.ts. */
export type Tactic = 'catenaccio' | 'tiki-taka' | 'clasicos' | 'cannon' | 'iron-wall' | 'engine-room';

/** A restart the attacker takes with the set-piece scene before planning the rest of the turn. */
export type SetPiece = 'corner' | 'throw-in';

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
  meta: Record<Team, TeamMeta>;
  /**
   * Set after a corner or throw-in restart: the attacker's first chain flick
   * is the set piece (fixed distance, never a shot). Absent on every other turn.
   */
  setPiece?: SetPiece;
}

/** Result of the set-piece timing game. Absent on plain drag flicks, which fly exactly where aimed. */
export interface Aim {
  /** 0..1; 1 is exactly the chosen line, 0 scatters by the full AIM_SCATTER. */
  accuracy: number;
  /** Shots only, 0..1: 0 along the ground, 1 at the bar. Above OVER_BAR after scatter sails over. */
  height?: number;
}

/** One pull-back-and-release gesture. `dir` is a unit vector in the direction of travel. */
export interface Flick {
  playerId: number;
  dir: Vec2;
  /** 0..1, fraction of the maximum pull. */
  strength: number;
  /**
   * An explicit shot (the Shoot button, or the CPU). Honoured only on the ball
   * carrier, from the attacking third, and never on a restart flick; otherwise
   * the flick is a pass. A plain drag is always a pass.
   */
  shot?: boolean;
  aim?: Aim;
}

export interface Plan {
  team: Team;
  flicks: Flick[];
  /**
   * A flick traded for a booster pack: the card drawn during planning with
   * `drawBooster` from `packSeed` (the server redraws it from the same seed).
   */
  pack?: Booster;
  /** A held booster to use this turn. */
  booster?: Booster;
  /**
   * Defense only: the keeper game was played this turn. It costs KEEPER_GAME_COST flicks
   * and rests for KEEPER_GAME_COOLDOWN turns; `accuracy` (0..1) is the mini-game's result,
   * client-claimed like `Aim.accuracy`, and grows the keeper's reach and save chance on shots.
   */
  keeperGame?: { accuracy: number };
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
  | { type: 'pack'; team: Team; booster: Booster; free: boolean }
  | { type: 'booster'; team: Team; booster: Booster }
  /** The defence spent its flicks on the keeper game. */
  | { type: 'keeper-game'; team: Team; accuracy: number }
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
