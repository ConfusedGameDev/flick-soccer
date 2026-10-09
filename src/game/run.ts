import type { Difficulty } from '../engine/cpu';
import { BOOSTERS, MAX_BOOSTERS } from '../engine/dice';
import { FORMATION_NAMES, LEAGUES, STAT_KEYS, cost, cpuSquad, leaguePool, type League, type PoolPlayer, type Squad, type Stats } from '../engine/pool';
import { mulberry32 } from '../engine/rng';
import { MAX_TACTICS, TACTICS, TACTIC_INFO } from '../engine/tactics';
import type { Booster, Score, Tactic } from '../engine/types';

// The season run (M10, first slice): a ladder of CPU clubs that get stronger,
// coins from results, and a store between matches. Pure: no DOM here, so it
// is unit-tested and the store UI only renders what these functions return.

export const RUN_STAGES = 5;
/** Draft budget of the opponent at each stage; the player drafted with 100. */
export const STAGE_BUDGET = [80, 92, 104, 116, 130];
export const WIN_COINS = 5;
export const DRAW_COINS = 2;
export const GOAL_COINS = 1;
export const TRAIN_COST = 3;
export const PACK_COST = 4;
export const MAX_STAT = 5;
export const SCOUT_OFFERS = 3;
export const TACTIC_OFFERS = 2;

export type Outcome = 'win' | 'draw' | 'loss';

export interface RunResult {
  stage: number;
  opponent: string;
  home: number;
  away: number;
  outcome: Outcome;
}

export interface RunState {
  seed: number;
  /** Index of the next opponent, 0..RUN_STAGES-1. */
  stage: number;
  coins: number;
  squad: Squad;
  kitId: string;
  /** Boosters carried into the next match (unused ones carry over). */
  boosters: Booster[];
  /** Tactics cards in play for every match of the run. */
  tactics: Tactic[];
  results: RunResult[];
  over: 'won' | 'lost' | null;
}

export interface Opponent {
  name: string;
  league: League;
  squad: Squad;
  difficulty: Difficulty;
  budget: number;
}

const stageSeed = (run: RunState, salt = 0): number => (Math.imul(run.seed ^ ((run.stage + 1) * 0x9e3779b9), 0x85ebca6b) + salt) >>> 0;

export function newRun(seed: number, squad: Squad, kitId: string): RunState {
  return { seed, stage: 0, coins: 0, squad, kitId, boosters: [], tactics: [], results: [], over: null };
}

/** Most common club in a squad, as a team name. */
function clubName(squad: Squad, fallback: string): string {
  const counts = new Map<string, number>();
  for (const p of squad.players) if (p.club) counts.set(p.club, (counts.get(p.club) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} XI` : fallback;
}

/** The club waiting at the run's current stage, drafted from one league. Deterministic for the run seed. */
export function opponentFor(pool: readonly PoolPlayer[], run: RunState): Opponent {
  const seed = stageSeed(run);
  const budget = STAGE_BUDGET[Math.min(run.stage, STAGE_BUDGET.length - 1)];
  const formation = FORMATION_NAMES[seed % FORMATION_NAMES.length];
  const league = LEAGUES[(seed >>> 8) % LEAGUES.length];
  const squad = cpuSquad(leaguePool(pool, league), formation, seed, budget);
  return {
    name: clubName(squad, `Stage ${run.stage + 1}`),
    league,
    squad,
    difficulty: run.stage < 2 ? 'easy' : 'normal',
    budget,
  };
}

export const outcomeOf = (score: Score): Outcome => (score.home > score.away ? 'win' : score.home < score.away ? 'loss' : 'draw');

/**
 * Bank a match: coins for the result and goals, the stage advances on a win,
 * a draw replays it, a loss ends the run. Boosters left over carry on.
 */
export function applyResult(run: RunState, score: Score, opponent: string, boosters: Booster[]): RunState {
  const outcome = outcomeOf(score);
  const coins = run.coins + score.home * GOAL_COINS + (outcome === 'win' ? WIN_COINS : outcome === 'draw' ? DRAW_COINS : 0);
  const result: RunResult = { stage: run.stage, opponent, home: score.home, away: score.away, outcome };
  const stage = outcome === 'win' ? run.stage + 1 : run.stage;
  const over: RunState['over'] = outcome === 'loss' ? 'lost' : stage >= RUN_STAGES ? 'won' : null;
  return { ...run, coins, stage, over, boosters: boosters.slice(0, MAX_BOOSTERS), results: [...run.results, result] };
}

/** +1 to one stat of the player at squad index `i`, for TRAIN_COST. Null when not allowed. */
export function train(run: RunState, i: number, stat: keyof Stats): RunState | null {
  const p = run.squad.players[i];
  if (!p || run.coins < TRAIN_COST || p[stat] >= MAX_STAT || !STAT_KEYS.includes(stat)) return null;
  const players = run.squad.players.map((q, k) => (k === i ? { ...q, [stat]: q[stat] + 1 } : q));
  return { ...run, coins: run.coins - TRAIN_COST, squad: { ...run.squad, players } };
}

/** What a scouted player costs to sign: about half their draft price. */
export const hireCost = (p: PoolPlayer): number => Math.max(3, Math.ceil(cost(p) / 2));

/** Three players from the pool who are not in the squad, seeded by the stage, better ones first. */
export function scoutOffers(pool: readonly PoolPlayer[], run: RunState): PoolPlayer[] {
  const rng = mulberry32(stageSeed(run, 7));
  const have = new Set(run.squad.players.map((p) => p.id));
  const free = pool.filter((p) => !have.has(p.id));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, SCOUT_OFFERS).sort((a, b) => cost(b) - cost(a));
}

/** Sign a scouted player: they replace the cheapest player of the same position (any outfielder if none). */
export function hire(run: RunState, offer: PoolPlayer): RunState | null {
  const price = hireCost(offer);
  if (run.coins < price || run.squad.players.some((p) => p.id === offer.id)) return null;
  const players = run.squad.players;
  let candidates = players.map((p, i) => ({ p, i })).filter(({ p }) => p.position === offer.position);
  if (!candidates.length) candidates = players.map((p, i) => ({ p, i })).filter(({ p }) => p.position !== 'GK');
  if (!candidates.length) return null;
  const out = candidates.sort((a, b) => cost(a.p) - cost(b.p))[0].i;
  const next = players.map((p, i) => (i === out ? offer : p));
  return { ...run, coins: run.coins - price, squad: { ...run.squad, players: next } };
}

/** A booster pack: one seeded random booster, up to the hand limit. */
export function buyPack(run: RunState): RunState | null {
  if (run.coins < PACK_COST || run.boosters.length >= MAX_BOOSTERS) return null;
  const rng = mulberry32(stageSeed(run, 11 + run.boosters.length + run.results.length));
  const booster = BOOSTERS[Math.floor(rng() * BOOSTERS.length)];
  return { ...run, coins: run.coins - PACK_COST, boosters: [...run.boosters, booster] };
}

/** Two tactics cards on offer this stage, never ones already held. */
export function tacticOffers(run: RunState): Tactic[] {
  const rng = mulberry32(stageSeed(run, 23));
  const free = TACTICS.filter((t) => !run.tactics.includes(t));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, TACTIC_OFFERS);
}

/** Buy a tactics card for the rest of the run. */
export function buyTactic(run: RunState, t: Tactic): RunState | null {
  const price = TACTIC_INFO[t].price;
  if (run.coins < price || run.tactics.includes(t) || run.tactics.length >= MAX_TACTICS) return null;
  return { ...run, coins: run.coins - price, tactics: [...run.tactics, t] };
}

// ---------------------------------------------------------------------------
// Persistence (guarded: the engine tests run without a window)
// ---------------------------------------------------------------------------

const KEY = 'flicksoccer.run';

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const run = JSON.parse(raw) as RunState;
    if (!run || !Array.isArray(run.squad?.players) || !run.squad.players.length) return null;
    // Runs saved before the league pools have players without a league; they cannot continue.
    if (!run.squad.players.every((p) => typeof p.league === 'string')) return null;
    run.tactics ??= [];
    return run;
  } catch {
    return null;
  }
}

export function saveRun(run: RunState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    /* no storage */
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no storage */
  }
}
