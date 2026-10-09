import { describe, expect, it, vi } from 'vitest';

// The painter only needs pixi for textures; keep the test free of a DOM.
vi.mock('pixi.js', () => ({ Texture: class {} }));

import { KITS, hex } from './kits';
import { BACK_H, BACK_W, SPRITE_H, SPRITE_W, lookFor, paintSprite, templateRows, type Pose } from './sprites';

const POSES: Pose[] = ['stand', 'run1', 'run2', 'kick', 'cheer', 'slide', 'ready'];

describe('sprite templates', () => {
  it('every pose and hair style is a full SPRITE_W x SPRITE_H grid of known letters', () => {
    for (const pose of POSES) {
      for (let style = 0; style < 4; style++) {
        const rows = templateRows(pose, { skin: 0, hair: 0, style });
        expect(rows.length, `${pose} style ${style} rows`).toBe(SPRITE_H);
        rows.forEach((r, i) => {
          expect(r.length, `${pose} style ${style} row ${i}`).toBe(SPRITE_W);
          expect(r, `${pose} style ${style} row ${i}`).toMatch(/^[.OHhSsGgJjqCPpKkB]+$/);
        });
      }
    }
  });

  it('looks are stable per name and spread across the palettes', () => {
    expect(lookFor('Hugo Sánchez')).toEqual(lookFor('Hugo Sánchez'));
    const names = ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9', '#10', '#11'];
    const skins = new Set(names.map((n) => lookFor(n).skin));
    const hairs = new Set(names.map((n) => lookFor(n).hair));
    expect(skins.size).toBeGreaterThan(1);
    expect(hairs.size).toBeGreaterThan(1);
  });
});

describe('back view (set-piece scene)', () => {
  it('is a full BACK_W x BACK_H grid of known letters for every hair style, with no face', () => {
    for (let style = 0; style < 4; style++) {
      const rows = templateRows('back', { skin: 0, hair: 0, style });
      expect(rows.length, `style ${style} rows`).toBe(BACK_H);
      rows.forEach((r, i) => {
        expect(r.length, `style ${style} row ${i}`).toBe(BACK_W);
        expect(r, `style ${style} row ${i}`).toMatch(/^[.OHhSsGgJjqCPpKkB]+$/);
      });
      // The hair sits above the shirt; a bald head shows skin instead.
      const crown = rows.slice(0, 8).join('');
      if (style === 3) expect(crown).not.toMatch(/[Hh]/);
      else expect(crown).toMatch(/H/);
    }
  });

  it('paints the kit colours onto the big shirt and shorts', () => {
    const fills: string[] = [];
    const fake = {
      fillStyle: '',
      fillRect(this: { fillStyle: string }) {
        fills.push(this.fillStyle);
      },
    };
    const ctx = fake as unknown as CanvasRenderingContext2D;
    paintSprite(ctx, 'back', KITS[0], false, 0, 0, 1);
    expect(fills).toContain(hex(KITS[0].jersey));
    expect(fills).toContain(hex(KITS[0].shorts));
    expect(fills.some((f) => f === undefined || f === '')).toBe(false);
  });
});
