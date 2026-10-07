// Kit definitions. Colors are hex numbers; patterns are applied per pixel by
// the sprite painter. The four presets are "inspired by" the 1990 kits of
// América, Chivas, Pumas and Cruz Azul: no crests, no licensed marks.

export type KitPattern = 'plain' | 'stripes' | 'hoops' | 'sash';

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
}

export const KITS: Kit[] = [
  {
    id: 'america',
    name: 'Águilas 1990',
    jersey: 0xf3e4b3,
    jersey2: 0x17305f,
    pattern: 'sash',
    shorts: 0x17305f,
    socks: 0xf3e4b3,
    keeper: { jersey: 0x2e8b57, shorts: 0x1b1b1b, socks: 0x2e8b57 },
  },
  {
    id: 'chivas',
    name: 'Rebaño 1990',
    jersey: 0xd42b2b,
    jersey2: 0xf5f5f5,
    pattern: 'stripes',
    shorts: 0x1c2f6b,
    socks: 0xf5f5f5,
    keeper: { jersey: 0xffd447, shorts: 0x1b1b1b, socks: 0xffd447 },
  },
  {
    id: 'pumas',
    name: 'Auriazul 1990',
    jersey: 0xf1b63a,
    jersey2: 0x1b2a5e,
    pattern: 'hoops',
    shorts: 0x1b2a5e,
    socks: 0x1b2a5e,
    keeper: { jersey: 0xe8e8e8, shorts: 0x1b1b1b, socks: 0xe8e8e8 },
  },
  {
    id: 'cruzazul',
    name: 'Celeste 1990',
    jersey: 0x1f58c7,
    jersey2: 0xf5f5f5,
    pattern: 'plain',
    shorts: 0xf5f5f5,
    socks: 0x1f58c7,
    keeper: { jersey: 0xff7043, shorts: 0x1b1b1b, socks: 0xff7043 },
  },
];

export const kitById = (id: string): Kit => KITS.find((k) => k.id === id) ?? KITS[0];

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
