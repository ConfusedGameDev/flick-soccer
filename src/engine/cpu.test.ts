import { describe, expect, it } from 'vitest';
import { planAttack, planDefense, scoreTurn } from './cpu';
import { MAX_FLICKS, PITCH_L, PITCH_W, SAVE_CHANCE } from './pitch';
import { mulberry32 } from './rng';
import { initialMatch } from './setup';
import { flickKind, resolveTurn } from './sim';
import type { MatchState, Plan } from './types';

const base = initialMatch();

function shootingState(): MatchState {
  const s: MatchState = structuredClone(base);
  const striker = s.players.find((p) => p.team === 'home' && p.number === 10)!;
  striker.pos = { x: PITCH_W / 2, y: PITCH_L - 18 };
  s.ball = { ...striker.pos };
  s.possession = { team: 'home', playerId: striker.id };
  for (const p of s.players) if (p.team === 'away' && !p.keeper) p.pos = { x: 5, y: 30 };
  return s;
}

function validPlan(state: MatchState, plan: Plan, role: 'attack' | 'defense'): void {
  expect(plan.flicks.length).toBeLessThanOrEqual(MAX_FLICKS[role]);
  for (const f of plan.flicks) {
    expect(state.players[f.playerId].team).toBe(plan.team);
    expect(f.strength).toBeGreaterThan(0);
    expect(f.strength).toBeLessThanOrEqual(1);
    expect(Math.hypot(f.dir.x, f.dir.y)).toBeCloseTo(1, 5);
  }
}

describe('cpu attack', () => {
  it('produces a legal plan and is deterministic for a seed', () => {
    const a = planAttack(base, 'home', 'normal', 11);
    validPlan(base, a, 'attack');
    expect(a.flicks.length).toBeGreaterThan(0);
    expect(planAttack(base, 'home', 'normal', 11)).toEqual(a);
    expect(planAttack(base, 'home', 'normal', 12)).not.toEqual(a);
  });

  it('keeps possession and moves the ball forward from kickoff', () => {
    const a = planAttack(base, 'home', 'normal', 5);
    const r = resolveTurn(base, a, { team: 'away', flicks: [] }, 1);
    expect(r.state.possession.team).toBe('home');
    expect(r.state.ball.y).toBeGreaterThan(base.ball.y);
  });

  it('shoots when a striker is in front of goal', () => {
    const s = shootingState();
    const a = planAttack(s, 'home', 'normal', 3);
    expect(a.flicks.some((f) => flickKind(s, 'home', 'attack', f) === 'shot')).toBe(true);
  });

  it('plans for the away side too', () => {
    const s = initialMatch('away');
    const a = planAttack(s, 'away', 'easy', 8);
    validPlan(s, a, 'attack');
    const r = resolveTurn(s, a, { team: 'home', flicks: [] }, 2);
    expect(r.state.ball.y).toBeLessThan(s.ball.y);
  });
});

describe('cpu defense', () => {
  it('produces a legal plan and is deterministic for a seed', () => {
    const d = planDefense(base, 'away', 'normal', 21);
    validPlan(base, d, 'defense');
    expect(planDefense(base, 'away', 'normal', 21)).toEqual(d);
  });

  it('moves the keeper or a blocker when a shot is coming', () => {
    const s = shootingState();
    const d = planDefense(s, 'away', 'normal', 4);
    expect(d.flicks.length).toBeGreaterThan(0);
    // Against the striker's best shot, the chosen defense should not be worse than standing still.
    const shot = planAttack(s, 'home', 'normal', 3);
    const seed = (() => {
      for (let i = 1; i < 1000; i++) if (mulberry32(i)() >= SAVE_CHANCE) return i;
      return 1;
    })();
    const idle = scoreTurn(s, resolveTurn(s, shot, { team: 'away', flicks: [] }, seed), 'home');
    const planned = scoreTurn(s, resolveTurn(s, shot, d, seed), 'home');
    expect(planned).toBeLessThanOrEqual(idle + 1e-9);
  });
});
