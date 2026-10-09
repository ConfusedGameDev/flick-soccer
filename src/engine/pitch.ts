import type { SetPiece, Team, Vec2 } from './types';
import { clamp } from './vec';

// All distances are meters, all times seconds. The pitch runs along +y so a
// portrait phone shows it upright; home defends y = 0 and attacks toward +y.

export const PITCH_W = 68;
export const PITCH_L = 105;
export const GOAL_W = 7.32;

export const DT = 1 / 60;
/** Hard cap on a turn's simulated length, in case a plan never settles. */
export const MAX_TURN_SECONDS = 20;

export const TURNS_PER_HALF = 8;
/** Planning time per side, in seconds (client-enforced). */
export const PLAN_SECONDS = 60;

export const MAX_FLICKS = { attack: 3, defense: 2 } as const;

/** Distance a full-strength pass travels. */
export const PASS_RANGE = 40;
export const BALL_SPEED = 24;
/** A teammate this close to where the pass lands collects it. */
export const RECEIVE_RADIUS = 6;

/** Distance a full-strength shot travels; it must reach the goal line to count. */
export const SHOT_RANGE = 36;
export const SHOT_SPEED = 34;

/** Distance a full-strength tackle slides. */
export const SLIDE_RANGE = 16;
export const SLIDE_SPEED = 11;
/** A defender this close to the ball gets one interception roll per pass. */
export const TACKLE_REACH = 2.5;
export const INTERCEPT_CHANCE = 0.75;
/** Outfield players are worse at stopping shots than passes. */
export const BLOCK_CHANCE = 0.5;

/** Distance a full-strength run moves a teammate without the ball. */
export const RUN_RANGE = 14;
export const RUN_SPEED = 12;

/** Keeper dive: short, quick, and with a bigger reach against shots. */
export const DIVE_RANGE = 7;
export const DIVE_SPEED = 12;
export const KEEPER_REACH = 3.5;
export const SAVE_CHANCE = 0.65;
/** After a save, chance the keeper holds on; otherwise the ball goes out for a corner. */
export const HOLD_CHANCE = 0.5;

// ---- Set pieces: the timing game's accuracy scatters the ball ----
/** Angular error (radians) of an aimed flick at accuracy 0; it shrinks linearly to 0 at accuracy 1. */
export const AIM_SCATTER = 0.35;
/** Height error of a shot at accuracy 0. */
export const HEIGHT_SCATTER = 0.3;
/** A shot whose height (after scatter) is above this sails over the bar: goal kick. */
export const OVER_BAR = 0.85;
/** The keeper's save chance drops by this much times the shot's height. */
export const HEIGHT_SAVE_SHIFT = 0.15;
/** Fixed distances of restart kicks; the engine overrides the taker's strength. */
export const SET_PIECE_METERS: Record<SetPiece, number> = { corner: 36, 'throw-in': 14 };

export const other = (team: Team): Team => (team === 'home' ? 'away' : 'home');

/** +1 when the team attacks toward +y, -1 otherwise. */
export const attackDir = (team: Team): number => (team === 'home' ? 1 : -1);

/** y of the goal line the team shoots at. */
export const targetGoalY = (team: Team): number => (team === 'home' ? PITCH_L : 0);

/** The third of the pitch nearest the goal the team attacks; shots are only allowed from here. */
export const inAttackingThird = (team: Team, p: Vec2): boolean =>
  team === 'home' ? p.y >= (2 * PITCH_L) / 3 : p.y <= PITCH_L / 3;

export const inPitch = (p: Vec2): boolean =>
  p.x >= 0 && p.x <= PITCH_W && p.y >= 0 && p.y <= PITCH_L;

export const clampToPitch = (p: Vec2): Vec2 => ({
  x: clamp(p.x, 0, PITCH_W),
  y: clamp(p.y, 0, PITCH_L),
});

export const inGoalMouth = (x: number): boolean => Math.abs(x - PITCH_W / 2) <= GOAL_W / 2;
