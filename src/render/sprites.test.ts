import { describe, expect, it, vi } from 'vitest';

// The painter only needs pixi for textures; keep the test free of a DOM.
vi.mock('pixi.js', () => ({ Texture: class {} }));

import { KITS, hex } from './kits';
import { LETTERS } from './rig';
import { BACK_H, BACK_W, HERO_POSES, SPRITE_H, SPRITE_W, heroTemplate, lookFor, paintNumber, paintSprite, spriteSize, templateRows, type Pose } from './sprites';

const ALPHABET = new RegExp(`^[.${Object.keys(LETTERS).join('')}]+$`);
const LEGACY = /^[.OHhSsGgJjqCPpKkB]+$/;

/** A context that records every fill. */
function recorder(): { ctx: CanvasRenderingContext2D; fills: string[]; rects: [number, number, number, number][] } {
  const fills: string[] = [];
  const rects: [number, number, number, number][] = [];
  const fake = {
    fillStyle: '',
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      fills.push(this.fillStyle);
      rects.push([x, y, w, h]);
    },
  };
  return { ctx: fake as unknown as CanvasRenderingContext2D, fills, rects };
}

const POSES: Pose[] = ['stand', 'run1', 'run2', 'kick', 'cheer', 'slide', 'ready'];
// Fingerprints taken from the painter before the hero poses were added (see the snapshot test).
const FINGERPRINT_STAND = 815974069;
const FINGERPRINT_PAINT = 2258995164;

describe('sprite templates', () => {
  it('every pose and hair style is a full SPRITE_W x SPRITE_H grid of known letters', () => {
    for (const pose of POSES) {
      for (let style = 0; style < 4; style++) {
        const rows = templateRows(pose, { skin: 0, hair: 0, style });
        expect(rows.length, `${pose} style ${style} rows`).toBe(SPRITE_H);
        rows.forEach((r, i) => {
          expect(r.length, `${pose} style ${style} row ${i}`).toBe(SPRITE_W);
          expect(r, `${pose} style ${style} row ${i}`).toMatch(LEGACY);
        });
      }
    }
  });

  it('the pitch sprites are unchanged by the letter table (stand, style 0 snapshot)', () => {
    // A fingerprint of the typed template and of its painted colours: the hero
    // work must never move a pixel of the small sprites.
    const rows = templateRows('stand', { skin: 0, hair: 0, style: 0 });
    let h = 2166136261;
    for (const ch of rows.join('\n')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    expect(h).toBe(FINGERPRINT_STAND);
    const rec = recorder();
    for (const pose of [...POSES, 'back'] as Pose[]) paintSprite(rec.ctx, pose, KITS[1], false, 0, 0, 1, { skin: 0, hair: 0, style: 0 });
    paintSprite(rec.ctx, 'ready', KITS[0], true, 0, 0, 1, { skin: 2, hair: 1, style: 2 });
    paintNumber(rec.ctx, KITS[1], false, 0, 0, 1, 7);
    let f = 2166136261;
    for (const ch of rec.fills.join(',') + rec.rects.join(';')) f = Math.imul(f ^ ch.charCodeAt(0), 16777619) >>> 0;
    expect(f).toBe(FINGERPRINT_PAINT);
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
        expect(r, `style ${style} row ${i}`).toMatch(LEGACY);
      });
      // The hair sits above the shirt; a bald head shows skin instead.
      const crown = rows.slice(0, 8).join('');
      if (style === 3) expect(crown).not.toMatch(/[Hh]/);
      else expect(crown).toMatch(/H/);
    }
  });

  it('paints the kit colours onto the big shirt and shorts', () => {
    const { ctx, fills } = recorder();
    paintSprite(ctx, 'back', KITS[0], false, 0, 0, 1);
    expect(fills).toContain(hex(KITS[0].jersey));
    expect(fills).toContain(hex(KITS[0].shorts));
    expect(fills.some((f) => f === undefined || f === '')).toBe(false);
  });
});

describe('hero poses (cutscene cards and the set-piece scene)', () => {
  it('rasterise to their frame for every hair style, in the extended alphabet', () => {
    for (const pose of HERO_POSES) {
      const [w, h] = spriteSize(pose);
      for (let style = 0; style < 4; style++) {
        const rows = templateRows(pose, { skin: 0, hair: 0, style });
        expect(rows.length, `${pose} ${style}`).toBe(h);
        rows.forEach((r) => {
          expect(r.length).toBe(w);
          expect(r).toMatch(ALPHABET);
        });
      }
    }
    expect(spriteSize('stand')).toEqual([SPRITE_W, SPRITE_H]);
    expect(spriteSize('back')).toEqual([BACK_W, BACK_H]);
  });

  it('paints every letter to a colour, and both stripe colours onto a leaning torso', () => {
    const stripes = KITS.find((k) => k.pattern === 'stripes')!;
    for (const pose of HERO_POSES) {
      const { ctx, fills } = recorder();
      paintSprite(ctx, pose, stripes, false, 0, 0, 1, { skin: 2, hair: 3, style: 2 });
      expect(fills.some((f) => f === undefined || f === '' || f.includes('NaN'))).toBe(false);
      expect(fills).toContain(hex(stripes.shorts));
    }
    const { ctx, fills } = recorder();
    paintSprite(ctx, 'hero-dive', stripes, false, 0, 0, 1);
    expect(fills).toContain(hex(stripes.jersey));
    expect(fills).toContain(hex(stripes.jersey2));
    // Keepers get gloves and the keeper kit.
    const gk = recorder();
    paintSprite(gk.ctx, 'hero-ready', KITS[0], true, 0, 0, 1);
    expect(gk.fills).toContain('#f0f0f0');
    expect(gk.fills).toContain(hex(KITS[0].keeper.jersey));
  });

  it('flip mirrors the figure and the number sits inside the hero back view', () => {
    const a = templateRows('hero-run', { skin: 0, hair: 0, style: 0 });
    const b = templateRows('hero-run', { skin: 0, hair: 0, style: 0 }, true);
    const mask = (rows: string[]) => rows.map((r) => r.replace(/[^.]/g, '#'));
    expect(mask(b)).toEqual(mask(a).map((r) => [...r].reverse().join('')));
    expect(heroTemplate('hero-back', { skin: 0, hair: 0, style: 0 }).number).toBeDefined();
    const [w, h] = spriteSize('hero-back');
    const { ctx, rects } = recorder();
    paintNumber(ctx, KITS[0], false, 0, 0, 1, 10, 'hero-back');
    expect(rects.length).toBeGreaterThan(0);
    for (const [x, y] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(h);
    }
  });
});
