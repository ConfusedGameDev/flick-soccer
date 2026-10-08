import { describe, expect, it } from 'vitest';
import poolData from '../data/players.json';
import { MAX_BOOSTERS } from '../engine/dice';
import { cost, cpuSquad, squadCost, type PoolPlayer } from '../engine/pool';
import {
  DRAW_COINS,
  GOAL_COINS,
  PACK_COST,
  RUN_STAGES,
  STAGE_BUDGET,
  TRAIN_COST,
  applyResult,
  buyPack,
  buyTactic,
  hire,
  hireCost,
  newRun,
  opponentFor,
  scoutOffers,
  tacticOffers,
  train,
  WIN_COINS,
} from './run';

const pool = poolData as PoolPlayer[];
const start = () => newRun(42, cpuSquad(pool, '4-4-2', 1), 'america');

describe('season run', () => {
  it('banks coins and advances only on a win', () => {
    let run = start();
    run = applyResult(run, { home: 2, away: 1 }, 'A', []);
    expect(run.coins).toBe(WIN_COINS + 2 * GOAL_COINS);
    expect(run.stage).toBe(1);
    expect(run.over).toBeNull();
    run = applyResult(run, { home: 1, away: 1 }, 'B', []);
    expect(run.stage).toBe(1);
    expect(run.coins).toBe(WIN_COINS + 2 + DRAW_COINS + 1);
    run = applyResult(run, { home: 0, away: 3 }, 'B', []);
    expect(run.over).toBe('lost');
  });

  it('wins the run after the last stage and caps carried boosters', () => {
    let run = { ...start(), stage: RUN_STAGES - 1 };
    run = applyResult(run, { home: 1, away: 0 }, 'Final', ['extra-flick', 'double-speed', 'super-keeper']);
    expect(run.over).toBe('won');
    expect(run.boosters.length).toBe(MAX_BOOSTERS);
  });

  it('opponents get stronger with the stage and are deterministic', () => {
    const run = start();
    const budgets = STAGE_BUDGET.map((_, stage) => squadCost(opponentFor(pool, { ...run, stage }).squad.players));
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1]);
    expect(opponentFor(pool, run).name).toBe(opponentFor(pool, run).name);
    expect(opponentFor(pool, run).difficulty).toBe('easy');
    expect(opponentFor(pool, { ...run, stage: 3 }).difficulty).toBe('normal');
  });

  it('training costs coins, raises one stat and stops at the cap', () => {
    const run = { ...start(), coins: TRAIN_COST * 2 };
    const i = run.squad.players.findIndex((p) => p.pass < 5);
    const r1 = train(run, i, 'pass')!;
    expect(r1.squad.players[i].pass).toBe(run.squad.players[i].pass + 1);
    expect(r1.coins).toBe(TRAIN_COST);
    expect(train({ ...run, coins: 0 }, i, 'pass')).toBeNull();
    const maxed = { ...run, squad: { ...run.squad, players: run.squad.players.map((p) => ({ ...p, pass: 5 })) } };
    expect(train(maxed, i, 'pass')).toBeNull();
  });

  it('scouts offer players outside the squad and a signing replaces the cheapest in that position', () => {
    const run = { ...start(), coins: 50 };
    const offers = scoutOffers(pool, run);
    expect(offers.length).toBe(3);
    for (const o of offers) expect(run.squad.players.some((p) => p.id === o.id)).toBe(false);
    const offer = offers[0];
    const r = hire(run, offer)!;
    expect(r.coins).toBe(50 - hireCost(offer));
    expect(r.squad.players.length).toBe(11);
    expect(r.squad.players.some((p) => p.id === offer.id)).toBe(true);
    const cheapest = run.squad.players.filter((p) => p.position === offer.position).sort((a, b) => cost(a) - cost(b))[0];
    expect(r.squad.players.some((p) => p.id === cheapest.id)).toBe(false);
    expect(hire({ ...run, coins: 0 }, offer)).toBeNull();
  });

  it('tactics cards are offered, bought once each and capped', () => {
    let run = { ...start(), coins: 100 };
    const offers = tacticOffers(run);
    expect(offers.length).toBe(2);
    run = buyTactic(run, offers[0])!;
    expect(run.tactics).toEqual([offers[0]]);
    expect(buyTactic(run, offers[0])).toBeNull();
    expect(tacticOffers(run).includes(offers[0])).toBe(false);
    run = buyTactic(run, tacticOffers(run)[0])!;
    run = buyTactic(run, tacticOffers(run)[0])!;
    expect(run.tactics.length).toBe(3);
    expect(buyTactic(run, tacticOffers(run)[0])).toBeNull();
    expect(buyTactic({ ...start(), coins: 0 }, 'cannon')).toBeNull();
  });

  it('booster packs respect the coin cost and the hand limit', () => {
    let run = { ...start(), coins: PACK_COST * 3 };
    run = buyPack(run)!;
    run = buyPack(run)!;
    expect(run.boosters.length).toBe(2);
    expect(run.coins).toBe(PACK_COST);
    expect(buyPack(run)).toBeNull();
  });
});
