import { describe, expect, it } from 'vitest';
import raw from '../data/players.json';
import { INTERCEPT_CHANCE, PASS_RANGE, TACKLE_REACH } from './pitch';
import {
  BUDGET,
  FORMATIONS,
  FORMATION_NAMES,
  LEAGUES,
  POOL_PER_LEAGUE,
  SQUAD_SIZE,
  autoAssign,
  cost,
  cpuSquad,
  defaultSquad,
  leaguePool,
  makeSquad,
  squadCost,
  squadProblem,
  statFactor,
  type PoolPlayer,
} from './pool';
import { mulberry32 } from './rng';
import { initialMatch, mirror } from './setup';
import { passTarget, resolveTurn } from './sim';
import type { MatchState } from './types';

const pool = raw as PoolPlayer[];

describe('player pool', () => {
  it('has the 26 best players of each of the five leagues with legal stats', () => {
    expect(pool).toHaveLength(LEAGUES.length * POOL_PER_LEAGUE);
    for (const league of LEAGUES) {
      const lp = leaguePool(pool, league);
      expect(lp).toHaveLength(POOL_PER_LEAGUE);
      expect(lp.filter((p) => p.position === 'GK').length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(pool.map((p) => p.id)).size).toBe(pool.length);
    for (const p of pool) {
      for (const k of ['pass', 'shot', 'speed', 'tackle', 'keeping'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(1);
        expect(p[k]).toBeLessThanOrEqual(5);
      }
      expect(['GK', 'DF', 'MF', 'FW']).toContain(p.position);
    }
    expect(pool.filter((p) => p.position === 'GK').length).toBeGreaterThanOrEqual(4);
  });

  it('prices players between 3 and 15 and stars above journeymen', () => {
    for (const p of pool) {
      expect(cost(p)).toBeGreaterThanOrEqual(3);
      expect(cost(p)).toBeLessThanOrEqual(15);
    }
    const holland = pool.find((p) => p.id === 'holland')!;
    const anten = pool.find((p) => p.id === 'anten')!;
    expect(cost(holland)).toBeGreaterThan(cost(anten));
    // An average eleven roughly fits the budget.
    const avg = pool.reduce((s, p) => s + cost(p), 0) / pool.length;
    expect(avg * SQUAD_SIZE).toBeGreaterThan(BUDGET * 0.8);
    expect(avg * SQUAD_SIZE).toBeLessThan(BUDGET * 1.4);
  });
});

describe('squads', () => {
  it('validates size, keeper and budget', () => {
    const stars = [...pool].sort((a, b) => cost(b) - cost(a));
    expect(squadProblem(stars.slice(0, 5))).toMatch(/Pick 11/);
    const noKeeper = stars.filter((p) => p.position !== 'GK').slice(0, 11);
    expect(squadProblem(noKeeper)).toMatch(/goalkeeper/);
    const expensive = [stars.find((p) => p.position === 'GK')!, ...stars.filter((p) => p.position !== 'GK').slice(0, 10)];
    expect(squadCost(expensive)).toBeGreaterThan(BUDGET);
    expect(squadProblem(expensive)).toMatch(/Over budget/);
  });

  it('cpuSquad is legal, deterministic and uses most of the budget in every league', () => {
    for (const league of LEAGUES) {
      const lp = leaguePool(pool, league);
      for (const f of FORMATION_NAMES) {
        const s = cpuSquad(lp, f, 7);
        expect(squadProblem(s.players)).toBeNull();
        expect(s.players[0].position).toBe('GK');
        expect(squadCost(s.players)).toBeGreaterThan(BUDGET * 0.75);
        expect(squadCost(s.players)).toBeLessThanOrEqual(BUDGET);
        expect(cpuSquad(lp, f, 7)).toEqual(s);
      }
      // The run's first opponent drafts with 80 points, which every league must afford.
      expect(squadCost(cpuSquad(lp, '4-4-2', 3, 80).players)).toBeLessThanOrEqual(80);
    }
    const distinct = new Set([1, 2, 3, 4, 5, 6].map((seed) => cpuSquad(pool, '4-4-2', seed).players.map((p) => p.id).join()));
    expect(distinct.size).toBeGreaterThan(2);
  });

  it('autoAssign puts the keeper first and forwards up front', () => {
    const s = cpuSquad(pool, '4-3-3', 3);
    const ordered = autoAssign(s.players, '4-3-3');
    expect(ordered).toHaveLength(11);
    expect(ordered[0].position).toBe('GK');
    const slots = FORMATIONS['4-3-3'];
    const natural = ordered.filter((p, i) => p.position === slots[i].role).length;
    expect(natural).toBeGreaterThanOrEqual(8);
  });

  it('the default squad is all baseline threes and matches the 4-4-2 layout', () => {
    const d = defaultSquad('home');
    expect(d.players.every((p) => p.pass === 3 && p.keeping === 3)).toBe(true);
    expect(d.positions[0]).toEqual({ x: 34, y: 3 });
    expect(statFactor(3)).toBe(1);
  });
});

describe('stats in a match', () => {
  const gkIdx = pool.findIndex((p) => p.position === 'GK');
  const squad = makeSquad([pool[gkIdx], ...pool.filter((p) => p.position !== 'GK').slice(0, 10)], '4-4-2');

  it('initialMatch places drafted players with their names, stats and mirrored away spots', () => {
    const s: MatchState = initialMatch('home', { home: squad, away: squad });
    expect(s.players[0].name).toBe(squad.players[0].short);
    expect(s.players[0].keeper).toBe(true);
    expect(s.players[11].keeper).toBe(true);
    expect(s.players[11].pos).toEqual(mirror(squad.positions[0]));
    expect(s.players[3].stats.pass).toBe(squad.players[3].pass);
  });

  it('a stronger passer kicks further and is harder to intercept', () => {
    const base = initialMatch();
    const weak: MatchState = structuredClone(base);
    const strong: MatchState = structuredClone(base);
    weak.players[0].stats.pass = 1;
    strong.players[0].stats.pass = 5;
    const flick = { playerId: 0, dir: { x: 0, y: 1 }, strength: 0.5 };
    const far = (s: MatchState) => passTarget(s.ball, flick, 'pass', statFactor(s.players[0].stats.pass)).to.y;
    expect(far(strong)).toBeGreaterThan(far(weak));
    expect(far(base)).toBeCloseTo(base.ball.y + 0.5 * PASS_RANGE, 6);

    // A tackler on the line: find a seed where only the strong passer gets through.
    for (const s of [weak, strong]) s.players[21].pos = { x: 34, y: 3 + TACKLE_REACH * 0.5 + 4 };
    const seed = (() => {
      for (let i = 1; i < 10_000; i++) {
        const v = mulberry32(i)();
        if (v > INTERCEPT_CHANCE - 0.09 && v < INTERCEPT_CHANCE - 0.05) return i;
      }
      throw new Error('no seed');
    })();
    const d = { team: 'away' as const, flicks: [] };
    const a = { team: 'home' as const, flicks: [{ playerId: 0, dir: { x: 0, y: 1 }, strength: 0.4 }] };
    expect(resolveTurn(weak, a, d, seed).events.some((e) => e.type === 'intercept')).toBe(true);
    expect(resolveTurn(strong, a, d, seed).events.some((e) => e.type === 'intercept')).toBe(false);
  });
});
