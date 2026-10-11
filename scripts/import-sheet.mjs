// Imports the hand-drawn Aseprite characters under art/sheet into
// src/data/sheet.json as the painter's letter templates, so kits and looks
// recolour them at runtime exactly like the typed sprites and the generated
// frames (scripts/import-frames.mjs).
//
//   npm run sheet
//
// Unlike the generated frames, the Aseprite files keep every material on its
// own layer (body, jersey, short, socks, boots, gloves, Hair..Hair5), so the
// split is exact: a layer maps to a material and the pixel's colour (a fixed
// palette per layer, checked below) picks the tone letter. Hair layers are
// emitted as overlays per style so a look can pick one (or none: bald). The
// `ball` and `VFX` layers are dropped (the game draws its own ball), and the
// `stripes*` trim layers are off unless TRIMS is set.
//
// Every frame is cropped to its own box; `x, y` is the crop's offset in the
// 128x64 canvas, and every standing frame has its feet on canvas row 47,
// centred on column 64, which is the pivot the runtime anchors to (ORIGIN).
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const ROOT = new URL('../art/sheet/', import.meta.url);
const OUT = new URL('../src/data/sheet.json', import.meta.url);

/** Animations to import per file: tag name -> key in sheet.json. */
const PLAYER_ANIMS = ['idle', 'run', 'sprint', 'jump', 'defensive_stance', 'slide_tackle', 'shoot_ball', 'volley_kick', 'celebration_1'];
const KEEPER_ANIMS = ['idle', 'defensive_stance', 'slide', 'clearance', 'clearance_2', 'hold_ball'];
const FRAME_MS = 100;
/** Feet row (bottom edge) and centre column of a standing figure in the canvas. */
const ORIGIN = [64.5, 48];
/** Paint the jersey trim layers (stripes1-3) as the collar material (the second kit colour). */
const TRIMS = false;

/** Material per layer and the tone letter per colour (rig.ts LETTERS). Unknown colours fail the import. */
const LAYERS = {
  body: { '#fdcbb0': 'L', '#fca790': 'S', '#f68181': 's', '#f04f78': 'z' },
  jersey: { '#ffffff': 'I', '#c7dcd0': 'J' },
  short: { '#ffffff': 'P', '#c7dcd0': 'p' },
  socks: { '#ffffff': 'K', '#c7dcd0': 'k' },
  boots: { '#ed8099': 'b', '#cf657f': 'B', '#a24b6f': 'B', '#3e3546': 'B' },
  gloves: { '#ffffff': 'G', '#b33831': 'g', '#ae2334': 'g', '#2e222f': 'y' },
};
const TRIM_LAYERS = { stripes1: 'C', stripes2: 'C', stripes3: 'C' };
const DROP = new Set(['ball', 'VFX', ...(TRIMS ? [] : Object.keys(TRIM_LAYERS))]);
const isHair = (name) => /^Hair\d*$/.test(name);

// ---- Aseprite reading (header, frames, layer / cel / tag chunks; RGBA files only) ----
function readAse(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const i16 = () => { const v = buf.readInt16LE(o); o += 2; return v; };
  const u16 = () => { const v = buf.readUInt16LE(o); o += 2; return v; };
  const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; };
  const str = () => { const n = u16(); const s = buf.toString('utf8', o, o + n); o += n; return s; };
  u32();
  if (u16() !== 0xa5e0) throw new Error('not an Aseprite file');
  const nframes = u16();
  const w = u16();
  const h = u16();
  if (u16() !== 32) throw new Error('only RGBA Aseprite files');
  o = 128;
  const layers = [];
  const frames = [];
  const tags = [];
  for (let f = 0; f < nframes; f++) {
    const start = o;
    const bytes = u32();
    if (u16() !== 0xf1fa) throw new Error(`bad frame magic at frame ${f}`);
    let nch = u16();
    const duration = u16();
    o += 2;
    const nch2 = u32();
    if (nch === 0xffff) nch = nch2;
    const cels = [];
    for (let c = 0; c < nch; c++) {
      const cs = o;
      const size = u32();
      const type = u16();
      if (type === 0x2004) {
        const flags = u16();
        u16(); u16(); u16(); u16(); u16(); u8();
        o += 3;
        layers.push({ name: str(), visible: !!(flags & 1) });
      } else if (type === 0x2005) {
        const li = u16();
        const x = i16();
        const y = i16();
        u8();
        const ct = u16();
        i16();
        o += 5;
        if (ct === 2) {
          const cw = u16();
          const chh = u16();
          cels.push({ li, x, y, w: cw, h: chh, px: inflateSync(buf.subarray(o, cs + size)) });
        } else if (ct === 0) {
          const cw = u16();
          const chh = u16();
          cels.push({ li, x, y, w: cw, h: chh, px: buf.subarray(o, o + cw * chh * 4) });
        } else if (ct === 1) {
          cels.push({ li, link: u16() });
        } else throw new Error(`unsupported cel type ${ct} (tilemaps)`);
      } else if (type === 0x2018) {
        const n = u16();
        o += 8;
        for (let i = 0; i < n; i++) {
          const from = u16();
          const to = u16();
          u8(); u16();
          o += 6;
          o += 4;
          tags.push({ name: str(), from, to });
        }
      }
      o = cs + size;
    }
    frames.push({ duration, cels });
    o = start + bytes;
  }
  // Linked cels point at an earlier frame's cel on the same layer.
  for (const fr of frames) fr.cels = fr.cels.map((c) => (c.link === undefined ? c : frames[c.link].cels.find((d) => d.li === c.li)));
  return { w, h, layers, frames, tags };
}

// ---- PNG decoding for the ball (8-bit RGBA/RGB, non-interlaced) ----
function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      colorType = body[9];
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : (() => { throw new Error(`unsupported colour type ${colorType}`); })();
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[i++];
    const line = Uint8Array.from(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 4] = line[x * bpp];
      px[(y * w + x) * 4 + 1] = line[x * bpp + 1];
      px[(y * w + x) * 4 + 2] = line[x * bpp + 2];
      px[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px };
}

const hexOf = (px, i) => `#${[px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const lum = (hex) => 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16);

/** Paint one cel's letters into a canvas-sized grid; `letterOf(hex)` gives the letter. */
function blit(grid, W, H, cel, letterOf) {
  for (let y = 0; y < cel.h; y++) {
    for (let x = 0; x < cel.w; x++) {
      const i = (y * cel.w + x) * 4;
      if (!cel.px[i + 3]) continue;
      const X = cel.x + x;
      const Y = cel.y + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      grid[Y * W + X] = letterOf(hexOf(cel.px, i));
    }
  }
}

/**
 * Hair tones come from each hair layer's own palette: its most used colour is
 * the base (H), lighter ones the highlight (h), darker ones the shade (x). A
 * stray skin pixel on a hair layer (an ear) keeps its skin letter.
 */
function hairLetters(ase, li) {
  const counts = new Map();
  for (const fr of ase.frames) {
    const cel = fr.cels.find((c) => c && c.li === li);
    if (!cel) continue;
    for (let i = 0; i < cel.w * cel.h; i++) {
      if (!cel.px[i * 4 + 3]) continue;
      const hex = hexOf(cel.px, i * 4);
      if (!LAYERS.body[hex]) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const base = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const map = { ...LAYERS.body };
  for (const hex of counts.keys()) map[hex] = hex === base ? 'H' : lum(hex) > lum(base) ? 'h' : 'x';
  return map;
}

function importFile(name, anims, prefix) {
  const ase = readAse(readFileSync(new URL(`${name}.aseprite`, ROOT)));
  const { w: W, h: H } = ase;
  const bodyLayers = [];
  const hairLayers = [];
  ase.layers.forEach((l, li) => {
    if (DROP.has(l.name)) return;
    if (isHair(l.name)) hairLayers.push({ li, name: l.name, map: hairLetters(ase, li) });
    else if (LAYERS[l.name]) bodyLayers.push({ li, name: l.name, map: LAYERS[l.name] });
    else if (TRIMS && TRIM_LAYERS[l.name]) bodyLayers.push({ li, name: l.name, map: null, letter: TRIM_LAYERS[l.name] });
    else throw new Error(`${name}: unknown layer "${l.name}"; map it in LAYERS or DROP it`);
  });
  const letterFor = (layer) => (hex) => {
    if (layer.letter) return layer.letter;
    const ch = layer.map[hex];
    if (!ch) throw new Error(`${name}: colour ${hex} on layer "${layer.name}" is not in its palette`);
    return ch;
  };
  const out = {};
  for (const tagName of anims) {
    const tag = ase.tags.find((t) => t.name === tagName);
    if (!tag) throw new Error(`${name}: no tag "${tagName}" (have ${ase.tags.map((t) => t.name).join(', ')})`);
    const frames = [];
    const hist = {};
    for (let f = tag.from; f <= tag.to; f++) {
      const fr = ase.frames[f];
      if (fr.duration !== FRAME_MS) throw new Error(`${name}: frame ${f} lasts ${fr.duration} ms, expected ${FRAME_MS}`);
      const body = new Array(W * H).fill('.');
      for (const layer of bodyLayers) {
        const cel = fr.cels.find((c) => c && c.li === layer.li);
        if (cel) blit(body, W, H, cel, letterFor(layer));
      }
      const hairs = hairLayers.map((layer) => {
        const cel = fr.cels.find((c) => c && c.li === layer.li);
        if (!cel) return null;
        const g = new Array(W * H).fill('.');
        blit(g, W, H, cel, letterFor(layer));
        return g;
      });
      // Crop to the union of the body and every hair style, so each overlay fits inside.
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (const g of [body, ...hairs]) {
        if (!g) continue;
        for (let i = 0; i < W * H; i++) {
          if (g[i] === '.') continue;
          const x = i % W;
          const y = (i - x) / W;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) throw new Error(`${name}: frame ${f} of ${tagName} is empty`);
      const cw = x1 - x0 + 1;
      const ch = y1 - y0 + 1;
      const rows = [];
      let jx0 = cw, jx1 = -1, jy0 = ch, jy1 = -1;
      for (let y = 0; y < ch; y++) {
        let row = '';
        for (let x = 0; x < cw; x++) {
          const c = body[(y0 + y) * W + x0 + x];
          row += c;
          if (c !== '.') hist[c] = (hist[c] ?? 0) + 1;
          if ('IJjqm'.includes(c)) {
            if (x < jx0) jx0 = x;
            if (x > jx1) jx1 = x;
            if (y < jy0) jy0 = y;
            if (y > jy1) jy1 = y;
          }
        }
        rows.push(row);
      }
      if (jx1 < 0) throw new Error(`${name}: frame ${f} of ${tagName} has no jersey pixels`);
      const hair = hairs.map((g) => {
        if (!g) return null;
        let hx0 = cw, hy0 = ch, hx1 = -1, hy1 = -1;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          if (g[(y0 + y) * W + x0 + x] === '.') continue;
          if (x < hx0) hx0 = x;
          if (x > hx1) hx1 = x;
          if (y < hy0) hy0 = y;
          if (y > hy1) hy1 = y;
        }
        if (hx1 < 0) return null;
        const hrows = [];
        for (let y = hy0; y <= hy1; y++) {
          let row = '';
          for (let x = hx0; x <= hx1; x++) row += g[(y0 + y) * W + x0 + x];
          hrows.push(row);
        }
        return { x: hx0, y: hy0, rows: hrows };
      });
      frames.push({ x: x0, y: y0, rows, jersey: [jy0, jy1 - jy0 + 1, jx0, jx1 - jx0 + 1], hair });
    }
    const summary = Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ');
    console.log(`${prefix}${tagName}: ${frames.length} frames, ${frames.map((f) => `${f.rows[0].length}x${f.rows.length}`).join(' ')} | ${summary}`);
    out[`${prefix}${tagName}`] = frames;
  }
  console.log(`${name}: hair styles ${hairLayers.map((l) => l.name).join(', ')}`);
  return out;
}

/** The ball: its own colours, as letters A.. with a palette (it is not recoloured). */
function importBall() {
  const { w, px } = decodePng(readFileSync(new URL('ball.png', ROOT)));
  let x0 = w, y0 = w, x1 = -1, y1 = -1;
  for (let i = 0; i < px.length / 4; i++) {
    if (!px[i * 4 + 3]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const colors = {};
  const letters = new Map();
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      if (!px[i + 3]) { row += '.'; continue; }
      const hex = hexOf(px, i);
      if (!letters.has(hex)) {
        const ch = String.fromCharCode(65 + letters.size);
        letters.set(hex, ch);
        colors[ch] = hex;
      }
      row += letters.get(hex);
    }
    rows.push(row);
  }
  console.log(`ball: ${rows[0].length}x${rows.length}, ${letters.size} colours`);
  return { rows, colors };
}

const anims = { ...importFile('character', PLAYER_ANIMS, ''), ...importFile('goalkeeper', KEEPER_ANIMS, 'gk-') };
const ball = importBall();
writeFileSync(OUT, JSON.stringify({ frameMs: FRAME_MS, origin: ORIGIN, anims, ball }) + '\n');
const total = Object.values(anims).reduce((n, fs) => n + fs.length, 0);
console.log(`wrote ${total} frames in ${Object.keys(anims).length} animations to src/data/sheet.json`);
