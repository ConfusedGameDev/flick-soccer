import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {} }));

import { KITS, hex } from './kits';
import { LETTERS } from './rig';
import { BACK_NUMBER_ANCHOR, KICK_CONTACT, ONE_SHOT, SHEET_ANIMS, SHEET_BALL, SHEET_HERO, hairLayerFor, sheetFrame, sheetFrameAt, sheetFrames, sheetJersey, sheetPivot, sheetRows } from './sheet';
import { paintSheet } from './sprites';

const ALPHABET = new RegExp(`^[.${Object.keys(LETTERS).join('')}]+$`);
const CANVAS = { w: 128, h: 64 };

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

describe('sheet frames', () => {
  it('cover every animation with rectangular grids in the alphabet, crops inside the canvas and the kit parts present', () => {
    expect(SHEET_ANIMS.length).toBe(16);
    for (const anim of SHEET_ANIMS) {
      expect(sheetFrames(anim), anim).toBeGreaterThan(0);
      for (let i = 0; i < sheetFrames(anim); i++) {
        const f = sheetFrame(anim, i);
        const w = f.rows[0].length;
        for (const row of f.rows) {
          expect(row.length, `${anim}#${i}`).toBe(w);
          expect(row).toMatch(ALPHABET);
        }
        expect(f.x + w).toBeLessThanOrEqual(CANVAS.w);
        expect(f.y + f.rows.length).toBeLessThanOrEqual(CANVAS.h);
        const all = f.rows.join('');
        for (const family of [/[IJjqm]/, /[Pnpw]/, /[LSsz]/, /B/]) expect(all, `${anim}#${i} has ${family}`).toMatch(family);
        // No hair on the body, no ball, no outline: hair is an overlay, the game draws its own ball.
        expect(all).not.toMatch(/[HhxWeDO]/);
        const [top, rows, left, cols] = f.jersey;
        expect(rows, `${anim}#${i} jersey rows`).toBeGreaterThanOrEqual(3);
        expect(cols, `${anim}#${i} jersey cols`).toBeGreaterThanOrEqual(3);
        expect(top + rows).toBeLessThanOrEqual(f.rows.length);
        expect(left + cols).toBeLessThanOrEqual(w);
        // The pivot (feet centre) is inside the crop horizontally and at or below its top.
        const [px, py] = sheetPivot(f);
        expect(px, `${anim}#${i} pivot x`).toBeGreaterThan(0);
        expect(px).toBeLessThan(w);
        expect(py).toBeGreaterThan(0);
        for (const h of f.hair) {
          if (!h) continue;
          expect(h.x + h.rows[0].length).toBeLessThanOrEqual(w);
          expect(h.y + h.rows.length).toBeLessThanOrEqual(f.rows.length);
          expect(h.rows.join('')).toMatch(/H/);
        }
      }
    }
  });

  it('keeps the feet on one line across animations: standing frames share the pivot row', () => {
    for (const anim of ['idle', 'shoot_ball', 'celebration_1', 'gk-idle', 'gk-defensive_stance'] as const) {
      const f = sheetFrame(anim, 0);
      expect(sheetPivot(f)[1], anim).toBe(f.rows.length);
    }
    // The keeper has gloves, the outfield player bare hands.
    expect(sheetFrame('gk-idle', 0).rows.join('')).toMatch(/[Ggy]/);
    expect(sheetFrame('idle', 0).rows.join('')).not.toMatch(/[Ggy]/);
  });

  it('wears a different hair style per look, none when bald, and mirrors on flip', () => {
    const look = (style: number) => ({ skin: 0, hair: 0, style });
    const styles = [0, 1, 2].map((s) => sheetRows('idle', 0, look(s)).join(''));
    for (const s of styles) expect(s).toMatch(/H/);
    expect(new Set(styles).size).toBe(3);
    const bald = sheetRows('idle', 0, look(3));
    expect(bald.join('')).not.toMatch(/[Hhx]/);
    expect(bald.length).toBe(sheetRows('idle', 0, look(0)).length);
    expect(hairLayerFor(look(3), false)).toBe(-1);
    expect(hairLayerFor(look(1), true)).not.toBe(hairLayerFor(look(1), false));
    const plain = sheetRows('shoot_ball', 3, look(0));
    const flipped = sheetRows('shoot_ball', 3, look(0), true);
    expect(flipped).toEqual(plain.map((r) => [...r].reverse().join('')));
    const f = sheetFrame('shoot_ball', 3);
    const w = f.rows[0].length;
    expect(sheetPivot(f, true)[0]).toBeCloseTo(w - sheetPivot(f)[0]);
    const [, , left, cols] = sheetJersey(f, true);
    expect(left + cols).toBe(w - f.jersey[2]);
  });

  it('loops most animations and holds the last frame of a one-shot', () => {
    expect(sheetFrameAt('run', 0)).toBe(0);
    expect(sheetFrameAt('run', 100 * sheetFrames('run'))).toBe(0);
    expect(sheetFrameAt('run', 250)).toBe(2);
    expect(ONE_SHOT.has('slide_tackle')).toBe(true);
    expect(sheetFrameAt('slide_tackle', 100000)).toBe(sheetFrames('slide_tackle') - 1);
  });

  it('paints kit colours, both stripe colours, and the keeper kit with gloves', () => {
    const stripes = KITS.find((k) => k.pattern === 'stripes')!;
    const { ctx, fills } = recorder();
    paintSheet(ctx, 'idle', 0, stripes, false, 0, 0, 1);
    expect(fills).toContain(hex(stripes.jersey));
    expect(fills).toContain(hex(stripes.jersey2));
    expect(fills).toContain(hex(stripes.shorts));
    expect(fills).toContain(hex(stripes.socks));
    expect(fills.some((f) => !f || f.includes('NaN'))).toBe(false);
    const gk = recorder();
    paintSheet(gk.ctx, 'gk-clearance', 7, KITS[0], true, 0, 0, 1, undefined, true);
    expect(gk.fills).toContain(hex(KITS[0].keeper.jersey));
    expect(gk.fills).toContain('#f0f0f0');
  });

  it('draws the hand-made back view at the idle figure\'s size, with a kick that holds its last frame', () => {
    expect(sheetFrames('back_kick')).toBe(4);
    const idle = sheetFrame('idle', 0);
    const back = sheetFrame('back_kick', 0);
    expect(back.rows.length).toBe(idle.rows.length);
    expect(back.rows[0].length).toBe(idle.rows[0].length);
    expect(sheetPivot(back)).toEqual(sheetPivot(idle));
    // Seen from behind: hair covers the head, no face highlights above the shoulders.
    const withHair = sheetRows('back_kick', 0, { skin: 0, hair: 0, style: 0 });
    expect(withHair.slice(0, 11).join('')).toMatch(/H/);
    expect(withHair.slice(0, 11).join('')).not.toMatch(/L/);
    const [ax, ay] = BACK_NUMBER_ANCHOR;
    const [top, rows, left, cols] = back.jersey;
    expect(ay).toBeGreaterThan(top);
    expect(ay).toBeLessThan(top + rows);
    expect(ax).toBeGreaterThan(left);
    expect(ax).toBeLessThan(left + cols);
    expect(KICK_CONTACT.back_kick).toBeLessThan(sheetFrames('back_kick'));
    expect(sheetFrameAt('back_kick', 10000)).toBe(3);
    expect(SHEET_HERO['hero-back']).toEqual(['back_kick', 0]);
  });

  it('has a 7x7 ball and a sheet frame for every hero pose', () => {
    expect(SHEET_BALL.rows.length).toBe(7);
    for (const r of SHEET_BALL.rows) expect(r.length).toBe(7);
    for (const ch of SHEET_BALL.rows.join('').replace(/\./g, '')) expect(SHEET_BALL.colors[ch]).toMatch(/^#[0-9a-f]{6}$/);
    for (const [pose, [anim, i]] of Object.entries(SHEET_HERO)) {
      expect(SHEET_ANIMS, pose).toContain(anim);
      expect(i).toBeLessThan(sheetFrames(anim));
    }
  });
});
