import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {}, Container: class {}, Graphics: class {}, Sprite: class {}, Text: class {} }));

import type { Flick, Vec2 } from '../engine/types';
import { FlickGesture, MAX_PULL_M } from './FlickGesture';

/** A canvas stand-in: listeners by type, a unit mapping to the world (1 px = 1 m, origin top-left). */
function harness() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const canvas = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ??= []).push(fn),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  };
  const pitch = { toWorld: (p: Vec2) => ({ x: p.x, y: p.y }) };
  const drags: { flick: Flick; pull: Vec2; aim: Vec2 | null }[] = [];
  const releases: (Flick | null)[] = [];
  const gesture = new FlickGesture(canvas as never, pitch as never, {
    pick: (w) => (Math.hypot(w.x - 50, w.y - 50) < 3 ? 7 : null),
    onDrag: (_id, flick, pull, aim) => drags.push({ flick, pull, aim }),
    onRelease: (_id, flick) => releases.push(flick),
  });
  gesture.enabled = true;
  const fire = (type: string, pointerId: number, x: number, y: number) => {
    for (const fn of listeners[type] ?? []) fn({ pointerId, clientX: x, clientY: y, preventDefault() {} });
  };
  return { fire, drags, releases };
}

const last = <T>(a: T[]) => a[a.length - 1];

describe('FlickGesture', () => {
  it('one finger: pull back, the flick goes the other way with the pull length as strength', () => {
    const { fire, drags, releases } = harness();
    fire('pointerdown', 1, 50, 50);
    fire('pointermove', 1, 50, 60);
    expect(last(drags).flick.dir).toEqual({ x: 0, y: -1 });
    expect(last(drags).flick.strength).toBeCloseTo(10 / MAX_PULL_M);
    expect(last(drags).aim).toBeNull();
    fire('pointerup', 1, 50, 60);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.dir).toEqual({ x: 0, y: -1 });
  });

  it('two fingers: the first keeps the power, the second aims; lifting it goes back to one-finger aiming', () => {
    const { fire, drags, releases } = harness();
    fire('pointerdown', 1, 50, 50);
    fire('pointermove', 1, 50, 60);
    fire('pointerdown', 2, 80, 50); // aim straight right of the disc
    expect(last(drags).flick.dir.x).toBeCloseTo(1);
    expect(last(drags).flick.dir.y).toBeCloseTo(0);
    expect(last(drags).flick.strength).toBeCloseTo(10 / MAX_PULL_M);
    expect(last(drags).aim).toEqual({ x: 80, y: 50 });
    // Pulling further only changes the power.
    fire('pointermove', 1, 50, 70);
    expect(last(drags).flick.dir.x).toBeCloseTo(1);
    expect(last(drags).flick.strength).toBeCloseTo(20 / MAX_PULL_M);
    // Moving the second finger changes the aim.
    fire('pointermove', 2, 50, 20);
    expect(last(drags).flick.dir.y).toBeCloseTo(-1);
    // Lifting the aiming finger: back to the pull direction.
    fire('pointerup', 2, 50, 20);
    expect(last(drags).aim).toBeNull();
    expect(last(drags).flick.dir).toEqual({ x: 0, y: -1 });
    expect(releases).toHaveLength(0);
    // And a second finger again, then the first lifts: the flick goes where finger two points.
    fire('pointerdown', 2, 20, 50);
    fire('pointerup', 1, 50, 70);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.dir.x).toBeCloseTo(-1);
    expect(releases[0]!.strength).toBeCloseTo(20 / MAX_PULL_M);
  });

  it('a third touch and a touch with no disc are ignored', () => {
    const { fire, drags, releases } = harness();
    fire('pointerdown', 1, 10, 10);
    expect(drags).toHaveLength(0);
    fire('pointerup', 1, 10, 10);
    expect(releases).toHaveLength(0);
    fire('pointerdown', 1, 50, 50);
    fire('pointerdown', 2, 80, 50);
    fire('pointerdown', 3, 20, 50);
    fire('pointermove', 1, 50, 60);
    expect(last(drags).flick.dir.x).toBeCloseTo(1);
  });
});
