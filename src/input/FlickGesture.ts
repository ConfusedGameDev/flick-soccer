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
  /** `aim` is the second finger's world point while it is down (two-finger mode). */
  onDrag: (playerId: number, flick: Flick, pull: Vec2, aim: Vec2 | null) => void;
  onRelease: (playerId: number, flick: Flick | null) => void;
}

/**
 * Angry Birds-style flick: press a disc, pull back, release. The flick direction
 * is opposite the pull and strength is the pull length over MAX_PULL_M.
 *
 * Two fingers: while the first finger holds the pull, a second touch anywhere
 * takes over the aim. The first finger's pull length is then only the power
 * and the flick goes from the disc toward the second finger. Lifting the second
 * finger goes back to one-finger aiming; lifting the first commits the flick.
 * A cancelled pointer (an OS edge gesture) commits the pull as it stood.
 */
export class FlickGesture {
  enabled = false;
  private pointerId: number | null = null;
  private playerId: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };
  /** Where the first finger is now. */
  private current: Vec2 = { x: 0, y: 0 };
  /** The second finger, when down. */
  private aimPointerId: number | null = null;
  private aim: Vec2 | null = null;

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

  /** The flick for the fingers as they are: power from the pull, direction from the second finger when there is one. */
  private flick(): Flick | null {
    const l = dist(this.origin, this.current);
    if (l < MIN_PULL_M) return null;
    const strength = Math.min(1, l / MAX_PULL_M);
    if (this.aim) {
      if (dist(this.origin, this.aim) < MIN_PULL_M) return null;
      return { playerId: this.playerId!, dir: normalize(sub(this.aim, this.origin)), strength };
    }
    return { playerId: this.playerId!, dir: normalize(sub(this.origin, this.current)), strength };
  }

  private capture(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private drag(): void {
    const id = this.playerId!;
    const flick = this.flick() ?? { playerId: id, dir: { x: 0, y: 0 }, strength: 0 };
    this.handlers.onDrag(id, flick, this.current, this.aim);
  }

  private down = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const world = this.worldOf(e);
    if (this.pointerId !== null) {
      // A second finger while pulling: it aims from now on.
      if (this.aimPointerId !== null || this.playerId === null) return;
      e.preventDefault();
      this.aimPointerId = e.pointerId;
      this.aim = world;
      this.capture(e);
      this.drag();
      return;
    }
    const id = this.handlers.pick(world);
    if (id === null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.playerId = id;
    this.origin = world;
    this.current = world;
    this.capture(e);
  };

  private move = (e: PointerEvent): void => {
    if (this.playerId === null) return;
    if (e.pointerId === this.pointerId) this.current = this.worldOf(e);
    else if (e.pointerId === this.aimPointerId) this.aim = this.worldOf(e);
    else return;
    this.drag();
  };

  private up = (e: PointerEvent): void => {
    if (this.playerId === null) return;
    if (e.pointerId === this.aimPointerId) {
      // Back to one-finger aiming.
      this.aimPointerId = null;
      this.aim = null;
      this.drag();
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const id = this.playerId;
    this.current = this.worldOf(e);
    const flick = this.flick();
    this.reset();
    this.handlers.onRelease(id, flick);
  };

  private cancel = (e: PointerEvent): void => {
    if (this.playerId === null) return;
    if (e.pointerId === this.aimPointerId) {
      this.aimPointerId = null;
      this.aim = null;
      this.drag();
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    // The browser or OS took the pointer (an edge gesture near the screen border): the
    // pull so far was on screen as a ghost, so commit it like a release rather than lose it.
    const id = this.playerId;
    const flick = this.flick();
    this.reset();
    this.handlers.onRelease(id, flick);
  };

  private reset(): void {
    this.pointerId = null;
    this.playerId = null;
    this.aimPointerId = null;
    this.aim = null;
  }
}
