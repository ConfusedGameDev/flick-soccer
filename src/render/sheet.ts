import data from '../data/sheet.json';
import type { HeroPose } from './rig';
import type { Look } from './sprites';

// The hand-drawn Aseprite characters (art/sheet, via `npm run sheet`): side-view
// figures facing right, one crop per frame, stored as the painter's letter
// templates so kits and looks recolour them like the typed sprites. Hair is an
// overlay per style written over the body (which draws the whole head, so no
// overlay is bald). Pure: no DOM.

export type SheetAnim =
  | 'idle'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'defensive_stance'
  | 'slide_tackle'
  | 'shoot_ball'
  | 'volley_kick'
  | 'celebration_1'
  | 'gk-idle'
  | 'gk-defensive_stance'
  | 'gk-slide'
  | 'gk-clearance'
  | 'gk-clearance_2'
  | 'gk-hold_ball'
  | 'back_kick';

export interface SheetHair {
  /** Offset of the overlay inside the frame's crop. */
  x: number;
  y: number;
  rows: string[];
}

export interface SheetFrame {
  /** Offset of the crop in the source canvas. */
  x: number;
  y: number;
  /** Body and kit letters, no hair; '.' is transparent. */
  rows: string[];
  /** Jersey box for the kit pattern: [top, rows, left, cols], in crop cells. */
  jersey: [number, number, number, number];
  /** One overlay per hair layer of the source file (null where a layer has no pixels). */
  hair: (SheetHair | null)[];
}

interface SheetData {
  frameMs: number;
  origin: [number, number];
  anims: Record<SheetAnim, SheetFrame[]>;
  ball: { rows: string[]; colors: Record<string, string> };
}

const SHEET = data as unknown as SheetData;

// ---- The back view, drawn by hand in the sheet's style and proportions ----
// The files have no figure seen from behind, which the set-piece scene needs
// for its kicker. These four frames (stand, wind-up, contact, follow-through)
// copy the idle frame's proportions (an 8-row head, a 9-row torso, 4-row
// shorts, 3-row legs, 2-row socks, 3-row boots, 15 cells wide, 33 rows with
// headroom for tall hair) with the same letters, so kits, looks and the shirt
// number paint them like any imported frame. Hair is a back-of-the-head
// overlay per style in the files' order: short, spiky, bandana, afro, swept.
const BACK_HEAD = [
  '...............',
  '...............',
  '...............',
  '...............',
  '......SSSS.....',
  '.....SSSSSS....',
  '....SSSSSSSS...',
  '....SSSSSSSS...',
  '....SSSSSSSS...',
  '....sSSSSSSs...',
  '.....sSSSSs....',
  '......SSSS.....',
];
const BACK_TORSO = [
  '....JJJJJJJ....',
  '..IJJJJJJJJJj..',
  '.IIJJJJJJJJJjj.',
  '.IIjJJJJJJJjjj.',
  '.SS.JJJJJJJ.SS.',
  '.SS.JJJJJJJ.SS.',
  '.LS.JJJJJJJ.sS.',
  '.LS.JJJJJJJ.sS.',
  '....JJJJJJJ....',
  '....PPPPPPP....',
];
/** Shorts' lower rows, legs, socks and boots per frame (rows 22-32). */
const BACK_LEGS: string[][] = [
  // stand
  [
    '...PPPPPPPPp...',
    '...PPPp.pPPp...',
    '...PPP...PPp...',
    '...SSS...SSS...',
    '...SSS...SSS...',
    '...LSS...sSS...',
    '...KKK...KKK...',
    '...KKK...KKK...',
    '...BBB...BBB...',
    '..bBBB...BBBb..',
    '..bBBB...BBBb..',
  ],
  // wind-up: the right boot swings up behind him, sole showing
  [
    '...PPPPPPPPp...',
    '...PPPp.pPPp...',
    '...PPP...PPp...',
    '...SSS...SSS...',
    '...SSS...KKK...',
    '...LSS...KKK...',
    '...KKK..bBBBb..',
    '...KKK..bBBBb..',
    '...BBB.........',
    '..bBBB.........',
    '..bBBB.........',
  ],
  // contact: the right leg drives through the ball
  [
    '...PPPPPPPPp...',
    '...PPPp.pPPp...',
    '...PPP...PPp...',
    '...SSS...SSS...',
    '...SSS...SSS...',
    '...LSS...sSS...',
    '...KKK...KKK...',
    '...KKK...KKK...',
    '...BBB...BBB...',
    '..bBBB...BBB...',
    '..bBBB....BB...',
  ],
  // follow-through: the leg swings up in front, the boot peeking past the shorts
  [
    '...PPPPPPPPpBb.',
    '...PPPp.pPPpBb.',
    '...PPP...PPp...',
    '...SSS.........',
    '...SSS.........',
    '...LSS.........',
    '...KKK.........',
    '...KKK.........',
    '...BBB.........',
    '..bBBB.........',
    '..bBBB.........',
  ],
];
const BACK_HAIR: SheetHair[] = [
  { x: 4, y: 4, rows: ['..HHHH..', '.HHHHHH.', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'xHHHHHHx', '.xHHHHx.'] },
  { x: 4, y: 2, rows: ['.H.HH.H.', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'xHHHHHHx', '.xHHHHx.', '..xHHx..'] },
  { x: 4, y: 4, rows: ['..HHHH..', '.HHHHHH.', 'HHHHHHHH', 'hhhhhhhh', 'HHHHHHHH', 'xHHHHHHx', '.xHHHHx.'] },
  { x: 2, y: 1, rows: ['...HHHHH...', '.HHHHHHHHH.', 'HHHHHHHHHHH', 'HHHHHHHHHHH', 'HHHHHHHHHHH', 'HHHHHHHHHHH', 'HHHHHHHHHHH', 'xHHHHHHHHHx', '.xHHHHHHHx.', '..xHHHHHx..', '....HHH....'] },
  { x: 3, y: 3, rows: ['..HHHH...', '.HHHHHHH.', 'HHHHHHHHH', '.HHHHHHHH', '.HHHHHHHH', '.xHHHHHHx', '..xHHHHx.', '...xHHx..'] },
];
const BACK_FRAMES: SheetFrame[] = BACK_LEGS.map((legs) => ({
  x: 57,
  y: 15,
  rows: [...BACK_HEAD, ...BACK_TORSO, ...legs],
  jersey: [12, 9, 1, 13],
  hair: BACK_HAIR,
}));
SHEET.anims.back_kick = BACK_FRAMES;

export const SHEET_ANIMS = Object.keys(SHEET.anims) as SheetAnim[];
export const SHEET_FRAME_MS = SHEET.frameMs;
/** Height of the standing figure (hair to boots), for sizing on the pitch. */
export const SHEET_FIGURE_H = 29;
/** Animations that play once and hold their last frame (tackles, dives). */
export const ONE_SHOT = new Set<SheetAnim>(['slide_tackle', 'shoot_ball', 'back_kick', 'gk-clearance', 'gk-clearance_2']);
/** The `shoot_ball` frame where the boot meets the ball: the frames before are the wind-up. */
export const SHOOT_CONTACT_FRAME = 3;
/** The contact frame of each kicking animation. */
export const KICK_CONTACT: Partial<Record<SheetAnim, number>> = { shoot_ball: SHOOT_CONTACT_FRAME, back_kick: 2 };
/** Where the shirt number sits on the back view, in crop cells (centre of the digits). */
export const BACK_NUMBER_ANCHOR: [number, number] = [7.5, 16.5];
/** The ball as drawn, with its own colours (letters -> CSS colour). */
export const SHEET_BALL = SHEET.ball;

export const sheetFrames = (anim: SheetAnim): number => SHEET.anims[anim].length;

/** Frame `i` of an animation; the index wraps. */
export function sheetFrame(anim: SheetAnim, i: number): SheetFrame {
  const frames = SHEET.anims[anim];
  return frames[((i % frames.length) + frames.length) % frames.length];
}

/** Frame index at a time into an animation: looping, or held on the last frame for one-shots. */
export function sheetFrameAt(anim: SheetAnim, ms: number): number {
  const i = Math.max(0, Math.floor(ms / SHEET_FRAME_MS));
  const n = sheetFrames(anim);
  return ONE_SHOT.has(anim) ? Math.min(n - 1, i) : i % n;
}

/**
 * Which hair overlay a look wears: the source files stack their styles as
 * Hair (short), Hair2 (spiky), Hair3 (bandana), Hair4 (afro) and, for outfield
 * players, Hair5 (short, swept). Style 3 is bald: no overlay.
 */
export function hairLayerFor(look: Look, keeper: boolean): number {
  if (look.style >= 3) return -1;
  const table = keeper ? [0, 2, 3] : [0, 4, 3];
  return table[look.style] ?? 0;
}

const rowCache = new Map<string, string[]>();

/** Template rows of a frame with a look's hair over the body, optionally mirrored. Cached. */
export function sheetRows(anim: SheetAnim, i: number, look: Look, flip = false): string[] {
  const f = sheetFrame(anim, i);
  const layer = hairLayerFor(look, anim.startsWith('gk-'));
  const key = `${anim}:${i}:${layer}:${flip ? 'f' : ''}`;
  let rows = rowCache.get(key);
  if (!rows) {
    const grid = f.rows.map((r) => r.split(''));
    const hair = layer >= 0 ? f.hair[layer] : null;
    if (hair) {
      hair.rows.forEach((r, y) => {
        [...r].forEach((ch, x) => {
          if (ch !== '.') grid[hair.y + y][hair.x + x] = ch;
        });
      });
    }
    rows = grid.map((r) => (flip ? r.reverse() : r).join(''));
    rowCache.set(key, rows);
  }
  return rows;
}

/** Where the figure's feet-centre sits inside the crop, in cells: [x, y] from the top-left (y is a bottom edge). */
export function sheetPivot(f: SheetFrame, flip = false): [number, number] {
  const [ox, oy] = SHEET.origin;
  const px = ox - f.x;
  return [flip ? f.rows[0].length - px : px, oy - f.y];
}

/** The jersey box of a frame, mirrored when the rows are. */
export function sheetJersey(f: SheetFrame, flip = false): [number, number, number, number] {
  const [top, rows, left, cols] = f.jersey;
  return flip ? [top, rows, f.rows[0].length - left - cols, cols] : f.jersey;
}

/** The hero pose of a cutscene card or the set-piece scene as a sheet frame. */
export const SHEET_HERO: Partial<Record<HeroPose, [SheetAnim, number]>> = {
  'hero-back': ['back_kick', 0],
  'hero-strike': ['shoot_ball', 4],
  'hero-tackle': ['slide_tackle', 3],
  'hero-dive': ['gk-clearance_2', 4],
  'hero-cheer': ['celebration_1', 2],
  'hero-run': ['sprint', 0],
  'hero-point': ['idle', 0],
  'hero-throw': ['jump', 3],
  'hero-ready': ['gk-defensive_stance', 0],
};
