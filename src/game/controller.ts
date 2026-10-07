import { planAttack, planDefense, type Difficulty } from '../engine/cpu';
import { BOOSTER_INFO, MAX_DICE_BONUS, rollDice } from '../engine/dice';
import { MAX_FLICKS, PLAN_SECONDS } from '../engine/pitch';
import { mulberry32 } from '../engine/rng';
import { findReceiver, flickKind, kickRange, moveRange, moveTarget, passTarget } from '../engine/sim';
import type { Booster, DiceRoll, Flick, MatchState, Plan, Team, Vec2 } from '../engine/types';
import { FlickGesture, type FlickGestureHandlers } from '../input/FlickGesture';
import type { PiecesView } from '../render/PiecesView';
import type { DragPreview, GhostFlick, PlanPreview } from '../render/PlanPreview';
import { DiceView } from '../ui/DiceView';
import type { Hud } from '../ui/Hud';

export type Role = 'attack' | 'defense';

/** Where a side's plan comes from. CPU and remote implementations arrive in M2 and M8. */
export interface PlanController {
  readonly kind: 'local' | 'cpu' | 'remote';
  plan(state: MatchState, team: Team, role: Role): Promise<Plan>;
}

export const teamName = (t: Team): string => (t === 'home' ? 'Home' : 'Away');

/** The CPU plans with the engine's sampler; `seed` makes a match replayable. */
export class CpuController implements PlanController {
  readonly kind = 'cpu' as const;

  constructor(
    readonly difficulty: Difficulty,
    private readonly hud: Hud,
    private readonly seedFor: (state: MatchState) => number,
  ) {}

  plan(state: MatchState, team: Team, role: Role): Promise<Plan> {
    this.hud.setStatus(`${teamName(team)} (CPU) ${role === 'attack' ? 'attack' : 'defend'}`, 'Thinking…');
    this.hud.setPlanning(null);
    // Yield a frame so the status paints before the (synchronous) search runs.
    return new Promise((resolve) =>
      setTimeout(() => {
        const seed = this.seedFor(state);
        resolve(role === 'attack' ? planAttack(state, team, this.difficulty, seed) : planDefense(state, team, this.difficulty, seed));
      }, 30),
    );
  }
}

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
  dice: DiceRoll | null;
  booster: Booster | null;
  deadline: number;
  resolve: (plan: Plan) => void;
}

export interface LocalDeps {
  hud: Hud;
  preview: PlanPreview;
  pieces: PiecesView;
  dice: DiceView;
  /** Seed for this side's trade roll this turn; the engine would roll the same. */
  rollSeed: (state: MatchState, team: Team) => number;
}

/** A human planning on this device with the flick gesture and the HUD buttons. */
export class LocalController implements PlanController {
  readonly kind = 'local' as const;
  private session: Session | null = null;
  private gesture: FlickGesture | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly deps: LocalDeps) {}

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
        dice: null,
        booster: null,
        deadline: performance.now() + PLAN_SECONDS * 1000,
        resolve,
      };
      const { hud } = this.deps;
      hud.onUndo = () => this.undo();
      hud.onConfirm = () => this.confirm();
      hud.onRoll = () => void this.roll();
      hud.onBooster = (b) => this.toggleBooster(b);
      if (this.gesture) this.gesture.enabled = true;
      this.timer = setInterval(() => this.tick(), 250);
      this.tick();
      this.refresh();
    });
  }

  /** Flicks allowed this turn: base, minus one for a traded roll, plus one for the booster. */
  private get max(): number {
    const s = this.session;
    if (!s) return 0;
    return MAX_FLICKS[s.role] - (s.dice ? 1 : 0) + (s.booster === 'extra-flick' ? 1 : 0);
  }

  /** Boosters available this turn: held ones plus a fresh pack from this turn's roll. */
  private available(): { booster: Booster; fresh: boolean }[] {
    const s = this.session!;
    const list = s.state.meta[s.team].boosters.map((b) => ({ booster: b, fresh: false }));
    if (s.dice?.booster) list.push({ booster: s.dice.booster, fresh: true });
    return list;
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
    if ((kind === 'pass' || kind === 'shot') && s.projected.possession.playerId < 0) return null;
    return kind;
  }

  private pick(world: Vec2): number | null {
    if (!this.session || this.busy) return null;
    return FlickGesture.nearest(world, this.positions(), (id) => this.kindFor(id) !== null);
  }

  /** Ghost for a flick given the projected chain, without committing it. */
  private ghostFor(id: number, flick: Flick): GhostFlick {
    const s = this.session!;
    const from = s.state.players[id].pos;
    const kind = flickKind(s.projected, s.team, s.role, flick);
    if (kind === 'invalid') return { kind: 'pass', from, to: from, bad: true };
    if (flick.strength === 0) return { kind, from, to: from };
    const player = s.state.players[id];
    if (kind === 'pass' || kind === 'shot') {
      const { to, out } = passTarget(s.projected.ball, flick, kind, kickRange(player, kind));
      if (kind === 'shot') return { kind, from: s.projected.ball, to, bad: !out };
      const receiver = out ? null : findReceiver(s.state.players, s.team, to, id);
      return { kind, from: s.projected.ball, to, receiver: receiver?.pos, bad: out || !receiver };
    }
    const rangeMul = (s.booster === 'longer-slide' && kind !== 'run' ? 1.5 : 1) * moveRange(player, kind);
    return { kind, from, to: moveTarget(from, flick, kind, rangeMul) };
  }

  private drag(id: number, flick: Flick, pull: Vec2): void {
    if (!this.session) return;
    const drag: DragPreview = { ...this.ghostFor(id, flick), pull };
    this.deps.preview.draw(this.session.ghosts, drag);
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

  /** Trade a flick for 2d6. The result comes from the shared seed; the flick animation is theater. */
  private async roll(): Promise<void> {
    const s = this.session;
    if (!s || s.dice || this.busy || s.state.meta[s.team].blocked > 0 || s.draft.length >= this.max) return;
    this.busy = true;
    const roll = rollDice(mulberry32(this.deps.rollSeed(s.state, s.team)));
    await this.deps.dice.show({
      title: `${teamName(s.team)}: trade a flick for a roll`,
      rounds: roll.pairs,
      caption: DiceView.caption(roll),
      flick: true,
    });
    this.busy = false;
    if (this.session !== s) return; // timed out while the dice were up
    s.dice = roll;
    this.rebuild();
    this.refresh();
  }

  private toggleBooster(b: Booster): void {
    const s = this.session;
    if (!s) return;
    s.booster = s.booster === b ? null : b;
    // Dropping an extra flick may leave one flick too many.
    while (s.draft.length > this.max) s.draft.pop();
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
    const { hud, preview, pieces } = this.deps;
    hud.setPlanning(null);
    hud.setTimer(null);
    preview.clear();
    pieces.setHighlights(null, []);
    const plan: Plan = { team: s.team, flicks: s.draft };
    if (s.dice) plan.dice = s.dice;
    if (s.booster) plan.booster = s.booster;
    s.resolve(plan);
  }

  private tick(): void {
    const s = this.session;
    if (!s) return;
    const left = Math.max(0, Math.ceil((s.deadline - performance.now()) / 1000));
    this.deps.hud.setTimer(left);
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
    const { hud, preview, pieces } = this.deps;
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
    hud.setStatus(`${teamName(s.team)} ${s.role === 'attack' ? 'attacks' : 'defends'} · ${flicks}`, sub);
    hud.setPlanning({ canUndo: s.draft.length > 0, canConfirm: true });

    const meta = s.state.meta[s.team];
    hud.setExtras({
      canRoll: !s.dice && meta.blocked === 0 && s.draft.length < this.max,
      rolled: !!s.dice,
      blocked: meta.blocked,
      bonus: Math.min(MAX_DICE_BONUS, meta.bonus + (s.dice?.bonus ?? 0)),
      boosters: this.available().map((b) => ({ ...b, usable: BOOSTER_INFO[b.booster].roles.includes(s.role) })),
      armed: s.booster,
    });

    preview.draw(s.ghosts, null);
    const flickable = s.state.players.filter((p) => this.kindFor(p.id) !== null).map((p) => p.id);
    const carrier = s.role === 'attack' && s.projected.possession.playerId >= 0 ? s.projected.possession.playerId : null;
    pieces.setHighlights(carrier, flickable);
  }
}
