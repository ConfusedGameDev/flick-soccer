import type { Team, Vec2 } from './types';
import { clamp } from './vec';

// All distances are meters, all times seconds. The pitch runs along +y so a
// portrait phone shows it upright; home defends y = 0 and attacks toward +y.

export const PITCH_W = 68;
export const PITCH_L = 105;
export const GOAL_W = 7.32;

export const DT = 1 / 60;
/** Hard cap on a turn's simulated length, in case a plan never settles. */
export const MAX_TURN_SECONDS = 20;

export const MAX_FLICKS = { attack: 3, defense: 2 } as const;

/** Distance a full-strength pass travels. */
export const PASS_RANGE = 40;
export const BALL_SPEED = 24;
/** A teammate this close to where the pass lands collects it. */
export const RECEIVE_RADIUS = 6;

/** Distance a full-strength tackle slides. */
export const SLIDE_RANGE = 16;
export const SLIDE_SPEED = 11;
/** A defender this close to the ball gets one interception roll per pass. */
export const TACKLE_REACH = 2.5;
export const INTERCEPT_CHANCE = 0.75;

export const other = (team: Team): Team => (team === 'home' ? 'away' : 'home');

/** +1 when the team attacks toward +y, -1 otherwise. */
export const attackDir = (team: Team): number => (team === 'home' ? 1 : -1);

export const inPitch = (p: Vec2): boolean =>
  p.x >= 0 && p.x <= PITCH_W && p.y >= 0 && p.y <= PITCH_L;

export const clampToPitch = (p: Vec2): Vec2 => ({
  x: clamp(p.x, 0, PITCH_W),
  y: clamp(p.y, 0, PITCH_L),
});
