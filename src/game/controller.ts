import { MAX_FLICKS } from '../engine/pitch';
import { findReceiver, passTarget, slideTarget } from '../engine/sim';
import type { Flick, MatchState, Plan, Team, Vec2 } from '../engine/types';
import { FlickGesture, type FlickGestureHandlers } from '../input/FlickGesture';
import type { PiecesView } from '../render/PiecesView';
import type { DragPreview, GhostFlick, PlanPreview } from '../render/PlanPreview';
import type { Hud } from '../ui/Hud';

export type Role = 'attack' | 'defense';

/** Where a side's plan comes from. CPU and remote implementations arrive in M2 and M8. */
export interface PlanController {
  readonly kind: 'local' | 'cpu' | 'remote';
  plan(state: MatchState, team: Team, role: Role): Promise<Plan>;
}

export const teamName = (t: Team): string => (t === 'home' ? 'Home' : 'Away');

interface Session {
  state: MatchState;
  team: Team;
  role: Role;
  draft: Flick[];
  ghosts: GhostFlick[];
  /** Attack only: who makes the next pass, or null once the chain is broken. */
  carrierId: number | null;
  /** Defense only: players already given a slide this turn. */
  used: Set<number>;
  resolve: (plan: Plan) => void;
}

/** A human planning on this device with the flick gesture and the HUD buttons. */
export class LocalController implements PlanController {
  readonly kind = 'local' as const;
  private session: Session | null = null;
  private gesture: FlickGesture | null = null;

  constructor(
    private readonly hud: Hud,
    private readonly preview: PlanPreview,
    private readonly pieces: PiecesView,
  ) {}

  attachGesture(gesture: FlickGesture): void {
    this.gesture = gesture;
  }

  readonly handlers: FlickGestureHandlers = {
    pick: (world) => this.pick(world),
    onDrag: (id, flick, pull) => this.drag(id, flick, pull),
    onRelease: (id, flick) => this.release(id, flick),
  };

  plan(state: MatchState, team: Team, role: Role): Promise<Plan> {
    return new Promise((resolve) => {
      this.session = {
        state,
        team,
        role,
        draft: [],
        ghosts: [],
        carrierId: state.possession.playerId,
        used: new Set(),
        resolve,
      };
      this.hud.onUndo = () => this.undo();
      this.hud.onConfirm = () => this.confirm();
      if (this.gesture) this.gesture.enabled = true;
      this.refresh();
    });
  }

  private get max(): number {
    return this.session ? MAX_FLICKS[this.session.role] : 0;
  }

  private positions(): Vec2[] {
    return this.session!.state.players.map((p) => p.pos);
  }

  private allowed(id: number): boolean {
    const s = this.session;
    if (!s || s.draft.length >= this.max) return false;
    if (s.role === 'attack') return id === s.carrierId;
    const p = s.state.players[id];
    return p.team === s.team && !s.used.has(id);
  }

  private pick(world: Vec2): number | null {
    if (!this.session) return null;
    return FlickGesture.nearest(world, this.positions(), (id) => this.allowed(id));
  }

  /** Ghost for a flick given the current draft, without committing it. */
  private ghostFor(id: number, flick: Flick): GhostFlick {
    const s = this.session!;
    const from = s.state.players[id].pos;
    if (flick.strength === 0) return { kind: s.role === 'attack' ? 'pass' : 'slide', from, to: from };
    if (s.role === 'attack') {
      const { to, out } = passTarget(from, flick);
      const receiver = out ? null : findReceiver(s.state.players, s.team, to, id);
      return { kind: 'pass', from, to, receiver: receiver?.pos, bad: out || !receiver };
    }
    return { kind: 'slide', from, to: slideTarget(from, flick) };
  }

  private drag(id: number, flick: Flick, pull: Vec2): void {
    if (!this.session) return;
    const drag: DragPreview = { ...this.ghostFor(id, flick), pull };
    this.preview.draw(this.session.ghosts, drag);
  }

  private release(id: number, flick: Flick | null): void {
    const s = this.session;
    if (!s) return;
    if (flick && this.allowed(id)) s.draft.push(flick);
    this.rebuild();
    this.refresh();
  }

  private undo(): void {
    const s = this.session;
    if (!s || s.draft.length === 0) return;
    s.draft.pop();
    this.rebuild();
    this.refresh();
  }

  private confirm(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (this.gesture) this.gesture.enabled = false;
    this.hud.setPlanning(null);
    this.preview.clear();
    this.pieces.setHighlights(null, []);
    s.resolve({ team: s.team, flicks: s.draft });
  }

  /** Recompute ghosts, carrier and used defenders from the draft (simplest correct undo). */
  private rebuild(): void {
    const s = this.session!;
    s.ghosts = [];
    s.used = new Set();
    s.carrierId = s.state.possession.playerId;
    for (const f of s.draft) {
      const g = this.ghostFor(f.playerId, f);
      s.ghosts.push(g);
      if (s.role === 'attack') {
        const receiver = g.receiver ? findReceiver(s.state.players, s.team, g.to, f.playerId) : null;
        s.carrierId = receiver ? receiver.id : null;
      } else {
        s.used.add(f.playerId);
      }
    }
  }

  private refresh(): void {
    const s = this.session!;
    const left = this.max - s.draft.length;
    const flicks = `${left} flick${left === 1 ? '' : 's'} left`;
    let sub: string;
    if (s.role === 'attack') {
      sub = s.carrierId === null ? 'The chain ends here (dead ball or out). Undo or confirm.' : left ? 'Pull back from the glowing carrier to pass' : 'Confirm when ready';
    } else {
      sub = left ? 'Pull back from a defender to slide them toward the pass' : 'Confirm when ready';
    }
    this.hud.setStatus(`${teamName(s.team)} ${s.role === 'attack' ? 'attacks' : 'defends'} · ${flicks}`, sub);
    this.hud.setPlanning({ canUndo: s.draft.length > 0, canConfirm: true });
    this.preview.draw(s.ghosts, null);
    const flickable = s.state.players.filter((p) => this.allowed(p.id)).map((p) => p.id);
    this.pieces.setHighlights(s.role === 'attack' ? s.carrierId : null, flickable);
  }
}
