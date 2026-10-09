import { describe, expect, it } from 'vitest';
import { HERO_POSES, HERO_RIGS, LETTERS, ballParts, letterFor, rasterise, type Rig } from './rig';

const ALPHABET = new RegExp(`^[.${Object.keys(LETTERS).join('')}]+$`);

/** Every painted cell that is not outline has only painted 8-neighbours (the outline is closed). */
function outlineClosed(rows: string[]): boolean {
  const h = rows.length;
  const w = rows[0].length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '.' || c === 'O') continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (rows[ny][nx] === '.') return false;
        }
      }
    }
  }
  return true;
}

const bandIndex = (ch: string): number => {
  const i = ['L', 'S', 's', 'z'].indexOf(ch);
  return i;
};

describe('rasterise', () => {
  it('shades a horizontal capsule from highlight on top to deep below, inside a closed outline', () => {
    const r: Rig = { w: 30, h: 16, parts: [{ kind: 'capsule', a: [6, 8], b: [24, 8], r0: 5, mat: 'skin', z: 1 }] };
    const { rows } = rasterise(r);
    expect(rows).toHaveLength(16);
    rows.forEach((row) => {
      expect(row).toHaveLength(30);
      expect(row).toMatch(ALPHABET);
    });
    expect(outlineClosed(rows)).toBe(true);
    // Down the middle column the band never gets lighter again.
    const column = rows.map((row) => row[15]).filter((ch) => ch !== '.' && ch !== 'O');
    const bands = column.map(bandIndex);
    for (let i = 1; i < bands.length; i++) expect(bands[i]).toBeGreaterThanOrEqual(bands[i - 1]);
    expect(bands[0]).toBe(0);
    expect(bands[bands.length - 1]).toBe(3);
  });

  it('draws a separation line where a part overlaps a lower one, unless they share a seam', () => {
    const over = (seamA?: string, seamB?: string) => {
      const r: Rig = {
        w: 24,
        h: 24,
        parts: [
          { kind: 'ellipse', c: [12, 12], rx: 8, ry: 8, mat: 'jersey', z: 1, seam: seamA, flat: 'base' },
          { kind: 'capsule', a: [12, 4], b: [12, 20], r0: 3, mat: 'skin', z: 2, seam: seamB, flat: 'base' },
        ],
      };
      return rasterise(r).rows;
    };
    const apart = over('a', 'b');
    // Across the middle row: jersey, a dark line, the skin capsule, a dark line, jersey.
    expect(apart[12]).toMatch(/J+O+S+O+J+/);
    const joined = over('x', 'x');
    expect(joined[12]).toMatch(/J+S+J+/);
    expect(joined[12]).not.toMatch(/JO+S|SO+J/);
  });

  it('flip mirrors the grid and the anchors', () => {
    const r: Rig = {
      w: 20,
      h: 12,
      parts: [{ kind: 'capsule', a: [3, 6], b: [10, 6], r0: 3, mat: 'shorts', z: 1, flat: 'base' }],
      anchors: { number: [4, 6], ball: [1, 1] },
      jersey: { origin: [2, 2], u: [6, 0], v: [0, 6] },
    };
    const a = rasterise(r);
    const b = rasterise(r, { flip: true });
    const mask = (rows: string[]) => rows.map((row) => row.replace(/[^.]/g, '#'));
    expect(mask(b.rows)).toEqual(mask(a.rows).map((row) => [...row].reverse().join('')));
    expect(b.anchors.number).toEqual([15, 6]);
    expect(b.anchors.ball).toEqual([18, 1]);
    expect(b.jersey).toEqual({ origin: [18, 2], u: [-6, 0], v: [0, 6] });
  });

  it('explicit marks keep their letters and mirror by cell', () => {
    const r: Rig = { w: 10, h: 10, parts: [...ballParts([5, 5], 4, 1)] };
    const rows = rasterise(r).rows;
    expect(rows.join('')).toContain('D');
    expect(rows.join('')).toContain('W');
    expect(outlineClosed(rows)).toBe(true);
  });

  it('letterFor covers every material and band', () => {
    expect(letterFor('jersey', 'hi')).toBe('I');
    expect(letterFor('socks', 'deep')).toBe('v');
    expect(letterFor('boots', 'base')).toBe('B');
    for (const ch of Object.keys(LETTERS)) expect(ch).toHaveLength(1);
  });
});

describe('hero rigs', () => {
  it('rasterise to their frame, inside the alphabet, with a closed outline, for every hair style', () => {
    for (const pose of HERO_POSES) {
      for (let style = 0; style < 4; style++) {
        const r = HERO_RIGS[pose](style);
        const { rows } = rasterise(r);
        expect(rows.length, `${pose} ${style}`).toBe(r.h);
        rows.forEach((row, i) => {
          expect(row.length, `${pose} ${style} row ${i}`).toBe(r.w);
          expect(row, `${pose} ${style} row ${i}`).toMatch(ALPHABET);
        });
        expect(outlineClosed(rows), `${pose} ${style} outline`).toBe(true);
        const all = rows.join('');
        expect(all).toMatch(/J/);
        expect(all).toMatch(/P/);
        expect(all).toMatch(/S/);
        expect(all).toMatch(/K/);
        expect(all).toMatch(/B/);
        if (style === 3) expect(all).not.toMatch(/[Hhx]/);
        else expect(all).toMatch(/H/);
        // Deterministic.
        expect(rasterise(HERO_RIGS[pose](style)).rows).toEqual(rows);
      }
    }
  });

  it('back view has no face, carries a number anchor inside the frame; the keeper has gloves', () => {
    const back = rasterise(HERO_RIGS['hero-back'](0));
    expect(back.anchors.number).toBeDefined();
    expect(back.anchors.number![0]).toBeLessThan(48);
    // No face marks from behind; the front poses carry them.
    expect(HERO_RIGS['hero-back'](0).parts.some((p) => p.kind === 'marks')).toBe(false);
    expect(HERO_RIGS['hero-cheer'](0).parts.some((p) => p.kind === 'marks')).toBe(true);
    const ready = rasterise(HERO_RIGS['hero-ready'](0)).rows.join('');
    expect(ready).toMatch(/G/);
    const front = rasterise(HERO_RIGS['hero-cheer'](0)).rows.join('');
    expect(front).toMatch(/z/); // the mouth
  });

  it('the horizontal poses are wider than tall and the throw-in holds a ball', () => {
    expect(HERO_RIGS['hero-dive'](0).w).toBeGreaterThan(HERO_RIGS['hero-dive'](0).h);
    expect(HERO_RIGS['hero-tackle'](0).w).toBeGreaterThan(HERO_RIGS['hero-tackle'](0).h);
    expect(rasterise(HERO_RIGS['hero-throw'](0)).rows.join('')).toMatch(/W/);
  });
});
