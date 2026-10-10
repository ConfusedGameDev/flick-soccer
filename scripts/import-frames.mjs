// Imports the generated 48x48 sprite frames under art/frames/<state>/<dir>.png
// into src/data/frames.json as the painter's letter templates, so kits and
// looks recolour them at runtime exactly like the typed sprites.
//
//   npm run frames
//
// Each opaque pixel is classified into a material and a tone from its colour
// family (the generated character wears a white kit with blue trim, brown
// hair, navy boots). Shirt and shorts share the white ramp and are split along
// the body axis (hair centroid -> boots centroid); socks are the other white
// blobs; in the Idle frames the ball blob is erased.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const ROOT = new URL('../art/frames/', import.meta.url);
const OUT = new URL('../src/data/frames.json', import.meta.url);
const STATES = ['idle', 'run', 'slide'];
const DIRS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
/** Where the shorts start along the torso blob's extent (hair -> boots), per state. */
const SHORTS_AT = { idle: 0.6, run: 0.58, slide: 0.58 };
/** Radius of the ball cut out of the Idle frames, around its black panels. */
const BALL_R = 7.5;

// ---- PNG decoding (8-bit RGBA or RGB, non-interlaced, which is what the generator writes) ----
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

// ---- Colour families ----
function hsv(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Material family and tone band (0 hi .. 3 deep) of a pixel; 'W' is the shared white ramp. */
function family(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const { h, s, v } = hsv(r, g, b);
  if (lum < 12) return { fam: 'O' };
  // Hair is the red-brown family; skin the orange one. They overlap in hue, so the darker, redder pixels are hair.
  if ((h >= 340 || h < 14.5) && s >= 0.3 && lum < 130) return { fam: 'H', band: lum < 60 ? 3 : lum < 100 ? 1 : 0 };
  if (h >= 8 && h < 40 && s >= 0.25) return { fam: 'S', band: lum < 100 ? 3 : lum < 150 ? 2 : lum < 185 ? 1 : 0 };
  // Boots: anything else this dark (navy, purple-grey soles), plus the dull greys just above.
  if (lum < 62 || (s < 0.2 && lum < 90)) return { fam: 'B', band: lum < 62 ? 1 : 0 };
  if (h >= 195 && h < 250 && s >= 0.42) return { fam: 'C', band: lum < 75 ? 2 : 1 };
  return { fam: 'W', band: lum >= 225 ? 1 : lum >= 195 ? 4 : lum >= 150 ? 2 : 3 };
}

// Letters per family and band: [hi, base, shade, deep, mid]
const LETTERS = {
  H: ['h', 'H', 'x', 'x', 'H'],
  S: ['L', 'S', 's', 'z', 'S'],
  C: ['C', 'C', 'c', 'c', 'C'],
  B: ['b', 'B', 'B', 'B', 'B'],
  jersey: ['I', 'J', 'j', 'q', 'm'],
  shorts: ['P', 'P', 'p', 'w', 'n'],
  socks: ['K', 'K', 'k', 'v', 'o'],
};

function components(cells, w, h, pred) {
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !pred(cells[y * w + x], y * w + x)) continue;
      const pts = [];
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        pts.push([cx, cy]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !pred(cells[ny * w + nx], ny * w + nx)) continue;
            seen[ny * w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      out.push(pts);
    }
  }
  return out;
}

const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

function importFrame(state, dir) {
  const { w, h, px } = decodePng(readFileSync(new URL(`${state}/${dir}.png`, ROOT)));
  const cells = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] < 128) continue;
    cells[i] = family(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  }
  const at = (x, y) => cells[y * w + x];
  const hair = [];
  const boots = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c?.fam === 'H') hair.push([x, y]);
    if (c?.fam === 'B') boots.push([x, y]);
  }
  if (!hair.length) throw new Error(`${state}/${dir}: no hair pixels found; check the colour families`);
  const head = centroid(hair);
  // Feet: the boots, or failing that the lowest painted rows.
  let feet = boots.length ? centroid(boots) : null;
  if (!feet) {
    const low = [];
    for (let y = h - 1; y >= 0 && low.length < 12; y--) for (let x = 0; x < w; x++) if (at(x, y)) low.push([x, y]);
    feet = centroid(low);
  }
  const axis = [feet[0] - head[0], feet[1] - head[1]];
  const axisLen = Math.hypot(axis[0], axis[1]) || 1;
  const t = ([x, y]) => ((x - head[0]) * axis[0] + (y - head[1]) * axis[1]) / (axisLen * axisLen);

  // The ball (Idle frames): black panel pixels enclosed by white. Cut a disc around their centre
  // before anything else, so neither the torso pick nor the socks see it.
  const erased = new Set();
  if (state === 'idle') {
    const panels = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (at(x, y)?.fam !== 'O') continue;
      let inside = 0;
      let white = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = at(x + dx, y + dy);
        if (m && (m.fam === 'W' || m.fam === 'O')) inside++;
        if (m?.fam === 'W') white++;
      }
      if (inside === 4 && white >= 2) panels.push([x, y]);
    }
    if (panels.length >= 2) {
      // Flood the white and black pixels joined to the panels, no further than BALL_R from them,
      // so a sock or boot that touches the ball keeps everything beyond the ball's rim.
      const [cx, cy] = centroid(panels);
      const stack = [...panels];
      for (const [x, y] of panels) erased.add(y * w + x);
      while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const i = ny * w + nx;
          const c = at(nx, ny);
          if (!c || erased.has(i) || (c.fam !== 'W' && c.fam !== 'O')) continue;
          if (Math.hypot(nx - cx, ny - cy) > BALL_R) continue;
          erased.add(i);
          stack.push([nx, ny]);
        }
      }
    }
  }
  const painted = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] && !erased.has(y * w + x);

  // White blobs: with the ball gone the biggest is the torso (shirt + shorts); the rest are socks.
  const white = components(cells, w, h, (c, i) => c?.fam === 'W' && !erased.has(i)).sort((a, b) => b.length - a.length);
  const torso = white[0];
  const ts = torso.map(t);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const split = tMin + (tMax - tMin) * SHORTS_AT[state];
  const letters = new Array(w * h).fill('.');
  const role = new Array(w * h).fill(null);
  for (const [x, y] of torso) role[y * w + x] = t([x, y]) > split ? 'shorts' : 'jersey';
  for (const blob of white.slice(1)) for (const [x, y] of blob) role[y * w + x] = 'socks';

  const hist = {};
  for (let i = 0; i < w * h; i++) {
    const c = cells[i];
    if (!c || erased.has(i)) continue;
    let ch;
    if (c.fam === 'O') ch = 'O';
    else if (c.fam === 'W') ch = LETTERS[role[i] ?? 'socks'][c.band];
    else ch = LETTERS[c.fam][c.band];
    letters[i] = ch;
    hist[ch] = (hist[ch] ?? 0) + 1;
  }
  // Where the ball was cut away, close the outline along the cut.
  if (erased.size) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (letters[i] === '.' || letters[i] === 'O') continue;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => erased.has((y + dy) * w + (x + dx)) && !painted(x + dx, y + dy));
      if (open) {
        letters[i] = 'O';
        hist.O = (hist.O ?? 0) + 1;
        hist[letters[i]] = Math.max(0, (hist[letters[i]] ?? 1) - 1);
      }
    }
    // Lone outline pixels left floating (they only framed the ball) go too.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (letters[i] !== 'O') continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && letters[ny * w + nx] !== '.' && letters[ny * w + nx] !== 'O') { touch = true; break; }
      }
      if (!touch) letters[i] = '.';
    }
  }
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(letters.slice(y * w, (y + 1) * w).join(''));
  let jx0 = w, jx1 = -1, jy0 = h, jy1 = -1, baseline = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = letters[y * w + x];
    if (ch === '.') continue;
    baseline = Math.max(baseline, y);
    if ('IJjqm'.includes(ch)) {
      jx0 = Math.min(jx0, x); jx1 = Math.max(jx1, x); jy0 = Math.min(jy0, y); jy1 = Math.max(jy1, y);
    }
  }
  const summary = Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ');
  console.log(`${state}/${dir}: ${summary}${erased.size ? ` | ball erased ${erased.size}px` : ''}`);
  return { rows, jersey: [jy0, jy1 - jy0 + 1, jx0, jx1 - jx0 + 1], baseline };
}

const states = {};
for (const state of STATES) {
  states[state] = {};
  for (const dir of DIRS) states[state][dir] = importFrame(state, dir);
}
writeFileSync(OUT, JSON.stringify({ size: 48, states }) + '\n');
console.log(`wrote ${STATES.length * DIRS.length} frames to src/data/frames.json`);
