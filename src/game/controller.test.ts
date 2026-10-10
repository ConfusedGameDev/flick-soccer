import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {}, Container: class {}, Graphics: class {}, Sprite: class {}, Text: class {} }));

import { PITCH_L, PITCH_W } from '../engine/pitch';
import { initialMatch } from '../engine/setup';
import type { Flick, MatchState, Plan } from '../engine/types';
import { KITS } from '../render/kits';
import { LocalController } from './controller';

// The planning controller with its DOM and Pixi collaborators stubbed out:
// what matters here is the draft and what Undo may take back.

function harness() {
  const calls: string[] = [];
  const hud = {
    onUndo: () => {},
    onConfirm: () => {},
    onPack: () => {},
    onShoot: () => {},
    onKeeper: () => {},
    onBooster: () => {},
    planning: null as { canUndo: boolean; canConfirm: boolean } | null,
    setPlanning(p: { canUndo: boolean; canConfirm: boolean } | null) {
      this.planning = p;
    },
    setStatus() {},
    setTimer() {},
    setExtras() {},
    toast(t: string) {
      calls.push(`toast:${t}`);
    },
  };
  const deps = {
    hud,
    preview: { draw() {}, clear() {} },
    pieces: { setHighlights() {}, currentKits: { home: KITS[0], away: KITS[1] } },
    pack: { show: async () => {}, cancel() {} },
    setPiece: { run: async () => ({ x: 0, accuracy: 1, height: 0.5 }), cancel() {} },
  };
  const local = new LocalController(deps as never);
  local.timed = false;
  // Private access for the test: the draft, the actions and the buttons.
  const priv = local as unknown as {
    session: { draft: Flick[]; pack: string | null; keeperGame: number | null } | null;
    shoot: () => Promise<void>;
    keeperGame: () => Promise<void>;
    toggleBooster: (b: string) => void;
    kindFor: (id: number) => string | null;
    undo: () => void;
    release: (id: number, flick: Flick | null) => void;
    confirm: () => void;
    canUndo: () => boolean;
  };
  return { local, priv, hud, calls, deps };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function shootingState(): MatchState {
  const s: MatchState = structuredClone(initialMatch());
  const striker = s.players.find((p) => p.team === 'home' && p.number === 10)!;
  striker.pos = { x: PITCH_W / 2, y: PITCH_L - 14 };
  s.ball = { ...striker.pos };
  s.possession = { team: 'home', playerId: striker.id };
  return s;
}

describe('LocalController undo', () => {
  it('a shot is final: Undo is disabled after it and later only takes back the flicks added after', async () => {
    const { local, priv, hud } = harness();
    const state = shootingState();
    const planned = local.plan(state, 'home', 'attack');
    expect(hud.planning).toEqual({ canUndo: false, canConfirm: true });
    await priv.shoot();
    expect(priv.session!.draft).toHaveLength(1);
    expect(priv.session!.draft[0].shot).toBe(true);
    expect(hud.planning!.canUndo).toBe(false);
    priv.undo();
    expect(priv.session!.draft).toHaveLength(1);
    // A run after the shot can still be undone, and only the run goes.
    const runner = state.players.find((p) => p.team === 'home' && p.number === 6)!;
    priv.release(runner.id, { playerId: runner.id, dir: { x: 0, y: 1 }, strength: 0.5 });
    expect(priv.session!.draft).toHaveLength(2);
    expect(hud.planning!.canUndo).toBe(true);
    priv.undo();
    expect(priv.session!.draft).toHaveLength(1);
    expect(priv.session!.draft[0].shot).toBe(true);
    expect(hud.planning!.canUndo).toBe(false);
    priv.confirm();
    const plan: Plan = await planned;
    expect(plan.flicks).toHaveLength(1);
    expect(plan.flicks[0].shot).toBe(true);
  });

  it('a corner is taken by the scene and stays in the draft; passes after it can be undone', async () => {
    const { local, priv, hud } = harness();
    const state: MatchState = structuredClone(initialMatch());
    state.setPiece = 'corner';
    state.ball = { x: 0.5, y: PITCH_L - 0.5 };
    const taker = state.players.find((p) => p.team === 'home' && p.number === 7)!;
    taker.pos = { ...state.ball };
    state.possession = { team: 'home', playerId: taker.id };
    const planned = local.plan(state, 'home', 'attack');
    await tick();
    await tick();
    expect(priv.session!.draft).toHaveLength(1);
    expect(hud.planning!.canUndo).toBe(false);
    priv.undo();
    expect(priv.session!.draft).toHaveLength(1);
    priv.confirm();
    const plan = await planned;
    expect(plan.flicks).toHaveLength(1);
    expect(plan.flicks[0].playerId).toBe(taker.id);
  });

  it('a plain pass can be undone', () => {
    const { local, priv, hud } = harness();
    const state = initialMatch();
    void local.plan(state, 'home', 'attack');
    const gk = state.players[state.possession.playerId];
    priv.release(gk.id, { playerId: gk.id, dir: { x: 0, y: 1 }, strength: 0.6 });
    expect(priv.session!.draft).toHaveLength(1);
    expect(hud.planning!.canUndo).toBe(true);
    priv.undo();
    expect(priv.session!.draft).toHaveLength(0);
    expect(priv.canUndo()).toBe(false);
  });
});

describe('LocalController keeper game', () => {
  const defenders = (state: MatchState) => state.players.filter((p) => p.team === 'away').map((p) => p.id);

  it('spends both flicks, is final, and rides the plan', async () => {
    const { local, priv, hud } = harness();
    const state = shootingState();
    const planned = local.plan(state, 'away', 'defense');
    expect(defenders(state).some((id) => priv.kindFor(id) !== null)).toBe(true);
    await priv.keeperGame();
    expect(priv.session!.keeperGame).toBe(1);
    expect(defenders(state).every((id) => priv.kindFor(id) === null)).toBe(true);
    expect(hud.planning!.canUndo).toBe(false);
    priv.undo();
    expect(priv.session!.keeperGame).toBe(1);
    priv.confirm();
    const plan: Plan = await planned;
    expect(plan.flicks).toHaveLength(0);
    expect(plan.keeperGame).toEqual({ accuracy: 1 });
  });

  it('is not offered while resting, after a flick is used, or on the attack', async () => {
    const { local, priv } = harness();
    const resting = shootingState();
    resting.meta.away.keeperCooldown = 1;
    void local.plan(resting, 'away', 'defense');
    await priv.keeperGame();
    expect(priv.session!.keeperGame).toBeNull();
    priv.confirm();

    const state = shootingState();
    void local.plan(state, 'away', 'defense');
    const back = state.players.find((p) => p.team === 'away' && p.number === 5)!;
    priv.release(back.id, { playerId: back.id, dir: { x: 0, y: 1 }, strength: 0.5 });
    expect(priv.session!.draft).toHaveLength(1);
    await priv.keeperGame();
    expect(priv.session!.keeperGame).toBeNull();
    priv.confirm();

    void local.plan(state, 'home', 'attack');
    await priv.keeperGame();
    expect(priv.session!.keeperGame).toBeNull();
    priv.confirm();
  });

  it('is simply not played when the clock runs out with the scene up', async () => {
    const { local, priv, deps } = harness();
    let finish: (r: { x: number; accuracy: number; height: number }) => void = () => {};
    deps.setPiece.run = () => new Promise((r) => (finish = r));
    const planned = local.plan(shootingState(), 'away', 'defense');
    const game = priv.keeperGame();
    await tick();
    priv.confirm();
    finish({ x: 0, accuracy: 1, height: 0.5 });
    await game;
    const plan = await planned;
    expect(plan.keeperGame).toBeUndefined();
    expect(plan.flicks).toHaveLength(0);
  });

  it('keeps the flicks it spent: an extra flick cannot be disarmed from under it', async () => {
    const { local, priv, calls } = harness();
    const state = shootingState();
    state.meta.away.boosters = ['extra-flick'];
    void local.plan(state, 'away', 'defense');
    priv.session!.pack = 'double-speed';
    priv.toggleBooster('extra-flick');
    await priv.keeperGame();
    expect(priv.session!.keeperGame).toBe(1);
    priv.toggleBooster('extra-flick');
    expect(calls).toContain('toast:The keeper is set');
    priv.confirm();
  });
});
