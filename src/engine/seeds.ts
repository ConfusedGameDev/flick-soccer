import type { MatchState, Team } from './types';

// Every random decision in a match derives from one match seed and the clock,
// so the client, the CPU and the server all compute the same numbers.

export const clockKey = (s: Pick<MatchState, 'half' | 'turn'>): number => s.half * 100 + s.turn;

/** Seed for resolving the turn at this clock. */
export const turnSeed = (seed: number, s: Pick<MatchState, 'half' | 'turn'>): number => (seed + clockKey(s) * 7919) >>> 0;

/** Seed for a side's trade roll in this turn. */
export const rollSeed = (seed: number, s: Pick<MatchState, 'half' | 'turn'>, team: Team): number =>
  (seed ^ (clockKey(s) * 40503 + (team === 'home' ? 7919 : 15838))) >>> 0;

/** Seed for the CPU's thinking in this turn. */
export const cpuSeed = (seed: number, s: Pick<MatchState, 'half' | 'turn'>): number => (seed ^ (clockKey(s) * 2654435761)) >>> 0;

export const kickoffSeed = (seed: number): number => (seed ^ 0x2545f491) >>> 0;

export const duelSeed = (seed: number, s: Pick<MatchState, 'half' | 'turn'>): number => (turnSeed(seed, s) ^ 0x7f4a7c15) >>> 0;

export const newSeed = (): number => (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
