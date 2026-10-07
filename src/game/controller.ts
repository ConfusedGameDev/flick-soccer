import { MAX_FLICKS, PLAN_SECONDS } from '../engine/pitch';
import { findReceiver, flickKind, moveTarget, passTarget } from '../engine/sim';
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
  /** Attack: the engine's projected view of the chain so far (ball + carrier). */
  projected: MatchState;
  /** Players already given a movement flick this turn. */
  moving: Set<number>;
  deadline: number;
  resolve: (plan: Plan) => void;
}

/** A human planning on this device with the flick gesture and the HUD buttons. */
export class LocalController implements PlanController {
  readonly kind = 'local' as const;
  private session: Session | null = null;
  private gesture: FlickGesture | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

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
        projected: state,
        moving: new Set(),
        deadline: performance.now() + PLAN_SECONDS * 1000,
        resolve,
      };
      this.hud.onUndo = () => this.undo();
      this.hud.onConfirm = () => this.confirm();
      if (this.gesture) this.gesture.enabled = true;
      this.timer = setInterval(() => this.tick(), 250);
      this.tick();
      this.refresh();
    });
  }

  private get max(): number {
    return this.session ? MAX_FLICKS[this.session.role] : 0;
  }

  private positions(): Vec2[] {
    return this.session!.state.players.map((p) => p.pos);
  }

  /** What flicking this player would mean right now, or null if it is not allowed. */
  private kindFor(id: number): GhostFlick['kind'] | null {
    const s = this.session;
    if (!s || s.draft.length >= this.max) return null;
    const probe: Flick = { playerId: id, dir: { x: 0, y: 1 }, strength: 1 };
    const kind = flickKind(s.projected, s.team, s.role, probe);
    if (kind === 'invalid') return null;
    if ((kind === 'run' || kind === 'slide' || kind === 'dive') && s.moving.has(id)) return null;
    // A run on the current carrier makes no sense; a pass needs an open chain.
    if ((kind === 'pass' || kind === 'shot') && s.projected.possession.playerId < 0) return null;
    return kind;
  }

  private pick(world: Vec2): number | null {
    if (!this.session) return null;
    return FlickGesture.nearest(world, this.positions(), (id) => this.kindFor(id) !== null);
  }

  /** Ghost for a flick given the projected chain, without committing it. */
  private ghostFor(id: number, flick: Flick): GhostFlick {
    const s = this.session!;
    const from = s.state.players[id].pos;
    const kind = flickKind(s.projected, s.team, s.role, flick);
    if (kind === 'invalid') return { kind: 'pass', from, to: from, bad: true };
    if (flick.strength === 0) return { kind, from, to: from };
    if (kind === 'pass' || kind === 'shot') {
      const { to, out } = passTarget(s.projected.ball, flick, kind);
      if (kind === 'shot') return { kind, from: s.projected.ball, to, bad: !out };
      const receiver = out ? null : findReceiver(s.state.players, s.team, to, id);
      return { kind, from: s.projected.ball, to, receiver: receiver?.pos, bad: out || !receiver };
    }
    return { kind, from, to: moveTarget(from, flick, kind) };
  }

  private drag(id: number, flick: Flick, pull: Vec2): void {
    if (!this.session) return;
    const drag: DragPreview = { ...this.ghostFor(id, flick), pull };
    this.preview.draw(this.session.ghosts, drag);
  }

  private release(id: number, flick: Flick | null): void {
    const s = this.session;
    if (!s) return;
    if (flick && this.kindFor(id) !== null) s.draft.push(flick);
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.gesture) this.gesture.enabled = false;
    this.hud.setPlanning(null);
    this.hud.setTimer(null);
    this.preview.clear();
    this.pieces.setHighlights(null, []);
    s.resolve({ team: s.team, flicks: s.draft });
  }

  private tick(): void {
    const s = this.session;
    if (!s) return;
    const left = Math.max(0, Math.ceil((s.deadline - performance.now()) / 1000));
    this.hud.setTimer(left);
    if (left === 0) this.confirm();
  }

  /** Recompute ghosts and the projected chain from the draft (simplest correct undo). */
  private rebuild(): void {
    const s = this.session!;
    s.ghosts = [];
    s.moving = new Set();
    s.projected = s.state;
    for (const f of s.draft) {
      const g = this.ghostFor(f.playerId, f);
      s.ghosts.push(g);
      if (g.kind === 'pass' || g.kind === 'shot') {
        const receiver = g.receiver ? findReceiver(s.state.players, s.team, g.to, f.playerId) : null;
        s.projected = receiver
          ? { ...s.projected, ball: { ...receiver.pos }, possession: { team: s.team, playerId: receiver.id } }
          : { ...s.projected, possession: { team: s.team, playerId: -1 } };
      } else {
        s.moving.add(f.playerId);
      }
    }
  }

  private refresh(): void {
    const s = this.session!;
    const left = this.max - s.draft.length;
    const flicks = `${left} flick${left === 1 ? '' : 's'} left`;
    let sub: string;
    if (left === 0) sub = 'Confirm when ready';
    else if (s.role === 'attack') {
      sub =
        s.projected.possession.playerId < 0
          ? 'The chain is finished; you can still flick a teammate to run'
          : 'Pull back from the carrier to pass or shoot, or from a teammate to run';
    } else sub = 'Pull back from a defender to tackle, or from the keeper to dive';
    this.hud.setStatus(`${teamName(s.team)} ${s.role === 'attack' ? 'attacks' : 'defends'} · ${flicks}`, sub);
    this.hud.setPlanning({ canUndo: s.draft.length > 0, canConfirm: true });
    this.preview.draw(s.ghosts, null);
    const flickable = s.state.players.filter((p) => this.kindFor(p.id) !== null).map((p) => p.id);
    const carrier = s.role === 'attack' && s.projected.possession.playerId >= 0 ? s.projected.possession.playerId : null;
    this.pieces.setHighlights(carrier, flickable);
  }
}
