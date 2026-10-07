import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { PlayerState, Team, Vec2 } from '../engine/types';
import { KITS, type Kit } from './kits';
import type { PitchView } from './PitchView';
import { SPRITE_H, ballTexture, spriteTexture, type Pose } from './sprites';

export const PLAYER_RADIUS_M = 1.3;
/** How tall a player sprite is in world meters; larger than life, as in 16-bit football games. */
const SPRITE_HEIGHT_M = 4.2;
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

  /** Integer pixel scale that makes a sprite about SPRITE_HEIGHT_M tall. */
  private get k(): number {
    return Math.max(1, Math.round((SPRITE_HEIGHT_M * this.pitch.scale) / SPRITE_H));
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
      const sprite = new Sprite(spriteTexture('stand', this.kits[p.team], p.keeper));
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
      this.pieces.push({ root, shadow, ring, sprite, name, last: null, moving: false, facing: 1, sliding: false });
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
      piece.sprite.scale.set(k * piece.facing, k);
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
    const frame: Pose = Math.floor(this.runClock / RUN_FRAME_MS) % 2 === 0 ? 'run1' : 'run2';
    this.pieces.forEach((piece, i) => {
      const p = this.players[i];
      if (!p) return;
      const pose: Pose = piece.sliding ? 'slide' : piece.moving ? frame : 'stand';
      const tex = spriteTexture(pose, this.kits[p.team], p.keeper);
      if (piece.sprite.texture !== tex) piece.sprite.texture = tex;
      piece.sprite.scale.x = this.k * piece.facing;
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
