import type { Flick, Vec2 } from '../engine/types';
import { dist, normalize, sub } from '../engine/vec';
import type { PitchView } from '../render/PitchView';
import { PLAYER_RADIUS_M } from '../render/PiecesView';

/** Pull this many meters for a full-strength flick. */
export const MAX_PULL_M = 20;
/** Shorter pulls than this cancel the flick. */
const MIN_PULL_M = 1.5;
/** How far from a disc's center a press still grabs it (in disc radii). */
const GRAB_RADII = 2.2;

export interface FlickGestureHandlers {
  /** Which player a press at this world point may grab, or null. */
  pick: (world: Vec2) => number | null;
  onDrag: (playerId: number, flick: Flick, pull: Vec2) => void;
  onRelease: (playerId: number, flick: Flick | null) => void;
}

/**
 * Angry Birds-style flick: press a disc, pull back, release. The flick direction
 * is opposite the pull and strength is the pull length over MAX_PULL_M.
 */
export class FlickGesture {
  enabled = false;
  private pointerId: number | null = null;
  private playerId: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pitch: PitchView,
    private readonly handlers: FlickGestureHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Helper for `pick`: nearest player within grab range. */
  static nearest(world: Vec2, positions: readonly Vec2[], allowed: (id: number) => boolean): number | null {
    let best: number | null = null;
    let bestD = PLAYER_RADIUS_M * GRAB_RADII;
    positions.forEach((p, id) => {
      if (!allowed(id)) return;
      const d = dist(p, world);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }

  private worldOf(e: PointerEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return this.pitch.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  private flickFrom(current: Vec2): Flick | null {
    const pull = sub(this.origin, current);
    const l = dist(this.origin, current);
    if (l < MIN_PULL_M) return null;
    return { playerId: this.playerId!, dir: normalize(pull), strength: Math.min(1, l / MAX_PULL_M) };
  }

  private down = (e: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null) return;
    const world = this.worldOf(e);
    const id = this.handlers.pick(world);
    if (id === null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.playerId = id;
    this.origin = world;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || this.playerId === null) return;
    const current = this.worldOf(e);
    const flick = this.flickFrom(current);
    if (flick) this.handlers.onDrag(this.playerId, flick, current);
    else this.handlers.onDrag(this.playerId, { playerId: this.playerId, dir: { x: 0, y: 0 }, strength: 0 }, current);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || this.playerId === null) return;
    const id = this.playerId;
    const flick = this.flickFrom(this.worldOf(e));
    this.reset();
    this.handlers.onRelease(id, flick);
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || this.playerId === null) return;
    const id = this.playerId;
    this.reset();
    this.handlers.onRelease(id, null);
  };

  private reset(): void {
    this.pointerId = null;
    this.playerId = null;
  }
}
