import { describe, expect, it } from 'vitest';
import {
  BLOCK_CHANCE,
  HOLD_CHANCE,
  INTERCEPT_CHANCE,
  PASS_RANGE,
  PITCH_L,
  PITCH_W,
  SAVE_CHANCE,
  TACKLE_REACH,
  TURNS_PER_HALF,
} from './pitch';
import { mulberry32 } from './rng';
import { initialMatch, keeperOf, kickoffPosition } from './setup';
import { continueMatch, findReceiver, flickKind, passTarget, resolveDuel, resolveTurn } from './sim';
import type { Flick, MatchState, Plan, Team, Vec2 } from './types';
import { dist, normalize, sub } from './vec';

const flick = (playerId: number, from: Vec2, to: Vec2, meters?: number): Flick => {
  const d = sub(to, from);
  const strength = Math.min(1, (meters ?? Math.hypot(d.x, d.y)) / PASS_RANGE);
  return { playerId, dir: normalize(d), strength };
};

const plan = (team: Team, ...flicks: Flick[]): Plan => ({ team, flicks });
const attack = (...flicks: Flick[]): Plan => plan('home', ...flicks);
const defense = (...flicks: Flick[]): Plan => plan('away', ...flicks);

/** Find a seed whose rolls land on the wanted sides of the given thresholds, in order. */
function seedFor(...wanted: { chance: number; succeeds: boolean }[]): number {
  for (let s = 1; s < 100_000; s++) {
    const rng = mulberry32(s);
    if (wanted.every((w) => (rng() < w.chance) === w.succeeds)) return s;
  }
  throw new Error('no seed found');
}

const base: MatchState = initialMatch();
const home = (n: number) => base.players.find((p) => p.team === 'home' && p.number === n)!;
const away = (n: number) => base.players.find((p) => p.team === 'away' && p.number === n)!;

/** Home striker with the ball near the away goal, nobody else nearby. */
function shootingState(): MatchState {
  const s: MatchState = structuredClone(base);
  const striker = s.players[home(10).id];
  striker.pos = { x: PITCH_W / 2, y: PITCH_L - 20 };
  s.ball = { ...striker.pos };
  s.possession = { team: 'home', playerId: striker.id };
  // Move away defenders far from the shot line.
  for (const p of s.players) if (p.team === 'away' && !p.keeper) p.pos = { x: 5, y: 30 };
  return s;
}
const straightShot = (s: MatchState): Flick => ({ playerId: s.possession.playerId, dir: { x: 0, y: 1 }, strength: 1 });

describe('resolveTurn: passing', () => {
  it('is deterministic for the same state, plans and seed', () => {
    const a = attack(flick(home(1).id, home(1).pos, home(2).pos));
    const d = defense(flick(away(10).id, away(10).pos, home(2).pos));
    expect(resolveTurn(base, a, d, 42)).toEqual(resolveTurn(base, a, d, 42));
  });

  it('passes along a chain and ends with the last receiver', () => {
    const a = attack(
      flick(home(1).id, home(1).pos, home(2).pos),
      flick(home(2).id, home(2).pos, home(6).pos),
    );
    const r = resolveTurn(base, a, defense(), 1);
    const receives = r.events.filter((e) => e.type === 'receive');
    expect(receives.map((e) => (e as { playerId: number }).playerId)).toEqual([home(2).id, home(6).id]);
    expect(r.state.possession).toEqual({ team: 'home', playerId: home(6).id });
    expect(r.state.ball).toEqual(home(6).pos);
    expect(r.state.turn).toBe(base.turn + 1);
    expect(r.state.status).toBe('playing');
  });

  it('lets a defender who slides onto the pass line intercept', () => {
    const state: MatchState = structuredClone(base);
    const mid = { x: (home(1).pos.x + home(2).pos.x) / 2, y: (home(1).pos.y + home(2).pos.y) / 2 };
    const tackler = state.players[away(10).id];
    tackler.pos = { x: mid.x, y: mid.y + TACKLE_REACH * 2 };
    const toward = flick(tackler.id, tackler.pos, mid, TACKLE_REACH * 2);
    const a = attack(flick(home(1).id, home(1).pos, home(2).pos));

    const hit = resolveTurn(state, a, defense(toward), seedFor({ chance: INTERCEPT_CHANCE, succeeds: true }));
    expect(hit.events.some((e) => e.type === 'intercept')).toBe(true);
    expect(hit.state.possession).toEqual({ team: 'away', playerId: tackler.id });

    const miss = resolveTurn(state, a, defense(toward), seedFor({ chance: INTERCEPT_CHANCE, succeeds: false }));
    expect(miss.events.some((e) => e.type === 'intercept')).toBe(false);
    expect(miss.state.possession.team).toBe('home');
  });

  it('declares a dead ball and asks for a duel when a pass lands away from everyone', () => {
    const a = attack(flick(home(1).id, home(1).pos, { x: 34, y: 34 }));
    const r = resolveTurn(base, a, defense(), 7);
    expect(r.events.some((e) => e.type === 'dead-ball')).toBe(true);
    expect(r.state.status).toBe('duel');
    expect(r.state.ball.y).toBeCloseTo(34, 3);

    const after = resolveDuel(r.state, 'away');
    expect(after.status).toBe('playing');
    expect(after.possession.team).toBe('away');
    expect(after.players[after.possession.playerId].pos).toEqual(r.state.ball);
  });

  it('treats a flick on a teammate as a run and the carrier can still pass', () => {
    const runner = home(6);
    const a = attack(
      { playerId: runner.id, dir: { x: 0, y: 1 }, strength: 1 },
      flick(home(1).id, home(1).pos, home(2).pos),
    );
    const r = resolveTurn(base, a, defense(), 3);
    expect(r.events.some((e) => e.type === 'run')).toBe(true);
    expect(r.state.players[runner.id].pos.y).toBeGreaterThan(runner.pos.y + 5);
    expect(r.state.possession.playerId).toBe(home(2).id);
  });

  it('gives a throw-in to the other side when the ball crosses the sideline', () => {
    const a = attack({ playerId: home(1).id, dir: normalize({ x: -1, y: 0.2 }), strength: 1 });
    const r = resolveTurn(base, a, defense(), 9);
    expect(r.events.some((e) => e.type === 'throw-in')).toBe(true);
    expect(r.state.possession.team).toBe('away');
    expect(r.state.ball.x).toBeCloseTo(0, 3);
    expect(r.state.players[r.state.possession.playerId].pos).toEqual(r.state.ball);
  });

  it('gives a goal kick when the attacker puts it over the far goal line', () => {
    const s = shootingState();
    // Wide of the posts, so not a shot: classified as a pass that goes out.
    const f: Flick = { playerId: s.possession.playerId, dir: normalize({ x: 1, y: 1 }), strength: 1 };
    expect(flickKind(s, 'home', 'attack', f)).toBe('pass');
    const r = resolveTurn(s, attack(f), defense(), 2);
    expect(r.events.some((e) => e.type === 'goal-kick')).toBe(true);
    expect(r.state.possession).toEqual({ team: 'away', playerId: keeperOf(s.players, 'away').id });
  });
});

describe('resolveTurn: shooting', () => {
  it('classifies a flick at the goal from the attacking third as a shot', () => {
    const s = shootingState();
    expect(flickKind(s, 'home', 'attack', straightShot(s))).toBe('shot');
    // Same aim from midfield is only a pass.
    const far = structuredClone(s);
    far.ball = { x: PITCH_W / 2, y: 50 };
    far.players[far.possession.playerId].pos = { ...far.ball };
    expect(flickKind(far, 'home', 'attack', straightShot(far))).toBe('pass');
  });

  it('scores when the keeper misses the save', () => {
    const s = shootingState();
    const r = resolveTurn(s, attack(straightShot(s)), defense(), seedFor({ chance: SAVE_CHANCE, succeeds: false }));
    expect(r.events.some((e) => e.type === 'goal')).toBe(true);
    expect(r.state.score).toEqual({ home: 1, away: 0 });
    // Kickoff reset: away keeper restarts, everyone back in formation.
    expect(r.state.possession).toEqual({ team: 'away', playerId: keeperOf(s.players, 'away').id });
    expect(r.state.players[home(10).id].pos).toEqual(kickoffPosition('home', 9));
  });

  it('lets the keeper save and hold, or save and concede a corner', () => {
    const s = shootingState();
    const hold = resolveTurn(
      s,
      attack(straightShot(s)),
      defense(),
      seedFor({ chance: SAVE_CHANCE, succeeds: true }, { chance: HOLD_CHANCE, succeeds: true }),
    );
    expect(hold.events.some((e) => e.type === 'save')).toBe(true);
    expect(hold.state.score).toEqual({ home: 0, away: 0 });
    expect(hold.state.possession).toEqual({ team: 'away', playerId: keeperOf(s.players, 'away').id });

    const corner = resolveTurn(
      s,
      attack(straightShot(s)),
      defense(),
      seedFor({ chance: SAVE_CHANCE, succeeds: true }, { chance: HOLD_CHANCE, succeeds: false }),
    );
    expect(corner.events.some((e) => e.type === 'corner')).toBe(true);
    expect(corner.state.possession.team).toBe('home');
    expect(corner.state.ball.y).toBe(PITCH_L);
    expect([0, PITCH_W]).toContain(corner.state.ball.x);
  });

  it('lets a keeper dive out of the way and concede', () => {
    const s = shootingState();
    const gk = keeperOf(s.players, 'away');
    const dive: Flick = { playerId: gk.id, dir: { x: 1, y: 0 }, strength: 1 };
    expect(flickKind(s, 'away', 'defense', dive)).toBe('dive');
    // The keeper would have saved had it stayed put; the dive takes it out of reach.
    const r = resolveTurn(s, attack(straightShot(s)), defense(dive), seedFor({ chance: SAVE_CHANCE, succeeds: true }));
    expect(r.events.some((e) => e.type === 'dive')).toBe(true);
    expect(r.events.some((e) => e.type === 'goal')).toBe(true);
  });

  it('lets an outfield defender block a shot', () => {
    const s = shootingState();
    const blocker = s.players[away(5).id];
    blocker.pos = { x: PITCH_W / 2, y: s.ball.y + 8 };
    const r = resolveTurn(s, attack(straightShot(s)), defense(), seedFor({ chance: BLOCK_CHANCE, succeeds: true }));
    expect(r.events.some((e) => e.type === 'intercept')).toBe(true);
    expect(r.state.possession).toEqual({ team: 'away', playerId: blocker.id });
  });
});

describe('match clock', () => {
  const quiet = (s: MatchState) => resolveTurn(s, plan(s.possession.team), plan(s.possession.team === 'home' ? 'away' : 'home'), 1);

  it('goes to half-time after TURNS_PER_HALF turns and the other side kicks off', () => {
    let s = base;
    for (let i = 0; i < TURNS_PER_HALF - 1; i++) s = quiet(s).state;
    expect(s.status).toBe('playing');
    expect(s.turn).toBe(TURNS_PER_HALF);
    const r = quiet(s);
    expect(r.state.status).toBe('half-time');
    expect(r.state.half).toBe(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.possession).toEqual({ team: 'away', playerId: keeperOf(base.players, 'away').id });
    expect(continueMatch(r.state).status).toBe('playing');
  });

  it('ends at full-time after the second half', () => {
    let s = base;
    for (let i = 0; i < TURNS_PER_HALF; i++) s = quiet(s).state;
    s = continueMatch(s);
    for (let i = 0; i < TURNS_PER_HALF - 1; i++) s = quiet(s).state;
    const r = quiet(s);
    expect(r.state.status).toBe('full-time');
    expect(r.events.some((e) => e.type === 'full-time')).toBe(true);
  });
});

describe('helpers', () => {
  it('passTarget clips to the pitch edge and flags it out', () => {
    const { to, out } = passTarget({ x: 34, y: 2 }, { playerId: 0, dir: { x: 0, y: -1 }, strength: 1 });
    expect(out).toBe(true);
    expect(to.y).toBeCloseTo(0, 3);
  });

  it('findReceiver picks the nearest teammate in range and never the passer', () => {
    const gk = base.players[0];
    expect(findReceiver(base.players, 'home', gk.pos, gk.id)).toBeNull();
    const lb = base.players[1];
    const r = findReceiver(base.players, 'home', { x: lb.pos.x + 1, y: lb.pos.y + 1 }, gk.id);
    expect(r?.id).toBe(lb.id);
    expect(dist(r!.pos, lb.pos)).toBe(0);
  });

  it('caps the plans at 3 attacking and 2 defending flicks', () => {
    const p = home(1);
    const many = Array.from({ length: 5 }, () => flick(p.id, p.pos, home(2).pos));
    const r = resolveTurn(base, attack(...many), defense(), 5);
    const looked = r.events.filter((e) => e.type === 'pass' || e.type === 'invalid-flick');
    expect(looked.length).toBeLessThanOrEqual(3);
  });
});
