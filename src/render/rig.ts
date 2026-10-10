// Rig rasteriser for the big ISS-style cutscene figures. A pose is a list of
// body parts (capsules, ellipses, polygons and explicit marks) with a
// material each; `rasterise` turns it into the same ASCII letter grid the
// sprite painter reads, with shading from a top-left light, a dark outline and
// separation lines where a part overlaps another. Pure: no DOM, no RNG, so
// the figures are deterministic and unit-tested.

export type Material = 'skin' | 'hair' | 'jersey' | 'collar' | 'hands' | 'shorts' | 'socks' | 'boots' | 'ball';
export type Band = 'hi' | 'base' | 'shade' | 'deep';
export type Vec = [number, number];

/**
 * Every template letter: its material and tone. 1 is the base colour, a
 * fraction darkens it, above 1 lightens it, and 'alt' is the palette's second
 * colour (skin shade, hair highlight, glove shade, ball shade). The 0.86 mid
 * tones (m, n, o) only come from imported frames (scripts/import-frames.mjs).
 */
export const LETTERS: Record<string, { mat: Material | 'outline'; tone: number | 'alt' }> = {
  O: { mat: 'outline', tone: 1 },
  H: { mat: 'hair', tone: 1 },
  h: { mat: 'hair', tone: 'alt' },
  x: { mat: 'hair', tone: 0.72 },
  S: { mat: 'skin', tone: 1 },
  s: { mat: 'skin', tone: 'alt' },
  L: { mat: 'skin', tone: 1.12 },
  z: { mat: 'skin', tone: 0.62 },
  G: { mat: 'hands', tone: 1 },
  g: { mat: 'hands', tone: 'alt' },
  y: { mat: 'hands', tone: 0.55 },
  J: { mat: 'jersey', tone: 1 },
  j: { mat: 'jersey', tone: 0.72 },
  q: { mat: 'jersey', tone: 0.5 },
  I: { mat: 'jersey', tone: 1.15 },
  m: { mat: 'jersey', tone: 0.86 },
  C: { mat: 'collar', tone: 1 },
  c: { mat: 'collar', tone: 0.72 },
  P: { mat: 'shorts', tone: 1 },
  p: { mat: 'shorts', tone: 0.72 },
  w: { mat: 'shorts', tone: 0.5 },
  n: { mat: 'shorts', tone: 0.86 },
  K: { mat: 'socks', tone: 1 },
  k: { mat: 'socks', tone: 0.72 },
  v: { mat: 'socks', tone: 0.5 },
  o: { mat: 'socks', tone: 0.86 },
  B: { mat: 'boots', tone: 1 },
  b: { mat: 'boots', tone: 1.6 },
  W: { mat: 'ball', tone: 1 },
  e: { mat: 'ball', tone: 'alt' },
  D: { mat: 'ball', tone: 0.15 },
};

/** The letter of each shade band per material: [hi, base, shade, deep]. */
const BANDS: Record<Material, [string, string, string, string]> = {
  skin: ['L', 'S', 's', 'z'],
  hair: ['h', 'H', 'x', 'x'],
  jersey: ['I', 'J', 'j', 'q'],
  collar: ['C', 'C', 'c', 'c'],
  hands: ['G', 'G', 'g', 'y'],
  shorts: ['P', 'P', 'p', 'w'],
  socks: ['K', 'K', 'k', 'v'],
  boots: ['b', 'B', 'B', 'B'],
  ball: ['W', 'W', 'e', 'e'],
};

export const letterFor = (mat: Material, band: Band): string => BANDS[mat][band === 'hi' ? 0 : band === 'base' ? 1 : band === 'shade' ? 2 : 3];

interface PartBase {
  mat: Material;
  /** Painter's order, low first. */
  z: number;
  /** Parts sharing a seam get no separating outline between them (upper and lower arm, head and neck). */
  seam?: string;
  /** Skip the shading and use one band. */
  flat?: Band;
}
export type Part =
  | (PartBase & { kind: 'capsule'; a: Vec; b: Vec; r0: number; r1?: number })
  | (PartBase & { kind: 'ellipse'; c: Vec; rx: number; ry: number; clipAbove?: number; clipBelow?: number })
  | (PartBase & { kind: 'poly'; pts: Vec[]; axis?: [Vec, Vec]; axisR?: number })
  | (PartBase & { kind: 'marks'; at: Vec; cells: [number, number, string][] });

/** The shirt as an affine frame: `u` runs across the shoulders, `v` from the neck to the hem, both the full length. */
export interface JerseyFrame {
  origin: Vec;
  u: Vec;
  v: Vec;
}

export interface Rig {
  w: number;
  h: number;
  parts: Part[];
  jersey?: JerseyFrame;
  anchors?: { number?: Vec; ball?: Vec };
}

export interface RasterResult {
  rows: string[];
  jersey?: JerseyFrame;
  anchors: NonNullable<Rig['anchors']>;
}

/** Light from the top-left, in the picture plane. */
const LIGHT: Vec = [-0.6, -0.8];
const HI = 0.45;
const BASE = -0.2;
const SHADE = -0.65;

const bandOf = (d: number): Band => (d > HI ? 'hi' : d > BASE ? 'base' : d > SHADE ? 'shade' : 'deep');

/**
 * Light on a surface point given its offset from the axis or centre in units
 * of the radius. The offset is bent toward the rim so highlights stay a thin
 * crescent and the shade grows toward the far edge, as on a sphere.
 */
function lit(n: Vec): number {
  const rho = Math.hypot(n[0], n[1]);
  if (rho === 0) return 0;
  const k = Math.pow(rho, 1.6) / rho;
  return n[0] * k * LIGHT[0] + n[1] * k * LIGHT[1];
}

function inPoly(px: number, py: number, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Normal-ish offset of a point from a segment's axis, in units of the radius there; null when outside. */
function capsuleOffset(px: number, py: number, a: Vec, b: Vec, r0: number, r1: number, infinite = false): Vec | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  if (!infinite) t = Math.max(0, Math.min(1, t));
  const qx = a[0] + dx * t;
  const qy = a[1] + dy * t;
  const r = r0 + (r1 - r0) * Math.max(0, Math.min(1, t));
  if (r <= 0) return null;
  const ox = (px - qx) / r;
  const oy = (py - qy) / r;
  return ox * ox + oy * oy <= 1 ? [ox, oy] : null;
}

const mirrorPt = (p: Vec, w: number): Vec => [w - p[0], p[1]];

function mirrorPart(p: Part, w: number): Part {
  switch (p.kind) {
    case 'capsule':
      return { ...p, a: mirrorPt(p.a, w), b: mirrorPt(p.b, w) };
    case 'ellipse':
      return { ...p, c: mirrorPt(p.c, w) };
    case 'poly':
      return { ...p, pts: p.pts.map((q) => mirrorPt(q, w)), axis: p.axis ? [mirrorPt(p.axis[0], w), mirrorPt(p.axis[1], w)] : undefined };
    case 'marks':
      // Marks are whole cells: mirror the cell, not the continuous coordinate.
      return { ...p, at: [w - 1 - p.at[0], p.at[1]], cells: p.cells.map(([dx, dy, ch]) => [-dx, dy, ch]) };
  }
}

/**
 * Rasterise a rig into template rows. `flip` mirrors the pose before painting,
 * so the light still comes from the top-left.
 */
export function rasterise(rig: Rig, opts: { flip?: boolean } = {}): RasterResult {
  const { w, h } = rig;
  const parts = (opts.flip ? rig.parts.map((p) => mirrorPart(p, w)) : rig.parts).map((p, i) => ({ p, i })).sort((a, b) => a.p.z - b.p.z || a.i - b.i);
  const cells: string[] = new Array(w * h).fill('.');
  const owner = new Int16Array(w * h).fill(-1);
  const at = (x: number, y: number) => y * w + x;

  parts.forEach(({ p }, idx) => {
    const put = (x: number, y: number, ch: string) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      cells[at(x, y)] = ch;
      owner[at(x, y)] = idx;
    };
    const shaded = (x: number, y: number, n: Vec | null) => {
      const band: Band = p.flat ?? (n ? bandOf(lit(n)) : 'base');
      put(x, y, letterFor(p.mat, band));
    };
    if (p.kind === 'marks') {
      for (const [dx, dy, ch] of p.cells) put(p.at[0] + dx, p.at[1] + dy, ch);
      return;
    }
    // Only the part's bounding box is visited.
    let x0 = 0;
    let y0 = 0;
    let x1 = w - 1;
    let y1 = h - 1;
    if (p.kind === 'capsule') {
      const r = Math.max(p.r0, p.r1 ?? p.r0);
      x0 = Math.floor(Math.min(p.a[0], p.b[0]) - r);
      x1 = Math.ceil(Math.max(p.a[0], p.b[0]) + r);
      y0 = Math.floor(Math.min(p.a[1], p.b[1]) - r);
      y1 = Math.ceil(Math.max(p.a[1], p.b[1]) + r);
    } else if (p.kind === 'ellipse') {
      x0 = Math.floor(p.c[0] - p.rx);
      x1 = Math.ceil(p.c[0] + p.rx);
      y0 = Math.floor(Math.max(p.c[1] - p.ry, p.clipAbove ?? -Infinity));
      y1 = Math.ceil(Math.min(p.c[1] + p.ry, p.clipBelow ?? Infinity));
    } else {
      x0 = Math.floor(Math.min(...p.pts.map((q) => q[0])));
      x1 = Math.ceil(Math.max(...p.pts.map((q) => q[0])));
      y0 = Math.floor(Math.min(...p.pts.map((q) => q[1])));
      y1 = Math.ceil(Math.max(...p.pts.map((q) => q[1])));
    }
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (p.kind === 'capsule') {
          const n = capsuleOffset(px, py, p.a, p.b, p.r0, p.r1 ?? p.r0);
          if (n) shaded(x, y, n);
        } else if (p.kind === 'ellipse') {
          if (py < (p.clipAbove ?? -Infinity) || py > (p.clipBelow ?? Infinity)) continue;
          const nx = (px - p.c[0]) / p.rx;
          const ny = (py - p.c[1]) / p.ry;
          if (nx * nx + ny * ny <= 1) shaded(x, y, [nx, ny]);
        } else if (inPoly(px, py, p.pts)) {
          const n = p.axis ? capsuleOffset(px, py, p.axis[0], p.axis[1], p.axisR ?? 1, p.axisR ?? 1, true) : null;
          shaded(x, y, n ?? (p.axis ? [0, 0] : null));
        }
      }
    }
  });

  // Separation lines: where a part lies over a lower one with a different seam, its border goes dark.
  const seamOf = (idx: number) => parts[idx].p.seam;
  const isMarks = (idx: number) => parts[idx].p.kind === 'marks';
  const lines: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const me = owner[at(x, y)];
      if (me < 0 || isMarks(me)) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const other = owner[at(nx, ny)];
        if (other < 0 || other === me || isMarks(other)) continue;
        if (parts[other].p.z < parts[me].p.z && (seamOf(me) === undefined || seamOf(me) !== seamOf(other))) {
          lines.push(at(x, y));
          break;
        }
      }
    }
  }
  for (const i of lines) cells[i] = 'O';

  // Outer outline: every empty cell touching a painted one.
  const outline: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[at(x, y)] !== '.') continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && cells[at(nx, ny)] !== '.') {
            touch = true;
            break;
          }
        }
      }
      if (touch) outline.push(at(x, y));
    }
  }
  for (const i of outline) cells[i] = 'O';

  const rows: string[] = [];
  for (let y = 0; y < h; y++) rows.push(cells.slice(y * w, (y + 1) * w).join(''));
  const anchors: RasterResult['anchors'] = {};
  const mirrorCell = (p: Vec): Vec => (opts.flip ? [w - 1 - p[0], p[1]] : p);
  if (rig.anchors?.number) anchors.number = mirrorCell(rig.anchors.number);
  if (rig.anchors?.ball) anchors.ball = mirrorCell(rig.anchors.ball);
  let jersey = rig.jersey;
  if (jersey && opts.flip) jersey = { origin: mirrorPt(jersey.origin, w), u: [0 - jersey.u[0] || 0, jersey.u[1]], v: [0 - jersey.v[0] || 0, jersey.v[1]] };
  return { rows, jersey, anchors };
}

// ---------------------------------------------------------------------------
// Figures: a jointed body builder and the hero poses
// ---------------------------------------------------------------------------

interface Joints {
  head: Vec;
  /** Head radii; the figure's scale follows from them. */
  headR?: [number, number];
  /** Viewer's left first. */
  shoulders: [Vec, Vec];
  elbows: [Vec, Vec];
  hands: [Vec, Vec];
  hips: [Vec, Vec];
  knees: [Vec, Vec];
  ankles: [Vec, Vec];
  /** Toe tips; default points the feet outward. */
  toes?: [Vec, Vec];
  /** Which arm and leg (0 left, 1 right) is nearer the viewer. */
  front?: { arm: 0 | 1; leg: 0 | 1 };
  face: 'front' | 'back';
  /** Optional ball drawn as part of the figure (held or at the feet). */
  ball?: { c: Vec; r: number; z: number };
}

const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Z layers, back to front. */
const Z = { backLeg: 3, backArm: 4, torso: 10, shorts: 11, frontLeg: 12, neck: 13, collar: 14, head: 15, hair: 16, face: 17, frontArm: 18, ball: 20 };

function arm(j: Joints, side: 0 | 1, z: number): Part[] {
  const s = j.shoulders[side];
  const e = j.elbows[side];
  const hd = j.hands[side];
  const seam = `arm${side}`;
  const sleeveEnd = lerp(s, e, 0.5);
  return [
    { kind: 'capsule', a: s, b: sleeveEnd, r0: 3.2, r1: 2.9, mat: 'jersey', z, seam },
    { kind: 'capsule', a: sleeveEnd, b: e, r0: 2.4, r1: 2.2, mat: 'skin', z: z + 0.1, seam },
    { kind: 'capsule', a: e, b: hd, r0: 2.2, r1: 1.9, mat: 'skin', z: z + 0.2, seam },
    { kind: 'ellipse', c: hd, rx: 2.4, ry: 2.6, mat: 'hands', z: z + 0.3, seam },
  ];
}

function leg(j: Joints, side: 0 | 1, z: number): Part[] {
  const hp = j.hips[side];
  const k = j.knees[side];
  const a = j.ankles[side];
  const toe = j.toes?.[side] ?? add(a, [side === 0 ? -4 : 4, 1.5]);
  const seam = `leg${side}`;
  const shortEnd = lerp(hp, k, 0.42);
  const sockStart = lerp(k, a, 0.3);
  return [
    { kind: 'capsule', a: hp, b: shortEnd, r0: 3.5, r1: 3.2, mat: 'shorts', z, seam: 'shorts' },
    { kind: 'capsule', a: shortEnd, b: k, r0: 3, r1: 2.6, mat: 'skin', z: z + 0.1, seam },
    { kind: 'capsule', a: k, b: sockStart, r0: 2.6, r1: 2.4, mat: 'skin', z: z + 0.2, seam },
    { kind: 'capsule', a: sockStart, b: a, r0: 2.4, r1: 2.1, mat: 'socks', z: z + 0.3, seam },
    { kind: 'capsule', a: a, b: toe, r0: 2.2, r1: 1.8, mat: 'boots', z: z + 0.4, seam, flat: 'base' },
  ];
}

/** Hair for a `Look.style` (0 short, 1 buzz, 2 long, 3 bald) on a head ellipse. */
export function hairParts(style: number, c: Vec, rx: number, ry: number, face: 'front' | 'back', z: number): Part[] {
  const [cx, cy] = c;
  if (style === 3) return [];
  const back = face === 'back';
  const parts: Part[] = [];
  const capBelow = back ? cy + ry * (style === 1 ? 0.15 : 0.45) : cy - ry * (style === 1 ? 0.3 : 0.1);
  parts.push({ kind: 'ellipse', c: [cx, cy - ry * 0.08], rx: rx + 0.6, ry: ry * 0.98, clipBelow: capBelow, mat: 'hair', z, seam: 'hair' });
  if (style === 0 && !back) {
    // A fringe that hangs to one side.
    parts.push({ kind: 'capsule', a: [cx - rx * 0.7, cy - ry * 0.15], b: [cx + rx * 0.35, cy - ry * 0.02], r0: 1.4, r1: 1.1, mat: 'hair', z, seam: 'hair' });
  }
  if (style === 2) {
    if (back) parts.push({ kind: 'capsule', a: [cx, cy + ry * 0.4], b: [cx, cy + ry * 1.5], r0: rx * 0.75, r1: rx * 0.55, mat: 'hair', z: z - 3, seam: 'hair' });
    else
      for (const sgn of [-1, 1]) {
        parts.push({ kind: 'capsule', a: [cx + sgn * rx * 0.85, cy - ry * 0.25], b: [cx + sgn * rx * 1.05, cy + ry * 0.95], r0: 1.6, r1: 1.4, mat: 'hair', z, seam: 'hair' });
      }
  }
  return parts;
}

function faceMarks(c: Vec, rx: number, ry: number, style: number): Part[] {
  const cx = Math.round(c[0] - 0.5);
  const cy = Math.round(c[1] - 0.5);
  const ex = Math.max(1, Math.round(rx * 0.4));
  const ey = Math.round(ry * 0.22);
  const my = Math.round(ry * 0.62);
  // Eyes a clear row under the hairline, a brow on the lit side only, a small mouth.
  const brow = style === 3 ? 'z' : 'x';
  const cells: [number, number, string][] = [
    [-ex, ey, 'O'],
    [ex, ey, 'O'],
    [-ex, ey - 2, brow],
    [-ex + 1, ey - 2, brow],
    [ex, ey - 2, brow],
    [ex - 1, ey - 2, brow],
    [0, my, 'z'],
    [1, my, 'z'],
  ];
  return [{ kind: 'marks', at: [cx, cy], mat: 'skin', z: Z.face, cells }];
}

/** A jointed body: torso, shorts, limbs, head, hair and face from a joint set. */
export function figure(j: Joints, style: number): Part[] {
  const [rx, ry] = j.headR ?? [6, 7];
  const front = j.front ?? { arm: 1, leg: 1 };
  const parts: Part[] = [];
  const sL = j.shoulders[0];
  const sR = j.shoulders[1];
  const hL = j.hips[0];
  const hR = j.hips[1];
  const neckBase = mid(sL, sR);
  const pelvis = mid(hL, hR);
  const halfW = dist(sL, sR) / 2;
  // Torso as a quad shaded like a cylinder along the spine.
  parts.push({
    kind: 'poly',
    pts: [add(sL, [-1.5, -1]), add(sR, [1.5, -1]), add(hR, [2, 1]), add(hL, [-2, 1])],
    axis: [neckBase, pelvis],
    axisR: halfW + 1.5,
    mat: 'jersey',
    z: Z.torso,
    seam: 'torso',
  });
  parts.push({ kind: 'capsule', a: add(hL, [0, 0]), b: add(hR, [0, 0]), r0: 4, mat: 'shorts', z: Z.shorts, seam: 'shorts' });
  parts.push(...leg(j, front.leg === 0 ? 1 : 0, Z.backLeg));
  parts.push(...leg(j, front.leg, Z.frontLeg));
  parts.push(...arm(j, front.arm === 0 ? 1 : 0, Z.backArm));
  // Neck and head share a seam so no line cuts the chin.
  parts.push({ kind: 'capsule', a: add(j.head, [0, ry * 0.6]), b: add(neckBase, [0, 1]), r0: 2.4, r1: 2.6, mat: 'skin', z: Z.neck, seam: 'head' });
  parts.push({ kind: 'capsule', a: add(neckBase, [-3.5, 0.5]), b: add(neckBase, [3.5, 0.5]), r0: 1.6, mat: 'collar', z: Z.collar, flat: 'base', seam: 'torso' });
  parts.push({ kind: 'ellipse', c: j.head, rx, ry, mat: 'skin', z: Z.head, seam: 'head' });
  parts.push(...hairParts(style, j.head, rx, ry, j.face, Z.hair));
  if (j.face === 'front') {
    parts.push(...faceMarks(j.head, rx, ry, style));
    // Ears peek out under the hair.
    for (const sgn of [-1, 1]) parts.push({ kind: 'ellipse', c: [j.head[0] + sgn * rx * 0.95, j.head[1] + ry * 0.12], rx: 1.4, ry: 1.9, mat: 'skin', z: Z.head - 0.5, seam: 'head' });
  }
  parts.push(...arm(j, front.arm, Z.frontArm));
  if (j.ball) parts.push(...ballParts(j.ball.c, j.ball.r, j.ball.z));
  return parts;
}

/** A ball: white with a shaded side and a dark pentagon. */
export function ballParts(c: Vec, r: number, z: number): Part[] {
  const cx = Math.round(c[0] - 0.5);
  const cy = Math.round(c[1] - 0.5);
  const panels: [number, number, string][] = [
    [0, -1, 'D'],
    [-1, 0, 'D'],
    [0, 0, 'D'],
    [1, 0, 'D'],
    [0, 1, 'D'],
    [-2, 2, 'D'],
    [2, 2, 'D'],
    [-2, -2, 'D'],
    [2, -2, 'D'],
  ];
  return [
    { kind: 'ellipse', c, rx: r, ry: r, mat: 'ball', z, seam: 'ball' },
    { kind: 'marks', at: [cx, cy], mat: 'ball', z: z + 0.1, cells: panels.filter(([dx, dy]) => Math.hypot(dx, dy) < r - 0.8) },
  ];
}

/** The shirt frame from the shoulders and hips (the torso quad). */
function jerseyFrame(j: Joints): JerseyFrame {
  const [sL, sR] = j.shoulders;
  const [hL] = j.hips;
  const origin = add(sL, [-2, -1]);
  const topRight = add(sR, [2, -1]);
  const bottomLeft = add(hL, [-2, 1]);
  return { origin, u: [topRight[0] - origin[0], topRight[1] - origin[1]], v: [bottomLeft[0] - origin[0], bottomLeft[1] - origin[1]] };
}

export type HeroPose = 'hero-strike' | 'hero-tackle' | 'hero-dive' | 'hero-cheer' | 'hero-throw' | 'hero-point' | 'hero-run' | 'hero-back' | 'hero-ready';
export const HERO_POSES: HeroPose[] = ['hero-strike', 'hero-tackle', 'hero-dive', 'hero-cheer', 'hero-throw', 'hero-point', 'hero-run', 'hero-back', 'hero-ready'];

function rig(w: number, h: number, j: Joints, style: number, extra: Partial<Rig> = {}): Rig {
  return { w, h, parts: figure(j, style), jersey: jerseyFrame(j), ...extra };
}

/** One builder per hero pose; `style` is the hair style. Frames keep a 1 px margin for the outline. */
export const HERO_RIGS: Record<HeroPose, (style: number) => Rig> = {
  // Striker following through: leaning back, kicking leg swung up in front.
  'hero-strike': (style) =>
    rig(
      48,
      64,
      {
        head: [19, 11],
        shoulders: [[13, 23], [27, 21]],
        elbows: [[5, 28], [36, 23]],
        hands: [[3, 36], [42, 27]],
        hips: [[20, 37], [28, 36]],
        knees: [[16, 48], [36, 41]],
        ankles: [[14, 59], [44, 33]],
        toes: [[9, 60], [46, 27]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
      { anchors: { ball: [44, 24] } },
    ),
  // Defender sliding in from the left, one leg stretched along the ground.
  'hero-tackle': (style) =>
    rig(
      80,
      64,
      {
        head: [15, 29],
        shoulders: [[11, 41], [27, 37]],
        elbows: [[5, 50], [37, 29]],
        hands: [[4, 58], [45, 24]],
        hips: [[33, 50], [40, 47]],
        knees: [[30, 58], [56, 52]],
        ankles: [[21, 60], [71, 56]],
        toes: [[15, 61], [76, 57]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
      { anchors: { ball: [75, 58] } },
    ),
  // Keeper diving to the right, arms stretched toward the ball.
  'hero-dive': (style) =>
    rig(
      80,
      64,
      {
        head: [58, 20],
        headR: [6, 6.5],
        shoulders: [[47, 27], [55, 35]],
        elbows: [[60, 17], [66, 27]],
        hands: [[70, 11], [73, 19]],
        hips: [[28, 44], [33, 51]],
        knees: [[15, 51], [20, 59]],
        ankles: [[4, 53], [8, 61]],
        toes: [[2, 48], [4, 58]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
      { anchors: { ball: [76, 8] } },
    ),
  // Arms up in a V.
  'hero-cheer': (style) =>
    rig(
      48,
      64,
      {
        head: [24, 12],
        shoulders: [[17, 23], [31, 23]],
        elbows: [[9, 15], [39, 15]],
        hands: [[7, 6], [41, 6]],
        hips: [[20, 38], [28, 38]],
        knees: [[18, 49], [30, 49]],
        ankles: [[17, 59], [31, 59]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
    ),
  // Throw-in: both hands over the head holding the ball.
  'hero-throw': (style) =>
    rig(
      48,
      64,
      {
        head: [24, 14],
        shoulders: [[17, 25], [31, 25]],
        elbows: [[13, 15], [35, 15]],
        hands: [[20, 9], [28, 9]],
        hips: [[20, 40], [28, 40]],
        knees: [[17, 50], [31, 50]],
        ankles: [[15, 60], [32, 60]],
        front: { arm: 1, leg: 1 },
        face: 'front',
        ball: { c: [24, 5.5], r: 4.3, z: Z.ball },
      },
      style,
    ),
  // Pointing to the flag, other hand on the hip.
  'hero-point': (style) =>
    rig(
      48,
      64,
      {
        head: [22, 12],
        shoulders: [[15, 23], [29, 23]],
        elbows: [[9, 31], [37, 22]],
        hands: [[15, 35], [45, 20]],
        hips: [[19, 38], [27, 38]],
        knees: [[17, 49], [29, 49]],
        ankles: [[16, 59], [30, 59]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
    ),
  // Dribbler running to the right with the ball at his feet.
  'hero-run': (style) =>
    rig(
      48,
      64,
      {
        head: [26, 11],
        shoulders: [[19, 22], [33, 21]],
        elbows: [[11, 29], [40, 25]],
        hands: [[16, 36], [43, 17]],
        hips: [[22, 37], [30, 36]],
        knees: [[18, 47], [36, 45]],
        ankles: [[12, 57], [38, 57]],
        toes: [[8, 60], [43, 58]],
        front: { arm: 1, leg: 1 },
        face: 'front',
        ball: { c: [40, 60], r: 3.4, z: Z.ball },
      },
      style,
    ),
  // Seen from behind, for the set-piece scene: the number goes between the shoulder blades.
  'hero-back': (style) =>
    rig(
      48,
      64,
      {
        head: [24, 11],
        shoulders: [[17, 22], [31, 22]],
        elbows: [[12, 32], [36, 32]],
        hands: [[12, 40], [36, 40]],
        hips: [[20, 38], [28, 38]],
        knees: [[19, 49], [29, 49]],
        ankles: [[18, 59], [30, 59]],
        toes: [[16, 61], [32, 61]],
        front: { arm: 1, leg: 1 },
        face: 'back',
      },
      style,
      { anchors: { number: [24, 30] } },
    ),
  // Keeper set on his line: crouched low, gloves out wide. Short enough to fit under the bar.
  'hero-ready': (style) =>
    rig(
      64,
      48,
      {
        head: [32, 10],
        headR: [5.5, 6.5],
        shoulders: [[24, 20], [40, 20]],
        elbows: [[13, 25], [51, 25]],
        hands: [[6, 31], [58, 31]],
        hips: [[27, 30], [37, 30]],
        knees: [[20, 37], [44, 37]],
        ankles: [[18, 44], [46, 44]],
        toes: [[14, 45], [50, 45]],
        front: { arm: 1, leg: 1 },
        face: 'front',
      },
      style,
    ),
};

export const isHeroPose = (pose: string): pose is HeroPose => pose.startsWith('hero-');
