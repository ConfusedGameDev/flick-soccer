import { Container, Graphics } from 'pixi.js';
import { GOAL_W, PITCH_L, PITCH_W } from '../engine/pitch';
import type { Vec2 } from '../engine/types';

const PAD_X = 16;
const PAD_TOP = 84;
const PAD_BOTTOM = 92;
/** Margin on a dedicated pitch screen: room for the stands band (up to 40 px) plus a gap. */
const PAD_SCREEN = 48;
/**
 * Free screen space kept beyond each goal line, in metres at the chosen scale, so a
 * keeper near his line can still pull back far enough for a decent pass or dive.
 */
export const PULL_ROOM_M = 12;

/**
 * Pixels per metre for the available area: the pitch fits the width and the height, and the
 * scale is capped so that the end padding plus the centring slack leaves PULL_ROOM_M behind
 * each goal line. `padEnd` is the smaller of the two end paddings.
 */
export function fitScale(availW: number, availH: number, padEnd: number): number {
  return Math.max(0.5, Math.min(availW / PITCH_W, availH / PITCH_L, (availH + 2 * padEnd) / (PITCH_L + 2 * PULL_ROOM_M)));
}

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
  /**
   * Dual-screen (M9): when set, the pitch fills this screen and ignores `insets`
   * and the bar padding, because the HUD lives on the other screen. The margin
   * keeps the stands inside the screen, clear of the hinge.
   */
  screen: { x: number; y: number; width: number; height: number } | null = null;
  private ox = 0;
  private oy = 0;

  constructor() {
    this.root.addChild(this.g);
  }

  layout(width: number, height: number): void {
    let x0: number;
    let y0: number;
    let availW: number;
    let availH: number;
    if (this.screen) {
      const r = this.screen;
      x0 = r.x + PAD_SCREEN;
      y0 = r.y + PAD_SCREEN;
      availW = r.width - PAD_SCREEN * 2;
      availH = r.height - PAD_SCREEN * 2;
    } else {
      const { left, right, top, bottom } = this.insets;
      x0 = left + PAD_X;
      y0 = top + PAD_TOP;
      availW = width - left - right - PAD_X * 2;
      availH = height - top - bottom - PAD_TOP - PAD_BOTTOM;
    }
    const s = fitScale(availW, availH, this.screen ? PAD_SCREEN : Math.min(PAD_TOP, PAD_BOTTOM));
    this.scale = s;
    this.ox = x0 + (availW - PITCH_W * s) / 2;
    this.oy = y0 + (availH - PITCH_L * s) / 2;
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

    // Stands: a dark terrace around the pitch filled with rows of fans (a
    // skin-tone head over a shirt in a crowd colour), behind a strip of
    // advertising boards in flat 16-bit colours.
    const band = Math.min(6 * s, 40);
    const boards = Math.max(3, Math.min(1.2 * s, 9));
    const x0 = tl.x - band;
    const y0 = tl.y - band;
    const w = PITCH_W * s + band * 2;
    const h = PITCH_L * s + band * 2;
    g.rect(x0, y0, w, h).fill(0x1c2630);
    const px = Math.max(1, Math.floor(Math.min(s * 0.45, 3)));
    const stepX = px * 2 + 1;
    const stepY = px * 3 + 1;
    const skins = [0xf1c9a5, 0xe2a978, 0xb9784b, 0x7a4a2e];
    const shirts = [0xe8e8e8, 0xd42b2b, 0x1f58c7, 0xf1b63a, 0x2d9a4c, 0x8b5a2b, 0xc9c9c9, 0x4a2a7a];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const innerL = tl.x - boards;
    const innerR = tl.x + PITCH_W * s + boards;
    const innerT = tl.y - boards;
    const innerB = tl.y + PITCH_L * s + boards;
    for (let y = y0 + 2; y < y0 + h - stepY; y += stepY) {
      for (let x = x0 + 2; x < x0 + w - stepX; x += stepX) {
        const inside = x + stepX > innerL && x < innerR && y + stepY > innerT && y < innerB;
        if (inside) continue;
        // A few empty seats and a little jitter so the rows do not read as a grid.
        if (rnd() < 0.08) continue;
        const jx = Math.floor(rnd() * 2);
        g.rect(x + jx, y, px, px).fill(skins[Math.floor(rnd() * skins.length)]);
        g.rect(x + jx - (px > 1 ? 1 : 0), y + px, px + (px > 1 ? 2 : 0), px * 2).fill(shirts[Math.floor(rnd() * shirts.length)]);
      }
    }
    // Advertising boards: alternating blocks with a thin dark gap, around all four sides.
    const boardColors = [0xd42b2b, 0xf4f1e6, 0x1f58c7, 0xffd447];
    const seg = Math.max(12, Math.round(8 * s));
    const sides: [number, number, number, number, boolean][] = [
      [innerL, innerT, innerR - innerL, boards, true],
      [innerL, innerB - boards, innerR - innerL, boards, true],
      [innerL, innerT, boards, innerB - innerT, false],
      [innerR - boards, innerT, boards, innerB - innerT, false],
    ];
    sides.forEach(([bx, by, bw, bh, horizontal], side) => {
      g.rect(bx, by, bw, bh).fill(0x0d1116);
      const len = horizontal ? bw : bh;
      let i = 0;
      for (let d = 0; d < len; d += seg, i++) {
        const l = Math.min(seg - 2, len - d);
        if (l <= 2) break;
        const c = boardColors[(i + side) % boardColors.length];
        if (horizontal) g.rect(bx + d, by + 1, l, bh - 2).fill(c);
        else g.rect(bx + 1, by + d, bw - 2, l).fill(c);
      }
    });

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

    // Corner flags: a pole with a small pennant, leaning away from the pitch.
    const flag = Math.max(3, 1.2 * s);
    for (const cx of [0, PITCH_W]) {
      for (const cy of [0, PITCH_L]) {
        const p = this.toScreen({ x: cx, y: cy });
        const dx = cx === 0 ? -1 : 1;
        g.moveTo(p.x, p.y).lineTo(p.x + dx * flag * 0.4, p.y - flag).stroke({ width: Math.max(1, 0.12 * s), color: 0xf4f1e6 });
        g.moveTo(p.x + dx * flag * 0.4, p.y - flag)
          .lineTo(p.x + dx * flag * 1.1, p.y - flag * 0.75)
          .lineTo(p.x + dx * flag * 0.35, p.y - flag * 0.55)
          .fill(0xffd447);
      }
    }

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
