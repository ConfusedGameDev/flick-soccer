import type { HeroPose } from '../render/sprites';

// What each cutscene card shows, as data: the stage width in native pixels,
// the figures on it (which kit, which pose, where) and the props. Pure, so the
// layout is unit-tested and the DOM card only renders it.

export type CutsceneKind = 'goal' | 'save' | 'overtake' | 'duel' | 'corner' | 'throw-in';

export interface Figure {
  pose: HeroPose;
  /** `hero` wears the featured player's kit, `foil` the opponent's. */
  who: 'hero' | 'foil';
  keeper: boolean;
  flip: boolean;
  /** Left edge in stage pixels. */
  x: number;
  /** Feet offset from the ground line: negative is airborne. */
  baseline: number;
  /** Painter's order, low first. */
  z: number;
}

export interface Prop {
  kind: 'ball' | 'flag';
  x: number;
  y: number;
}

export interface Scene {
  title: string;
  major: boolean;
  /** Stage width in native pixels; the height is STAGE_H. */
  width: number;
  figures: Figure[];
  props: Prop[];
}

/** Stage height: 64 for the figures, the grass strip and a little headroom. */
export const STAGE_H = 80;
/** Row the figures stand on. */
export const GROUND = 70;
/** Grass strip rows. */
export const GRASS = { top: 70, bottom: 78 };

const BALL_R = 3.5;

export const SCENES: Record<CutsceneKind, Scene> = {
  goal: {
    title: '¡GOOOL!',
    major: true,
    width: 160,
    figures: [
      { pose: 'hero-dive', who: 'foil', keeper: true, flip: true, x: 76, baseline: -6, z: 1 },
      { pose: 'hero-strike', who: 'hero', keeper: false, flip: false, x: 8, baseline: 0, z: 2 },
    ],
    props: [{ kind: 'ball', x: 150, y: 24 }],
  },
  save: {
    title: '¡ATAJADA!',
    major: true,
    width: 160,
    figures: [
      { pose: 'hero-strike', who: 'foil', keeper: false, flip: true, x: 110, baseline: 0, z: 1 },
      { pose: 'hero-dive', who: 'hero', keeper: true, flip: false, x: 40, baseline: -4, z: 2 },
    ],
    props: [{ kind: 'ball', x: 118, y: 12 }],
  },
  overtake: {
    title: '¡ROBO!',
    major: false,
    width: 160,
    figures: [
      { pose: 'hero-run', who: 'foil', keeper: false, flip: true, x: 92, baseline: 0, z: 1 },
      { pose: 'hero-tackle', who: 'hero', keeper: false, flip: false, x: 8, baseline: 0, z: 2 },
    ],
    // The dribbler's rig carries the ball.
    props: [],
  },
  duel: {
    title: '¡BALÓN GANADO!',
    major: false,
    width: 96,
    figures: [{ pose: 'hero-cheer', who: 'hero', keeper: false, flip: false, x: 24, baseline: 0, z: 1 }],
    props: [{ kind: 'ball', x: 70, y: 66 }],
  },
  corner: {
    title: '¡CÓRNER!',
    major: false,
    width: 112,
    figures: [{ pose: 'hero-point', who: 'hero', keeper: false, flip: false, x: 8, baseline: 0, z: 1 }],
    props: [
      { kind: 'flag', x: 92, y: 40 },
      { kind: 'ball', x: 80, y: 66 },
    ],
  },
  'throw-in': {
    title: 'SAQUE DE BANDA',
    major: false,
    width: 96,
    figures: [{ pose: 'hero-throw', who: 'hero', keeper: false, flip: false, x: 24, baseline: 0, z: 1 }],
    props: [],
  },
};

export const BALL_RADIUS = BALL_R;

/**
 * Integer scale for a stage on a viewport: as big as fits the width and the
 * lower 60% of the height (the caption keeps the top), never below 2.
 */
export function stageScale(vw: number, vh: number, stageW: number): number {
  return Math.max(2, Math.floor(Math.min(vw / stageW, (vh * 0.6) / STAGE_H)));
}

/** Figures that fit the viewport at scale k: the foil is dropped when the stage would overflow. */
export function visibleFigures(scene: Scene, vw: number, k: number): Figure[] {
  if (scene.width * k <= vw) return scene.figures;
  return scene.figures.filter((f) => f.who === 'hero');
}
