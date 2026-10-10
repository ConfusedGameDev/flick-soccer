import type { Squad } from '../engine/pool';
import type { Booster, Coin, MatchState, Plan, Team, TurnResult } from '../engine/types';
import type { Kit } from '../render/kits';

// JSON messages between a client and the match server. The server is the
// authority: it owns the seed, flips the coin, resolves turns, draws the
// booster packs and runs the duel.

export type ClientMessage =
  | { t: 'create'; kit: Kit }
  | { t: 'join'; code: string; kit: Kit }
  | { t: 'resume'; code: string; token: string }
  | { t: 'squad'; squad: Squad }
  | { t: 'plan'; plan: Plan }
  /** The toss caller's call; anyone else's is ignored. */
  | { t: 'call'; call: Coin }
  | { t: 'mash' }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'created'; code: string; token: string; side: Team }
  | { t: 'joined'; code: string; token: string; side: Team }
  | { t: 'error'; message: string }
  | { t: 'start'; side: Team; seed: number; kits: Record<Team, Kit> }
  /** Both squads are in: `caller` picks heads or tails (the server calls heads after CALL_MS). */
  | { t: 'toss'; caller: Team }
  | { t: 'kickoff'; state: MatchState; coin: Coin; call: Coin; caller: Team; winner: Team }
  | { t: 'turn'; state: MatchState; role: 'attack' | 'defense'; deadlineMs: number }
  | { t: 'result'; result: TurnResult }
  | { t: 'duel'; openInMs: number; durationMs: number }
  | { t: 'meter'; value: number }
  | { t: 'duel-result'; winner: Team; state: MatchState; booster: Booster | null }
  | { t: 'over'; state: MatchState }
  | { t: 'opponent-left' };

/** Room codes: 4 letters, no ambiguous glyphs. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
