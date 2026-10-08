import { describe, expect, it, vi } from 'vitest';

// The painter only needs pixi for textures; keep the test free of a DOM.
vi.mock('pixi.js', () => ({ Texture: class {} }));

import { SPRITE_H, SPRITE_W, lookFor, templateRows, type Pose } from './sprites';

const POSES: Pose[] = ['stand', 'run1', 'run2', 'kick', 'cheer', 'slide'];

describe('sprite templates', () => {
  it('every pose and hair style is a full SPRITE_W x SPRITE_H grid of known letters', () => {
    for (const pose of POSES) {
      for (let style = 0; style < 4; style++) {
        const rows = templateRows(pose, { skin: 0, hair: 0, style });
        expect(rows.length, `${pose} style ${style} rows`).toBe(SPRITE_H);
        rows.forEach((r, i) => {
          expect(r.length, `${pose} style ${style} row ${i}`).toBe(SPRITE_W);
          expect(r, `${pose} style ${style} row ${i}`).toMatch(/^[.OHhSsGgJjCPpKkB]+$/);
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
