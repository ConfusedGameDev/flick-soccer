import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Texture: class {} }));

import { spriteSize } from '../render/sprites';
import { GROUND, SCENES, STAGE_H, stageScale, visibleFigures } from './cutsceneScenes';

describe('cutscene scenes', () => {
  it('every figure and prop fits its stage with the feet on the ground line', () => {
    for (const [kind, scene] of Object.entries(SCENES)) {
      expect(scene.figures.some((f) => f.who === 'hero'), kind).toBe(true);
      for (const f of scene.figures) {
        const [w, h] = spriteSize(f.pose);
        expect(f.x, `${kind} ${f.pose} x`).toBeGreaterThanOrEqual(0);
        expect(f.x + w, `${kind} ${f.pose} right edge`).toBeLessThanOrEqual(scene.width);
        expect(GROUND - h + f.baseline, `${kind} ${f.pose} top`).toBeGreaterThanOrEqual(0);
        expect(GROUND + f.baseline, `${kind} ${f.pose} feet`).toBeLessThanOrEqual(STAGE_H);
      }
      for (const p of scene.props) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(scene.width);
        expect(p.y).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it('scales to whole pixels and drops the foil on a narrow screen', () => {
    expect(stageScale(360, 640, 160)).toBe(2);
    expect(stageScale(844, 390, 160)).toBe(2);
    expect(stageScale(1024, 768, 96)).toBe(5);
    expect(stageScale(200, 200, 160)).toBe(2);
    const goal = SCENES.goal;
    expect(visibleFigures(goal, 1100, 4)).toHaveLength(2);
    const narrow = visibleFigures(goal, 300, 2);
    expect(narrow).toHaveLength(1);
    expect(narrow[0].who).toBe('hero');
  });
});
