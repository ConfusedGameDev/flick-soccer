import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { Vec2 } from '../engine/types';

// Haptic cues. The Capacitor plugin drives the native engine inside the app
// and falls back to navigator.vibrate on the web (Android browsers; iOS
// Safari has none). Every call is fire-and-forget and never throws.

export type Impact = 'light' | 'medium' | 'heavy';

const STYLE: Record<Impact, ImpactStyle> = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };

let enabled = true;

/** Turn haptics off (tests, a future setting). */
export function setHaptics(on: boolean): void {
  enabled = on;
}

const fire = (p: Promise<void>): void => {
  p.catch(() => {
    /* unsupported here */
  });
};

export const haptics = {
  impact(style: Impact): void {
    if (!enabled) return;
    try {
      fire(Haptics.impact({ style: STYLE[style] }));
    } catch {
      /* ignore */
    }
  },
  /** A short success buzz (a won duel, a goal). */
  success(): void {
    if (!enabled) return;
    try {
      fire(Haptics.notification({ type: NotificationType.Success }));
    } catch {
      /* ignore */
    }
  },
};

/** Strength notches while pulling: one tick each. */
export const POWER_NOTCH = 0.1;
/** Direction change that earns a tick, in radians (~18°). */
export const AIM_NOTCH = Math.PI / 10;
/** Shortest gap between two ticks, so a fast drag does not buzz continuously. */
export const TICK_GAP_MS = 40;

/**
 * What a drag should feel like: a tick each time the pull crosses a power
 * notch, harder the more power there is, and a light tick when the aim
 * swings by a notch. Pure, so the thresholds are tested; `now` is injected.
 */
export class FlickFeel {
  private notch = 0;
  private angle: number | null = null;
  private last = -Infinity;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Call on every drag update; returns the impact to play, if any. */
  update(strength: number, dir: Vec2): Impact | null {
    const notch = Math.floor(strength / POWER_NOTCH + 1e-9);
    const angle = strength > 0 ? Math.atan2(dir.y, dir.x) : null;
    let out: Impact | null = null;
    if (notch !== this.notch) {
      // Harder the further the pull, and a pull back to nothing is the softest.
      out = notch === 0 ? 'light' : strength < 0.35 ? 'light' : strength < 0.7 ? 'medium' : 'heavy';
      this.notch = notch;
    }
    if (angle !== null) {
      if (this.angle !== null) {
        let d = Math.abs(angle - this.angle);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d >= AIM_NOTCH) {
          out ??= 'light';
          this.angle = angle;
        }
      } else this.angle = angle;
    } else this.angle = null;
    if (!out) return null;
    const t = this.now();
    if (t - this.last < TICK_GAP_MS) return null;
    this.last = t;
    return out;
  }

  /** The release: one impact that matches the power, then forget the drag. */
  release(strength: number): Impact | null {
    this.notch = 0;
    this.angle = null;
    this.last = -Infinity;
    if (strength <= 0) return null;
    return strength < 0.35 ? 'light' : strength < 0.7 ? 'medium' : 'heavy';
  }
}
