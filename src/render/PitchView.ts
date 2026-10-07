import { Container, Graphics } from 'pixi.js';
import { GOAL_W, PITCH_L, PITCH_W } from '../engine/pitch';
import type { Vec2 } from '../engine/types';

const PAD_X = 16;
const PAD_TOP = 84;
const PAD_BOTTOM = 92;

/**
 * Draws the pitch and owns the world (meters, +y up) to screen (pixels, +y down)
 * mapping. Home defends the bottom edge of the screen.
 */
export class PitchView {
  readonly root = new Container();
  private readonly g = new Graphics();
  /** Pixels per meter. */
  scale = 1;
  /** Screen areas taken by overlays (e.g. the team builder panel); the pitch fits in what's left. */
  insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private ox = 0;
  private oy = 0;

  constructor() {
    this.root.addChild(this.g);
  }

  layout(width: number, height: number): void {
    const { left, right, top, bottom } = this.insets;
    const availW = width - left - right - PAD_X * 2;
    const availH = height - top - bottom - PAD_TOP - PAD_BOTTOM;
    const s = Math.max(0.5, Math.min(availW / PITCH_W, availH / PITCH_L));
    this.scale = s;
    this.ox = left + PAD_X + (availW - PITCH_W * s) / 2;
    this.oy = top + PAD_TOP + (availH - PITCH_L * s) / 2;
    this.draw();
  }

  toScreen(p: Vec2): Vec2 {
    return { x: this.ox + p.x * this.scale, y: this.oy + (PITCH_L - p.y) * this.scale };
  }

  toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.ox) / this.scale, y: PITCH_L - (p.y - this.oy) / this.scale };
  }

  private draw(): void {
    const g = this.g;
    const s = this.scale;
    const line = { width: Math.max(1, 0.15 * s), color: 0xffffff, alpha: 0.85 };
    g.clear();

    const tl = this.toScreen({ x: 0, y: PITCH_L });

    // Stands: a band of crowd around the pitch, rows of little pixel heads.
    const band = Math.min(6 * s, 40);
    g.rect(tl.x - band, tl.y - band, PITCH_W * s + band * 2, PITCH_L * s + band * 2).fill(0x24303a);
    const step = Math.max(3, Math.round(s * 0.9));
    const palette = [0xd9a066, 0xe8e8e8, 0xd42b2b, 0x1f58c7, 0xf1b63a, 0x8b5a2b];
    const px = Math.max(1, Math.floor(step * 0.5));
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const dot = (x: number, y: number) => g.rect(x, y, px, px).fill(palette[Math.floor(rnd() * palette.length)]);
    const x0 = tl.x - band;
    const y0 = tl.y - band;
    const w = PITCH_W * s + band * 2;
    const h = PITCH_L * s + band * 2;
    for (let y = y0 + 2; y < y0 + h - 2; y += step) {
      for (let x = x0 + 2; x < x0 + w - 2; x += step) {
        const inside = x > tl.x - px && x < tl.x + PITCH_W * s && y > tl.y - px && y < tl.y + PITCH_L * s;
        if (!inside) dot(x, y);
      }
    }

    // Grass, with mowing stripes.
    g.rect(tl.x, tl.y, PITCH_W * s, PITCH_L * s).fill(0x3c8f47);
    for (let i = 0; i < 10; i += 2) {
      const a = this.toScreen({ x: 0, y: PITCH_L - (i * PITCH_L) / 10 });
      g.rect(a.x, a.y, PITCH_W * s, (PITCH_L / 10) * s).fill(0x35823f);
    }

    // Outline, halfway line, center circle and spot.
    g.rect(tl.x, tl.y, PITCH_W * s, PITCH_L * s).stroke(line);
    const hl = this.toScreen({ x: 0, y: PITCH_L / 2 });
    const hr = this.toScreen({ x: PITCH_W, y: PITCH_L / 2 });
    g.moveTo(hl.x, hl.y).lineTo(hr.x, hr.y).stroke(line);
    const c = this.toScreen({ x: PITCH_W / 2, y: PITCH_L / 2 });
    g.circle(c.x, c.y, 9.15 * s).stroke(line);
    g.circle(c.x, c.y, 0.3 * s).fill(0xffffff);

    // Boxes and goals at both ends.
    for (const end of [0, PITCH_L]) {
      const dir = end === 0 ? 1 : -1;
      const box = (w: number, d: number) => {
        const a = this.toScreen({ x: PITCH_W / 2 - w / 2, y: end + dir * d });
        const b = this.toScreen({ x: PITCH_W / 2 + w / 2, y: end });
        g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)).stroke(line);
      };
      box(40.3, 16.5);
      box(18.3, 5.5);
      const goalA = this.toScreen({ x: PITCH_W / 2 - GOAL_W / 2, y: end });
      const goalB = this.toScreen({ x: PITCH_W / 2 + GOAL_W / 2, y: end - dir * 2.4 });
      const gx = Math.min(goalA.x, goalB.x);
      const gy = Math.min(goalA.y, goalB.y);
      const gw = Math.abs(goalB.x - goalA.x);
      const gh = Math.abs(goalB.y - goalA.y);
      g.rect(gx, gy, gw, gh).fill({ color: 0xffffff, alpha: 0.18 });
      // Net lattice.
      const mesh = Math.max(3, s * 0.6);
      for (let x = gx + mesh; x < gx + gw; x += mesh) g.moveTo(x, gy).lineTo(x, gy + gh).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
      for (let y = gy + mesh; y < gy + gh; y += mesh) g.moveTo(gx, y).lineTo(gx + gw, y).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
      g.rect(gx, gy, gw, gh).stroke(line);
    }
  }
}
