import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: async () => {}, notification: async () => {} },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS' },
}));

import { AIM_NOTCH, FlickFeel, POWER_NOTCH, TICK_GAP_MS } from './haptics';

const dir = (a: number) => ({ x: Math.cos(a), y: Math.sin(a) });

describe('FlickFeel', () => {
  it('ticks once per power notch, harder with more power, and not between notches', () => {
    let t = 0;
    const f = new FlickFeel(() => (t += TICK_GAP_MS + 1));
    expect(f.update(0.05, dir(0))).toBeNull();
    expect(f.update(POWER_NOTCH, dir(0))).toBe('light');
    expect(f.update(0.15, dir(0))).toBeNull();
    expect(f.update(0.42, dir(0))).toBe('medium');
    expect(f.update(0.9, dir(0))).toBe('heavy');
    expect(f.update(0.91, dir(0))).toBeNull();
    // Easing the pull back across a notch ticks too.
    expect(f.update(0.5, dir(0))).toBe('medium');
  });

  it('ticks lightly when the aim swings by a notch', () => {
    let t = 0;
    const f = new FlickFeel(() => (t += TICK_GAP_MS + 1));
    f.update(0.55, dir(0));
    expect(f.update(0.55, dir(AIM_NOTCH * 0.5))).toBeNull();
    expect(f.update(0.55, dir(AIM_NOTCH * 1.1))).toBe('light');
    // Measured from the last tick, and across the ±π seam.
    expect(f.update(0.55, dir(AIM_NOTCH * 1.5))).toBeNull();
    f.update(0.55, dir(Math.PI - 0.05));
    expect(f.update(0.55, dir(-Math.PI + 0.05))).toBeNull();
    expect(f.update(0.55, dir(-Math.PI + AIM_NOTCH + 0.1))).toBe('light');
  });

  it('rate-limits ticks and the release matches the power', () => {
    let t = 0;
    const f = new FlickFeel(() => t);
    expect(f.update(0.2, dir(0))).toBe('light');
    t += TICK_GAP_MS / 2;
    expect(f.update(0.4, dir(0))).toBeNull();
    t += TICK_GAP_MS;
    expect(f.update(0.4, dir(0))).toBeNull(); // the notch was already counted
    expect(f.update(0.6, dir(0))).toBe('medium');
    expect(f.release(0.95)).toBe('heavy');
    expect(f.release(0)).toBeNull();
    // After a release the next drag starts fresh.
    t += TICK_GAP_MS * 2;
    expect(f.update(0.2, dir(0))).toBe('light');
  });
});
