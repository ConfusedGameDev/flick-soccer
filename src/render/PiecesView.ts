import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { PlayerState, Team, Vec2 } from '../engine/types';
import { KITS, type Kit } from './kits';
import type { PitchView } from './PitchView';
import { FRAME_FIGURE_H, dirFromDelta, frame, type Dir8, type FrameState } from './frames';
import { spriteSet } from './spriteSet';
import { SPRITE_H, ballTexture, frameTexture, lookFor, spriteTexture, type Pose } from './sprites';

export const PLAYER_RADIUS_M = 1.3;
/** How tall a player sprite is in world meters; larger than life, as in 16-bit football games. */
const SPRITE_HEIGHT_M = 5;
const RUN_FRAME_MS = 130;

const CARRIER_RING = 0xffd447;
const FLICKABLE_RING = 0xffffff;

interface Piece {
  root: Container;
  shadow: Graphics;
  ring: Graphics;
  sprite: Sprite;
  name: Text;
  last: Vec2 | null;
  moving: boolean;
  facing: 1 | -1;
  /** Eight-way facing for the imported frames (screen space). */
  dir: Dir8;
  sliding: boolean;
}

export type Kits = Record<Team, Kit>;

/** Pixel-art players and the ball. Positions are set every frame; poses follow movement. */
export class PiecesView {
  readonly root = new Container();
  private pieces: Piece[] = [];
  private players: readonly PlayerState[] = [];
  private kits: Kits = { home: KITS[0], away: KITS[1] };
  private readonly ball = new Sprite(ballTexture());
  private readonly ballShadow = new Graphics();
  /** Dashed rings for unfilled formation slots (team builder). */
  private readonly slotsG = new Graphics();
  private slots: Vec2[] = [];
  private carrierId: number | null = null;
  private flickable = new Set<number>();
  private showNames = true;
  private runClock = 0;

  constructor(
    private readonly pitch: PitchView,
    players: readonly PlayerState[],
  ) {
    this.ball.anchor.set(0.5, 0.8);
    this.root.addChild(this.slotsG, this.ballShadow, this.ball);
    this.rebuild(players);
  }

  setKits(kits: Kits): void {
    this.kits = kits;
    this.rebuild(this.players);
  }

  get currentKits(): Kits {
    return this.kits;
  }

  /** The imported frames (art/frames) or the typed templates. */
  private readonly frames = spriteSet() === 'generated';

  /** Integer pixel scale that makes a sprite about SPRITE_HEIGHT_M tall. */
  private get k(): number {
    return Math.max(1, Math.round((SPRITE_HEIGHT_M * this.pitch.scale) / (this.frames ? FRAME_FIGURE_H : SPRITE_H)));
  }

  /** The texture for a piece's current pose and facing. */
  private textureFor(piece: Piece, p: PlayerState, runFrame: 0 | 1): Texture {
    const look = lookFor(p.name);
    if (this.frames) {
      // One run frame so far: the cycle alternates the stride with the idle stance.
      const state: FrameState = piece.sliding ? 'slide' : piece.moving && runFrame === 0 ? 'run' : 'idle';
      return frameTexture(state, piece.dir, this.kits[p.team], p.keeper, look);
    }
    const pose: Pose = piece.sliding ? 'slide' : piece.moving ? (runFrame === 0 ? 'run1' : 'run2') : 'stand';
    return spriteTexture(pose, this.kits[p.team], p.keeper, look);
  }

  /** Feet on the piece position: the frame's baseline row, or the bottom of a typed template. */
  private anchorFor(piece: Piece): void {
    if (!this.frames) return;
    const state: FrameState = piece.sliding ? 'slide' : piece.moving ? 'run' : 'idle';
    const f = frame(state, piece.dir);
    piece.sprite.anchor.set(0.5, (f.baseline + 1) / f.rows.length);
  }

  /** Replace every piece (new squads or kits). */
  rebuild(players: readonly PlayerState[]): void {
    for (const p of this.pieces) p.root.destroy({ children: true });
    this.pieces = [];
    this.players = players;
    for (const p of players) {
      const root = new Container();
      const shadow = new Graphics();
      const ring = new Graphics();
      // Kickoff facing: toward the goal each side attacks (home up the screen).
      const dir: Dir8 = p.team === 'home' ? 'n' : 's';
      const piece0 = { last: null, moving: false, facing: 1 as const, dir, sliding: false };
      const sprite = new Sprite(this.frames ? frameTexture('idle', dir, this.kits[p.team], p.keeper, lookFor(p.name)) : spriteTexture('stand', this.kits[p.team], p.keeper, lookFor(p.name)));
      sprite.anchor.set(0.5, 1);
      const name = new Text({
        text: p.name,
        style: {
          fontSize: 10,
          fontWeight: '600',
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
          stroke: { color: 0x000000, width: 2 },
        },
      });
      name.anchor.set(0.5, 0);
      root.addChild(shadow, ring, sprite, name);
      // Insert under the ball so the ball stays visible; keep insertion order for depth.
      this.root.addChildAt(root, this.root.getChildIndex(this.ballShadow));
      const piece: Piece = { root, shadow, ring, sprite, name, ...piece0 };
      this.anchorFor(piece);
      this.pieces.push(piece);
    }
    this.carrierId = null;
    this.flickable = new Set();
    this.redraw(players);
  }

  /** Show empty-slot markers at these world positions (empty list hides them). */
  setSlots(positions: Vec2[]): void {
    this.slots = positions;
    this.redrawSlots();
  }

  setNamesVisible(on: boolean): void {
    this.showNames = on;
    for (const p of this.pieces) p.name.visible = on;
  }

  /** Which disc is the ball carrier and which discs may be flicked right now. */
  setHighlights(carrierId: number | null, flickable: Iterable<number>): void {
    this.carrierId = carrierId;
    this.flickable = new Set(flickable);
    this.redrawRings();
  }

  /** Mark a player as sliding (tackle/dive) until they stop moving. */
  setSliding(id: number): void {
    const p = this.pieces[id];
    if (p) p.sliding = true;
  }

  /** Re-render shapes at the current pitch scale (call after layout). */
  redraw(players: readonly PlayerState[] = this.players): void {
    const k = this.k;
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    players.forEach((_, i) => {
      const piece = this.pieces[i];
      if (!piece) return;
      piece.sprite.scale.set(this.frames ? k : k * piece.facing, k);
      piece.shadow
        .clear()
        .ellipse(0, 0, r * 0.9, r * 0.45)
        .fill({ color: 0x000000, alpha: 0.35 });
      piece.name.style.fontSize = Math.max(8, r * 0.95);
      piece.name.position.set(0, r * 0.5);
      piece.name.visible = this.showNames;
    });
    const bk = Math.max(1, Math.round(this.pitch.scale * 0.26));
    this.ball.scale.set(bk);
    this.ballShadow
      .clear()
      .ellipse(0, 0, bk * 2.2, bk * 1.1)
      .fill({ color: 0x000000, alpha: 0.35 });
    this.redrawRings();
    this.redrawSlots();
  }

  private redrawRings(): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    this.pieces.forEach((piece, id) => {
      piece.ring.clear();
      if (id === this.carrierId) {
        piece.ring.ellipse(0, 0, r * 1.5, r * 0.75).stroke({ width: Math.max(2, r * 0.25), color: CARRIER_RING });
      } else if (this.flickable.has(id)) {
        piece.ring.ellipse(0, 0, r * 1.4, r * 0.7).stroke({ width: Math.max(1, r * 0.12), color: FLICKABLE_RING, alpha: 0.7 });
      }
    });
  }

  private redrawSlots(): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    this.slotsG.clear();
    for (const p of this.slots) {
      const s = this.pitch.toScreen(p);
      this.slotsG.ellipse(s.x, s.y, r, r * 0.5).stroke({ width: 2, color: 0xffffff, alpha: 0.45 });
      this.slotsG.circle(s.x, s.y, r * 0.2).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }

  /** Advance the run animation; call once per frame. */
  tick(dtSeconds: number): void {
    this.runClock += dtSeconds * 1000;
    const runFrame: 0 | 1 = Math.floor(this.runClock / RUN_FRAME_MS) % 2 === 0 ? 0 : 1;
    this.pieces.forEach((piece, i) => {
      const p = this.players[i];
      if (!p) return;
      const tex = this.textureFor(piece, p, runFrame);
      if (piece.sprite.texture !== tex) {
        piece.sprite.texture = tex;
        this.anchorFor(piece);
      }
      piece.sprite.scale.x = this.frames ? this.k : this.k * piece.facing;
    });
  }

  /** Move every piece. `players` is indexed like MatchState.players. */
  setPositions(players: readonly Vec2[], ball: Vec2): void {
    players.forEach((p, i) => {
      const piece = this.pieces[i];
      if (!piece) return;
      const s = this.pitch.toScreen(p);
      piece.root.position.set(s.x, s.y);
      if (piece.last) {
        const dx = p.x - piece.last.x;
        const dy = p.y - piece.last.y;
        const moved = Math.hypot(dx, dy) > 0.02;
        if (moved && Math.abs(dx) > 0.01) piece.facing = dx < 0 ? -1 : 1;
        if (moved) {
          // Facing follows the movement on screen, so it is right whichever way the pitch is drawn.
          const from = this.pitch.toScreen(piece.last);
          piece.dir = dirFromDelta(s.x - from.x, s.y - from.y);
        }
        if (!moved && piece.moving) piece.sliding = false;
        piece.moving = moved;
      }
      piece.last = { x: p.x, y: p.y };
    });
    const b = this.pitch.toScreen(ball);
    this.ball.position.set(b.x, b.y);
    this.ballShadow.position.set(b.x, b.y + 1);
  }
}
