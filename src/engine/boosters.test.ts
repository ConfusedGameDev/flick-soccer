import { describe, expect, it } from 'vitest';
import { BOOSTERS, MAX_BOOSTERS, decoysFor, drawBooster, flipCoin, tossWinner } from './boosters';
import { PASS_RANGE, TACKLE_REACH } from './pitch';
import { mulberry32 } from './rng';
import { initialMatch } from './setup';
import { resolveTurn } from './sim';
import type { Flick, MatchState, Plan, Vec2 } from './types';
import { normalize, sub } from './vec';

describe('packs and the coin', () => {
  it('a pack can hold any of the five boosters', () => {
    const seen = new Set<string>();
    for (let s = 1; s < 200; s++) seen.add(drawBooster(mulberry32(s)));
    expect([...seen].sort()).toEqual([...BOOSTERS].sort());
  });

  it('the two other cards show two different other boosters', () => {
    for (const b of BOOSTERS) {
      const [x, y] = decoysFor(b);
      expect(x).not.toBe(b);
      expect(y).not.toBe(b);
      expect(x).not.toBe(y);
    }
  });

  it('the coin shows both faces and the caller wins only on a right call', () => {
    const faces = new Set<string>();
    for (let s = 1; s < 50; s++) faces.add(flipCoin(mulberry32(s)));
    expect(faces).toEqual(new Set(['heads', 'tails']));
    expect(tossWinner('heads', 'heads', 'away')).toBe('away');
    expect(tossWinner('tails', 'heads', 'away')).toBe('home');
    expect(tossWinner('tails', 'tails', 'home')).toBe('home');
    expect(tossWinner('heads', 'tails', 'home')).toBe('away');
  });
});

describe('packs and boosters in a turn', () => {
  const base: MatchState = initialMatch();
  const home = (n: number) => base.players.find((p) => p.team === 'home' && p.number === n)!;
  const away = (n: number) => base.players.find((p) => p.team === 'away' && p.number === n)!;
  const flick = (playerId: number, from: Vec2, to: Vec2, meters?: number): Flick => {
    const d = sub(to, from);
    return { playerId, dir: normalize(d), strength: Math.min(1, (meters ?? Math.hypot(d.x, d.y)) / PASS_RANGE) };
  };
  const empty: Plan = { team: 'away', flicks: [] };

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

  /** A seed whose first roll lands under the base intercept chance. */
  const interceptSeed = (() => {
    for (let i = 1; i < 1000; i++) if (mulberry32(i)() < 0.1) return i;
    return 1;
  })();

  it('a pack costs a flick and the card lands in the hand', () => {
    // Three runs by three different midfielders: every flick is looked at.
    const runs = [6, 7, 8].map((n) => ({ playerId: home(n).id, dir: { x: 0, y: 1 }, strength: 1 }));
    const plain = resolveTurn(base, { team: 'home', flicks: runs }, empty, 1);
    expect(plain.events.filter((e) => e.type === 'run')).toHaveLength(3);
    const packed = resolveTurn(base, { team: 'home', flicks: runs, pack: 'double-speed' }, empty, 1);
    expect(packed.events.filter((e) => e.type === 'run')).toHaveLength(2);
    expect(packed.events).toContainEqual(expect.objectContaining({ type: 'pack', team: 'home', booster: 'double-speed', free: false }));
    expect(packed.state.meta.home.boosters).toEqual(['double-speed']);
  });

  it('a full hand refuses the pack and keeps the flick', () => {
    const s: MatchState = structuredClone(base);
    s.meta.home.boosters = ['extra-flick', 'super-keeper'];
    expect(s.meta.home.boosters).toHaveLength(MAX_BOOSTERS);
    const runs = [6, 7, 8].map((n) => ({ playerId: home(n).id, dir: { x: 0, y: 1 }, strength: 1 }));
    const r = resolveTurn(s, { team: 'home', flicks: runs, pack: 'double-speed' }, empty, 1);
    expect(r.events.some((e) => e.type === 'invalid-flick' && e.reason === 'hand full')).toBe(true);
    expect(r.events.filter((e) => e.type === 'run')).toHaveLength(3);
    expect(r.state.meta.home.boosters).toEqual(['extra-flick', 'super-keeper']);
  });

  it('a booster is spent when used and refused when not held', () => {
    const s: MatchState = structuredClone(base);
    s.meta.home.boosters = ['extra-flick', 'extra-flick'];
    const r = resolveTurn(s, { team: 'home', flicks: [], booster: 'extra-flick' }, empty, 9);
    expect(r.events.some((e) => e.type === 'booster')).toBe(true);
    expect(r.state.meta.home.boosters).toHaveLength(MAX_BOOSTERS - 1);
    const bad = resolveTurn(base, { team: 'home', flicks: [], booster: 'super-keeper' }, empty, 9);
    expect(bad.events.some((e) => e.type === 'invalid-flick' && e.reason === 'booster not held')).toBe(true);
  });

  it('extra flick allows a fourth attacking flick, also fresh from this turn’s pack', () => {
    const s: MatchState = structuredClone(base);
    s.meta.home.boosters = ['extra-flick'];
    // GK -> #2 -> #6 -> #7 -> #3 would need four flicks.
    const chain: Flick[] = [
      flick(home(1).id, home(1).pos, home(2).pos),
      flick(home(2).id, home(2).pos, home(6).pos),
      flick(home(6).id, home(6).pos, home(7).pos),
      flick(home(7).id, home(7).pos, home(3).pos),
    ];
    const plain = resolveTurn(s, { team: 'home', flicks: chain }, empty, 1);
    expect(plain.events.filter((e) => e.type === 'pass')).toHaveLength(3);
    const extra = resolveTurn(s, { team: 'home', flicks: chain, booster: 'extra-flick' }, empty, 1);
    expect(extra.events.filter((e) => e.type === 'pass')).toHaveLength(4);
    // A pack costs the flick the fresh extra-flick card gives back: three passes, and the card is spent.
    const fresh = resolveTurn(base, { team: 'home', flicks: chain, pack: 'extra-flick', booster: 'extra-flick' }, empty, 1);
    expect(fresh.events.filter((e) => e.type === 'pass')).toHaveLength(3);
    expect(fresh.state.meta.home.boosters).toEqual([]);
  });

  it('unstoppable pass skips interception on the first pass only', () => {
    const { state, attack, defense } = tackleSetup();
    state.meta.home.boosters = ['unstoppable-pass'];
    expect(resolveTurn(state, attack, defense, interceptSeed).events.some((e) => e.type === 'intercept')).toBe(true);
    const r = resolveTurn(state, { ...attack, booster: 'unstoppable-pass' }, defense, interceptSeed);
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

  it('an overtake banks a free pack for the interceptor, unless the hand is full', () => {
    const { state, attack, defense } = tackleSetup();
    const r = resolveTurn(state, attack, defense, interceptSeed);
    expect(r.events.some((e) => e.type === 'intercept')).toBe(true);
    const free = r.events.find((e) => e.type === 'pack');
    expect(free).toBeDefined();
    expect(free).toMatchObject({ team: 'away', free: true });
    expect(r.state.meta.away.boosters).toEqual([(free as { booster: string }).booster]);

    const full: MatchState = structuredClone(state);
    full.meta.away.boosters = ['super-keeper', 'super-keeper'];
    const r2 = resolveTurn(full, attack, defense, interceptSeed);
    expect(r2.events.some((e) => e.type === 'intercept')).toBe(true);
    expect(r2.events.some((e) => e.type === 'pack')).toBe(false);
    expect(r2.state.meta.away.boosters).toEqual(['super-keeper', 'super-keeper']);
  });
});
