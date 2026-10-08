import {
  DIVE_RANGE,
  GOAL_W,
  MAX_FLICKS,
  PASS_RANGE,
  PITCH_L,
  PITCH_W,
  SHOT_RANGE,
  SLIDE_RANGE,
  inAttackingThird,
  other,
  targetGoalY,
} from './pitch';
import { BOOSTER_INFO, rollDice } from './dice';
import { mulberry32 } from './rng';
import { maxFlicksFor } from './tactics';
import { findReceiver, goalLineCrossing, kickRange, passTarget, resolveTurn } from './sim';
import { keeperOf } from './setup';
import type { Flick, MatchState, Plan, PlayerState, Team, TurnResult, Vec2 } from './types';
import { add, clamp, dist, normalize, scale, sub } from './vec';

// The CPU plans by sampling candidate plans and scoring them with the real
// engine over a few seeds. Attack: pick the chain with the best expected
// outcome. Defense: predict the opponent's best attacks the same way, then
// pick the slides and dive that do the most damage against them.

export type Difficulty = 'easy' | 'normal';

interface Params {
  attackSamples: number;
  defenseSamples: number;
  /** How many predicted attacks the defense plans against. */
  predictions: number;
  seeds: number;
  /** Random angle (radians) and strength error added to the chosen plan. */
  noise: number;
  /** Button presses per second in a dispute duel (client-side). */
  mashRate: number;
}

export const CPU_PARAMS: Record<Difficulty, Params> = {
  easy: { attackSamples: 18, defenseSamples: 12, predictions: 2, seeds: 2, noise: 0.22, mashRate: 5.5 },
  normal: { attackSamples: 60, defenseSamples: 36, predictions: 3, seeds: 3, noise: 0, mashRate: 8.5 },
};

type Rng = () => number;

/** Flick that sends the ball (or a player) from `from` toward `to`, covering `meters` of the given range. */
function aim(playerId: number, from: Vec2, to: Vec2, range: number, meters = dist(from, to)): Flick {
  return { playerId, dir: normalize(sub(to, from)), strength: clamp(meters / range, 0.05, 1) };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** How good a resolved turn is for `team` (bigger is better). */
export function scoreTurn(before: MatchState, r: TurnResult, team: Team): number {
  const s = r.state;
  const goalY = targetGoalY(team);
  let score = 0;
  for (const e of r.events) {
    if (e.type === 'goal') score += e.team === team ? 100 : -100;
    if (e.type === 'save') score += team === before.possession.team ? 2 : 0; // a shot that forced a save still beats nothing
  }
  if (s.status === 'duel') score -= 6;
  else if (s.possession.team === team) score += 12;
  else score -= 14;
  // Progress toward the goal we attack, measured where the ball ends up. Ground
  // gained is worth much less if we don't have the ball at the end of it.
  const advance = Math.abs(goalY - before.ball.y) - Math.abs(goalY - s.ball.y);
  score += advance * (s.possession.team === team && s.status !== 'duel' ? 0.6 : 0.2);
  if (s.possession.team === team && inAttackingThird(team, s.ball)) score += 8;
  return score;
}

function expectedScore(state: MatchState, attack: Plan, defense: Plan, team: Team, seeds: number, base: number): number {
  let total = 0;
  for (let i = 0; i < seeds; i++) {
    total += scoreTurn(state, resolveTurn(state, attack, defense, base + i * 104729, { keyframes: false }), team);
  }
  return total / seeds;
}

// ---------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------

/** One random, plausible attacking plan built by projecting the chain forward. */
function sampleAttack(state: MatchState, team: Team, rng: Rng, maxFlicks: number = MAX_FLICKS.attack): Plan {
  const flicks: Flick[] = [];
  const goalY = targetGoalY(team);
  let ball = state.ball;
  let carrier = state.possession.playerId;
  const used = new Set<number>([carrier]);
  const mates = state.players.filter((p) => p.team === team);

  // Sometimes send a runner forward first; runs happen in parallel with the passes.
  if (rng() < 0.3) {
    const runner = mates[Math.floor(rng() * mates.length)];
    if (runner.id !== carrier && !runner.keeper) {
      const ahead = { x: clamp(runner.pos.x + (rng() - 0.5) * 16, 2, PITCH_W - 2), y: clamp(goalY, 2, PITCH_L - 2) };
      flicks.push(aim(runner.id, runner.pos, ahead, 14, 8 + rng() * 6));
      used.add(runner.id);
    }
  }

  while (flicks.length < maxFlicks) {
    const live: MatchState = { ...state, ball, possession: { team, playerId: carrier } };
    const options: { flick: Flick; weight: number; next: PlayerState | null }[] = [];

    if (inAttackingThird(team, ball)) {
      for (const dx of [-GOAL_W * 0.38, 0, GOAL_W * 0.38]) {
        const target = { x: PITCH_W / 2 + dx, y: goalY };
        // A shot must reach the line to count, so never offer one from out of range.
        if (dist(ball, target) > SHOT_RANGE * kickRange(state.players[carrier], 'shot')) continue;
        options.push({ flick: aim(carrier, ball, target, 1, 1), weight: 6 + 40 / (1 + dist(ball, target) / 10), next: null });
      }
    }
    const reach = PASS_RANGE * kickRange(state.players[carrier], 'pass');
    for (const m of mates) {
      if (used.has(m.id) || m.keeper) continue;
      const d = dist(ball, m.pos);
      if (d > reach || d < 3) continue;
      // Slight error so the sample space isn't just "perfect passes".
      const target = add(m.pos, { x: (rng() - 0.5) * 2, y: (rng() - 0.5) * 2 });
      const flick = aim(carrier, ball, target, reach);
      const { to, out } = passTarget(ball, flick, 'pass', kickRange(state.players[carrier], 'pass'));
      const receiver = out ? null : findReceiver(live.players, team, to, carrier);
      if (!receiver) continue;
      const advance = Math.abs(goalY - ball.y) - Math.abs(goalY - receiver.pos.y);
      options.push({ flick, weight: 2 + Math.max(0, advance) * 0.4 + rng() * 3, next: receiver });
    }
    if (options.length === 0) break;

    const total = options.reduce((s, o) => s + o.weight, 0);
    let pick = rng() * total;
    let chosen = options[options.length - 1];
    for (const o of options) {
      pick -= o.weight;
      if (pick <= 0) {
        chosen = o;
        break;
      }
    }
    flicks.push(chosen.flick);
    if (!chosen.next) break; // a shot ends the chain
    used.add(chosen.next.id);
    carrier = chosen.next.id;
    ball = chosen.next.pos;
    if (rng() < 0.25) break; // shorter chains are safer
  }
  return { team, flicks };
}

function addNoise(plan: Plan, noise: number, rng: Rng): Plan {
  if (noise === 0) return plan;
  return {
    team: plan.team,
    flicks: plan.flicks.map((f) => {
      const a = (rng() - 0.5) * 2 * noise;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return {
        playerId: f.playerId,
        dir: { x: f.dir.x * c - f.dir.y * s, y: f.dir.x * s + f.dir.y * c },
        strength: clamp(f.strength * (1 + (rng() - 0.5) * noise), 0.05, 1),
      };
    }),
  };
}

/** The `count` best attacking plans (best first) with their expected scores. */
function rankAttacks(
  state: MatchState,
  team: Team,
  params: Params,
  seed: number,
  count: number,
  extras: Pick<Plan, 'dice' | 'booster'> = {},
): { plan: Plan; score: number }[] {
  const rng = mulberry32(seed);
  const empty: Plan = { team: other(team), flicks: [] };
  const ranked: { plan: Plan; score: number }[] = [];
  const maxFlicks = MAX_FLICKS.attack - (extras.dice ? 1 : 0) + (extras.booster === 'extra-flick' ? 1 : 0);
  for (let i = 0; i < params.attackSamples; i++) {
    const plan = { ...sampleAttack(state, team, rng, maxFlicks), ...extras };
    ranked.push({ plan, score: expectedScore(state, plan, empty, team, params.seeds, seed + i) });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, count);
}

/**
 * Dice and booster choices for a turn. The CPU trades a flick for a roll
 * about a third of the time when allowed (the roll itself is made here, with
 * the same seeded rule as a human's), and plays the first held booster that
 * fits its role.
 */
export function cpuExtras(state: MatchState, team: Team, role: 'attack' | 'defense', seed: number): Pick<Plan, 'dice' | 'booster'> {
  const rng = mulberry32(seed ^ 0x3c6ef372);
  const m = state.meta[team];
  const extras: Pick<Plan, 'dice' | 'booster'> = {};
  if (m.blocked === 0 && rng() < 0.33) extras.dice = rollDice(rng);
  const held = [...m.boosters, ...(extras.dice?.booster ? [extras.dice.booster] : [])];
  const fit = held.find((b) => BOOSTER_INFO[b].roles.includes(role));
  if (fit) extras.booster = fit;
  return extras;
}

export function planAttack(state: MatchState, team: Team, difficulty: Difficulty, seed: number): Plan {
  const params = CPU_PARAMS[difficulty];
  const extras = cpuExtras(state, team, 'attack', seed);
  const best = rankAttacks(state, team, params, seed, 1, extras)[0]?.plan ?? { team, flicks: [], ...extras };
  return addNoise(best, params.noise, mulberry32(seed ^ 0x5bd1e995));
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

/** Closest point to `p` on segment ab. */
function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 < 1e-9) return a;
  const k = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2, 0, 1);
  return add(a, scale(ab, k));
}

/** The pass/shot segments a predicted attack would produce, projected like the engine does. */
function segmentsOf(state: MatchState, plan: Plan): { a: Vec2; b: Vec2; shot: boolean }[] {
  const team = plan.team;
  const segs: { a: Vec2; b: Vec2; shot: boolean }[] = [];
  let ball = state.ball;
  let carrier = state.possession.playerId;
  for (const f of plan.flicks) {
    if (f.playerId !== carrier) continue; // a run
    const cross = goalLineCrossing(team, ball, f.dir);
    const shot = !!cross && Math.abs(cross.x - PITCH_W / 2) <= GOAL_W / 2 && inAttackingThird(team, ball);
    const { to, out } = passTarget(ball, f, shot ? 'shot' : 'pass', kickRange(state.players[carrier], shot ? 'shot' : 'pass'));
    segs.push({ a: ball, b: to, shot });
    if (shot) break;
    const receiver = out ? null : findReceiver(state.players, team, to, carrier);
    if (!receiver) break;
    carrier = receiver.id;
    ball = receiver.pos;
  }
  return segs;
}

function sampleDefense(state: MatchState, team: Team, predicted: Plan[], rng: Rng, maxFlicks: number = MAX_FLICKS.defense): Plan {
  const flicks: Flick[] = [];
  const used = new Set<number>();
  const defenders = state.players.filter((p) => p.team === team && !p.keeper);
  const keeper = keeperOf(state.players, team);
  const allSegs = predicted.flatMap((p) => segmentsOf(state, p));
  const shots = allSegs.filter((s) => s.shot);
  const n = 1 + (rng() < 0.75 ? 1 : 0);

  while (flicks.length < Math.min(n, maxFlicks)) {
    // Keeper: dive to where a predicted shot crosses the line.
    if (shots.length && !used.has(keeper.id) && rng() < 0.6) {
      const s = shots[Math.floor(rng() * shots.length)];
      const target = { x: s.b.x, y: keeper.pos.y };
      flicks.push(aim(keeper.id, keeper.pos, target, DIVE_RANGE));
      used.add(keeper.id);
      continue;
    }
    if (allSegs.length === 0) break;
    const seg = allSegs[Math.floor(rng() * allSegs.length)];
    // Among the few defenders nearest to this lane, pick one and slide onto it.
    const ranked = defenders
      .filter((d) => !used.has(d.id))
      .map((d) => ({ d, at: closestOnSegment(d.pos, seg.a, seg.b) }))
      .map((x) => ({ ...x, dd: dist(x.d.pos, x.at) }))
      .sort((p, q) => p.dd - q.dd)
      .slice(0, 3);
    if (ranked.length === 0) break;
    const choice = ranked[Math.floor(rng() * ranked.length)];
    if (choice.dd > SLIDE_RANGE * 1.4) break;
    // Aim a little along the lane so the slide meets the ball rather than trailing it.
    const target = add(choice.at, scale(normalize(sub(seg.b, seg.a)), (rng() - 0.3) * 3));
    flicks.push(aim(choice.d.id, choice.d.pos, target, SLIDE_RANGE));
    used.add(choice.d.id);
  }
  return { team, flicks };
}

export function planDefense(state: MatchState, team: Team, difficulty: Difficulty, seed: number): Plan {
  const params = CPU_PARAMS[difficulty];
  const attacker = other(team);
  const predicted = rankAttacks(state, attacker, params, seed ^ 0x9e3779b9, params.predictions).map((r) => r.plan);
  if (predicted.length === 0) return { team, flicks: [] };

  const rng = mulberry32(seed);
  const extras = cpuExtras(state, team, 'defense', seed);
  const maxFlicks = maxFlicksFor(state.meta[team], 'defense') - (extras.dice ? 1 : 0) + (extras.booster === 'extra-flick' ? 1 : 0);
  let best: Plan = { team, flicks: [], ...extras };
  let bestScore = Infinity;
  const candidates = [
    best,
    ...Array.from({ length: params.defenseSamples }, () => ({ ...sampleDefense(state, team, predicted, rng, maxFlicks), ...extras })),
  ];
  candidates.forEach((candidate, i) => {
    let total = 0;
    for (const attack of predicted) total += expectedScore(state, attack, candidate, attacker, params.seeds, seed + i * 7);
    const s = total / predicted.length;
    if (s < bestScore) {
      bestScore = s;
      best = candidate;
    }
  });
  return addNoise(best, params.noise, mulberry32(seed ^ 0x27d4eb2f));
}
