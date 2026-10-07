import { describe, expect, it } from 'vitest';
import { DICE_BLOCK_TURNS, MAX_BOOSTERS, MAX_DICE_BONUS, kickoffRoll, rollDice } from './dice';
import { INTERCEPT_CHANCE, PASS_RANGE, TACKLE_REACH } from './pitch';
import { mulberry32 } from './rng';
import { initialMatch } from './setup';
import { resolveTurn } from './sim';
import type { DiceRoll, Flick, MatchState, Plan, Vec2 } from './types';
import { normalize, sub } from './vec';

/** An rng that returns the given unit values in order (die = 1 + floor(v * 6)). */
const scripted = (...faces: number[]) => {
  let i = 0;
  return () => (faces[i++] - 1 + 0.5) / 6;
};

describe('rollDice', () => {
  it('a plain roll gives 2% per pip', () => {
    const r = rollDice(scripted(4, 5));
    expect(r.pairs).toEqual([[4, 5]]);
    expect(r.sum).toBe(9);
    expect(r.bonus).toBeCloseTo(0.18);
    expect(r.booster).toBeNull();
    expect(r.blocked).toBe(false);
  });

  it('doubles roll again and the sums add up, capped', () => {
    const r = rollDice(scripted(5, 5, 4, 4, 2, 6));
    expect(r.pairs).toEqual([
      [5, 5],
      [4, 4],
      [2, 6],
    ]);
    expect(r.sum).toBe(26);
    expect(r.bonus).toBe(MAX_DICE_BONUS);
  });

  it('double 3 and double 6 give a booster', () => {
    // The booster pick consumes one rng value after the pair.
    const r = rollDice(scripted(3, 3, 1, 2, 5));
    expect(r.booster).not.toBeNull();
    expect(rollDice(scripted(6, 6, 2, 1, 4)).booster).not.toBeNull();
    expect(rollDice(scripted(2, 2, 1, 4)).booster).toBeNull();
  });

  it('a pair below 4 blocks the dice; double 1 does not reroll', () => {
    const one = rollDice(scripted(1, 1, 6, 6, 6));
    expect(one.pairs).toEqual([[1, 1]]);
    expect(one.blocked).toBe(true);
    expect(one.bonus).toBe(0);
    const low = rollDice(scripted(2, 1));
    expect(low.blocked).toBe(true);
    // A block on a reroll keeps what was already earned.
    const late = rollDice(scripted(4, 4, 1, 2));
    expect(late.blocked).toBe(true);
    expect(late.sum).toBe(8);
  });

  it('kickoff rerolls ties', () => {
    const k = kickoffRoll(scripted(3, 3, 2, 5));
    expect(k.rounds).toEqual([
      [3, 3],
      [2, 5],
    ]);
    expect(k.winner).toBe('away');
  });
});

describe('dice and boosters in a turn', () => {
  const base: MatchState = initialMatch();
  const home = (n: number) => base.players.find((p) => p.team === 'home' && p.number === n)!;
  const away = (n: number) => base.players.find((p) => p.team === 'away' && p.number === n)!;
  const flick = (playerId: number, from: Vec2, to: Vec2, meters?: number): Flick => {
    const d = sub(to, from);
    return { playerId, dir: normalize(d), strength: Math.min(1, (meters ?? Math.hypot(d.x, d.y)) / PASS_RANGE) };
  };
  const roll = (sum: number, extra: Partial<DiceRoll> = {}): DiceRoll => ({
    pairs: [[Math.ceil(sum / 2), Math.floor(sum / 2)]],
    sum,
    bonus: Math.min(MAX_DICE_BONUS, sum * 0.02),
    booster: null,
    blocked: false,
    ...extra,
  });

  /** A pass with a tackler sitting on it, so the interception roll always happens. */
  function tackleSetup(): { state: MatchState; attack: Plan; defense: Plan } {
    const state: MatchState = structuredClone(base);
    const mid = { x: (home(1).pos.x + home(2).pos.x) / 2, y: (home(1).pos.y + home(2).pos.y) / 2 };
    state.players[away(10).id].pos = { x: mid.x, y: mid.y + TACKLE_REACH * 0.5 };
    return {
      state,
      attack: { team: 'home', flicks: [flick(home(1).id, home(1).pos, home(2).pos)] },
      defense: { team: 'away', flicks: [] },
    };
  }

  /** Seed whose first roll lands just under the base intercept chance. */
  function nearMissSeed(): number {
    for (let s = 1; s < 100_000; s++) {
      const v = mulberry32(s)();
      if (v < INTERCEPT_CHANCE && v > INTERCEPT_CHANCE - 0.1) return s;
    }
    throw new Error('no seed');
  }

  it("the attacker's dice bonus turns a near-certain interception into a completed pass", () => {
    const { state, attack, defense } = tackleSetup();
    const seed = nearMissSeed();
    expect(resolveTurn(state, attack, defense, seed).events.some((e) => e.type === 'intercept')).toBe(true);
    const boosted = resolveTurn(state, { ...attack, dice: roll(8) }, defense, seed);
    expect(boosted.events.some((e) => e.type === 'dice')).toBe(true);
    expect(boosted.events.some((e) => e.type === 'intercept')).toBe(false);
  });

  it('a traded roll costs a flick', () => {
    // Three runs by three different midfielders: every flick is looked at.
    const runs = [6, 7, 8].map((n) => ({ playerId: home(n).id, dir: { x: 0, y: 1 }, strength: 1 }));
    const count = (plan: Plan) =>
      resolveTurn(base, plan, { team: 'away', flicks: [] }, 1).events.filter((e) => e.type === 'run').length;
    expect(count({ team: 'home', flicks: runs })).toBe(3);
    expect(count({ team: 'home', flicks: runs, dice: roll(7) })).toBe(2);
  });

  it('blocked dice are refused and the block counts down each turn', () => {
    const r1 = resolveTurn(base, { team: 'home', flicks: [], dice: roll(0, { blocked: true, bonus: 0 }) }, { team: 'away', flicks: [] }, 1);
    expect(r1.state.meta.home.blocked).toBe(DICE_BLOCK_TURNS - 1);
    const r2 = resolveTurn(r1.state, { team: 'home', flicks: [], dice: roll(9) }, { team: 'away', flicks: [] }, 2);
    expect(r2.events.some((e) => e.type === 'invalid-flick' && e.reason === 'dice are blocked')).toBe(true);
    expect(r2.state.meta.home.blocked).toBe(DICE_BLOCK_TURNS - 2);
  });

  it('a booster from the dice is banked, capped at MAX_BOOSTERS, and spent when used', () => {
    let s = base;
    for (let i = 0; i < MAX_BOOSTERS + 1; i++) {
      s = resolveTurn(s, { team: 'home', flicks: [], dice: roll(6, { booster: 'extra-flick' }) }, { team: 'away', flicks: [] }, i).state;
    }
    expect(s.meta.home.boosters).toEqual(Array(MAX_BOOSTERS).fill('extra-flick'));
    const r = resolveTurn(s, { team: 'home', flicks: [], booster: 'extra-flick' }, { team: 'away', flicks: [] }, 9);
    expect(r.events.some((e) => e.type === 'booster')).toBe(true);
    expect(r.state.meta.home.boosters).toHaveLength(MAX_BOOSTERS - 1);
    const bad = resolveTurn(base, { team: 'home', flicks: [], booster: 'super-keeper' }, { team: 'away', flicks: [] }, 9);
    expect(bad.events.some((e) => e.type === 'invalid-flick' && e.reason === 'booster not held')).toBe(true);
  });

  it('extra flick allows a fourth attacking flick', () => {
    const s: MatchState = structuredClone(base);
    s.meta.home.boosters = ['extra-flick'];
    // GK -> #2 -> #6 -> #7 -> #3 would need four flicks.
    const chain: Flick[] = [
      flick(home(1).id, home(1).pos, home(2).pos),
      flick(home(2).id, home(2).pos, home(6).pos),
      flick(home(6).id, home(6).pos, home(7).pos),
      flick(home(7).id, home(7).pos, home(3).pos),
    ];
    const plain = resolveTurn(s, { team: 'home', flicks: chain }, { team: 'away', flicks: [] }, 1);
    expect(plain.events.filter((e) => e.type === 'pass')).toHaveLength(3);
    const extra = resolveTurn(s, { team: 'home', flicks: chain, booster: 'extra-flick' }, { team: 'away', flicks: [] }, 1);
    expect(extra.events.filter((e) => e.type === 'pass')).toHaveLength(4);
  });

  it('unstoppable pass skips interception on the first pass only', () => {
    const { state, attack, defense } = tackleSetup();
    state.meta.home.boosters = ['unstoppable-pass'];
    const seed = (() => {
      for (let i = 1; i < 1000; i++) if (mulberry32(i)() < 0.1) return i;
      return 1;
    })();
    expect(resolveTurn(state, attack, defense, seed).events.some((e) => e.type === 'intercept')).toBe(true);
    const r = resolveTurn(state, { ...attack, booster: 'unstoppable-pass' }, defense, seed);
    expect(r.events.some((e) => e.type === 'intercept')).toBe(false);
    expect(r.events.some((e) => e.type === 'receive')).toBe(true);
  });

  it('longer slide and double speed change the move', () => {
    const d = away(10);
    const slide: Flick = { playerId: d.id, dir: { x: 0, y: -1 }, strength: 1 };
    const plain = resolveTurn(base, { team: 'home', flicks: [] }, { team: 'away', flicks: [slide] }, 1);
    const s: MatchState = structuredClone(base);
    s.meta.away.boosters = ['longer-slide', 'double-speed'];
    const longer = resolveTurn(s, { team: 'home', flicks: [] }, { team: 'away', flicks: [slide], booster: 'longer-slide' }, 1);
    const plainDist = d.pos.y - plain.state.players[d.id].pos.y;
    const longerDist = d.pos.y - longer.state.players[d.id].pos.y;
    expect(longerDist).toBeCloseTo(plainDist * 1.5, 5);
    const fast = resolveTurn(s, { team: 'home', flicks: [] }, { team: 'away', flicks: [slide], booster: 'double-speed' }, 1);
    const last = (r: typeof fast) => r.keyframes[r.keyframes.length - 1].t;
    expect(last(fast)).toBeLessThan(last(plain));
  });

  it('an overtake banks a free roll for the interceptor', () => {
    const { state, attack, defense } = tackleSetup();
    const seed = (() => {
      for (let i = 1; i < 1000; i++) if (mulberry32(i)() < 0.1) return i;
      return 1;
    })();
    const r = resolveTurn(state, attack, defense, seed);
    expect(r.events.some((e) => e.type === 'intercept')).toBe(true);
    const free = r.events.find((e) => e.type === 'dice');
    expect(free).toBeDefined();
    expect((free as { free: boolean }).free).toBe(true);
    expect(r.state.meta.away.bonus).toBe((free as { roll: DiceRoll }).roll.bonus);
  });
});
