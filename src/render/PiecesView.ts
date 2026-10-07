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
}

/** Grey discs for the 22 players plus the ball. Positions are set every frame. */
export class PiecesView {
  readonly root = new Container();
  private pieces: Piece[] = [];
  private readonly ball = new Graphics();
  private carrierId: number | null = null;
  private flickable = new Set<number>();

  constructor(
    private readonly pitch: PitchView,
    players: readonly PlayerState[],
  ) {
    for (const p of players) {
      const root = new Container();
      const ring = new Graphics();
      const body = new Graphics();
      const label = new Text({
        text: String(p.number),
        style: { fontSize: 12, fontWeight: '700', fill: TEAM_INK[p.team], fontFamily: 'system-ui, sans-serif' },
      });
      label.anchor.set(0.5);
      root.addChild(ring, body, label);
      this.root.addChild(root);
      this.pieces.push({ root, body, ring, label });
    }
    this.root.addChild(this.ball);
    this.redraw(players);
  }

  /** Which disc is the ball carrier and which discs may be flicked right now. */
  setHighlights(carrierId: number | null, flickable: Iterable<number>): void {
    this.carrierId = carrierId;
    this.flickable = new Set(flickable);
    this.redrawRings();
  }

  /** Re-render shapes at the current pitch scale (call after layout). */
  redraw(players: readonly PlayerState[]): void {
    const r = PLAYER_RADIUS_M * this.pitch.scale;
    players.forEach((p, i) => {
      const piece = this.pieces[i];
      piece.body
        .clear()
        .circle(0, 0, r)
        .fill(TEAM_FILL[p.team])
        .stroke({ width: Math.max(1, r * 0.12), color: p.keeper ? KEEPER_RING : 0x000000, alpha: p.keeper ? 1 : 0.5 });
      piece.label.style.fontSize = Math.max(9, r * 1.1);
    });
    this.ball.clear().circle(0, 0, BALL_RADIUS_M * this.pitch.scale).fill(0xffffff).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    this.redrawRings();
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
      const s = this.pitch.toScreen(p);
      this.pieces[i].root.position.set(s.x, s.y);
    });
    const b = this.pitch.toScreen(ball);
    this.ball.position.set(b.x, b.y);
  }
}
