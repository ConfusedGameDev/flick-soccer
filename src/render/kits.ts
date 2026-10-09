// Kit definitions. Colors are hex numbers; patterns are applied per pixel by
// the sprite painter. The six presets are "inspired by" the home colours of
// Madrid, Barcelona, Milan, Paris, Dortmund and Manchester United: no crests,
// no licensed marks. Custom kits carry a painted design instead of a pattern.

/** `band` is a single vertical stripe down the middle of the shirt. */
export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'sash' | 'band';

/** A painted shirt: palette indices on a DESIGN_SIZE² grid. */
export interface KitDesign {
  size: number;
  /** Row-major palette indices, length size². */
  pixels: number[];
}

export interface Kit {
  id: string;
  name: string;
  jersey: number;
  jersey2: number;
  pattern: KitPattern;
  shorts: number;
  socks: number;
  /** Goalkeeper colours (always plain). */
  keeper: { jersey: number; shorts: number; socks: number };
  /** Present on custom kits; overrides jersey/jersey2/pattern for the shirt. */
  design?: KitDesign;
}

export const DESIGN_SIZE = 16;

/** The 15 paint colours. */
export const PALETTE: number[] = [
  0xf5f5f5, 0x1b1b1b, 0xd42b2b, 0x1f58c7, 0x17305f, 0x4fc3f7, 0x2e8b57, 0x1b5e20, 0xffd447, 0xff7043, 0x7b3fa0, 0xf48fb1,
  0x8b5a2b, 0x8a8a8a, 0xf3e4b3,
];

export const KITS: Kit[] = [
  {
    id: 'madrid',
    name: 'Merengues',
    jersey: 0xf5f5f5,
    jersey2: 0xf5f5f5,
    pattern: 'plain',
    shorts: 0xf5f5f5,
    socks: 0xf5f5f5,
    keeper: { jersey: 0x2e8b57, shorts: 0x1b1b1b, socks: 0x2e8b57 },
  },
  {
    id: 'barca',
    name: 'Blaugrana',
    jersey: 0x1f58c7,
    jersey2: 0xa51a4a,
    pattern: 'stripes',
    shorts: 0x1f3a8a,
    socks: 0x1f3a8a,
    keeper: { jersey: 0xff7043, shorts: 0x1b1b1b, socks: 0xff7043 },
  },
  {
    id: 'milan',
    name: 'Rossoneri',
    jersey: 0xd42b2b,
    jersey2: 0x1b1b1b,
    pattern: 'stripes',
    shorts: 0xf5f5f5,
    socks: 0x1b1b1b,
    keeper: { jersey: 0xffd447, shorts: 0x1b1b1b, socks: 0xffd447 },
  },
  {
    id: 'paris',
    name: 'Parisiens',
    jersey: 0x1b2a5e,
    jersey2: 0xd42b2b,
    pattern: 'band',
    shorts: 0x1b2a5e,
    socks: 0x1b2a5e,
    keeper: { jersey: 0x8a8a8a, shorts: 0x1b1b1b, socks: 0x8a8a8a },
  },
  {
    id: 'dortmund',
    name: 'Schwarzgelb',
    jersey: 0xffd447,
    jersey2: 0x1b1b1b,
    pattern: 'plain',
    shorts: 0x1b1b1b,
    socks: 0xffd447,
    keeper: { jersey: 0x4fc3f7, shorts: 0x1b1b1b, socks: 0x4fc3f7 },
  },
  {
    id: 'united',
    name: 'Red Devils',
    jersey: 0xd42b2b,
    jersey2: 0xf5f5f5,
    pattern: 'plain',
    shorts: 0xf5f5f5,
    socks: 0x1b1b1b,
    keeper: { jersey: 0x2e8b57, shorts: 0x1b1b1b, socks: 0x2e8b57 },
  },
];

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Shirt colour at normalised shirt coordinates (u across, v down), honouring a painted design. */
export function shirtColorAt(kit: Kit, u: number, v: number): number {
  if (kit.design) {
    const n = kit.design.size;
    const x = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
    const y = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
    return PALETTE[kit.design.pixels[y * n + x]] ?? kit.jersey;
  }
  // Pattern frequencies tuned for the 10x4 jersey block of the sprite.
  const x = Math.floor(u * 10);
  const y = Math.floor(v * 4);
  const second = (() => {
    switch (kit.pattern) {
      case 'stripes':
        return (x >> 1) % 2 === 1;
      case 'hoops':
        return y % 2 === 1;
      case 'sash':
        return x + y * 2 >= 6 && x + y * 2 <= 9;
      case 'band':
        return x === 4 || x === 5;
      default:
        return false;
    }
  })();
  return second ? kit.jersey2 : kit.jersey;
}

/** Keeper colours that contrast with the outfield shirt (used for custom kits). */
export function contrastingKeeper(shirt: number): Kit['keeper'] {
  const r = (shirt >> 16) & 255;
  const g = (shirt >> 8) & 255;
  const b = shirt & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const isGreenish = g > r && g > b;
  const jersey = isGreenish ? 0xff7043 : lum > 140 ? 0x2e8b57 : 0xffd447;
  return { jersey, shorts: 0x1b1b1b, socks: jersey };
}

/** A new custom kit, blank in the given base colour. */
export function newCustomKit(name: string, base = 0): Kit {
  const pixels = new Array(DESIGN_SIZE * DESIGN_SIZE).fill(base);
  return {
    id: `custom-${Date.now().toString(36)}`,
    name,
    jersey: PALETTE[base],
    jersey2: PALETTE[base],
    pattern: 'plain',
    shorts: 0x1b1b1b,
    socks: PALETTE[base],
    keeper: contrastingKeeper(PALETTE[base]),
    design: { size: DESIGN_SIZE, pixels },
  };
}

const PREVIEW_OUTLINE = '#141420';

/** A shirt-shaped mask for previews (14 wide, 12 tall). */
const SHIRT_MASK = [
  '..XXXXXXXXXX..',
  '.XXXXXXXXXXXX.',
  'XXXXX....XXXXX',
  'XXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXX',
  'XX.XXXXXXXX.XX',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
];

/** Paint a shirt preview (and shorts under it) onto a canvas at `cell` pixels per mask cell. */
export function kitPreview(kit: Kit, cell: number): HTMLCanvasElement {
  const w = SHIRT_MASK[0].length;
  const h = SHIRT_MASK.length;
  const c = document.createElement('canvas');
  c.width = (w + 2) * cell;
  c.height = (h + 6) * cell;
  const ctx = c.getContext('2d')!;
  ctx.translate(cell, cell);
  // A dark outline one cell wide, so a white or yellow kit still reads on any background.
  const solid = (x: number, y: number) =>
    (y >= 0 && y < h && x >= 0 && x < w && SHIRT_MASK[y][x] === 'X') || (y >= h && y < h + 3 && x >= 3 && x < 11) || (y === h + 3 && ((x >= 3 && x < 6) || (x >= 8 && x < 11)));
  ctx.fillStyle = PREVIEW_OUTLINE;
  for (let y = -1; y <= h + 4; y++) {
    for (let x = -1; x <= w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (SHIRT_MASK[y][x] !== 'X') continue;
      ctx.fillStyle = hex(shirtColorAt(kit, (x + 0.5) / w, (y + 0.5) / h));
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  ctx.fillStyle = hex(kit.shorts);
  ctx.fillRect(3 * cell, h * cell, 8 * cell, 3 * cell);
  ctx.fillStyle = hex(kit.socks);
  ctx.fillRect(3 * cell, (h + 3) * cell, 3 * cell, cell);
  ctx.fillRect(8 * cell, (h + 3) * cell, 3 * cell, cell);
  return c;
}

// ---- Local storage of custom kits ----

const STORE_KEY = 'flicksoccer.kits';

export function loadCustomKits(): Kit[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Kit[];
    return Array.isArray(parsed) ? parsed.filter((k) => k && k.design && Array.isArray(k.design.pixels)) : [];
  } catch {
    return [];
  }
}

export function saveCustomKits(kits: Kit[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(kits));
  } catch {
    /* ignore */
  }
}
