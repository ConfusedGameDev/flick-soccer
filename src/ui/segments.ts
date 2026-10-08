/**
 * Dual-screen detection (M9). Reads the viewport segments a foldable or
 * two-screen device reports and splits them into the *pane* screen (HUD bars,
 * panels, menus, overlays) and the *pitch* screen (the canvas pitch only).
 *
 * Postures: `book` = two screens side by side (vertical hinge): pane left,
 * pitch right. `laptop` = two screens stacked (horizontal hinge): pitch top,
 * pane bottom, like a DS. `single` = everything else, which leaves the normal
 * one-screen layouts untouched.
 *
 * Sources, in order: `window.viewport.segments` (Viewport Segments API),
 * `visualViewport.segments` (older Chromium), `getWindowSegments()` (Surface
 * Duo), then the CSS `viewport-segment-*` env() values. For testing on a
 * single screen, `?segments=book` / `?segments=laptop` (or the same value under
 * localStorage `flicksoccer.segments`) fakes a hinge down the middle.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Posture = 'single' | 'book' | 'laptop';

export interface Screens {
  posture: Posture;
  pane: Rect;
  pitch: Rect;
}

const FAKE_HINGE_PX = 24;
const MEDIA = ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)'];

function viewportRect(): Rect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

function toRect(r: { x?: number; left?: number; y?: number; top?: number; width: number; height: number }): Rect {
  return { x: r.x ?? r.left ?? 0, y: r.y ?? r.top ?? 0, width: r.width, height: r.height };
}

function overridePosture(): 'book' | 'laptop' | null {
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('segments') ?? localStorage.getItem('flicksoccer.segments');
  } catch {
    /* no storage */
  }
  // Build-time override for native test builds, where there is no URL to edit: VITE_SEGMENTS=book npm run build.
  v ??= (import.meta.env.VITE_SEGMENTS as string | undefined) ?? null;
  return v === 'book' || v === 'laptop' ? v : null;
}

function fakeSegments(posture: 'book' | 'laptop'): Rect[] {
  const { width: w, height: h } = viewportRect();
  const g = FAKE_HINGE_PX;
  if (posture === 'book') {
    const sw = (w - g) / 2;
    return [
      { x: 0, y: 0, width: sw, height: h },
      { x: sw + g, y: 0, width: sw, height: h },
    ];
  }
  const sh = (h - g) / 2;
  return [
    { x: 0, y: 0, width: w, height: sh },
    { x: 0, y: sh + g, width: w, height: sh },
  ];
}

/** Segment rects from the CSS env() variables, for engines that only expose those. */
function envSegments(): Rect[] | null {
  const horizontal = matchMedia(MEDIA[0]).matches;
  const vertical = matchMedia(MEDIA[1]).matches;
  if (!horizontal && !vertical) return null;
  const read = (x: number, y: number): Rect => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;left:env(viewport-segment-left ${x} ${y});top:env(viewport-segment-top ${x} ${y});width:env(viewport-segment-width ${x} ${y});height:env(viewport-segment-height ${x} ${y})`;
    document.body.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const second = horizontal ? read(1, 0) : read(0, 1);
  if (second.width <= 0 || second.height <= 0) return null;
  return [read(0, 0), second];
}

function rawSegments(): Rect[] | null {
  const w = window as unknown as {
    viewport?: { segments?: ArrayLike<DOMRectReadOnly> | null };
    visualViewport?: { segments?: ArrayLike<DOMRectReadOnly> | null };
    getWindowSegments?: () => ArrayLike<DOMRectReadOnly>;
  };
  const list = w.viewport?.segments ?? w.visualViewport?.segments ?? (typeof w.getWindowSegments === 'function' ? w.getWindowSegments() : null);
  if (list && list.length === 2) return Array.from(list, toRect);
  try {
    return envSegments();
  } catch {
    return null;
  }
}

/** Current screens; `single` whenever there are not exactly two usable segments. */
export function readScreens(): Screens {
  const single: Screens = { posture: 'single', pane: viewportRect(), pitch: viewportRect() };
  const forced = overridePosture();
  const segs = forced ? fakeSegments(forced) : rawSegments();
  if (!segs || segs.some((r) => r.width < 120 || r.height < 120)) return single;
  const [a, b] = segs;
  const sideBySide = Math.abs(a.y - b.y) < 2 && Math.abs(a.x - b.x) >= 2;
  const stacked = Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) >= 2;
  if (sideBySide) {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    return { posture: 'book', pane: left, pitch: right };
  }
  if (stacked) {
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    return { posture: 'laptop', pane: bottom, pitch: top };
  }
  return single;
}

/**
 * Publish the screens to CSS: `html[data-posture]` plus `--pane-*` and
 * `--pitch-*` px variables (x, y, w, h). Returns the screens for convenience.
 */
export function applyScreens(s: Screens): Screens {
  const root = document.documentElement;
  if (s.posture === 'single') {
    delete root.dataset.posture;
    return s;
  }
  root.dataset.posture = s.posture;
  const put = (name: string, r: Rect) => {
    root.style.setProperty(`--${name}-x`, `${r.x}px`);
    root.style.setProperty(`--${name}-y`, `${r.y}px`);
    root.style.setProperty(`--${name}-w`, `${r.width}px`);
    root.style.setProperty(`--${name}-h`, `${r.height}px`);
  };
  put('pane', s.pane);
  put('pitch', s.pitch);
  return s;
}

/** True while a two-screen layout is applied. */
export function isDualScreen(): boolean {
  return !!document.documentElement.dataset.posture;
}

/** Call `cb` when the segment media features flip (a fold or unfold without a resize). */
export function onSegmentsChange(cb: () => void): void {
  for (const q of MEDIA) {
    try {
      matchMedia(q).addEventListener('change', cb);
    } catch {
      /* unsupported feature: resize covers it */
    }
  }
}
