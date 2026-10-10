import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {}, Container: class {}, Graphics: class {}, Sprite: class {}, Text: class {} }));

import { PITCH_L, PITCH_W } from '../engine/pitch';
import { PULL_ROOM_M, fitScale } from './PitchView';

/** Free space beyond one goal line at scale `s`: the end padding plus the centring slack. */
const room = (availH: number, padEnd: number, s: number) => padEnd + (availH - PITCH_L * s) / 2;

describe('PitchView.fitScale', () => {
  it('a width-bound viewport (phone portrait) keeps the full width', () => {
    const s = fitScale(358, 668, 84);
    expect(s).toBeCloseTo(358 / PITCH_W);
    expect(room(668, 84, s)).toBeGreaterThanOrEqual(PULL_ROOM_M * s);
  });

  it('a height-bound viewport is capped so a pull from the goal line has room', () => {
    const availH = 1180 - 84 - 92;
    const naive = Math.min(788 / PITCH_W, availH / PITCH_L);
    const s = fitScale(788, availH, 84);
    expect(s).toBeLessThan(naive);
    expect(room(availH, 84, s)).toBeCloseTo(PULL_ROOM_M * s);
  });

  it('never drops below the floor', () => {
    expect(fitScale(10, 10, 0)).toBe(0.5);
  });
});
