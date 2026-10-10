import { describe, expect, it } from 'vitest';
import { BLOCK_CHANCE, BODY_RADIUS, GOAL_W, HEIGHT_SAVE_SHIFT, HOLD_CHANCE, INTERCEPT_CHANCE, PASS_RANGE, PITCH_L, PITCH_W, RUN_RANGE, SAVE_CHANCE, SET_PIECE_METERS, SLIDE_RANGE, TACKLE_REACH, TURNS_PER_HALF } from './pitch';
import { mulberry32 } from './rng';
import { initialMatch, keeperOf, kickoffPosition } from './setup';
import { continueMatch, findReceiver, flickKind, passTarget, resolveDuel, resolveTurn, spotTaken } from './sim';
import type { Flick, MatchState, Plan, PlayerState, Team, TurnResult, Vec2 } from './types';
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
/** An explicit (Shoot button) shot straight at goal, no timing game: it flies exactly where aimed. */
const straightShot = (s: MatchState): Flick => ({ playerId: s.possession.playerId, dir: { x: 0, y: 1 }, strength: 1, shot: true });

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

    const { state: after, booster } = resolveDuel(r.state, 'away', 5);
    expect(after.status).toBe('playing');
    expect(after.possession.team).toBe('away');
    expect(after.players[after.possession.playerId].pos).toEqual(r.state.ball);
    // The winner banks a free booster pack.
    expect(booster).not.toBeNull();
    expect(after.meta.away.boosters).toEqual([booster]);
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

describe('resolveTurn: set pieces and the timing game', () => {
  /** A roll we do not care about (the scatter draws of an aimed flick). */
  const skip = { chance: 1, succeeds: true };

  it('only the Shoot marker makes a shot; a plain drag at goal is a pass', () => {
    const s = shootingState();
    const drag: Flick = { ...straightShot(s), shot: undefined };
    expect(flickKind(s, 'home', 'attack', drag)).toBe('pass');
    expect(flickKind(s, 'home', 'attack', straightShot(s))).toBe('shot');
    const mid = structuredClone(s);
    mid.players[mid.possession.playerId].pos = { x: PITCH_W / 2, y: PITCH_L / 2 };
    mid.ball = { ...mid.players[mid.possession.playerId].pos };
    expect(flickKind(mid, 'home', 'attack', straightShot(mid))).toBe('pass');
    // The marker means nothing on a teammate or a defender.
    expect(flickKind(s, 'home', 'attack', { ...straightShot(s), playerId: home(9).id })).toBe('run');
    expect(flickKind(s, 'away', 'defense', { ...straightShot(s), playerId: away(9).id })).toBe('slide');
  });

  it('a marked shot aimed wide is still a shot, and ends in a goal kick', () => {
    const s = shootingState();
    const wide: Flick = { ...straightShot(s), dir: normalize({ x: 1, y: 1 }) };
    expect(flickKind(s, 'home', 'attack', wide)).toBe('shot');
    const r = resolveTurn(s, attack(wide), defense(), 3);
    expect(r.events.some((e) => e.type === 'shot')).toBe(true);
    expect(r.events.some((e) => e.type === 'goal-kick')).toBe(true);
  });

  it('accuracy 1 flies exactly where aimed; accuracy 0 scatters; the same seed scatters the same way', () => {
    const s = shootingState();
    const perfect = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy: 1, height: 0.5 } }), defense(), 7);
    const shotTo = (r: ReturnType<typeof resolveTurn>) => (r.events.find((e) => e.type === 'shot') as { to: Vec2 }).to;
    expect(shotTo(perfect).x).toBeCloseTo(PITCH_W / 2, 3);
    // A seed whose first draw is far from the middle pushes an accuracy-0 shot off its line.
    const seed = seedFor({ chance: 0.1, succeeds: true });
    const wild = attack({ ...straightShot(s), aim: { accuracy: 0, height: 0.5 } });
    const a = resolveTurn(s, wild, defense(), seed);
    expect(Math.abs(shotTo(a).x - PITCH_W / 2)).toBeGreaterThan(1);
    expect(resolveTurn(s, wild, defense(), seed)).toEqual(a);
  });

  it('a shot over the bar is a goal kick that the keeper never touches', () => {
    const s = shootingState();
    const r = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy: 1, height: 0.95 } }), defense(), seedFor(skip, skip, { chance: SAVE_CHANCE, succeeds: true }));
    expect(r.events.some((e) => e.type === 'save')).toBe(false);
    expect(r.events.some((e) => e.type === 'goal')).toBe(false);
    expect(r.events.some((e) => e.type === 'goal-kick')).toBe(true);
  });

  it('a height locked over the bar goes over even when the scatter would pull it back down', () => {
    const s = shootingState();
    for (let seed = 1; seed <= 200; seed++) {
      const r = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy: 0, height: 0.9 } }), defense(), seed);
      expect(r.events.some((e) => e.type === 'goal'), `seed ${seed}`).toBe(false);
    }
  });

  it('a perfect shot into the corner beats the keeper more often than one straight at him', () => {
    const s = shootingState();
    const from = s.ball;
    const corner: Flick = { ...straightShot(s), dir: normalize(sub({ x: PITCH_W / 2 + GOAL_W * 0.4, y: PITCH_L }, from)) };
    const goals = (f: Flick) => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const r = resolveTurn(s, attack({ ...f, aim: { accuracy: 1, height: 0.5 } }), defense(), seed);
        if (r.events.some((e) => e.type === 'goal')) n++;
      }
      return n / 400;
    };
    const atKeeper = goals(straightShot(s));
    const placed = goals(corner);
    expect(placed).toBeGreaterThan(atKeeper + 0.2);
    expect(placed).toBeGreaterThan(0.5);
  });

  it('high shots are harder to save', () => {
    const s = shootingState();
    // A save roll (the third draw, after the two scatter draws) between the shifted and the
    // plain save chance: saved on the ground, scored up high.
    const seed = (() => {
      for (let s = 1; s < 100_000; s++) {
        const rng = mulberry32(s);
        rng();
        rng();
        const roll = rng();
        if (roll < SAVE_CHANCE && roll >= SAVE_CHANCE - HEIGHT_SAVE_SHIFT * 0.8) return s;
      }
      throw new Error('no seed found');
    })();
    const low = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy: 1, height: 0 } }), defense(), seed);
    const high = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy: 1, height: 0.8 } }), defense(), seed);
    expect(low.events.some((e) => e.type === 'save')).toBe(true);
    expect(high.events.some((e) => e.type === 'goal')).toBe(true);
  });

  it('a perfect timing game scores more often than a botched one', () => {
    const s = shootingState();
    const goals = (accuracy: number) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const r = resolveTurn(s, attack({ ...straightShot(s), aim: { accuracy, height: 0.5 } }), defense(), seed);
        if (r.events.some((e) => e.type === 'goal')) n++;
      }
      return n;
    };
    const perfect = goals(1);
    expect(perfect).toBeGreaterThan(0);
    expect(perfect).toBeGreaterThan(goals(0));
  });

  it('ignores a bogus aim on a plain pass', () => {
    const a = attack({ ...flick(home(1).id, home(1).pos, home(2).pos), aim: { accuracy: Number.NaN } });
    const r = resolveTurn(base, a, defense(), 42);
    expect(r.events.some((e) => e.type === 'receive' || e.type === 'dead-ball' || e.type === 'intercept')).toBe(true);
  });

  it('hands the attacker a corner or a throw-in as a set piece, and clears it the turn after', () => {
    const s = shootingState();
    const corner = resolveTurn(s, attack(straightShot(s)), defense(), seedFor({ chance: SAVE_CHANCE, succeeds: true }, { chance: HOLD_CHANCE, succeeds: false }));
    expect(corner.state.setPiece).toBe('corner');
    // The striker on the touchline kicks it straight out.
    const side = shootingState();
    side.players[side.possession.playerId].pos = { x: 3, y: PITCH_L - 20 };
    side.ball = { ...side.players[side.possession.playerId].pos };
    const out = resolveTurn(side, attack({ playerId: side.possession.playerId, dir: { x: -1, y: 0 }, strength: 1 }), defense(), 2);
    expect(out.events.some((e) => e.type === 'throw-in')).toBe(true);
    expect(out.state.setPiece).toBe('throw-in');
    // A quiet next turn drops the key entirely.
    const next = resolveTurn(out.state, plan('away'), plan('home'), 3);
    expect('setPiece' in next.state).toBe(false);
  });

  it('fixes the restart distance and never lets the restart flick be a shot', () => {
    const s = shootingState();
    const r = resolveTurn(s, attack(straightShot(s)), defense(), seedFor({ chance: SAVE_CHANCE, succeeds: true }, { chance: HOLD_CHANCE, succeeds: false }));
    const c = r.state;
    const taker = c.players[c.possession.playerId];
    // Towards the goal from the corner flag, full pull: the engine still kicks SET_PIECE_METERS.
    const kick: Flick = { playerId: taker.id, dir: normalize({ x: PITCH_W / 2 - c.ball.x, y: -12 }), strength: 1, shot: true };
    expect(flickKind(c, 'home', 'attack', kick)).toBe('pass');
    const t = resolveTurn(c, attack(kick), defense(), 5);
    const pass = t.events.find((e) => e.type === 'pass') as { to: Vec2 };
    expect(dist(c.ball, pass.to)).toBeCloseTo(SET_PIECE_METERS.corner, 0);
  });
});

describe('resolveTurn: own goal line', () => {
  it('gives a corner to the other side when the ball is kicked out behind its own goal', () => {
    const s: MatchState = structuredClone(base);
    const k = keeperOf(s.players, 'home');
    k.pos = { x: PITCH_W / 2, y: 5 };
    s.ball = { ...k.pos };
    s.possession = { team: 'home', playerId: k.id };
    const r = resolveTurn(s, attack({ playerId: k.id, dir: { x: 0.2, y: -1 }, strength: 1 }), defense(), 4);
    expect(r.events.some((e) => e.type === 'corner' && e.team === 'away')).toBe(true);
    expect(r.events.some((e) => e.type === 'goal-kick')).toBe(false);
    expect(r.state.setPiece).toBe('corner');
    expect(r.state.possession.team).toBe('away');
    expect(r.state.ball.y).toBe(0);
    expect([0, PITCH_W]).toContain(r.state.ball.x);
  });
});

describe('resolveTurn: moves may not end on another player', () => {
  const spotOf = (p: { pos: Vec2 }, dx: number, dy: number): Vec2 => ({ x: p.pos.x + dx, y: p.pos.y + dy });
  /** A run flick from `runner` that ends exactly at `to` (RUN_RANGE covers it at baseline speed). */
  const runTo = (runner: PlayerState, to: Vec2): Flick => {
    const d = sub(to, runner.pos);
    return { playerId: runner.id, dir: normalize(d), strength: Math.hypot(d.x, d.y) / RUN_RANGE };
  };
  const taken = (r: TurnResult, id: number) => r.events.some((e) => e.type === 'invalid-flick' && e.playerId === id && e.reason === 'spot taken');

  it('refuses a run onto a team-mate and keeps the runner where he was', () => {
    // Home 6 and 7 stand on the same row 16 m apart at kickoff: a 14 m run reaches 7's side.
    const runner = home(6);
    const mate = home(7);
    const near = spotOf(mate, -(BODY_RADIUS * 2 - 0.3), 0);
    expect(dist(runner.pos, near)).toBeLessThanOrEqual(RUN_RANGE);
    const r = resolveTurn(base, attack(runTo(runner, near)), defense(), 3);
    expect(taken(r, runner.id)).toBe(true);
    expect(r.events.some((e) => e.type === 'run')).toBe(false);
    expect(r.state.players[runner.id].pos).toEqual(runner.pos);
  });

  it('lets the same run end just outside the body radius', () => {
    const runner = home(6);
    const mate = home(7);
    const free = spotOf(mate, -(BODY_RADIUS * 2 + 0.3), 0);
    const r = resolveTurn(base, attack(runTo(runner, free)), defense(), 3);
    expect(taken(r, runner.id)).toBe(false);
    expect(r.events.some((e) => e.type === 'run')).toBe(true);
    expect(r.state.players[runner.id].pos.x).toBeCloseTo(free.x, 1);
  });

  it('refuses a slide onto an attacker', () => {
    const s: MatchState = structuredClone(base);
    const defender = s.players.find((p) => p.team === 'away' && p.number === 5)!;
    const target = s.players.find((p) => p.team === 'home' && p.number === 10)!;
    defender.pos = { x: target.pos.x, y: target.pos.y + 6 };
    const d = sub(target.pos, defender.pos);
    const slide: Flick = { playerId: defender.id, dir: normalize(d), strength: 6 / SLIDE_RANGE };
    const r = resolveTurn(s, attack(), defense(slide), 3);
    expect(taken(r, defender.id)).toBe(true);
    expect(r.state.players[defender.id].pos).toEqual(defender.pos);
  });

  it('refuses the second of two team-mates sent to one spot, but not a run to where an opponent slides', () => {
    const a = home(6);
    const b = home(7);
    const spot = { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y + 4 };
    const r = resolveTurn(base, attack(runTo(a, spot), runTo(b, spot)), defense(), 3);
    expect(taken(r, a.id)).toBe(false);
    expect(taken(r, b.id)).toBe(true);
    // Hidden information: a defender's slide ending on the same spot never blocks the attacker's run.
    const s: MatchState = structuredClone(base);
    const defender = s.players.find((p) => p.team === 'away' && p.number === 5)!;
    defender.pos = { x: spot.x, y: spot.y + 8 };
    const slide: Flick = { playerId: defender.id, dir: { x: 0, y: -1 }, strength: 8 / SLIDE_RANGE };
    const both = resolveTurn(s, attack(runTo(a, spot)), defense(slide), 3);
    expect(taken(both, a.id)).toBe(false);
    expect(taken(both, defender.id)).toBe(false);
  });

  it('spotTaken uses two body radii, ignores the mover himself and honours reserved spots', () => {
    const a = home(6);
    const b = home(7);
    expect(spotTaken(spotOf(b, 0, 0), base.players, a.id)).toBe(true);
    expect(spotTaken(spotOf(a, 0, 0), base.players, a.id)).toBe(false);
    expect(spotTaken(spotOf(b, BODY_RADIUS * 2 + 0.1, 0), base.players, a.id)).toBe(false);
    expect(spotTaken(spotOf(b, BODY_RADIUS * 2 - 0.1, 0), base.players, a.id)).toBe(true);
    const free = spotOf(b, BODY_RADIUS * 2 + 0.1, 0);
    expect(spotTaken(free, base.players, a.id, [free])).toBe(true);
  });
});
