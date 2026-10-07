import { Container, Graphics, Text } from 'pixi.js';
import type { PlayerState, Vec2 } from '../engine/types';
import type { PitchView } from './PitchView';

export const PLAYER_RADIUS_M = 1.3;
const BALL_RADIUS_M = 0.6;

const TEAM_FILL = { home: 0xe8e8e8, away: 0x4a4a4a } as const;
const TEAM_INK = { home: 0x1b1b1b, away: 0xf0f0f0 } as const;
const KEEPER_RING = 0x4fc3f7;
const CARRIER_RING = 0xffd447;
const FLICKABLE_RING = 0xffffff;

interface Piece {
  root: Container;
  body: Graphics;
  ring: Graphics;
  label: Text;
  name: Text;
}

/** Discs for the 22 players plus the ball. Positions are set every frame. */
export class PiecesView {
  readonly root = new Container();
  private pieces: Piece[] = [];
  private players: readonly PlayerState[] = [];
  private readonly ball = new Graphics();
  /** Dashed rings for unfilled formation slots (team builder). */
  private readonly slotsG = new Graphics();
  private slots: Vec2[] = [];
  private carrierId: number | null = null;
  private flickable = new Set<number>();
  private showNames = true;

  constructor(
    private readonly pitch: PitchView,
    players: readonly PlayerState[],
  ) {
    this.root.addChild(this.slotsG, this.ball);
    this.rebuild(players);
  }

  /** Show empty-slot markers at these world positions (empty list hides them). */
  setSlots(positions: Vec2[]): void {
    this.slots = positions;
    this.redrawSlots();
  }

  private redrawSlots(): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    this.slotsG.clear();
    for (const p of this.slots) {
      const s = this.pitch.toScreen(p);
      this.slotsG.circle(s.x, s.y, r).stroke({ width: 2, color: 0xffffff, alpha: 0.45 });
      this.slotsG.circle(s.x, s.y, r * 0.25).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }

  /** Replace every disc (new squads). */
  rebuild(players: readonly PlayerState[]): void {
    for (const p of this.pieces) p.root.destroy({ children: true });
    this.pieces = [];
    this.players = players;
    for (const p of players) {
      const root = new Container();
      const ring = new Graphics();
      const body = new Graphics();
      const label = new Text({
        text: String(p.number),
        style: { fontSize: 12, fontWeight: '700', fill: TEAM_INK[p.team], fontFamily: 'system-ui, sans-serif' },
      });
      label.anchor.set(0.5);
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
      root.addChild(ring, body, label, name);
      this.root.addChildAt(root, 0);
      this.pieces.push({ root, body, ring, label, name });
    }
    this.carrierId = null;
    this.flickable = new Set();
    this.redraw(players);
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

  /** Re-render shapes at the current pitch scale (call after layout). */
  redraw(players: readonly PlayerState[] = this.players): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    players.forEach((p, i) => {
      const piece = this.pieces[i];
      if (!piece) return;
      piece.body
        .clear()
        .circle(0, 0, r)
        .fill(TEAM_FILL[p.team])
        .stroke({ width: Math.max(1, r * 0.12), color: p.keeper ? KEEPER_RING : 0x000000, alpha: p.keeper ? 1 : 0.5 });
      piece.label.style.fontSize = Math.max(9, r * 1.1);
      piece.name.style.fontSize = Math.max(8, r * 0.95);
      piece.name.position.set(0, r * 1.2);
      piece.name.visible = this.showNames;
    });
    this.ball.clear().circle(0, 0, BALL_RADIUS_M * this.pitch.scale).fill(0xffffff).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    this.redrawRings();
    this.redrawSlots();
  }

  private redrawRings(): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    this.pieces.forEach((piece, id) => {
      piece.ring.clear();
      if (id === this.carrierId) {
        piece.ring.circle(0, 0, r * 1.55).stroke({ width: Math.max(2, r * 0.25), color: CARRIER_RING });
      } else if (this.flickable.has(id)) {
        piece.ring.circle(0, 0, r * 1.45).stroke({ width: Math.max(1, r * 0.12), color: FLICKABLE_RING, alpha: 0.7 });
      }
    });
  }

  /** Move every piece. `players` is indexed like MatchState.players. */
  setPositions(players: readonly Vec2[], ball: Vec2): void {
    players.forEach((p, i) => {
      const piece = this.pieces[i];
      if (!piece) return;
      const s = this.pitch.toScreen(p);
      piece.root.position.set(s.x, s.y);
    });
    const b = this.pitch.toScreen(ball);
    this.ball.position.set(b.x, b.y);
  }
}
