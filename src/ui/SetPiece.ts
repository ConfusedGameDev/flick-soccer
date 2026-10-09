import { statFactor } from '../engine/pool';
import { GOAL_W, OVER_BAR, PITCH_L, PITCH_W } from '../engine/pitch';
import type { MatchState, Team } from '../engine/types';
import { hex, type Kit } from '../render/kits';
import { lookFor, paintNumber, paintSprite, spriteCanvas, spriteSize } from '../render/sprites';

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
  /** Where the goal is: ahead of the kicker (shots), to their left or right (corners), or out of view. */
  goal: 'ahead' | 'left' | 'right' | 'none';
  /** The match as it stands, for the minimap (corners and throw-ins). */
  map?: { state: MatchState; kits: Partial<Record<Team, Kit>> };
  /** One-line coaching shown under the title (first time only). */
  hint?: string;
  /** Shots: the kicker's shirt number, painted on his back. */
  number?: number;
  /**
   * Shots: the defending keeper as he stands in the match. `x` is his offset from the goal
   * centre in half goal widths, screen-right positive (as seen from behind the kicker);
   * `depth` is how far off his line he is, 0 on the line and 1 at the ball.
   */
  goalie?: { kit: Kit; name: string; x: number; depth: number };
  /** Shots: the ball's offset from the goal centre in half goal widths, screen-right positive. */
  offset?: number;
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

/** How the DOM arrow sits on screen: its rest angle, how far it swings (deg) and which way +x turns it. */
interface ArrowFrame {
  base: number;
  sweep: number;
  sign: 1 | -1;
}

// ---- Corner view geometry (in backdrop pixels; mirrored when the goal is on the kicker's left) ----
/** The corner flag, with the goal line running left from it and the touchline climbing up-left. */
const FLAG = { x: 160, y: 84 };
/** Screen angle of the touchline above the goal line: the pitch's 90° corner drawn foreshortened. */
const TOUCHLINE_DEG = 55;
/** Pixels per metre along the goal line and along the touchline. */
const ALONG_GOAL = 3;
const ALONG_TOUCH = 2.2;
/** The kicker's rest aim, 45° between the goal line and the touchline, as an angle from "up" on screen. */
const CORNER_BASE_DEG = 90 - 45 * (TOUCHLINE_DEG / 90);
/** The ±35° world sweep of a corner (LocalController.restartFrame), foreshortened like the touchline. */
const CORNER_SWEEP_DEG = (35 * TOUCHLINE_DEG) / 90;

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
          ${spec.map ? '<canvas class="sp-map" data-map></canvas>' : ''}
        </div>`;
      this.overlay.appendChild(root);

      const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
      const stageEl = q('[data-stage]');
      const hintEl = q('[data-hint]');
      const figure = q('[data-figure]');
      const ball = q('[data-ball]');
      const pivot = q('[data-pivot]');
      const arrow = q('[data-arrow]');
      const gauge = q('[data-gauge]');
      const varrow = q('[data-varrow]');
      const bar = q('[data-bar]');
      const block = q('[data-block]');
      const cursor = q('[data-cursor]');
      const resultEl = q('[data-result]');

      const canvas = q<HTMLCanvasElement>('[data-canvas]');
      // Shots get the full ISS-style scene on the canvas (goal, keeper, kicker, aim);
      // corners and throw-ins keep the backdrop with the DOM figure and arrow.
      const scene = spec.kind === 'shot' ? new ShotScene(canvas, spec, q('.sp-top'), q('.sp-bottom')) : null;
      let frame: ArrowFrame = { base: 0, sweep: AIM_SWEEP_DEG, sign: 1 };
      const corner = spec.kind === 'corner';
      if (corner) {
        // The flag from above and behind: the goal line runs away along the bottom, the touchline
        // climbs into the pitch. Mirrored when the goal is on the kicker's left.
        const flagRight = spec.goal !== 'left';
        paintCorner(canvas, flagRight);
        const k = Math.max(2, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 250));
        figure.appendChild(spriteCanvas('hero-back', spec.kit, spec.keeper, k, lookFor(spec.name)));
        const fx = ((flagRight ? FLAG.x : W - FLAG.x) / W) * 100;
        const fy = (FLAG.y / H) * 100;
        for (const el of [ball, pivot]) {
          el.style.left = `${fx}%`;
          el.style.top = `${fy}%`;
          el.style.bottom = 'auto';
          el.style.marginLeft = '0';
        }
        figure.style.left = `${fx + (flagRight ? 2.5 : -2.5)}%`;
        figure.style.top = `${fy - 7}%`;
        figure.style.bottom = 'auto';
        figure.style.transform = flagRight ? 'translateX(0)' : 'translateX(-100%)';
        // Rest angle points into the pitch toward the box. +x is the kicker's right: toward the goal
        // line when the goal is on their right (flag drawn at the right), toward the touchline otherwise.
        frame = { base: flagRight ? -CORNER_BASE_DEG : CORNER_BASE_DEG, sweep: CORNER_SWEEP_DEG, sign: -1 };
      } else if (!scene) {
        paintBackdrop(canvas, spec.goal);
        const k = Math.max(2, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 200));
        figure.appendChild(spriteCanvas('hero-back', spec.kit, spec.keeper, k, lookFor(spec.name)));
      }
      if (spec.map) paintMap(q<HTMLCanvasElement>('[data-map]'), spec.map.state, spec.map.kits, spec.kit);
      const angle = () => frame.base + frame.sign * x * frame.sweep;
      // The posts mark the goal on the sweep so "inside" is visible while aiming.
      root.style.setProperty('--post-deg', `${GOAL_FRACTION * frame.sweep}deg`);
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
        arrow.style.transform = `rotate(${angle()}deg)`;
        varrow.style.bottom = `${h * 100}%`;
        varrow.classList.toggle('over', h > OVER_BAR);
        cursor.style.left = `${c * 100}%`;
        scene?.draw(now, stage, x, h, stage === 'aim' ? !locked : stage === 'height' && !locked);
      };

      const loop = (now: number) => {
        if (done) return;
        paint(now);
        raf = requestAnimationFrame(loop);
      };
      paint(stageStart);
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
        if (scene) {
          scene.kick(performance.now(), result.x, result.height ?? 0.2);
          const fly = (now: number) => {
            if (!root.isConnected) return;
            scene.draw(now, 'done', result.x, result.height ?? 0.2, false);
            requestAnimationFrame(fly);
          };
          requestAnimationFrame(fly);
        }
        // The DOM ball (corners, throw-ins) flies off along the arrow.
        const rad = (angle() * Math.PI) / 180;
        const reach = corner ? 24 : 36;
        ball.style.transform = `translate(calc(-50% + ${(Math.sin(rad) * reach).toFixed(1)}vh), calc(-50% - ${(Math.cos(rad) * reach).toFixed(1)}vh)) scale(${corner ? 0.5 : 0.18})`;
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
// Shot scene: the whole view painted on one pixel canvas, ISS Deluxe style
// ---------------------------------------------------------------------------

const C = {
  outline: '#141420',
  accent: '#ffd447',
  accent2: '#ff6b3d',
  cream: '#f4f1e6',
  grassA: '#2f8a3a',
  grassB: '#3a9a48',
  line: '#eef2e6',
  track: '#b4643c',
  trackDark: '#9a5232',
  net: 'rgba(235, 240, 235, 0.55)',
  netDim: 'rgba(235, 240, 235, 0.28)',
  shadow: 'rgba(0, 0, 0, 0.32)',
};
const BOARD_COLOURS = ['#1d3f8f', '#c8202a', '#f2f2f2', '#1d7a3a', '#f2c230', '#2a2a6a'];
const FLY_MS = 650;

/**
 * Paints the shot at an integer pixel scale, sized to the screen (never stretched). The goal
 * mouth on the canvas is the aim: the arrow's target is `x / GOAL_FRACTION` half goal widths
 * from the centre, which is exactly where LocalController.shoot sends the ball, so the
 * drawn posts are the real posts. The keeper stands where he is in the match.
 */
/** The kicker figure the shot scene can afford between the top and bottom bars, and where his goal line goes. */
export function pickFigures(W: number, avail: number, topY: number, botY: number): { pose: 'hero-back' | 'back'; s: number; w: number; h: number; gl: number } {
  const feet = Math.round(botY - 2);
  const candidates: ['hero-back' | 'back', number][] = [];
  if (W >= 230 && avail > 260) candidates.push(['hero-back', 2]);
  candidates.push(['hero-back', 1], ['back', 1]);
  // Built up from the kicker's feet, as in ISS: the goal line sits a little above his head.
  for (const [pose, s] of candidates) {
    const [w, h] = spriteSize(pose);
    const gl = feet - h * s - Math.max(6, Math.round(h * s * 0.22));
    if (gl - topY >= 40) return { pose, s, w: w * s, h: h * s, gl };
  }
  const [w, h] = spriteSize('back');
  return { pose: 'back', s: 1, w, h, gl: feet - h - 6 };
}

class ShotScene {
  private readonly k: number;
  private readonly W: number;
  private readonly H: number;
  private readonly bg: HTMLCanvasElement;
  /** The kicker, drawn over the aim arrow so it comes out from behind him. */
  private readonly fg: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private gcx = 0;
  private gw = 0;
  private gh = 0;
  /** y of the goal line. */
  private gl = 0;
  private ballX = 0;
  private ballY = 0;
  private kickAt = -1;
  private kickTarget = { x: 0, y: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly spec: SetPieceSpec,
    top: HTMLElement,
    bottom: HTMLElement,
  ) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.k = Math.max(2, Math.floor(Math.min(vw / 180, vh / 180)));
    this.W = Math.ceil(vw / this.k);
    this.H = Math.ceil(vh / this.k);
    canvas.width = this.W;
    canvas.height = this.H;
    canvas.style.width = `${this.W * this.k}px`;
    canvas.style.height = `${this.H * this.k}px`;
    canvas.style.inset = '0 auto auto 0';
    this.ctx = canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = this.W;
    this.bg.height = this.H;
    this.fg = document.createElement('canvas');
    this.fg.width = this.W;
    this.fg.height = this.H;
    this.paint(top.offsetHeight / this.k, this.H - bottom.offsetHeight / this.k);
  }

  /** Where an aim (x on the ±1 sweep) and a height (0..1, OVER_BAR = the bar) land on the goal plane. */
  private target(x: number, h: number): { x: number; y: number } {
    return { x: this.gcx + (x / GOAL_FRACTION) * (this.gw / 2), y: this.gl - (h / OVER_BAR) * this.gh };
  }

  private paint(topY: number, botY: number): void {
    const { W, H } = this;
    const g = this.bg.getContext('2d')!;
    const avail = Math.max(60, botY - topY);
    const fig = pickFigures(W, avail, topY, botY);
    const ks = fig.s;
    const feet = Math.round(botY - 2);
    // On tall screens the goal stays in the upper half rather than leaving a wall of crowd.
    const gl = Math.min(fig.gl, Math.round(topY + avail * 0.5));
    let gw = Math.round(Math.min(W * 0.86, 240));
    if (gl - Math.round(gw / 3) < topY + 6) gw = Math.max(48, 3 * (gl - topY - 6));
    const gh = Math.round(gw / 3);
    const goalTop = gl - gh;
    const offset = Math.max(-2.5, Math.min(2.5, this.spec.offset ?? 0));
    const gcx = Math.round(Math.max(gw / 2 + 4, Math.min(W - gw / 2 - 4, W / 2 - offset * (gw / 2) * 0.6)));
    Object.assign(this, { gcx, gw, gh, gl });

    // Crowd: a dithered terrace of faces and shirts, darker at the top.
    const boardsY = goalTop + Math.round(gh * 0.3);
    const boardH = Math.max(4, Math.round(gh * 0.22));
    g.fillStyle = '#1e2238';
    g.fillRect(0, 0, W, boardsY);
    const crowd = ['#c9b6a0', '#8a6a5a', '#d8d2c2', '#5a6a8a', '#b04a3a', '#e0c070', '#3a5a9a'];
    for (let y = 1; y < boardsY - 1; y++) {
      if (y % 5 === 4) continue; // tier steps
      for (let x = (y * 3) % 2; x < W; x += 2) {
        const r = (x * 7919 + y * 104729) % 97;
        if (r < 30) continue;
        g.fillStyle = crowd[r % crowd.length];
        g.fillRect(x, y, 1, 1);
      }
    }
    // Advertising boards behind the goal.
    for (let x = 0, i = 0; x < W; i++) {
      const w = 20 + ((i * 37) % 14);
      const col = BOARD_COLOURS[i % BOARD_COLOURS.length];
      g.fillStyle = col;
      g.fillRect(x, boardsY, w, boardH);
      g.fillStyle = col === '#f2f2f2' || col === '#f2c230' ? '#1d3f8f' : '#f2f2f2';
      for (let t = x + 3; t < x + w - 3; t += 3) if ((t * 13 + i) % 5 !== 0) g.fillRect(t, boardsY + Math.floor(boardH / 2) - 1, 2, Math.min(2, boardH - 2));
      g.fillStyle = C.outline;
      g.fillRect(x + w - 1, boardsY, 1, boardH);
      x += w;
    }
    g.fillStyle = C.outline;
    g.fillRect(0, boardsY + boardH, W, 1);
    // Running track, then the grass in perspective bands.
    const grassY = gl - Math.round(gh * 0.28);
    g.fillStyle = C.track;
    g.fillRect(0, boardsY + boardH + 1, W, grassY - boardsY - boardH - 1);
    g.fillStyle = C.trackDark;
    for (let y = boardsY + boardH + 3; y < grassY; y += 3) g.fillRect(0, y, W, 1);
    let y = grassY;
    for (let i = 0; y < H; i++) {
      const band = Math.max(2, Math.round(3 + i * i * 0.9));
      g.fillStyle = i % 2 ? C.grassA : C.grassB;
      g.fillRect(0, y, W, band);
      y += band;
    }

    // Lines: the goal line, the six-yard box and the penalty area, widening toward the camera.
    g.fillStyle = C.line;
    g.fillRect(0, gl, W, 1);
    const slant = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
    };
    const box = (half: number, depth: number) => {
      const yb = gl + depth;
      const spread = depth * 0.6;
      slant(gcx - half, gl, gcx - half - spread, yb);
      slant(gcx + half, gl, gcx + half + spread, yb);
      if (yb < H) g.fillRect(Math.round(gcx - half - spread), yb, Math.round(2 * (half + spread)) + 1, 1);
    };
    box(gw * 0.83, Math.round(gh * 0.55));
    box(gw * 2.2, Math.round(gh * 2.3));

    this.paintGoal(g, goalTop);

    // The keeper, where he stands: on his line by default, coming out toward the ball with depth.
    const kicker = { w: fig.w, h: fig.h };
    const kx = Math.round(W / 2 - kicker.w * (fig.pose === 'hero-back' ? 0.72 : 0.85));
    const ky = feet - kicker.h;
    this.ballX = Math.round(W / 2 + 3 * ks);
    this.ballY = feet - 3 * ks;
    const gk = this.spec.goalie;
    if (gk) {
      const depth = Math.max(0, Math.min(0.8, gk.depth));
      const gx = gcx + Math.max(-1.6, Math.min(1.6, gk.x)) * (gw / 2);
      const fx = Math.round(gx + (this.ballX - gx) * depth);
      const fy = Math.round(gl + (this.ballY - gl) * depth) + 1;
      g.fillStyle = C.shadow;
      if (gh >= 44 || depth > 0.45) {
        // The big crouched keeper fills a goal this size, as in ISS's penalty view.
        const [hw, hh] = spriteSize('hero-ready');
        g.fillRect(fx - Math.round(hw * 0.3), fy - 1, Math.round(hw * 0.6), 2);
        paintSprite(g, 'hero-ready', gk.kit, true, fx - Math.round(hw / 2), fy - hh, 1, lookFor(gk.name));
      } else {
        g.fillRect(fx - 6, fy - 1, 12, 2);
        paintSprite(g, 'ready', gk.kit, true, fx - 8, fy - 24, 1, lookFor(gk.name));
      }
    }
    // The kicker from behind, his shadow and his number, on the foreground layer.
    g.fillStyle = C.shadow;
    g.fillRect(kx + Math.round(kicker.w * 0.2), feet - 1, Math.round(kicker.w * 0.6), 2 * ks);
    const f = this.fg.getContext('2d')!;
    paintSprite(f, fig.pose, this.spec.kit, this.spec.keeper, kx, ky, ks, lookFor(this.spec.name));
    if (this.spec.number != null) paintNumber(f, this.spec.kit, this.spec.keeper, kx, ky, ks, this.spec.number, fig.pose);
  }

  private paintGoal(g: CanvasRenderingContext2D, goalTop: number): void {
    const { gcx, gw, gh, gl } = this;
    const l = Math.round(gcx - gw / 2);
    const r = Math.round(gcx + gw / 2);
    // The back of the net sits higher (further away) and a little narrower.
    const back = Math.round(gh * 0.3);
    const inset = Math.round(gw * 0.04);
    const bl = l + inset;
    const br = r - inset;
    const bTop = goalTop - Math.round(back * 0.25);
    const bBot = gl - back;
    g.fillStyle = 'rgba(20, 30, 20, 0.35)';
    g.fillRect(bl, bTop, br - bl, bBot - bTop);
    // Back net: a square mesh.
    g.fillStyle = C.netDim;
    for (let x = bl; x <= br; x += 3) g.fillRect(x, bTop, 1, bBot - bTop);
    for (let y = bTop; y <= bBot; y += 3) g.fillRect(bl, y, br - bl, 1);
    // Roof and side nets: lines from the frame to the back.
    g.fillStyle = C.net;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      // sides
      for (const [fx, bx] of [
        [l, bl],
        [r, br],
      ]) {
        const yTop = Math.round(goalTop + (bTop - goalTop) * t);
        const yBot = Math.round(gl + (bBot - gl) * t);
        const x = Math.round(fx + (bx - fx) * t);
        g.fillRect(x, yTop, 1, yBot - yTop);
      }
    }
    g.fillRect(bl, bBot, br - bl, 1);
    // Frame: posts and bar, white with a grey shade on the right.
    g.fillStyle = C.outline;
    g.fillRect(l - 1, goalTop - 1, 4, gl - goalTop + 2);
    g.fillRect(r - 2, goalTop - 1, 4, gl - goalTop + 2);
    g.fillRect(l - 1, goalTop - 1, r - l + 3, 4);
    g.fillStyle = '#ffffff';
    g.fillRect(l, goalTop, 2, gl - goalTop);
    g.fillRect(r - 1, goalTop, 2, gl - goalTop);
    g.fillRect(l, goalTop, r - l + 1, 2);
    g.fillStyle = '#c8ccd2';
    g.fillRect(l + 1, goalTop + 2, 1, gl - goalTop - 2);
    g.fillRect(r, goalTop + 2, 1, gl - goalTop - 2);
    g.fillRect(l, goalTop + 1, r - l + 1, 1);
  }

  kick(now: number, x: number, h: number): void {
    this.kickAt = now;
    this.kickTarget = this.target(x, h);
  }

  /** One frame: the painted backdrop, then the aim (while aiming or setting the height) and the ball. */
  draw(now: number, stage: Stage, x: number, h: number, live: boolean): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    c.drawImage(this.bg, 0, 0);
    if (this.kickAt >= 0) {
      const t = Math.min(1, (now - this.kickAt) / FLY_MS);
      const e = 1 - (1 - t) * (1 - t);
      const tx = this.kickTarget.x;
      const ty = this.kickTarget.y;
      const bx = this.ballX + (tx - this.ballX) * e;
      const by = this.ballY + (ty - this.ballY) * e - Math.sin(Math.PI * e) * this.gh * 0.25;
      c.drawImage(this.fg, 0, 0);
      this.ball(bx, by, 3.5 - 2 * e);
      return;
    }
    const tgt = this.target(x, stage === 'aim' ? 0.35 * OVER_BAR : h);
    const over = stage !== 'aim' && h > OVER_BAR;
    const col = !live ? C.cream : over ? C.accent2 : C.accent;
    this.arrow(this.ballX, this.ballY - 3, tgt.x, tgt.y, col);
    this.reticle(tgt.x, tgt.y, col);
    c.drawImage(this.fg, 0, 0);
    this.ball(this.ballX, this.ballY, 3.5);
  }

  private ball(x: number, y: number, r: number): void {
    const c = this.ctx;
    const d = Math.max(2, Math.round(r * 2));
    const px = Math.round(x - d / 2);
    const py = Math.round(y - d / 2);
    if (this.kickAt < 0) {
      c.fillStyle = C.shadow;
      c.fillRect(px, py + d - 1, d + 1, 2);
    }
    c.fillStyle = C.outline;
    c.fillRect(px, py, d, d);
    c.fillStyle = '#f8f8f8';
    c.fillRect(px + 1, py, d - 2, d);
    c.fillRect(px, py + 1, d, d - 2);
    if (d >= 5) {
      c.fillStyle = '#26262e';
      c.fillRect(px + Math.floor(d / 2), py + Math.floor(d / 2) - 1, 2, 2);
      c.fillRect(px + 1, py + d - 3, 1, 1);
    }
  }

  /** A thick pixel arrow from the ball toward the target, stopping short of it. */
  private arrow(x0: number, y0: number, x1: number, y1: number, col: string): void {
    const c = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    // Stop just short of the reticle, so the arrow points straight into it.
    const n = Math.max(8, Math.round(len - Math.max(3, Math.round(this.gh * 0.12)) - 3));
    for (const [fill, w] of [
      [C.outline, 4],
      [col, 2],
    ] as const) {
      c.fillStyle = fill;
      for (let i = 6; i <= n; i += 1) {
        const px = Math.round(x0 + (dx * i) / len) - w / 2;
        const py = Math.round(y0 + (dy * i) / len) - w / 2;
        c.fillRect(px, py, w, w);
      }
    }
    // Arrowhead: a small chevron at the tip.
    const ux = dx / len;
    const uy = dy / len;
    const tx = x0 + ux * n;
    const ty = y0 + uy * n;
    for (const [fill, grow] of [
      [C.outline, 1],
      [col, 0],
    ] as const) {
      c.fillStyle = fill;
      for (let i = 0; i < 5 + grow; i++) {
        for (const side of [-1, 1]) {
          const px = Math.round(tx - ux * i + -uy * side * i * 0.9);
          const py = Math.round(ty - uy * i + ux * side * i * 0.9);
          c.fillRect(px - grow, py - grow, 2 + grow * 2, 2 + grow * 2);
        }
      }
    }
  }

  /** Corner brackets around the aim point on the goal plane. */
  private reticle(x: number, y: number, col: string): void {
    const c = this.ctx;
    const r = Math.max(3, Math.round(this.gh * 0.12));
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (const [fill, o] of [
      [C.outline, 1],
      [col, 0],
    ] as const) {
      c.fillStyle = fill;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          c.fillRect(cx + sx * r - (sx > 0 ? 2 : 0) - o, cy + sy * r - o, 3 + o * 2, 1 + o * 2);
          c.fillRect(cx + sx * r - o, cy + sy * r - (sy > 0 ? 2 : 0) - o, 1 + o * 2, 3 + o * 2);
        }
      }
      c.fillRect(cx - o, cy - o, 1 + o * 2, 1 + o * 2);
    }
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

// ---------------------------------------------------------------------------
// Corner view: the flag from above and behind, and the minimap
// ---------------------------------------------------------------------------

const GRASS = '#35823f';
const GRASS_LIGHT = '#3c8f47';
const LINE = '#eef2e6';

/**
 * A corner: the flag at the right (or left, mirrored), the goal line running
 * away from it along the bottom with the goal in view, the touchline climbing
 * into the pitch, both boxes, and the track and terrace behind the lines.
 */
function paintCorner(canvas: HTMLCanvasElement, flagRight: boolean): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  if (!flagRight) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const { x: fx, y: fy } = FLAG;
  const rad = (TOUCHLINE_DEG * Math.PI) / 180;
  const tdx = -Math.cos(rad);
  const tdy = -Math.sin(rad);
  /** The point `g` metres along the goal line (toward the goal) and `t` metres up the touchline direction. */
  const at = (g: number, t: number) => ({ x: fx - g * ALONG_GOAL + t * ALONG_TOUCH * tdx, y: fy + t * ALONG_TOUCH * tdy });
  const top = at(0, fy / -tdy / ALONG_TOUCH);

  // Out of bounds beyond the goal line: a grass margin, the track, the terrace.
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c47a2b';
  ctx.fillRect(0, fy + 7, W, H - fy - 7);
  ctx.fillStyle = '#d99a4a';
  ctx.fillRect(0, fy + 9, W, 1);
  ctx.fillRect(0, fy + 15, W, 1);
  ctx.fillStyle = '#2a2f4a';
  ctx.fillRect(0, fy + 22, W, H - fy - 22);
  for (let y = fy + 23; y < H; y += 2) {
    for (let x = y % 4 === 1 ? 1 : 3; x < W; x += 4) {
      ctx.fillStyle = ['#c9b6a0', '#8a6a5a', '#d8d2c2', '#5a6a8a'][(x * 7 + y * 13) % 4];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Beyond the touchline: darker grass, then the track along the edge.
  ctx.fillStyle = '#2f7236';
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(top.x, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, fy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c47a2b';
  ctx.fillRect(fx + 20, 0, W - fx - 20, fy + 7);

  // Stripes parallel to the touchline, clipped to the pitch.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(top.x, 0);
  ctx.lineTo(0, 0);
  ctx.lineTo(0, fy);
  ctx.closePath();
  ctx.clip();
  const span = 14 / ALONG_GOAL;
  for (let i = 1; i < 14; i += 2) {
    const a = at(i * span, 0);
    const b = at((i + 1) * span, 0);
    const a2 = at(i * span, 60);
    const b2 = at((i + 1) * span, 60);
    ctx.fillStyle = GRASS_LIGHT;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Lines: goal line, touchline, corner arc, both boxes.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  line({ x: 0, y: fy }, { x: fx, y: fy });
  line({ x: fx, y: fy }, { x: top.x, y: 0 });
  ctx.beginPath();
  ctx.arc(fx, fy, 8, Math.PI, Math.PI + rad);
  ctx.stroke();
  const nearPost = (PITCH_W - GOAL_W) / 2;
  for (const [edge, depth] of [
    [16.5, 16.5],
    [5.5, 5.5],
  ] as const) {
    const g0 = nearPost - edge;
    const g1 = nearPost + GOAL_W + edge;
    line(at(g0, 0), at(g0, depth));
    line(at(g0, depth), at(g1, depth));
    line(at(g1, depth), at(g1, 0));
  }

  // The goal, seen along its line: posts on the goal line, the net behind it.
  const p0 = at(nearPost, 0);
  const p1 = at(nearPost + GOAL_W, 0);
  ctx.fillStyle = 'rgba(240, 240, 240, 0.4)';
  for (let x = Math.round(p1.x); x <= p0.x; x += 2) ctx.fillRect(x, fy, 1, 7);
  for (let y = fy; y < fy + 7; y += 2) ctx.fillRect(p1.x, y, p0.x - p1.x, 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(p1.x), fy - 2, 2, 9);
  ctx.fillRect(Math.round(p0.x) - 1, fy - 2, 2, 9);
  ctx.fillRect(Math.round(p1.x), fy - 2, p0.x - p1.x + 1, 2);

  // The corner flag: a pole with a little pennant.
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(fx - 1, fy - 12, 2, 12);
  ctx.fillStyle = '#ffd447';
  ctx.beginPath();
  ctx.moveTo(fx + 1, fy - 12);
  ctx.lineTo(fx + 8, fy - 9);
  ctx.lineTo(fx + 1, fy - 6);
  ctx.closePath();
  ctx.fill();
}

/**
 * The minimap: the whole pitch, landscape, with the kicker's side attacking to
 * the right. Dots in jersey colours, the taker ringed, the ball white.
 */
function paintMap(canvas: HTMLCanvasElement, state: MatchState, kits: Partial<Record<Team, Kit>>, fallback: Kit): void {
  const S = 2;
  const M = 4;
  canvas.width = PITCH_L * S + M * 2;
  canvas.height = PITCH_W * S + M * 2;
  const ctx = canvas.getContext('2d')!;
  const team = state.possession.team;
  const toMap = (p: { x: number; y: number }) => ({
    x: M + (team === 'home' ? p.y : PITCH_L - p.y) * S,
    y: M + (team === 'home' ? PITCH_W - p.x : p.x) * S,
  });

  ctx.fillStyle = '#2f7a3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(240, 245, 230, 0.8)';
  ctx.lineWidth = 1;
  const rect = (x: number, y: number, w: number, h: number) => ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  rect(M, M, PITCH_L * S, PITCH_W * S);
  ctx.beginPath();
  ctx.moveTo(M + (PITCH_L / 2) * S + 0.5, M);
  ctx.lineTo(M + (PITCH_L / 2) * S + 0.5, M + PITCH_W * S);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(M + (PITCH_L / 2) * S, M + (PITCH_W / 2) * S, 9.15 * S, 0, Math.PI * 2);
  ctx.stroke();
  for (const dir of [1, -1] as const) {
    const x0 = dir > 0 ? M : M + PITCH_L * S;
    const box = (depth: number, half: number) => rect(dir > 0 ? x0 : x0 - depth * S, M + (PITCH_W / 2 - half) * S, depth * S, half * 2 * S);
    box(16.5, 20.16);
    box(5.5, 9.16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dir > 0 ? x0 - 2 : x0, M + (PITCH_W / 2 - GOAL_W / 2) * S, 2, GOAL_W * S);
  }

  for (const p of state.players) {
    const kit = kits[p.team] ?? fallback;
    const { x, y } = toMap(p.pos);
    if (p.id === state.possession.playerId) {
      ctx.fillStyle = '#ffd447';
      ctx.fillRect(x - 3, y - 3, 7, 7);
    }
    ctx.fillStyle = '#141420';
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.fillStyle = hex(p.keeper ? kit.keeper.jersey : kit.jersey);
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  const b = toMap(state.ball);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(b.x - 1, b.y - 1, 3, 3);
}
