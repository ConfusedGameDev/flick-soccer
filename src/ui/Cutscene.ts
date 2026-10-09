import { hex, type Kit } from '../render/kits';
import { LETTERS, ballParts, rasterise } from '../render/rig';
import { DEFAULT_LOOK, lookFor, spriteCanvas, spriteSize, type Look } from '../render/sprites';
import { BALL_RADIUS, GRASS, GROUND, SCENES, STAGE_H, stageScale, visibleFigures, type CutsceneKind, type Figure, type Prop } from './cutsceneScenes';

export type { CutsceneKind };

export interface CutsceneSpec {
  kind: CutsceneKind;
  kit: Kit;
  keeper?: boolean;
  /** Player featured on the card. */
  name: string;
  team: string;
  /** The other side's figure, where the scene has one (the beaten keeper, the robbed dribbler). */
  foil?: { kit: Kit; keeper?: boolean; name?: string };
  /** Override the card's duration (the dev preview holds a card with Infinity). */
  holdMs?: number;
}

const GRASS_DARK = '#1f7a33';
const GRASS_LIGHT = '#2a9a44';
const GRASS_STREAK = '#4ec25e';
const GRASS_EDGE = '#145223';
const SHADOW = '#123d1c';

/**
 * Dramatic freeze-frame card in the spirit of ISS Deluxe: big pixel figures
 * on a black stage with a strip of grass, a slow stepped pan and a shouted
 * caption. The figures are rasterised rigs (render/rig.ts) in the two kits;
 * what each card shows is data in cutsceneScenes.ts.
 */
export class Cutscene {
  constructor(private readonly overlay: HTMLElement) {}

  show(spec: CutsceneSpec): Promise<void> {
    const scene = SCENES[spec.kind];
    const duration = spec.holdMs ?? (scene.major ? 2400 : 1600);
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = `cutscene ${scene.major ? 'major' : 'minor'}`;
      root.style.setProperty('--kit', hex(spec.kit.jersey));
      root.innerHTML = `
        <div class="cs-stage" data-stage></div>
        <div class="cs-text">
          <div class="cs-title">${scene.title}</div>
          <div class="cs-rule"></div>
          <div class="cs-sub">${spec.name} · ${spec.team}</div>
        </div>`;
      const stage = root.querySelector<HTMLElement>('[data-stage]')!;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const k = stageScale(vw, vh, scene.width);
      const figures = visibleFigures(scene, vw, k);
      stage.style.width = `${scene.width * k}px`;
      stage.style.height = `${STAGE_H * k}px`;
      root.style.setProperty('--pan', `${4 * k}px`);

      stage.appendChild(grassCanvas(scene.width, k, figures));
      for (const f of [...figures].sort((a, b) => a.z - b.z)) {
        const hero = f.who === 'hero';
        const kit = hero ? spec.kit : (spec.foil?.kit ?? spec.kit);
        const look: Look = hero ? lookFor(spec.name) : spec.foil?.name ? lookFor(spec.foil.name) : DEFAULT_LOOK;
        const canvas = spriteCanvas(f.pose, kit, f.keeper, k, look, f.flip);
        const [, h] = spriteSize(f.pose);
        canvas.style.left = `${f.x * k}px`;
        canvas.style.top = `${(GROUND - h + f.baseline) * k}px`;
        stage.appendChild(canvas);
      }
      for (const p of scene.props) {
        if (figures.length < scene.figures.length && p.kind === 'ball' && spec.kind !== 'duel' && spec.kind !== 'corner') continue;
        stage.appendChild(propCanvas(p, k));
      }
      this.overlay.appendChild(root);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        root.classList.add('out');
        setTimeout(() => {
          root.remove();
          resolve();
        }, 220);
      };
      root.addEventListener('pointerdown', finish);
      if (Number.isFinite(duration)) setTimeout(finish, duration);
    });
  }
}

/** The strip of grass the figures stand on, with a soft shadow under each standing figure. */
function grassCanvas(width: number, k: number, figures: Figure[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = STAGE_H;
  const g = c.getContext('2d')!;
  for (let y = GRASS.top; y < GRASS.bottom; y++) {
    for (let x = 0; x < width; x += 4) {
      g.fillStyle = ((x >> 2) + (y - GRASS.top)) % 2 ? GRASS_LIGHT : GRASS_DARK;
      g.fillRect(x, y, 4, 1);
    }
  }
  // Lighter blades at deterministic spots, and a dark edge where the turf meets the dark.
  g.fillStyle = GRASS_STREAK;
  for (let x = 3; x < width; x += 7) g.fillRect(x, GRASS.top + 1 + ((x * 5) % 5), 2, 1);
  g.fillStyle = GRASS_EDGE;
  g.fillRect(0, GRASS.top, width, 1);
  g.fillRect(0, GRASS.bottom - 1, width, 1);
  g.fillStyle = SHADOW;
  for (const f of figures) {
    if (f.baseline !== 0) continue;
    const [w] = spriteSize(f.pose);
    g.fillRect(Math.round(f.x + w * 0.2), GRASS.top + 1, Math.round(w * 0.6), 2);
  }
  c.style.left = '0';
  c.style.top = '0';
  c.style.width = `${width * k}px`;
  c.style.height = `${STAGE_H * k}px`;
  return c;
}

const BALL_COLOURS: Record<string, string> = { O: '#141420', W: '#f8f8f8', e: '#c8c8d0', D: '#26262e' };

/** A loose ball or the corner flag at a stage position, painted at scale k. */
function propCanvas(p: Prop, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  if (p.kind === 'ball') {
    const r = BALL_RADIUS;
    const size = Math.ceil(r * 2) + 2;
    c.width = size * k;
    c.height = size * k;
    const { rows } = rasterise({ w: size, h: size, parts: ballParts([size / 2, size / 2], r, 1) });
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        g.fillStyle = BALL_COLOURS[ch] ?? BALL_COLOURS[LETTERS[ch]?.mat === 'outline' ? 'O' : 'W'];
        g.fillRect(x * k, y * k, k, k);
      }),
    );
    c.style.left = `${(p.x - size / 2) * k}px`;
    c.style.top = `${(p.y - size / 2) * k}px`;
  } else {
    // The corner flag: a pole down to the ground with a pennant blowing right.
    const w = 12;
    const h = GROUND - p.y + 2;
    c.width = w * k;
    c.height = h * k;
    const px = (x: number, y: number, col: string, cw = 1, ch = 1) => {
      g.fillStyle = col;
      g.fillRect(x * k, y * k, cw * k, ch * k);
    };
    for (let y = 0; y < h; y++) {
      px(0, y, '#141420');
      px(1, y, '#e8e8e8');
      px(2, y, '#9a9aa4');
      px(3, y, '#141420');
    }
    for (let y = 0; y < 7; y++) {
      const len = Math.max(0, 8 - Math.abs(y - 3) * 2);
      if (!len) continue;
      px(4, y, '#141420', len + 1, 1);
      px(4, y, '#ffd447', len, 1);
    }
    px(4, 7, '#141420', 2, 1);
    c.style.left = `${p.x * k}px`;
    c.style.top = `${p.y * k}px`;
  }
  return c;
}
