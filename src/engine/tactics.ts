import { MAX_FLICKS } from './pitch';
import type { Tactic, TeamMeta } from './types';

// Tactics cards (M11): passive rules a team carries for a whole season run,
// the Balatro "jokers". They live in TeamMeta.tactics and every effect goes
// through one of the small functions below, so the sim, the CPU planner and
// the planning UI agree. Pure.

export const TACTICS: Tactic[] = ['catenaccio', 'tiki-taka', 'clasicos', 'cannon', 'iron-wall', 'engine-room'];
/** Cards a team can hold at once. */
export const MAX_TACTICS = 3;

/** Interception chance drops this much per pass already completed in the chain, up to the cap. */
export const TIKI_TAKA_STEP = 0.05;
export const TIKI_TAKA_CAP = 0.15;
/** A pass between two club-mates is this much harder to intercept (chemistry). */
export const CLASICOS_BONUS = 0.1;
/** Shots are this much harder to save or block. */
export const CANNON_BONUS = 0.1;
/** Keeper reach multiplier. */
export const IRON_WALL_REACH = 1.3;
/** Slides, runs and dives are this much faster. */
export const ENGINE_ROOM_SPEED = 1.2;

export const TACTIC_INFO: Record<Tactic, { name: string; text: string; price: number }> = {
  catenaccio: { name: 'Catenaccio', text: 'Three defensive flicks every turn instead of two.', price: 10 },
  'tiki-taka': { name: 'Tiki-taka', text: 'Each completed pass in a chain makes the next one 5% harder to intercept (up to 15%).', price: 8 },
  clasicos: { name: 'Chemistry', text: 'A pass between two club-mates is 10% harder to intercept.', price: 6 },
  cannon: { name: 'Cannon', text: 'Your shots are 10% harder to save or block.', price: 8 },
  'iron-wall': { name: 'Iron wall', text: 'Your keeper reaches 30% further.', price: 8 },
  'engine-room': { name: 'Engine room', text: 'Your slides, runs and dives are 20% faster.', price: 8 },
};

export const hasTactic = (meta: TeamMeta | undefined, t: Tactic): boolean => !!meta?.tactics?.includes(t);

/** Flicks a side gets this turn before packs and boosters. */
export function maxFlicksFor(meta: TeamMeta | undefined, role: 'attack' | 'defense'): number {
  return MAX_FLICKS[role] + (role === 'defense' && hasTactic(meta, 'catenaccio') ? 1 : 0);
}

/** Shift to a defender's interception chance on a pass (negative favours the attacker). */
export function passChanceShift(meta: TeamMeta | undefined, chainPos: number, clubmates: boolean): number {
  let shift = 0;
  if (hasTactic(meta, 'tiki-taka')) shift -= Math.min(TIKI_TAKA_CAP, Math.max(0, chainPos) * TIKI_TAKA_STEP);
  if (clubmates && hasTactic(meta, 'clasicos')) shift -= CLASICOS_BONUS;
  return shift;
}

/** Shift to the keeper's save (or a defender's block) chance on a shot. */
export function shotChanceShift(meta: TeamMeta | undefined): number {
  return hasTactic(meta, 'cannon') ? -CANNON_BONUS : 0;
}

export const keeperReachMul = (meta: TeamMeta | undefined): number => (hasTactic(meta, 'iron-wall') ? IRON_WALL_REACH : 1);

export const moveSpeedMul = (meta: TeamMeta | undefined): number => (hasTactic(meta, 'engine-room') ? ENGINE_ROOM_SPEED : 1);
