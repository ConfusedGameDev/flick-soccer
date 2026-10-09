import { statFactor } from '../engine/pool';
import { OVER_BAR } from '../engine/pitch';
import { hex, type Kit } from '../render/kits';
import { lookFor, spriteCanvas } from '../render/sprites';

// The set-piece scene, ISS Deluxe style: the camera sits behind the kicker,
// who is drawn big from behind with the goal (or the pitch) ahead. The player
// taps to lock a swinging arrow for the aim, a rising arrow for the height
// (shots only) and finally the cursor of a timing bar on a small block. The
// scene is theater: the only thing that reaches the engine is the result.

export type SetPieceKind = 'shot' | 'corner' | 'throw-in';

export interface SetPieceSpec {
  kind: SetPieceKind;
  kit: Kit;
  keeper: boolean;
  name: string;
  /** Shot stat for shots, pass stat for corners and throw-ins: sizes the timing block. */
  stat: number;
  /** Where the goal shows on the backdrop. */
  goal: 'ahead' | 'left' | 'right' | 'none';
  /** One-line coaching shown under the title (first time only). */
  hint?: string;
}

export interface SetPieceResult {
  /** -1..1 across the arrow's sweep; screen-right is positive. */
  x: number;
  /** Shots only, 0..1 (0 on the ground, 1 at the bar). */
  height?: number;
  /** 0..1 from the timing bar. */
  accuracy: number;
}

export interface SetPieceSounds {
  tick: () => void;
  kick: () => void;
}

/** Where the posts sit on the ±1 aim sweep; aiming beyond them is wide. */
export const GOAL_FRACTION = 0.77;

const AIM_PERIOD_MS = 1600;
const HEIGHT_PERIOD_MS = 1200;
const BAR_PERIOD_MS = 1100;
/** Block width at stat 3, as a fraction of the bar; scales with the stat. */
const BLOCK_BASE = 0.12;
/** How far outside the block the accuracy falls to 0. */
const MISS_RANGE = 0.25;
const AIM_SWEEP_DEG = 40;
const STAGE_PAUSE_MS = 250;
const CLOSE_MS = 850;

type Stage = 'aim' | 'height' | 'timing' | 'done';

const TITLES: Record<SetPieceKind, string> = { shot: 'SHOT', corner: 'CORNER', 'throw-in': 'THROW-IN' };
const STAGE_LABELS: Record<Exclude<Stage, 'done'>, string> = { aim: 'AIM', height: 'HEIGHT', timing: 'TIMING' };

export class SetPiece {
  private abort: (() => void) | null = null;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly sounds?: SetPieceSounds,
  ) {}

  /** Planning ran out while the scene was up: close it now; `run` resolves null. */
  cancel(): void {
    this.abort?.();
  }

  run(spec: SetPieceSpec): Promise<SetPieceResult | null> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = `setpiece ${spec.kind}`;
      root.style.setProperty('--kit', hex(spec.kit.jersey));
      root.style.setProperty('--kit2', hex(spec.kit.jersey2));
      root.innerHTML = `
        <canvas class="sp-canvas" data-canvas></canvas>
        <div class="sp-top">
          <div class="sp-title">${TITLES[spec.kind]}</div>
          <div class="sp-stage" data-stage></div>
          <div class="sp-hint" data-hint>${spec.hint ?? ''}</div>
        </div>
        <div class="sp-pitch">
          <div class="sp-figure" data-figure></div>
          <div class="sp-ball" data-ball></div>
          <div class="sp-pivot" data-pivot>
            <div class="sp-post left"></div>
            <div class="sp-post right"></div>
            <div class="sp-arrow" data-arrow><div class="sp-arrow-head"></div></div>
          </div>
          <div class="sp-gauge hidden" data-gauge>
            <div class="sp-gauge-bar"><div class="sp-gauge-ghost"></div></div>
            <div class="sp-gauge-arrow" data-varrow>▲</div>
            <div class="sp-gauge-label">OVER</div>
          </div>
        </div>
        <div class="sp-bottom">
          <div class="sp-bar hidden" data-bar>
            <div class="sp-block" data-block></div>
            <div class="sp-cursor" data-cursor></div>
          </div>
          <div class="sp-result" data-result></div>
          <div class="sp-tap">tap to lock</div>
        </div>`;
      this.overlay.appendChild(root);

      const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
      const stageEl = q('[data-stage]');
      const hintEl = q('[data-hint]');
      const figure = q('[data-figure]');
      const ball = q('[data-ball]');
      const arrow = q('[data-arrow]');
      const gauge = q('[data-gauge]');
      const varrow = q('[data-varrow]');
      const bar = q('[data-bar]');
      const block = q('[data-block]');
      const cursor = q('[data-cursor]');
      const resultEl = q('[data-result]');

      paintBackdrop(q<HTMLCanvasElement>('[data-canvas]'), spec.goal);
      const k = Math.max(3, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 110));
      figure.appendChild(spriteCanvas('back', spec.kit, spec.keeper, k, lookFor(spec.name)));
      // The posts mark the goal on the sweep so "inside" is visible while aiming.
      root.style.setProperty('--post-deg', `${GOAL_FRACTION * AIM_SWEEP_DEG}deg`);
      root.style.setProperty('--over', `${OVER_BAR * 100}%`);

      // The timing block never sits in the middle, so each attempt feels different.
      const width = BLOCK_BASE * statFactor(spec.stat);
      const centre = 0.15 + Math.random() * 0.27 + (Math.random() < 0.5 ? 0 : 0.43);
      block.style.left = `${(centre - width / 2) * 100}%`;
      block.style.width = `${width * 100}%`;

      let stage: Stage = 'aim';
      let stageStart = performance.now();
      let locked = false;
      let raf = 0;
      let done = false;
      const result: SetPieceResult = { x: 0, accuracy: 0 };
      // The value under the cursor right now.
      let x = 0;
      let h = 0;
      let c = 0;

      const setStage = (next: Stage) => {
        stage = next;
        stageStart = performance.now();
        locked = false;
        if (next === 'done') return;
        stageEl.textContent = STAGE_LABELS[next];
        gauge.classList.toggle('hidden', next !== 'height');
        bar.classList.toggle('hidden', next !== 'timing');
        arrow.classList.toggle('dim', next !== 'aim');
      };
      setStage('aim');

      const paint = (now: number) => {
        const t = now - stageStart;
        if (stage === 'aim' && !locked) x = Math.sin((2 * Math.PI * t) / AIM_PERIOD_MS);
        if (stage === 'height' && !locked) h = (1 - Math.cos((2 * Math.PI * t) / HEIGHT_PERIOD_MS)) / 2;
        if (stage === 'timing' && !locked) {
          const phase = (t % BAR_PERIOD_MS) / BAR_PERIOD_MS;
          c = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        }
        arrow.style.transform = `rotate(${x * AIM_SWEEP_DEG}deg)`;
        varrow.style.bottom = `${h * 100}%`;
        varrow.classList.toggle('over', h > OVER_BAR);
        cursor.style.left = `${c * 100}%`;
      };

      const loop = (now: number) => {
        if (done) return;
        paint(now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      const cleanup = () => {
        done = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        root.removeEventListener('pointerdown', onTap);
        this.abort = null;
      };

      const finish = () => {
        setStage('done');
        const d = Math.abs(c - centre) - width / 2;
        result.accuracy = d <= 0 ? 1 : Math.max(0, 1 - d / MISS_RANGE);
        const pct = Math.round(result.accuracy * 100);
        resultEl.textContent = result.accuracy >= 0.95 ? `PERFECT! ${pct}%` : result.accuracy >= 0.6 ? `GOOD ${pct}%` : `POOR ${pct}%`;
        resultEl.className = `sp-result ${result.accuracy >= 0.95 ? 'perfect' : result.accuracy >= 0.6 ? 'good' : 'poor'}`;
        hintEl.textContent = '';
        this.sounds?.kick();
        // The kicker follows through and the ball flies off toward the horizon.
        figure.classList.add('kick');
        root.classList.add('flying');
        ball.style.transform = `translate(calc(-50% + ${x * 30}vw), calc(-50% - 36vh - ${(result.height ?? 0.2) * 14}vh)) scale(0.18)`;
        cleanup();
        setTimeout(() => {
          root.remove();
          resolve(result);
        }, CLOSE_MS);
      };

      const lock = () => {
        if (done || locked) return;
        locked = true;
        if (stage === 'aim') {
          result.x = x;
          arrow.classList.add('locked');
          this.sounds?.tick();
          setTimeout(() => setStage(spec.kind === 'shot' ? 'height' : 'timing'), STAGE_PAUSE_MS);
        } else if (stage === 'height') {
          result.height = h;
          varrow.classList.add('locked');
          this.sounds?.tick();
          setTimeout(() => setStage('timing'), STAGE_PAUSE_MS);
        } else if (stage === 'timing') {
          cursor.classList.add('locked');
          finish();
        }
      };

      const onTap = (e: PointerEvent) => {
        e.preventDefault();
        lock();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          lock();
        }
      };
      root.addEventListener('pointerdown', onTap);
      root.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('keydown', onKey);

      this.abort = () => {
        if (done) return;
        cleanup();
        root.remove();
        resolve(null);
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Backdrop: a tiny pixel painting of the pitch from behind the kicker
// ---------------------------------------------------------------------------

const W = 192;
const H = 128;

function paintBackdrop(canvas: HTMLCanvasElement, goal: SetPieceSpec['goal']): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const horizon = 46;
  const vx = goal === 'left' ? 58 : goal === 'right' ? 134 : W / 2;

  // Sky and the far stand: two bands of sky, a dark dithered terrace with a lighter rim.
  ctx.fillStyle = '#5a7fb0';
  ctx.fillRect(0, 0, W, 18);
  ctx.fillStyle = '#7b9ccc';
  ctx.fillRect(0, 18, W, 8);
  ctx.fillStyle = '#2a2f4a';
  ctx.fillRect(0, 26, W, horizon - 26);
  for (let y = 27; y < horizon - 2; y += 2) {
    for (let x = (y % 4 === 1 ? 1 : 3); x < W; x += 4) {
      ctx.fillStyle = ['#c9b6a0', '#8a6a5a', '#d8d2c2', '#5a6a8a'][(x * 7 + y * 13) % 4];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = '#e7e2d4';
  ctx.fillRect(0, horizon - 2, W, 1);
  ctx.fillStyle = '#1b2a44';
  ctx.fillRect(0, horizon - 1, W, 1);

  // Grass: stripes converging on the vanishing point.
  ctx.fillStyle = '#35823f';
  ctx.fillRect(0, horizon, W, H - horizon);
  const stripes = 9;
  const spread = W * 2.4;
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 0) continue;
    const x0 = vx - spread / 2 + (spread / stripes) * i;
    const x1 = x0 + spread / stripes;
    ctx.fillStyle = '#3c8f47';
    ctx.beginPath();
    ctx.moveTo(vx - 1, horizon);
    ctx.lineTo(vx + 1, horizon);
    ctx.lineTo(x1, H);
    ctx.lineTo(x0, H);
    ctx.closePath();
    ctx.fill();
  }

  // Lines and the goal.
  ctx.fillStyle = '#eef2e6';
  if (goal === 'none') {
    // A throw-in: the far touchline runs across the horizon.
    ctx.fillRect(0, horizon + 2, W, 1);
    return;
  }
  const gw = goal === 'ahead' ? 54 : 32;
  const gh = goal === 'ahead' ? 19 : 11;
  const gy = horizon + 1;
  const gx = vx - gw / 2;
  // The goal line and the six-yard box.
  ctx.fillRect(0, gy + gh, W, 1);
  ctx.fillRect(gx - 14, gy + gh, 1, 7);
  ctx.fillRect(gx + gw + 14, gy + gh, 1, 7);
  ctx.fillRect(gx - 14, gy + gh + 7, gw + 29, 1);
  // Net: a dim grid, then the frame on top.
  ctx.fillStyle = 'rgba(240, 240, 240, 0.35)';
  for (let x = gx; x <= gx + gw; x += 3) ctx.fillRect(x, gy, 1, gh);
  for (let y = gy; y <= gy + gh; y += 3) ctx.fillRect(gx, y, gw, 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(gx, gy, 2, gh);
  ctx.fillRect(gx + gw - 1, gy, 2, gh);
  ctx.fillRect(gx, gy, gw + 1, 2);
}
