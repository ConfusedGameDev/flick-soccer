import { planAttack, planDefense } from '../engine/cpu';
import { initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { MatchState } from '../engine/types';
import { KITS, type Kit } from '../render/kits';
import { drawBooster, flipCoin } from '../engine/boosters';
import { mulberry32 } from '../engine/rng';
import type { PiecesView } from '../render/PiecesView';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import { DIRS, FRAME_STATES } from '../render/frames';
import { SHEET_ANIMS, SHEET_FRAME_MS, sheetFrame, sheetFrameAt, sheetFrames, sheetPivot } from '../render/sheet';
import { HERO_POSES, frameCanvas, paintSheet, sheetCanvas, spriteCanvas, type HeroPose } from '../render/sprites';
import type { Cutscene, CutsceneKind } from './Cutscene';
import type { SetPiece } from './SetPiece';
import type { CoinToss } from './CoinToss';
import type { Duel } from './Duel';
import type { PackView } from './PackView';

// Preview routes for the art (`?demo=sheet|frames|anim|pitch|cutscenes|shot|keeper|pack|toss|duel`),
// loaded on demand from main.ts. They exist so the figures can be iterated
// against screenshots, and checked on a preview deploy, without playing a match.

export interface DemoDeps {
  overlay: HTMLElement;
  cutscene: Cutscene;
  setPiece: SetPiece;
  pieces: PiecesView;
  player: TimelinePlayer;
  pack: PackView;
  toss: CoinToss;
  duel: Duel;
}

const KINDS: CutsceneKind[] = ['goal', 'save', 'overtake', 'duel', 'corner', 'throw-in'];

export async function runDemo(route: string, deps: DemoDeps): Promise<void> {
  const q = new URLSearchParams(location.search);
  const kit = KITS[Number(q.get('kit') ?? 1) % KITS.length];
  const other = KITS[Number(q.get('other') ?? 0) % KITS.length];
  if (route === 'sheet') return sheet(deps.overlay, kit, q);
  if (route === 'frames') return frames(deps.overlay, kit, other, q);
  if (route === 'anim') return anim(deps.overlay, kit, other, q);
  if (route === 'pitch') return pitchLoop(deps.pieces, deps.player, kit, other, q);
  if (route === 'cutscenes') return cutscenes(deps.cutscene, kit, other, q);
  if (route === 'shot') return shot(deps.setPiece, kit, other, q);
  if (route === 'keeper') return keeperGame(deps.setPiece, other);
  if (route === 'pack') return pack(deps.pack, kit, q);
  if (route === 'toss') return toss(deps.toss, kit, q);
  if (route === 'duel') return duel(deps.duel, kit, other, q);
}

/** A pack opening, over and over; `&auto=1` lets the middle card turn by itself, `&seed=` picks the card. */
async function pack(view: PackView, kit: Kit, q: URLSearchParams): Promise<void> {
  const auto = q.get('auto') === '1';
  for (let i = Number(q.get('seed') ?? 1); ; i++) {
    await view.show({ title: auto ? 'Away (CPU) open a pack' : 'Home: trade a flick for a card', booster: drawBooster(mulberry32(i)), pick: !auto, kit });
  }
}

/** The toss: call, then the coin lands on the seeded face; `&seed=` picks the face. */
async function toss(view: CoinToss, kit: Kit, q: URLSearchParams): Promise<void> {
  for (let i = Number(q.get('seed') ?? 1); ; i++) {
    const call = await view.call({ title: 'Home call the toss', text: 'Heads or tails? Call it right and you attack first.', kit });
    const coin = flipCoin(mulberry32(i));
    await view.flip({ title: 'The toss', coin, caption: `Home called ${call}: it is ${coin}. ${coin === call ? 'Home' : 'Away'} attack first.`, kit, button: 'Kick off' });
  }
}

/** Every hero pose, four hair styles, outfield and keeper, on black. */
function sheet(overlay: HTMLElement, kit: Kit, q: URLSearchParams): void {
  const k = Number(q.get('k') ?? 3);
  const flip = q.get('flip') === '1';
  const only = q.get('pose');
  const root = document.createElement('div');
  root.className = 'demo-sheet';
  for (const pose of HERO_POSES as HeroPose[]) {
    if (only && pose !== only) continue;
    const row = document.createElement('div');
    row.className = 'demo-row';
    const label = document.createElement('div');
    label.className = 'demo-label';
    label.textContent = pose;
    row.appendChild(label);
    for (let style = 0; style < 4; style++) {
      row.appendChild(spriteCanvas(pose, kit, false, k, { skin: style, hair: style, style }, flip));
    }
    row.appendChild(spriteCanvas(pose, kit, true, k, { skin: 1, hair: 2, style: 0 }, flip));
    root.appendChild(row);
  }
  overlay.appendChild(root);
}

/** The imported frames: every state and direction, in two kits, four looks and the keeper colours. */
function frames(overlay: HTMLElement, kit: Kit, other: Kit, q: URLSearchParams): void {
  const k = Number(q.get('k') ?? 3);
  const root = document.createElement('div');
  root.className = 'demo-sheet';
  for (const state of FRAME_STATES) {
    for (const [i, k2] of [kit, other].entries()) {
      const row = document.createElement('div');
      row.className = 'demo-row';
      const label = document.createElement('div');
      label.className = 'demo-label';
      label.textContent = `${state} · ${k2.name}`;
      row.appendChild(label);
      for (const dir of DIRS) row.appendChild(frameCanvas(state, dir, k2, false, k, { skin: (i + DIRS.indexOf(dir)) % 4, hair: DIRS.indexOf(dir) % 5, style: DIRS.indexOf(dir) % 4 }));
      row.appendChild(frameCanvas(state, 's', k2, true, k, { skin: 1, hair: 2, style: 0 }));
      root.appendChild(row);
    }
  }
  overlay.appendChild(root);
}

/**
 * The drawn sheet (art/sheet): every animation in two kits, each frame still and then
 * playing on its pivot. `&style=` picks the hair, `&flip=1` mirrors, `&anim=` shows one.
 */
function anim(overlay: HTMLElement, kit: Kit, other: Kit, q: URLSearchParams): void {
  const k = Number(q.get('k') ?? 3);
  const flip = q.get('flip') === '1';
  const style = Number(q.get('style') ?? 0);
  const only = q.get('anim');
  const root = document.createElement('div');
  root.className = 'demo-sheet';
  const players: { canvas: HTMLCanvasElement; paint: (ms: number) => void }[] = [];
  for (const a of SHEET_ANIMS) {
    if (only && a !== only) continue;
    const keeper = a.startsWith('gk-');
    for (const [n, k2] of [kit, other].entries()) {
      const look = { skin: n + 1, hair: n * 2, style };
      const row = document.createElement('div');
      row.className = 'demo-row';
      const label = document.createElement('div');
      label.className = 'demo-label';
      label.textContent = `${a} · ${k2.name}`;
      row.appendChild(label);
      for (let i = 0; i < sheetFrames(a); i++) row.appendChild(sheetCanvas(a, i, k2, keeper, k, look, flip));
      // The playing copy: a fixed box with the pivot at a fixed spot, so slides and dives stay planted.
      const box = document.createElement('canvas');
      box.width = 48 * k;
      box.height = 40 * k;
      const g = box.getContext('2d')!;
      players.push({
        canvas: box,
        paint: (ms) => {
          const i = sheetFrameAt(a, ms);
          const f = sheetFrame(a, i);
          const [px, py] = sheetPivot(f, flip);
          g.clearRect(0, 0, box.width, box.height);
          g.fillStyle = '#2a9a44';
          g.fillRect(0, 36 * k, box.width, 4 * k);
          paintSheet(g, a, i, k2, keeper, (24 - px) * k, (36 - py) * k, k, look, flip);
        },
      });
      row.appendChild(box);
      root.appendChild(row);
    }
  }
  overlay.appendChild(root);
  const t0 = performance.now();
  const loop = () => {
    const ms = performance.now() - t0;
    for (const p of players) p.paint(ms % (SHEET_FRAME_MS * 24));
    requestAnimationFrame(loop);
  };
  loop();
}

/** CPU vs CPU turns played on the pitch forever, to see the player sprites move (`&speed=0.5` slows it). */
async function pitchLoop(pieces: PiecesView, player: TimelinePlayer, kit: Kit, other: Kit, q: URLSearchParams): Promise<void> {
  const speed = Number(q.get('speed') ?? 0.6);
  pieces.setKits({ home: kit, away: other });
  let s: MatchState = initialMatch();
  pieces.rebuild(s.players);
  let turn = 0;
  for (;;) {
    turn++;
    const seed = 1000 + turn;
    const att = s.possession.team;
    const def = att === 'home' ? 'away' : 'home';
    const r = resolveTurn(s, planAttack(s, att, 'normal', seed), planDefense(s, def, 'normal', seed + 7), seed);
    pieces.setPositions(
      s.players.map((p) => p.pos),
      s.ball,
    );
    await player.play(r, speed);
    s = r.state;
    if (s.status === 'duel') s = resolveDuel(s, turn % 2 ? 'home' : 'away', seed).state;
    if (s.status === 'half-time') s = continueMatch(s);
    if (s.status === 'full-time') {
      s = initialMatch();
      pieces.rebuild(s.players);
    }
    pieces.setPositions(
      s.players.map((p) => p.pos),
      s.ball,
    );
    await new Promise((res) => setTimeout(res, 600));
  }
}

async function cutscenes(cutscene: Cutscene, kit: Kit, other: Kit, q: URLSearchParams): Promise<void> {
  const only = q.get('kind') as CutsceneKind | null;
  const hold = q.get('hold') === '1';
  for (;;) {
    for (const kind of KINDS) {
      if (only && kind !== only) continue;
      const keeper = kind === 'save';
      await cutscene.show({
        kind,
        kit,
        keeper,
        name: keeper ? 'Cortois' : 'Holland',
        team: 'Home',
        foil: { kit: other, keeper: kind === 'goal', name: kind === 'goal' ? 'Allison' : 'Van Dyke' },
        holdMs: hold ? Number.POSITIVE_INFINITY : undefined,
      });
    }
    if (only && hold) return;
  }
}

async function shot(setPiece: SetPiece, kit: Kit, other: Kit, q: URLSearchParams): Promise<void> {
  const depth = Number(q.get('depth') ?? 0.1);
  await setPiece.run({
    kind: 'shot',
    kit,
    keeper: false,
    name: 'Holland',
    stat: 4,
    goal: 'ahead',
    number: 9,
    goalie: { kit: other, name: 'Cortois', x: 0.3, depth },
    offset: 0,
  });
}

/** The keeper game, over and over. */
async function keeperGame(setPiece: SetPiece, kit: Kit): Promise<void> {
  for (;;) {
    await setPiece.run({ kind: 'keeper', kit, keeper: true, name: 'Cortois', stat: 4, goal: 'ahead', number: 1, hint: 'Tap to stop the arrow on the way you want him to dive, then tap to set how far he flies.', goalie: { kit, name: 'Cortois', x: 0, depth: 0 } });
  }
}

/** The dispute-ball duel against a CPU masher, over and over; `&rate=` sets its presses per second. */
async function duel(view: Duel, kit: Kit, other: Kit, q: URLSearchParams): Promise<void> {
  const rate = Number(q.get('rate') ?? 4);
  for (;;) await view.run({ left: 'home', right: 'away' }, { home: 'Home', away: 'Away' }, { side: 'right', rate }, undefined, { home: kit, away: other });
}
