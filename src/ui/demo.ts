import { KITS, type Kit } from '../render/kits';
import { drawBooster, flipCoin } from '../engine/boosters';
import { mulberry32 } from '../engine/rng';
import { HERO_POSES, spriteCanvas, type HeroPose } from '../render/sprites';
import type { Cutscene, CutsceneKind } from './Cutscene';
import type { SetPiece } from './SetPiece';
import type { CoinToss } from './CoinToss';
import type { PackView } from './PackView';

// Preview routes for the procedural art (`?demo=sheet|cutscenes|shot|pack|toss`),
// loaded on demand from main.ts. They exist so the figures can be iterated
// against screenshots, and checked on a preview deploy, without playing a match.

export interface DemoDeps {
  overlay: HTMLElement;
  cutscene: Cutscene;
  setPiece: SetPiece;
  pack: PackView;
  toss: CoinToss;
}

const KINDS: CutsceneKind[] = ['goal', 'save', 'overtake', 'duel', 'corner', 'throw-in'];

export async function runDemo(route: string, deps: DemoDeps): Promise<void> {
  const q = new URLSearchParams(location.search);
  const kit = KITS[Number(q.get('kit') ?? 1) % KITS.length];
  const other = KITS[Number(q.get('other') ?? 0) % KITS.length];
  if (route === 'sheet') return sheet(deps.overlay, kit, q);
  if (route === 'cutscenes') return cutscenes(deps.cutscene, kit, other, q);
  if (route === 'shot') return shot(deps.setPiece, kit, other, q);
  if (route === 'pack') return pack(deps.pack, kit, q);
  if (route === 'toss') return toss(deps.toss, kit, q);
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
