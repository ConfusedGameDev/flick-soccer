import { Texture } from 'pixi.js';
import { hex, shirtColorAt, type Kit } from './kits';

// Pixel-art player sprites painted from ASCII templates, in the spirit of
// 16-bit football games: a 16x24 figure seen from the front, slightly above,
// with a dark outline and one level of shading. Letters:
//   O outline   H/h hair, highlight   S/s skin, shade   G/g hands (gloves on keepers)
//   J/j jersey, shade (kit colour, pattern or painted design)   C collar trim (second kit colour)
//   P/p shorts, shade   K/k socks, shade   B boots   . transparent

export type Pose = 'stand' | 'run1' | 'run2' | 'kick' | 'slide';

export const SPRITE_W = 16;
export const SPRITE_H = 24;

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

const TORSO = [
  '....OOCJJCOO....',
  '..OOJJJJJJJJOO..',
  '.OJJJJJJJJJJJJO.',
  '.OJJOJJJJJJOJJO.',
  '.OjjOJJJJJJOjjO.',
];

const TEMPLATES: Record<Pose, string[]> = {
  stand: [
    ...HEAD,
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
    ...HEAD,
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
    ...HEAD,
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
    ...HEAD,
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
  slide: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
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

const OUTLINE = '#141420';
const HAIR = '#2b1d12';
const HAIR_HI = '#4b3321';
const SKIN = '#e2a978';
const SKIN_SHADE = '#c58a5c';
const BOOTS = '#1b1b22';
const GLOVE = '#f0f0f0';
const GLOVE_SHADE = '#c8c8d0';

/** Jersey block of the templates: rows 9..15 and columns 1..14 of the figure. */
const JERSEY_TOP = 9;
const JERSEY_ROWS = 7;
const JERSEY_LEFT = 1;
const JERSEY_COLS = 14;

/** Darken a packed RGB colour. */
function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

function jerseyColor(kit: Kit, keeper: boolean, x: number, y: number): number {
  if (keeper) return kit.keeper.jersey;
  return shirtColorAt(kit, (x - JERSEY_LEFT + 0.5) / JERSEY_COLS, (y - JERSEY_TOP + 0.5) / JERSEY_ROWS);
}

/** Paint one pose at integer scale `k` onto a 2D context at (x, y) = top-left. */
export function paintSprite(ctx: CanvasRenderingContext2D, pose: Pose, kit: Kit, keeper: boolean, x: number, y: number, k: number): void {
  const rows = TEMPLATES[pose];
  for (let j = 0; j < SPRITE_H; j++) {
    for (let i = 0; i < SPRITE_W; i++) {
      const c = rows[j][i];
      if (c === '.') continue;
      let fill: string;
      switch (c) {
        case 'O':
          fill = OUTLINE;
          break;
        case 'H':
          fill = HAIR;
          break;
        case 'h':
          fill = HAIR_HI;
          break;
        case 'S':
          fill = SKIN;
          break;
        case 's':
          fill = SKIN_SHADE;
          break;
        case 'G':
          fill = keeper ? GLOVE : SKIN;
          break;
        case 'g':
          fill = keeper ? GLOVE_SHADE : SKIN_SHADE;
          break;
        case 'J':
          fill = hex(jerseyColor(kit, keeper, i, j));
          break;
        case 'j':
          fill = hex(shade(jerseyColor(kit, keeper, i, j), 0.72));
          break;
        case 'C':
          // Collar trim: the second kit colour on presets, the painted shirt itself on custom kits.
          fill = hex(keeper ? shade(kit.keeper.jersey, 0.72) : kit.design ? jerseyColor(kit, false, i, j) : kit.jersey2);
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
export function spriteCanvas(pose: Pose, kit: Kit, keeper: boolean, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE_W * k;
  c.height = SPRITE_H * k;
  paintSprite(c.getContext('2d')!, pose, kit, keeper, 0, 0, k);
  return c;
}

const cache = new Map<string, Texture>();

/** Pixi texture for a pose at 1:1 pixels; scale the sprite by an integer for crisp pixels. */
export function spriteTexture(pose: Pose, kit: Kit, keeper: boolean): Texture {
  // Custom kits can be edited, so their cache key includes the design.
  const key = `${kit.id}:${keeper ? 'gk' : 'out'}:${pose}:${kit.design ? kit.design.pixels.join('') : ''}:${kit.shorts}:${kit.socks}`;
  let t = cache.get(key);
  if (!t) {
    t = Texture.from(spriteCanvas(pose, kit, keeper, 1));
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
