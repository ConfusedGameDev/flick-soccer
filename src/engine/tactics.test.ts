import { describe, expect, it } from 'vitest';
import { PASS_RANGE, PITCH_L, PITCH_W } from './pitch';
import { initialMatch } from './setup';
import { resolveTurn } from './sim';
import { CANNON_BONUS, CLASICOS_BONUS, TIKI_TAKA_CAP, TIKI_TAKA_STEP, maxFlicksFor, passChanceShift, shotChanceShift } from './tactics';
import type { Flick, MatchState, Tactic, TeamMeta, Vec2 } from './types';
import { normalize, sub } from './vec';

const meta = (...tactics: Tactic[]): TeamMeta => ({ blocked: 0, bonus: 0, boosters: [], tactics });

const flick = (playerId: number, from: Vec2, to: Vec2): Flick => {
  const d = sub(to, from);
  return { playerId, dir: normalize(d), strength: Math.min(1, Math.hypot(d.x, d.y) / PASS_RANGE) };
};

describe('tactics cards', () => {
  it('catenaccio adds a defensive flick, nothing else changes the count', () => {
    expect(maxFlicksFor(meta(), 'defense')).toBe(2);
    expect(maxFlicksFor(meta('catenaccio'), 'defense')).toBe(3);
    expect(maxFlicksFor(meta('catenaccio'), 'attack')).toBe(3);
    expect(maxFlicksFor(undefined, 'defense')).toBe(2);
  });

  it('tiki-taka and clásicos shift pass interceptions, cannon shifts shots', () => {
    expect(passChanceShift(meta(), 2, true)).toBe(0);
    expect(passChanceShift(meta('tiki-taka'), 0, false)).toBe(0);
    expect(passChanceShift(meta('tiki-taka'), 2, false)).toBeCloseTo(-2 * TIKI_TAKA_STEP);
    expect(passChanceShift(meta('tiki-taka'), 9, false)).toBeCloseTo(-TIKI_TAKA_CAP);
    expect(passChanceShift(meta('clasicos'), 0, true)).toBeCloseTo(-CLASICOS_BONUS);
    expect(passChanceShift(meta('clasicos'), 0, false)).toBe(0);
    expect(passChanceShift(meta('tiki-taka', 'clasicos'), 1, true)).toBeCloseTo(-TIKI_TAKA_STEP - CLASICOS_BONUS);
    expect(shotChanceShift(meta('cannon'))).toBeCloseTo(-CANNON_BONUS);
    expect(shotChanceShift(meta())).toBe(0);
  });

  it('the sim lets a catenaccio side slide three defenders', () => {
    const plain = initialMatch('home');
    const walled = initialMatch('home', undefined, undefined, { away: ['catenaccio'] });
    const slides = (s: MatchState) => {
      const defenders = s.players.filter((p) => p.team === 'away' && !p.keeper).slice(0, 3);
      const plan = { team: 'away' as const, flicks: defenders.map((p) => flick(p.id, p.pos, { x: p.pos.x, y: p.pos.y - 5 })) };
      const r = resolveTurn(s, { team: 'home', flicks: [] }, plan, 7);
      return r.events.filter((e) => e.type === 'slide').length;
    };
    expect(slides(plain)).toBe(2);
    expect(slides(walled)).toBe(3);
  });

  it('cannon scores more often from the same shots', () => {
    const shots = (tactics: Tactic[]) => {
      const s = initialMatch('home', undefined, undefined, { home: tactics });
      const striker = s.players.find((p) => p.team === 'home' && p.number === 10)!;
      striker.pos = { x: PITCH_W / 2, y: PITCH_L - 18 };
      s.ball = { ...striker.pos };
      s.possession = { team: 'home', playerId: striker.id };
      for (const p of s.players) if (p.team === 'away' && !p.keeper) p.pos = { x: 5, y: 30 };
      let goals = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const r = resolveTurn(s, { team: 'home', flicks: [{ playerId: striker.id, dir: { x: 0, y: 1 }, strength: 1, shot: true }] }, { team: 'away', flicks: [] }, seed);
        if (r.events.some((e) => e.type === 'goal')) goals++;
      }
      return goals;
    };
    const base = shots([]);
    const cannon = shots(['cannon']);
    expect(base).toBeGreaterThan(0);
    expect(cannon).toBeGreaterThan(base);
  });
});
