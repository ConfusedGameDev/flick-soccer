import { Texture } from 'pixi.js';
import { hex, shirtColorAt, type Kit } from './kits';

// Pixel-art player sprites painted from ASCII templates, in the spirit of
// 16-bit football games: a 10x14 figure seen from slightly above. Letters:
// H hair, S skin, J jersey, P shorts, K socks, B boots, . transparent.
// Jersey pixels get the kit's second colour where its pattern says so.

export type Pose = 'stand' | 'run1' | 'run2' | 'slide';

export const SPRITE_W = 10;
export const SPRITE_H = 14;

const TEMPLATES: Record<Pose, string[]> = {
  stand: [
    '...HHHH...',
    '..HHHHHH..',
    '..HSSSSH..',
    '..SSSSSS..',
    '...SSSS...',
    '.JJJJJJJJ.',
    'JJJJJJJJJJ',
    'S.JJJJJJ.S',
    '..JJJJJJ..',
    '..PPPPPP..',
    '..PP..PP..',
    '..KK..KK..',
    '..KK..KK..',
    '..BB..BB..',
  ],
  run1: [
    '...HHHH...',
    '..HHHHHH..',
    '..HSSSSH..',
    '..SSSSSS..',
    '...SSSS...',
    '.JJJJJJJJ.',
    'SJJJJJJJJ.',
    '..JJJJJJ.S',
    '..JJJJJJ..',
    '..PPPPPP..',
    '.PP....PP.',
    'KK......KK',
    'KK......KK',
    'BB......BB',
  ],
  run2: [
    '...HHHH...',
    '..HHHHHH..',
    '..HSSSSH..',
    '..SSSSSS..',
    '...SSSS...',
    '.JJJJJJJJ.',
    '.JJJJJJJJS',
    'S.JJJJJJ..',
    '..JJJJJJ..',
    '..PPPPPP..',
    '...PPPP...',
    '...KKKK...',
    '...KK.KK..',
    '...BB.BB..',
  ],
  slide: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '.......HHH',
    '......HSSH',
    'JJJJJJJSSS',
    'JJJJJJJJS.',
    'PPPJJJJJJ.',
    'KKPPJJJJ..',
    'KKK.......',
    'BB........',
  ],
};

const SKIN = '#d9a066';
const HAIR = '#2b1d12';
const BOOTS = '#1a1a1a';

/** Jersey block of the templates: rows 5..8, all 10 columns. */
const JERSEY_TOP = 5;
const JERSEY_ROWS = 4;

function jerseyColor(kit: Kit, x: number, y: number): string {
  return hex(shirtColorAt(kit, (x + 0.5) / SPRITE_W, (y - JERSEY_TOP + 0.5) / JERSEY_ROWS));
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
        case 'H':
          fill = HAIR;
          break;
        case 'S':
          fill = SKIN;
          break;
        case 'J':
          fill = keeper ? hex(kit.keeper.jersey) : jerseyColor(kit, i, j);
          break;
        case 'P':
          fill = hex(keeper ? kit.keeper.shorts : kit.shorts);
          break;
        case 'K':
          fill = hex(keeper ? kit.keeper.socks : kit.socks);
          break;
        default:
          fill = BOOTS;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x + i * k, y + j * k, k, k);
    }
  }
}

/** A standalone canvas holding one sprite at scale `k` (used by the cutscene cards). */
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

/** The ball: a 5x5 pixel ball. */
export function ballTexture(): Texture {
  const key = 'ball';
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = 5;
    c.height = 5;
    const ctx = c.getContext('2d')!;
    const rows = ['.WWW.', 'WWKWW', 'WKWKW', 'WWKWW', '.WWW.'];
    rows.forEach((r, j) =>
      [...r].forEach((ch, i) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === 'W' ? '#f8f8f8' : '#222';
        ctx.fillRect(i, j, 1, 1);
      }),
    );
    t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    cache.set(key, t);
  }
  return t;
}
