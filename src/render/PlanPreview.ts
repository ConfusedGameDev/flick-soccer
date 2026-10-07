import { Container, Graphics, Text } from 'pixi.js';
import type { FlickKind, Vec2 } from '../engine/types';
import { dist, lerp } from '../engine/vec';
import type { PitchView } from './PitchView';

export interface GhostFlick {
  kind: Exclude<FlickKind, 'invalid'>;
  from: Vec2;
  to: Vec2;
  /** Position of the teammate who will collect the pass, if any. */
  receiver?: Vec2;
  /** True when the ball would cross a line or nobody can receive it. */
  bad?: boolean;
}

export interface DragPreview extends GhostFlick {
  /** Current pointer position in world units (the pulled-back end of the band). */
  pull: Vec2;
}

const COLORS: Record<GhostFlick['kind'], number> = {
  pass: 0xffd447,
  shot: 0xff1744,
  run: 0x40c4ff,
  slide: 0xff7043,
  dive: 0x18ffff,
};
const BAD_COLOR = 0xef5350;

export const KIND_LABEL: Record<GhostFlick['kind'], string> = {
  pass: 'Pass',
  shot: 'SHOT',
  run: 'Run',
  slide: 'Tackle',
  dive: 'Dive',
};

/** Ghost arrows for committed flicks plus the rubber band while dragging. All in screen space. */
export class PlanPreview {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly labels = new Container();

  constructor(private readonly pitch: PitchView) {
    this.root.addChild(this.g, this.labels);
  }

  clear(): void {
    this.g.clear();
    this.labels.removeChildren();
  }

  draw(committed: readonly GhostFlick[], drag: DragPreview | null): void {
    this.clear();
    committed.forEach((f, i) => this.ghost(f, String(i + 1)));
    if (drag) {
      this.ghost(drag, KIND_LABEL[drag.kind]);
      const a = this.pitch.toScreen(drag.from);
      const b = this.pitch.toScreen(drag.pull);
      this.g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: 0xffffff, alpha: 0.6 });
      this.g.circle(b.x, b.y, 6).fill({ color: 0xffffff, alpha: 0.6 });
    }
  }

  private ghost(f: GhostFlick, text: string): void {
    const color = f.bad ? BAD_COLOR : COLORS[f.kind];
    const a = this.pitch.toScreen(f.from);
    const b = this.pitch.toScreen(f.to);
    this.dashed(a, b, color, f.kind === 'shot' ? 5 : 3);
    this.g.circle(b.x, b.y, f.kind === 'shot' ? 7 : 5).fill({ color, alpha: 0.9 });
    if (f.receiver) {
      const r = this.pitch.toScreen(f.receiver);
      this.g.circle(r.x, r.y, 1.3 * this.pitch.scale * 1.9).stroke({ width: 2, color, alpha: 0.9 });
    }
    const label = new Text({
      text,
      style: { fontSize: 12, fontWeight: '700', fill: 0xffffff, fontFamily: 'system-ui, sans-serif' },
    });
    label.anchor.set(0.5);
    label.position.set(b.x, b.y - 14);
    this.labels.addChild(label);
  }

  private dashed(a: Vec2, b: Vec2, color: number, width: number): void {
    const total = dist(a, b);
    const dash = 8;
    const gap = 6;
    for (let d = 0; d < total; d += dash + gap) {
      const p = lerp(a, b, d / total);
      const q = lerp(a, b, Math.min(total, d + dash) / total);
      this.g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width, color, alpha: 0.9 });
    }
  }
}
