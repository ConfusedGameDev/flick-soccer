import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {} }));

import { KITS, hex } from './kits';
import { DIRS, FRAME_SIZE, FRAME_STATES, dirFromDelta, frame, frameRows } from './frames';
import { LETTERS } from './rig';
import { paintFrame } from './sprites';

const ALPHABET = new RegExp(`^[.${Object.keys(LETTERS).join('')}]+$`);

function recorder(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const fake = {
    fillStyle: '',
    fillRect(this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    },
  };
  return { ctx: fake as unknown as CanvasRenderingContext2D, fills };
}

describe('imported frames', () => {
  it('cover every state and direction as full grids in the alphabet, with the kit parts present', () => {
    for (const state of FRAME_STATES) {
      for (const dir of DIRS) {
        const f = frame(state, dir);
        expect(f.rows.length, `${state}/${dir}`).toBe(FRAME_SIZE);
        for (const row of f.rows) {
          expect(row.length).toBe(FRAME_SIZE);
          expect(row).toMatch(ALPHABET);
        }
        const all = f.rows.join('');
        for (const family of [/[IJjqm]/, /[Pnpw]/, /[Kokv]/, /[LSsz]/, /[Hhx]/, /B/, /O/]) expect(all, `${state}/${dir} has ${family}`).toMatch(family);
        // No ball left in any frame.
        expect(all).not.toMatch(/[WeD]/);
        const [top, rows, left, cols] = f.jersey;
        expect(top).toBeGreaterThanOrEqual(0);
        expect(rows).toBeGreaterThan(4);
        expect(cols).toBeGreaterThan(4);
        expect(top + rows).toBeLessThanOrEqual(FRAME_SIZE);
        expect(left + cols).toBeLessThanOrEqual(FRAME_SIZE);
        expect(f.baseline).toBeGreaterThan(20);
        expect(f.baseline).toBeLessThan(FRAME_SIZE);
      }
    }
  });

  it('a bald look shows skin where the hair was', () => {
    const haired = frameRows('idle', 's', { skin: 0, hair: 0, style: 0 }).join('');
    const bald = frameRows('idle', 's', { skin: 0, hair: 0, style: 3 }).join('');
    expect(haired).toMatch(/H/);
    expect(bald).not.toMatch(/[Hhx]/);
    expect(bald.length).toBe(haired.length);
  });

  it('paints kit colours, both stripe colours, and the keeper kit', () => {
    const stripes = KITS.find((k) => k.pattern === 'stripes')!;
    const { ctx, fills } = recorder();
    paintFrame(ctx, 'idle', 's', stripes, false, 0, 0, 1);
    expect(fills).toContain(hex(stripes.jersey));
    expect(fills).toContain(hex(stripes.jersey2));
    expect(fills).toContain(hex(stripes.shorts));
    expect(fills).toContain(hex(stripes.socks));
    expect(fills.some((f) => !f || f.includes('NaN'))).toBe(false);
    const gk = recorder();
    paintFrame(gk.ctx, 'slide', 'e', KITS[0], true, 0, 0, 1);
    expect(gk.fills).toContain(hex(KITS[0].keeper.jersey));
  });

  it('maps screen deltas to the eight directions', () => {
    expect(dirFromDelta(1, 0)).toBe('e');
    expect(dirFromDelta(0, 1)).toBe('s');
    expect(dirFromDelta(-1, 0)).toBe('w');
    expect(dirFromDelta(0, -1)).toBe('n');
    expect(dirFromDelta(1, 1)).toBe('se');
    expect(dirFromDelta(-1, 1)).toBe('sw');
    expect(dirFromDelta(-1, -1)).toBe('nw');
    expect(dirFromDelta(1, -1)).toBe('ne');
    // A little off the axis stays on it.
    expect(dirFromDelta(10, 1)).toBe('e');
    expect(dirFromDelta(-1, -10)).toBe('n');
  });
});
