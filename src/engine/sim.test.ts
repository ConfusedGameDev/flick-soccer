import { describe, expect, it } from 'vitest';
import { INTERCEPT_CHANCE, PASS_RANGE, TACKLE_REACH } from './pitch';
import { mulberry32 } from './rng';
import { initialMatch } from './setup';
import { findReceiver, passTarget, resolveTurn } from './sim';
import type { Flick, MatchState, Plan, Vec2 } from './types';
import { dist, normalize, sub } from './vec';

const flick = (playerId: number, from: Vec2, to: Vec2, meters?: number): Flick => {
  const d = sub(to, from);
  const strength = Math.min(1, (meters ?? Math.hypot(d.x, d.y)) / PASS_RANGE);
  return { playerId, dir: normalize(d), strength };
};

const attack = (...flicks: Flick[]): Plan => ({ team: 'home', flicks });
const defense = (...flicks: Flick[]): Plan => ({ team: 'away', flicks });

/** Find a seed whose first roll lands on the wanted side of INTERCEPT_CHANCE. */
function seedWhereFirstRoll(succeeds: boolean): number {
  for (let s = 1; s < 10_000; s++) {
    const r = mulberry32(s)();
    if ((r < INTERCEPT_CHANCE) === succeeds) return s;
  }
  throw new Error('no seed found');
}

describe('resolveTurn', () => {
  const base: MatchState = initialMatch();
  const home = (n: number) => base.players.find((p) => p.team === 'home' && p.number === n)!;
  const away = (n: number) => base.players.find((p) => p.team === 'away' && p.number === n)!;

  it('is deterministic for the same state, plans and seed', () => {
    const a = attack(flick(home(1).id, home(1).pos, home(2).pos));
    const d = defense(flick(away(10).id, away(10).pos, home(2).pos));
    const r1 = resolveTurn(base, a, d, 42);
    const r2 = resolveTurn(base, a, d, 42);
    expect(r1).toEqual(r2);
    expect(r1.keyframes.length).toBeGreaterThan(1);
  });

  it('passes along a chain and ends with the last receiver', () => {
    // GK -> #2 (left back) -> #6 (left mid), with no defenders anywhere near.
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
  });

  it('lets a defender who slides onto the pass line intercept', () => {
    // Put an away forward right next to the pass line GK -> #2, standing still.
    const state: MatchState = structuredClone(base);
    const mid = { x: (home(1).pos.x + home(2).pos.x) / 2, y: (home(1).pos.y + home(2).pos.y) / 2 };
    const tackler = state.players[away(10).id];
    tackler.pos = { x: mid.x, y: mid.y + TACKLE_REACH * 2 };
    const toward = flick(tackler.id, tackler.pos, mid, TACKLE_REACH * 2);

    const a = attack(flick(home(1).id, home(1).pos, home(2).pos));
    const hit = resolveTurn(state, a, defense(toward), seedWhereFirstRoll(true));
    expect(hit.events.some((e) => e.type === 'intercept')).toBe(true);
    expect(hit.state.possession.team).toBe('away');
    expect(hit.state.possession.playerId).toBe(tackler.id);
    expect(hit.events.filter((e) => e.type === 'receive')).toHaveLength(0);

    const miss = resolveTurn(state, a, defense(toward), seedWhereFirstRoll(false));
    expect(miss.events.some((e) => e.type === 'intercept')).toBe(false);
    expect(miss.state.possession.team).toBe('home');
  });

  it('declares a dead ball when a pass lands away from every teammate', () => {
    const a = attack(flick(home(1).id, home(1).pos, { x: 34, y: 28 }));
    const r = resolveTurn(base, a, defense(), 7);
    expect(r.events.some((e) => e.type === 'dead-ball')).toBe(true);
    expect(r.state.possession).toEqual(base.possession);
  });

  it('ignores and reports a flick from a player who is not the carrier', () => {
    const a = attack(
      flick(home(5).id, home(5).pos, home(6).pos), // not the carrier
      flick(home(1).id, home(1).pos, home(2).pos),
    );
    const r = resolveTurn(base, a, defense(), 3);
    const invalid = r.events.find((e) => e.type === 'invalid-flick');
    expect(invalid).toBeDefined();
    expect(r.state.possession.playerId).toBe(home(2).id);
  });

  it('hands the ball to the other side when it goes out', () => {
    const gk = home(1);
    const a = attack({ playerId: gk.id, dir: { x: 0, y: -1 }, strength: 1 });
    const r = resolveTurn(base, a, defense(), 9);
    expect(r.events.some((e) => e.type === 'out')).toBe(true);
    expect(r.state.possession.team).toBe('away');
    expect(r.state.ball.y).toBeCloseTo(0, 3);
  });

  it('caps the plans at 3 attacking and 2 defending flicks', () => {
    const p = home(1);
    const many = Array.from({ length: 5 }, () => flick(p.id, p.pos, home(2).pos));
    const r = resolveTurn(base, attack(...many), defense(), 5);
    // Only the first pass is valid (the carrier changes), so at most 3 flicks were looked at.
    const looked = r.events.filter((e) => e.type === 'pass' || e.type === 'invalid-flick');
    expect(looked.length).toBeLessThanOrEqual(3);
  });
});

describe('helpers', () => {
  it('passTarget clips to the pitch edge and flags it out', () => {
    const { to, out } = passTarget({ x: 34, y: 2 }, { playerId: 0, dir: { x: 0, y: -1 }, strength: 1 });
    expect(out).toBe(true);
    expect(to.y).toBeCloseTo(0, 3);
  });

  it('findReceiver picks the nearest teammate in range and never the passer', () => {
    const s = initialMatch();
    const gk = s.players[0];
    expect(findReceiver(s.players, 'home', gk.pos, gk.id)).toBeNull();
    const lb = s.players[1];
    const r = findReceiver(s.players, 'home', { x: lb.pos.x + 1, y: lb.pos.y + 1 }, gk.id);
    expect(r?.id).toBe(lb.id);
    expect(dist(r!.pos, lb.pos)).toBe(0);
  });
});
