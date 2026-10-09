import { Texture } from 'pixi.js';
import { hex, shirtColorAt, type Kit } from './kits';

// Pixel-art player sprites painted from ASCII templates, in the spirit of
// 16-bit football games: a 16x24 figure seen from the front, slightly above,
// with a dark outline and one level of shading. Letters:
//   O outline   H/h hair, highlight   S/s skin, shade   G/g hands (gloves on keepers)
//   J/j jersey, shade (kit colour, pattern or painted design)   C collar trim (second kit colour)
//   P/p shorts, shade   K/k socks, shade   B boots   q deep jersey shadow   . transparent
// Each player gets a `Look` (skin tone, hair colour and style) derived from
// their name, so a squad reads as eleven people rather than clones.

export type Pose = 'stand' | 'run1' | 'run2' | 'kick' | 'cheer' | 'slide' | 'ready' | 'back';
/** The 16x24 front-facing poses used on the pitch. */
type FrontPose = Exclude<Pose, 'back'>;

export const SPRITE_W = 16;
export const SPRITE_H = 24;
/** The big back-view figure of the set-piece scene. */
export const BACK_W = 32;
export const BACK_H = 48;

export interface Look {
  /** Index into SKINS. */
  skin: number;
  /** Index into HAIRS. */
  hair: number;
  /** 0 short, 1 buzz cut, 2 long, 3 bald. */
  style: number;
}

export const DEFAULT_LOOK: Look = { skin: 1, hair: 0, style: 0 };

const SKINS: [string, string][] = [
  ['#f1c9a5', '#d4a37f'],
  ['#e2a978', '#c58a5c'],
  ['#b9784b', '#94593a'],
  ['#7a4a2e', '#5a3421'],
];
const HAIRS: [string, string][] = [
  ['#2b1d12', '#4b3321'],
  ['#161616', '#3a3a3a'],
  ['#6b3a1e', '#8f5a33'],
  ['#d9b24a', '#efd07a'],
  ['#a3341f', '#c9553a'],
];

const HEAD = [
  '.....OOOOOO.....',
  '....OHHHHHHO....',
  '...OHhHHHHHHO...',
  '...OHHHHHHHHO...',
  '...OHSSSSSSHO...',
  '...OSSSSSSSsO...',
  '...OSOSSSSOsO...',
  '....OSSSSSsO....',
  '.....OsSSsO.....',
];

/** Hair styles as edits of the base head (row, column, letter). */
const STYLES: Record<number, [number, number, string][]> = {
  0: [],
  // Buzz cut: more forehead, no fringe sides.
  1: [
    [3, 4, 'S'],
    [3, 5, 'S'],
    [3, 6, 'S'],
    [3, 7, 'S'],
    [3, 8, 'S'],
    [3, 9, 'S'],
    [3, 10, 'S'],
    [3, 11, 's'],
    [4, 4, 'S'],
    [4, 11, 's'],
  ],
  // Long: hair runs down both sides of the face.
  2: [
    [5, 4, 'H'],
    [5, 11, 'H'],
    [6, 4, 'H'],
    [6, 11, 'H'],
    [7, 4, 'O'],
    [7, 5, 'H'],
    [7, 10, 'H'],
    [7, 11, 'O'],
  ],
  // Bald: skin where the hair was, a slightly lower crown.
  3: [
    [1, 5, 'S'],
    [1, 6, 'S'],
    [1, 7, 'S'],
    [1, 8, 'S'],
    [1, 9, 'S'],
    [1, 10, 's'],
    [2, 4, 'S'],
    [2, 5, 'S'],
    [2, 6, 'S'],
    [2, 7, 'S'],
    [2, 8, 'S'],
    [2, 9, 'S'],
    [2, 10, 'S'],
    [2, 11, 's'],
    [3, 4, 'S'],
    [3, 5, 'S'],
    [3, 6, 'S'],
    [3, 7, 'S'],
    [3, 8, 'S'],
    [3, 9, 'S'],
    [3, 10, 'S'],
    [3, 11, 's'],
    [4, 4, 'S'],
    [4, 11, 's'],
  ],
};

const TORSO = [
  '....OOCJJCOO....',
  '..OOJJJJJJJJOO..',
  '.OJJJJJJJJJJJJO.',
  '.OJJOJJJJJJOJJO.',
  '.OjjOJJJJJJOjjO.',
];

const BODIES: Record<FrontPose, string[]> = {
  stand: [
    ...TORSO,
    '.OGGOJJJJJJOGGO.',
    '.OGgOjjjjjjOGgO.',
    '..OO.OPPPPPPO.OO',
    '.....OPPPPPPO...',
    '.....OPpOOpPO...',
    '.....OSSOOSSO...',
    '.....OKKOOKKO...',
    '.....OkKOOKkO...',
    '....OBBBOOBBBO..',
    '....OOOOOOOOOO..',
  ],
  run1: [
    ...TORSO,
    '.OGGOJJJJJJOJJO.',
    '.OGgOjjjjjjOGGO.',
    '..OO.OPPPPPPO.OO',
    '....OPPPPPPPO...',
    '...OPpOOOOPpO...',
    '..OSSO....OSSO..',
    '..OKKO....OKKO..',
    '.OKKO......OKkO.',
    'OBBBO......OBBBO',
    '.OOO........OOO.',
  ],
  run2: [
    ...TORSO,
    '.OJJOJJJJJJOGGO.',
    '.OGGOjjjjjjOGgO.',
    '..OO.OPPPPPPO.OO',
    '.....OPPPPPPO...',
    '.....OPpPPpPO...',
    '......OSSSSO....',
    '......OKKKKO....',
    '.....OKKOOKKO...',
    '....OBBBOOBBBO..',
    '....OOOOOOOOOO..',
  ],
  kick: [
    ...TORSO,
    '.OGGOJJJJJJOJJO.',
    '.OGgOjjjjjjOGGO.',
    '..OO.OPPPPPPO.OO',
    '.....OPPPPPPPO..',
    '.....OPpOOPPPO..',
    '.....OSSO.OSSSO.',
    '.....OKKO..OKKKO',
    '.....OkKO...OBBO',
    '....OBBBO....OO.',
    '....OOOOO.......',
  ],
  // A keeper set for a shot: crouched, knees out, gloves spread wide (the set-piece scene).
  ready: [
    '...OOOCJJCOOO...',
    '..OJJJJJJJJJJO..',
    '.OJJJJJJJJJJJJO.',
    'OJJOJJJJJJJJOJJO',
    'OSSOJJJJJJJJOSSO',
    'OGGOjjjjjjjjOGGO',
    'OGgO.OPPPPO.OGgO',
    '.OO.OPPPPPPO.OO.',
    '....OPpOOpPO....',
    '...OSSO..OSSO...',
    '..OSSO....OSSO..',
    '..OKKO....OKKO..',
    '..OkKO....OKkO..',
    '.OBBBO....OBBBO.',
    '.OOOO......OOOO.',
  ],
  // Arms up; the head rows are replaced below because the hands reach past the ears.
  cheer: [
    '.OJOOOCJJCOOOJO.',
    '..OJJJJJJJJJJO..',
    '..OJJJJJJJJJJO..',
    '..OJJJJJJJJJJO..',
    '..OjjJJJJJJjjO..',
    '...OJJJJJJJJO...',
    '...OjjjjjjjjO...',
    '....OPPPPPPO....',
    '....OPPPPPPO....',
    '....OPpOOpPO....',
    '....OSSOOSSO....',
    '....OKKOOKKO....',
    '....OkKOOKkO....',
    '...OBBBOOBBBO...',
    '...OOOOOOOOOO...',
  ],
  slide: [
    '................',
    '................',
    '................',
    '.OOOO...........',
    'OHHHHO..........',
    'OHhSSO..........',
    'OSSSsOOO........',
    '.OSOOJJJOO......',
    '..OOJJJJJJOOO...',
    '..OGOJJjjjPPPOO.',
    '..OOOjjjOPpPKKOO',
    '.....OOOOOPOKKKO',
    '..........OOOBBO',
    '.............OOO',
    '................',
  ],
};

/** Head rows for the cheer pose: the raised arms frame the face. */
const CHEER_HEAD = [
  '.....OOOOOO.....',
  '....OHHHHHHO....',
  '.OOOHhHHHHHHOOO.',
  'OGOOHHHHHHHHOOGO',
  'OGOOHSSSSSSHOOGO',
  'OSOOSSSSSSSsOOSO',
  'OSOOSOSSSSOsOOSO',
  'OJO.OSSSSSsO.OJO',
  'OJOO.OsSSsO.OOJO',
];

/**
 * The set-piece figure seen from behind, 32x48, ISS style: the back of the head,
 * hands on hips, a shirt shaded on the right with room for the number (paintNumber),
 * shorts, striped socks and boots. No face; the hair style is applied by templateRows.
 * Generated from simple shapes with an automatic one-pixel outline, then hand-checked.
 */
const BACK: string[] = [
  '...........OOHHHHHOO............',
  '..........OHhhHHHHHHO...........',
  '..........OhhhhHHHHHO...........',
  '.........OHhhhhHHHHHHO..........',
  '.........OHHHHHHHHHHHOO.........',
  '........OSHHHHHHHHHHHOSO........',
  '........OsHHHHHHHHHHHOsO........',
  '.........OHHHHHHHHHHHOO.........',
  '..........OHHHHHHHHHO...........',
  '...........OHHHHHHHO............',
  '............OSHHHssO............',
  '............OSSSSssO............',
  '........OOOOOSSSSssOOOOO........',
  '....OOOOJJJJCCCCCCCCJjjqOOO.....',
  '...OJJJjJJJJJCJJJJCJJjjJJJjO....',
  '...OJJJjJJJJJJJJJJJJJJjJJJjO....',
  '..OJJJjjJJJJJJJJJJJJJJjjJJJjO...',
  '..OJJJjOjJJJJJJJJJJJJjjqJJJjO...',
  '.OCCCCOOjJJJJJJJJJJJJjjqOCCCCO..',
  '.OSSSsOOjJJJJJJJJJJJJjjqOSSSsO..',
  '.OSSSsOOjJJJJJJJJJJJJjjqOSSSsO..',
  'OSSSsO.OjJJJJJJJJJJJJjjqOOSSSsO.',
  '.OSSSsOOjJJJJJJJJJJJJjjqOSSSsO..',
  '.OSSSsOOjJJJJJJJJJJJJjjqOSSSsO..',
  '..OSSSsOjJJJJJJJJJJJJjjqSSSsO...',
  '...OGGGgOjJJJJJJJJJJjjqGGGgO....',
  '...OGGGgOjJJJJJJJJJJjjqGGGgO....',
  '....OggggjJJJJJJJJJJjjggggO.....',
  '.....OOOOjJJJJJJJJJJjjqOOO......',
  '........OjJJJJJJJJJJjjqO........',
  '.........OjJJJJJJJJJjjqO........',
  '........OPPPPPPPPPPPPppO........',
  '........OPPPPPPPPPPPPppO........',
  '........OPPPPPPPPPPPPppO........',
  '........OPPPPPPPPPPPPppO........',
  '........OPPPPPPOOPPPPppO........',
  '........OPPPPPpOOpPPPppO........',
  '........OPPPPPpOOpPPPppO........',
  '.........OSSSSsOOSSSSsO.........',
  '.........OSSSSsOOSSSSsO.........',
  '.........OSSSSsOOSSSSsO.........',
  '.........OKKKKkOOKKKKkO.........',
  '.........OkkkkkOOkkkkkO.........',
  '.........OKKKKkOOKKKKkO.........',
  '.........OKKKKkOOKKKKkO.........',
  '.........OBBBBBOOBBBBBO.........',
  '.........OBBBBBOOBBBBBO.........',
  '..........OOOOO..OOOOO..........',
];

/** Where the jersey sits per pose, for mapping the kit pattern (top row, rows, left column, columns). */
const JERSEY_BOX: Record<Pose, [number, number, number, number]> = {
  stand: [9, 7, 1, 14],
  run1: [9, 7, 1, 14],
  run2: [9, 7, 1, 14],
  kick: [9, 7, 1, 14],
  cheer: [9, 7, 2, 12],
  slide: [16, 4, 4, 10],
  ready: [9, 6, 0, 16],
  back: [13, 18, 2, 28],
};

const OUTLINE = '#141420';
const BOOTS = '#1b1b22';
const GLOVE = '#f0f0f0';
const GLOVE_SHADE = '#c8c8d0';

/** Darken a packed RGB colour. */
function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

/** A stable look for a player name: the same name always paints the same person. */
export function lookFor(name: string): Look {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  // Styles are weighted: most players have short hair.
  const styleRoll = (h >>> 16) % 10;
  const style = styleRoll < 5 ? 0 : styleRoll < 7 ? 1 : styleRoll < 9 ? 2 : 3;
  return { skin: h % SKINS.length, hair: (h >>> 8) % HAIRS.length, style };
}

const templateCache = new Map<string, string[]>();
const BLANK = '.'.repeat(SPRITE_W);

/**
 * Rows for a pose with a look's hair style applied: SPRITE_H rows of SPRITE_W
 * letters for the pitch poses, BACK_H x BACK_W for the back view.
 */
export function templateRows(pose: Pose, look: Look): string[] {
  const key = `${pose}:${look.style}`;
  let rows = templateCache.get(key);
  if (!rows) {
    if (pose === 'back') {
      // Seen from behind there is no face: the style only changes how much neck shows.
      rows = BACK.map((r, y) => {
        if (look.style === 3) return y < 11 ? r.replace(/H/g, 'S').replace(/h/g, 's') : r; // bald
        if (look.style === 1 && y >= 8 && y < 11) return r.replace(/H/g, 'S').replace(/h/g, 's'); // buzz cut: shorter at the nape
        if (look.style === 2 && y >= 10 && y < 13) return r.replace(/S/g, 'H').replace(/s/g, 'h'); // long: hair down the neck
        return r;
      });
    } else if (pose === 'slide') {
      // The slide has no separate head block: pad the figure down to the bottom of the frame.
      rows = [...Array<string>(SPRITE_H - BODIES.slide.length).fill(BLANK), ...BODIES.slide];
    } else {
      const head = (pose === 'cheer' ? CHEER_HEAD : HEAD).map((r) => r.split(''));
      for (const [y, x, ch] of STYLES[look.style] ?? []) {
        // Only restyle pixels that are hair or face; never touch raised arms or outlines of the cheer head.
        if (head[y][x] === 'H' || head[y][x] === 'h' || head[y][x] === 'S' || head[y][x] === 's' || (ch === 'O' && head[y][x] === '.')) head[y][x] = ch;
      }
      rows = [...head.map((r) => r.join('')), ...BODIES[pose]];
    }
    templateCache.set(key, rows);
  }
  return rows;
}

function jerseyColor(kit: Kit, keeper: boolean, pose: Pose, x: number, y: number): number {
  if (keeper) return kit.keeper.jersey;
  const [top, rows, left, cols] = JERSEY_BOX[pose];
  const u = Math.max(0, Math.min(1, (x - left + 0.5) / cols));
  const v = Math.max(0, Math.min(1, (y - top + 0.5) / rows));
  return shirtColorAt(kit, u, v);
}

/** Paint one pose at integer scale `k` onto a 2D context at (x, y) = top-left. */
export function paintSprite(ctx: CanvasRenderingContext2D, pose: Pose, kit: Kit, keeper: boolean, x: number, y: number, k: number, look: Look = DEFAULT_LOOK): void {
  const rows = templateRows(pose, look);
  const [skin, skinShade] = SKINS[look.skin] ?? SKINS[1];
  const [hair, hairHi] = HAIRS[look.hair] ?? HAIRS[0];
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      const c = rows[j][i];
      if (c === '.') continue;
      let fill: string;
      switch (c) {
        case 'O':
          fill = OUTLINE;
          break;
        case 'H':
          fill = hair;
          break;
        case 'h':
          fill = hairHi;
          break;
        case 'S':
          fill = skin;
          break;
        case 's':
          fill = skinShade;
          break;
        case 'G':
          fill = keeper ? GLOVE : skin;
          break;
        case 'g':
          fill = keeper ? GLOVE_SHADE : skinShade;
          break;
        case 'J':
          fill = hex(jerseyColor(kit, keeper, pose, i, j));
          break;
        case 'j':
          fill = hex(shade(jerseyColor(kit, keeper, pose, i, j), 0.72));
          break;
        case 'q':
          fill = hex(shade(jerseyColor(kit, keeper, pose, i, j), 0.5));
          break;
        case 'C':
          // Collar trim: the second kit colour on presets, the painted shirt itself on custom kits.
          fill = hex(keeper ? shade(kit.keeper.jersey, 0.72) : kit.design ? jerseyColor(kit, false, pose, i, j) : kit.jersey2);
          break;
        case 'P':
          fill = hex(keeper ? kit.keeper.shorts : kit.shorts);
          break;
        case 'p':
          fill = hex(shade(keeper ? kit.keeper.shorts : kit.shorts, 0.72));
          break;
        case 'K':
          fill = hex(keeper ? kit.keeper.socks : kit.socks);
          break;
        case 'k':
          fill = hex(shade(keeper ? kit.keeper.socks : kit.socks, 0.72));
          break;
        default:
          fill = BOOTS;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x + i * k, y + j * k, k, k);
    }
  }
}

/** A standalone canvas holding one sprite at scale `k` (cutscene cards, menus, the coach). */
export function spriteCanvas(pose: Pose, kit: Kit, keeper: boolean, k: number, look: Look = DEFAULT_LOOK): HTMLCanvasElement {
  const rows = templateRows(pose, look);
  const c = document.createElement('canvas');
  c.width = rows[0].length * k;
  c.height = rows.length * k;
  paintSprite(c.getContext('2d')!, pose, kit, keeper, 0, 0, k, look);
  return c;
}

/** 3x5 digits for shirt numbers. */
const DIGITS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};

/**
 * The shirt number on the back view, painted over a `back` sprite at the same (x, y, k):
 * white with a dark edge on dark shirts, dark on light ones, centred between the shoulders.
 */
export function paintNumber(ctx: CanvasRenderingContext2D, kit: Kit, keeper: boolean, x: number, y: number, k: number, n: number): void {
  const text = String(Math.max(0, Math.round(n)) % 100);
  const base = keeper ? kit.keeper.jersey : kit.jersey;
  const lum = 0.299 * ((base >> 16) & 255) + 0.587 * ((base >> 8) & 255) + 0.114 * (base & 255);
  const ink = lum > 150 ? '#1b1b26' : '#f8f8f0';
  const edge = lum > 150 ? '#f8f8f0' : '#141420';
  const w = text.length * 4 - 1;
  const left = Math.round(15.5 - w / 2);
  const top = 17;
  const on = new Set<string>();
  [...text].forEach((d, n) => DIGITS[d].forEach((row, j) => [...row].forEach((c, i) => c === '#' && on.add(`${left + n * 4 + i},${top + j}`))));
  // A one-pixel ring first, so the number reads on stripes and hoops too, then the digits.
  ctx.fillStyle = edge;
  for (const key of on) {
    const [px, py] = key.split(',').map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!on.has(`${px + dx},${py + dy}`)) ctx.fillRect(x + (px + dx) * k, y + (py + dy) * k, k, k);
  }
  ctx.fillStyle = ink;
  for (const key of on) {
    const [px, py] = key.split(',').map(Number);
    ctx.fillRect(x + px * k, y + py * k, k, k);
  }
}

const cache = new Map<string, Texture>();

/** Pixi texture for a pose at 1:1 pixels; scale the sprite by an integer for crisp pixels. */
export function spriteTexture(pose: Pose, kit: Kit, keeper: boolean, look: Look = DEFAULT_LOOK): Texture {
  // Custom kits can be edited, so their cache key includes the design.
  const key = `${kit.id}:${keeper ? 'gk' : 'out'}:${pose}:${look.skin}${look.hair}${look.style}:${kit.design ? kit.design.pixels.join('') : ''}:${kit.shorts}:${kit.socks}`;
  let t = cache.get(key);
  if (!t) {
    t = Texture.from(spriteCanvas(pose, kit, keeper, 1, look));
    t.source.scaleMode = 'nearest';
    cache.set(key, t);
  }
  return t;
}

/** The ball: a 7x7 pixel ball with an outline and a highlight. */
export function ballTexture(): Texture {
  const key = 'ball';
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = 7;
    c.height = 7;
    const ctx = c.getContext('2d')!;
    const rows = ['..OOO..', '.OWWWO.', 'OWhWKWO', 'OWKWWWO', 'OWWWKWO', '.OWKWO.', '..OOO..'];
    const colors: Record<string, string> = { O: OUTLINE, W: '#f8f8f8', h: '#ffffff', K: '#222' };
    rows.forEach((r, j) =>
      [...r].forEach((ch, i) => {
        if (ch === '.') return;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(i, j, 1, 1);
      }),
    );
    t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    cache.set(key, t);
  }
  return t;
}
