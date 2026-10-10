import { planAttack, planDefense, type Difficulty } from '../engine/cpu';
import { BOOSTER_INFO, MAX_BOOSTERS, drawBooster } from '../engine/boosters';
import { GOAL_W, PITCH_W, PLAN_SECONDS, SHOT_RANGE, attackDir, inAttackingThird, other, targetGoalY } from '../engine/pitch';
import { maxFlicksFor } from '../engine/tactics';
import { mulberry32 } from '../engine/rng';
import { packSeed } from '../engine/seeds';
import { keeperOf } from '../engine/setup';
import { findReceiver, flickKind, kickRange, moveRange, moveTarget, passTarget, setPieceStrength, spotTaken } from '../engine/sim';
import type { Booster, Flick, MatchState, Plan, SetPiece as SetPieceKind, Team, Vec2 } from '../engine/types';
import { add, dist, normalize, scale, sub } from '../engine/vec';
import { FlickGesture, type FlickGestureHandlers } from '../input/FlickGesture';
import type { Kit } from '../render/kits';
import type { PiecesView } from '../render/PiecesView';
import type { DragPreview, GhostFlick, PlanPreview } from '../render/PlanPreview';
import type { PackView } from '../ui/PackView';
import type { Hud } from '../ui/Hud';
import { GOAL_FRACTION, type SetPiece, type SetPieceSpec } from '../ui/SetPiece';

/** The kicker's right-hand side when facing `d` (screen-right in the set-piece scene). */
const rightOf = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x });

/** Turn the scene's -1..1 sweep value into a direction, `rad` either side of `d`. */
function sweep(d: Vec2, x: number, rad: number): Vec2 {
  const a = x * rad;
  return normalize(add(scale(d, Math.cos(a)), scale(rightOf(d), Math.sin(a))));
}

/** How the scene frames a restart: where the kicker faces, how far the arrow swings and where the goal shows. */
function restartFrame(state: MatchState, team: Team, kind: SetPieceKind): { d: Vec2; rad: number; goal: SetPieceSpec['goal'] } {
  const ball = state.ball;
  const goalCentre = { x: PITCH_W / 2, y: targetGoalY(team) };
  if (kind === 'corner') {
    // Rest aim at 45° between the goal line and the touchline, so the ±35° sweep always stays in play.
    const d = normalize({ x: Math.sign(goalCentre.x - ball.x) || 1, y: -attackDir(team) });
    const toGoal = sub(goalCentre, ball);
    const side = toGoal.x * rightOf(d).x + toGoal.y * rightOf(d).y;
    return { d, rad: (35 * Math.PI) / 180, goal: side > 0 ? 'right' : 'left' };
  }
  return { d: { x: ball.x < PITCH_W / 2 ? 1 : -1, y: 0 }, rad: (70 * Math.PI) / 180, goal: 'none' };
}

const HINTS: Record<SetPieceSpec['kind'], string> = {
  shot: 'Tap to lock the arrow across the goal, then the height, then tap on the block.',
  corner: 'Tap to lock the arrow, then tap when the cursor is on the block.',
  'throw-in': 'Tap to lock the arrow, then tap when the cursor is on the block.',
};

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
  /** Where those movement flicks end; another move may not end there. */
  reserved: Vec2[];
  /** The booster drawn from this turn's pack, once opened. */
  pack: Booster | null;
  booster: Booster | null;
  /** Flicks a mini-game produced (a shot, a corner, a throw-in): Undo never takes them back. */
  final: Set<Flick>;
  /** The set-piece scene is up and its flick is not in the draft yet. */
  pendingRestart: boolean;
  deadline: number;
  resolve: (plan: Plan) => void;
}

/** What the tutorial sees while a human plans. */
export interface DraftInfo {
  role: Role;
  used: number;
  left: number;
  /** Boosters usable this turn (held or fresh). */
  boosters: number;
  /** Attack only: the last pass lands in open space, so the chain ends in a dead ball. */
  dead: boolean;
  /** Attack only: the Shoot button is live (carrier in the attacking third and in range). */
  canShoot: boolean;
}

export interface LocalDeps {
  hud: Hud;
  preview: PlanPreview;
  pieces: PiecesView;
  pack: PackView;
  setPiece: SetPiece;
}

/** A human planning on this device with the flick gesture and the HUD buttons. */
export class LocalController implements PlanController {
  readonly kind = 'local' as const;
  private session: Session | null = null;
  private gesture: FlickGesture | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  /** The match seed; packs derive from it and the clock, exactly as the server draws them. */
  private seed = 0;
  /** Called after every change to the draft during planning, and with null on confirm (tutorial). */
  onDraft: ((info: DraftInfo | null) => void) | null = null;
  /** False disables the planning clock (tutorial). */
  timed = true;

  constructor(private readonly deps: LocalDeps) {}

  setSeed(seed: number): void {
    this.seed = seed;
  }

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
        reserved: [],
        pack: null,
        booster: null,
        final: new Set(),
        pendingRestart: false,
        deadline: this.timed ? performance.now() + PLAN_SECONDS * 1000 : Infinity,
        resolve,
      };
      const { hud } = this.deps;
      hud.onUndo = () => this.undo();
      hud.onConfirm = () => this.confirm();
      hud.onPack = () => void this.openPack();
      hud.onShoot = () => void this.shoot();
      hud.onBooster = (b) => this.toggleBooster(b);
      if (this.gesture) this.gesture.enabled = true;
      this.timer = setInterval(() => this.tick(), 250);
      this.tick();
      this.refresh();
      // A corner or throw-in starts with the set-piece scene; the rest of the turn is planned after.
      if (role === 'attack' && state.setPiece) void this.takeSetPiece();
    });
  }

  /** The Shoot button is live: the projected carrier stands in the attacking third within range of goal. */
  private canShoot(): boolean {
    const s = this.session;
    if (!s || s.role !== 'attack' || this.busy || s.draft.length >= this.max) return false;
    const id = s.projected.possession.playerId;
    if (id < 0 || s.projected.setPiece) return false;
    const ball = s.projected.ball;
    if (!inAttackingThird(s.team, ball)) return false;
    return dist(ball, { x: PITCH_W / 2, y: targetGoalY(s.team) }) <= SHOT_RANGE * kickRange(s.state.players[id], 'shot');
  }

  /** Shoot: the scene picks the line across the goal, the height and the timing; the flick carries them to the engine. */
  private async shoot(): Promise<void> {
    const s = this.session;
    if (!s || !this.canShoot()) return;
    const kicker = s.state.players[s.projected.possession.playerId];
    const from = { ...s.projected.ball };
    this.busy = true;
    if (this.gesture) this.gesture.enabled = false;
    const res = await this.deps.setPiece.run({
      kind: 'shot',
      kit: this.deps.pieces.currentKits[s.team],
      keeper: kicker.keeper,
      name: kicker.name,
      stat: kicker.stats.shot,
      goal: 'ahead',
      hint: this.hint('shot'),
      ...shotView(s.state, s.team, from, this.deps.pieces.currentKits[other(s.team)]),
      number: kicker.number,
    });
    this.busy = false;
    if (this.session !== s) return; // timed out while the scene was up
    if (this.gesture) this.gesture.enabled = true;
    if (res) {
      // The sweep maps onto the goal mouth: ±GOAL_FRACTION are the posts, beyond is wide.
      const target = { x: PITCH_W / 2 + (res.x * attackDir(s.team) * (GOAL_W / 2)) / GOAL_FRACTION, y: targetGoalY(s.team) };
      const shot: Flick = { playerId: kicker.id, dir: normalize(sub(target, from)), strength: 1, shot: true, aim: { accuracy: res.accuracy, height: res.height ?? 0.5 } };
      // The timing game is played once: the shot cannot be undone and retaken.
      s.draft.push(shot);
      s.final.add(shot);
    }
    this.rebuild();
    this.refresh();
  }

  /** A corner or throw-in: the scene produces the first flick, which then stays final in the draft. */
  private async takeSetPiece(): Promise<void> {
    const s = this.session;
    if (!s || !s.state.setPiece) return;
    const kind = s.state.setPiece;
    const taker = s.state.players[s.state.possession.playerId];
    const { d, rad, goal } = restartFrame(s.state, s.team, kind);
    s.pendingRestart = true;
    this.busy = true;
    if (this.gesture) this.gesture.enabled = false;
    const res = await this.deps.setPiece.run({
      kind,
      kit: this.deps.pieces.currentKits[s.team],
      keeper: taker.keeper,
      name: taker.name,
      stat: taker.stats.pass,
      goal,
      map: { state: s.state, kits: this.deps.pieces.currentKits },
      hint: this.hint(kind),
    });
    this.busy = false;
    if (this.session !== s) return; // the deadline confirmed with the fallback flick
    if (this.gesture) this.gesture.enabled = true;
    s.pendingRestart = false;
    s.draft.unshift(this.restartFlick(s, res ? sweep(d, res.x, rad) : d, res?.accuracy ?? 0));
    this.rebuild();
    this.refresh();
  }

  private restartFlick(s: Session, dir: Vec2, accuracy: number): Flick {
    const taker = s.state.players[s.state.possession.playerId];
    const flick: Flick = { playerId: taker.id, dir, strength: setPieceStrength(s.state.setPiece!, taker), aim: { accuracy } };
    s.final.add(flick);
    return flick;
  }

  private readonly hinted = new Set<SetPieceSpec['kind']>();
  /** The coaching line, the first time each kind of scene opens. */
  private hint(kind: SetPieceSpec['kind']): string | undefined {
    if (this.hinted.has(kind)) return undefined;
    this.hinted.add(kind);
    return HINTS[kind];
  }

  /** Flicks allowed this turn: base, minus one for an opened pack, plus one for the booster. */
  private get max(): number {
    const s = this.session;
    if (!s) return 0;
    return maxFlicksFor(s.state.meta[s.team], s.role) - (s.pack ? 1 : 0) + (s.booster === 'extra-flick' ? 1 : 0);
  }

  /** Boosters available this turn: held ones plus the fresh card from this turn's pack. */
  private available(): { booster: Booster; fresh: boolean }[] {
    const s = this.session!;
    const list = s.state.meta[s.team].boosters.map((b) => ({ booster: b, fresh: false }));
    if (s.pack) list.push({ booster: s.pack, fresh: true });
    return list;
  }

  /** The pack button is live: not opened yet, room in the hand, a flick to trade. */
  private canOpenPack(): boolean {
    const s = this.session;
    return !!s && !s.pack && !this.busy && s.state.meta[s.team].boosters.length < MAX_BOOSTERS && s.draft.length < this.max;
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
    const to = moveTarget(from, flick, kind, rangeMul);
    // A move may not end on another player (or where a team-mate is already sent).
    return { kind, from, to, bad: spotTaken(to, s.state.players, id, s.reserved) };
  }

  private drag(id: number, flick: Flick, pull: Vec2): void {
    if (!this.session) return;
    const drag: DragPreview = { ...this.ghostFor(id, flick), pull };
    this.deps.preview.draw(this.session.ghosts, drag);
  }

  private release(id: number, flick: Flick | null): void {
    const s = this.session;
    if (!s) return;
    if (flick && this.kindFor(id) !== null) {
      const g = this.ghostFor(id, flick);
      // A run, slide or dive onto another player is refused outright; a bad pass is the player's to waste.
      if (g.bad && (g.kind === 'run' || g.kind === 'slide' || g.kind === 'dive')) this.deps.hud.toast('Spot taken');
      else s.draft.push(flick);
    }
    this.rebuild();
    this.refresh();
  }

  /** Undo takes back the last flick, unless a mini-game produced it. */
  private canUndo(): boolean {
    const s = this.session;
    return !!s && s.draft.length > 0 && !s.final.has(s.draft[s.draft.length - 1]);
  }

  private undo(): void {
    if (!this.canUndo()) return;
    this.session!.draft.pop();
    this.rebuild();
    this.refresh();
  }

  /** Trade a flick for a booster pack. The card comes from the shared seed; the pick is theater. */
  private async openPack(): Promise<void> {
    const s = this.session;
    if (!s || !this.canOpenPack()) return;
    this.busy = true;
    const booster = drawBooster(mulberry32(packSeed(this.seed, s.state, s.team)));
    await this.deps.pack.show({
      title: `${teamName(s.team)}: trade a flick for a card`,
      booster,
      pick: true,
      kit: this.deps.pieces.currentKits[s.team],
    });
    this.busy = false;
    if (this.session !== s) return; // timed out while the pack was open
    s.pack = booster;
    this.rebuild();
    this.refresh();
  }

  private toggleBooster(b: Booster): void {
    const s = this.session;
    if (!s) return;
    const next = s.booster === b ? null : b;
    // Dropping an extra flick may leave one flick too many; a final flick cannot be the one to go.
    const after = maxFlicksFor(s.state.meta[s.team], s.role) - (s.pack ? 1 : 0) + (next === 'extra-flick' ? 1 : 0);
    if (s.draft.length > after && s.final.has(s.draft[s.draft.length - 1])) {
      this.deps.hud.toast('The shot is taken');
      return;
    }
    s.booster = next;
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
    // The clock ran out with the scene up: close it. A restart still has to be taken,
    // straight ahead with no accuracy; an unfinished shot is simply not taken.
    if (this.busy) {
      this.deps.setPiece.cancel();
      this.deps.pack.cancel();
    }
    if (s.pendingRestart) s.draft.unshift(this.restartFlick(s, restartFrame(s.state, s.team, s.state.setPiece!).d, 0));
    hud.setPlanning(null);
    hud.setTimer(null);
    preview.clear();
    pieces.setHighlights(null, []);
    const plan: Plan = { team: s.team, flicks: s.draft };
    if (s.pack) plan.pack = s.pack;
    if (s.booster) plan.booster = s.booster;
    s.resolve(plan);
    this.onDraft?.(null);
  }

  private tick(): void {
    const s = this.session;
    if (!s) return;
    if (!this.timed) {
      this.deps.hud.setTimer(null);
      return;
    }
    const left = Math.max(0, Math.ceil((s.deadline - performance.now()) / 1000));
    this.deps.hud.setTimer(left);
    if (left === 0) this.confirm();
  }

  /** Recompute ghosts and the projected chain from the draft (simplest correct undo). */
  private rebuild(): void {
    const s = this.session!;
    s.ghosts = [];
    s.moving = new Set();
    s.reserved = [];
    s.projected = s.state;
    for (const f of s.draft) {
      const g = this.ghostFor(f.playerId, f);
      s.ghosts.push(g);
      if (g.kind === 'pass' || g.kind === 'shot') {
        const receiver = g.receiver ? findReceiver(s.state.players, s.team, g.to, f.playerId) : null;
        // Mirrors the engine: only the first chain flick is the set piece.
        s.projected = receiver
          ? { ...s.projected, setPiece: undefined, ball: { ...receiver.pos }, possession: { team: s.team, playerId: receiver.id } }
          : { ...s.projected, setPiece: undefined, possession: { team: s.team, playerId: -1 } };
      } else {
        s.moving.add(f.playerId);
        s.reserved.push(g.to);
      }
    }
  }

  private refresh(): void {
    const s = this.session!;
    const { hud, preview, pieces } = this.deps;
    const left = this.max - s.draft.length;
    const flicks = `${left} flick${left === 1 ? '' : 's'} left`;
    let sub: string;
    const canShoot = this.canShoot();
    if (left === 0) sub = 'Confirm when ready';
    else if (s.role === 'attack') {
      sub =
        s.projected.possession.playerId < 0
          ? 'The chain is finished; you can still flick a teammate to run'
          : canShoot
            ? 'Tap Shoot, or pull back from the carrier to pass or from a teammate to run'
            : 'Pull back from the carrier to pass, or from a teammate to run';
    } else sub = 'Pull back from a defender to tackle, or from the keeper to dive';
    hud.setStatus(`${teamName(s.team)} ${s.role === 'attack' ? 'attacks' : 'defends'} · ${flicks}`, sub);
    hud.setPlanning({ canUndo: this.canUndo(), canConfirm: true });

    hud.setExtras({
      pack: { can: this.canOpenPack(), opened: !!s.pack, full: s.state.meta[s.team].boosters.length >= MAX_BOOSTERS },
      boosters: this.available().map((b) => ({ ...b, usable: BOOSTER_INFO[b.booster].roles.includes(s.role) })),
      armed: s.booster,
      shoot: s.role === 'attack' ? { enabled: canShoot } : null,
    });

    preview.draw(s.ghosts, null);
    const flickable = s.state.players.filter((p) => this.kindFor(p.id) !== null).map((p) => p.id);
    const carrier = s.role === 'attack' && s.projected.possession.playerId >= 0 ? s.projected.possession.playerId : null;
    pieces.setHighlights(carrier, flickable);
    this.onDraft?.({
      role: s.role,
      used: s.draft.length,
      left,
      boosters: this.available().length,
      dead: s.role === 'attack' && s.draft.length > 0 && s.projected.possession.playerId < 0,
      canShoot,
    });
  }
}

/**
 * What the shot scene needs from the match, in the kicker's view (screen-right positive):
 * where the defending keeper stands relative to the goal and the ball's offset from the goal
 * centre, both in half goal widths, and how far off his line the keeper has come.
 */
export function shotView(state: MatchState, team: Team, from: Vec2, keeperKit: Kit): Pick<SetPieceSpec, 'goalie' | 'offset'> {
  const a = attackDir(team);
  const goalY = targetGoalY(team);
  const half = GOAL_W / 2;
  const keeper = keeperOf(state.players, other(team));
  const toBall = Math.max(1, Math.abs(from.y - goalY));
  return {
    offset: ((from.x - PITCH_W / 2) * a) / half,
    goalie: { kit: keeperKit, name: keeper.name, x: ((keeper.pos.x - PITCH_W / 2) * a) / half, depth: Math.abs(keeper.pos.y - goalY) / toBall },
  };
}
