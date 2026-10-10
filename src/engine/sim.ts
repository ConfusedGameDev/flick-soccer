import type {
  Booster,
  Flick,
  FlickKind,
  Keyframe,
  MatchState,
  Plan,
  PlayerState,
  SetPiece,
  Team,
  TeamMeta,
  TimelineEvent,
  TurnResult,
  Vec2,
} from './types';
import {
  AIM_SCATTER,
  BALL_SPEED,
  BLOCK_CHANCE,
  DIVE_RANGE,
  DIVE_SPEED,
  DT,
  HEIGHT_SAVE_SHIFT,
  HEIGHT_SCATTER,
  PLACEMENT_SAVE_SHIFT,
  HOLD_CHANCE,
  INTERCEPT_CHANCE,
  KEEPER_REACH,
  MAX_TURN_SECONDS,
  OVER_BAR,
  PASS_RANGE,
  PITCH_L,
  PITCH_W,
  RECEIVE_RADIUS,
  BODY_RADIUS,
  RUN_RANGE,
  RUN_SPEED,
  SAVE_CHANCE,
  SET_PIECE_METERS,
  SHOT_RANGE,
  SHOT_SPEED,
  SLIDE_RANGE,
  SLIDE_SPEED,
  TACKLE_REACH,
  TURNS_PER_HALF,
  clampToPitch,
  inAttackingThird,
  inGoalMouth,
  inPitch,
  other,
  targetGoalY,
} from './pitch';
import { MAX_BOOSTERS, drawBooster } from './boosters';
import { statFactor, statOdds } from './pool';
import { keeperReachMul, maxFlicksFor, moveSpeedMul, passChanceShift, shotChanceShift } from './tactics';
import { mulberry32 } from './rng';
import { keeperOf } from './setup';
import { add, clamp, clamp01, dist, lerp, normalize, rotate, scale } from './vec';

// ---------------------------------------------------------------------------
// Flick classification and geometry (shared with the client preview)
// ---------------------------------------------------------------------------

/** Where a flick's ray crosses the goal line the team shoots at, if it does. */
export function goalLineCrossing(team: Team, from: Vec2, dir: Vec2): Vec2 | null {
  const gy = targetGoalY(team);
  const d = normalize(dir);
  if (Math.abs(d.y) < 1e-6) return null;
  const t = (gy - from.y) / d.y;
  if (t <= 0) return null;
  return { x: from.x + d.x * t, y: gy };
}

/**
 * What a flick means for this side, from who was flicked and where they stand.
 * A shot needs the explicit `shot` marker (the Shoot button), the attacking
 * third and a ray that reaches the goal line; it may still go wide. A restart
 * flick (`state.setPiece`) is always a pass.
 */
export function flickKind(state: MatchState, team: Team, role: 'attack' | 'defense', flick: Flick): FlickKind {
  const p = state.players[flick.playerId];
  if (!p || p.team !== team) return 'invalid';
  if (role === 'defense') return p.keeper ? 'dive' : 'slide';
  if (p.id !== state.possession.playerId) return 'run';
  if (!flick.shot || state.setPiece) return 'pass';
  return inAttackingThird(team, state.ball) && goalLineCrossing(team, state.ball, flick.dir) ? 'shot' : 'pass';
}

/** The strength the engine gives a restart flick so that it covers SET_PIECE_METERS. */
export const setPieceStrength = (kind: SetPiece, kicker: PlayerState): number =>
  clamp(SET_PIECE_METERS[kind] / (PASS_RANGE * kickRange(kicker, 'pass')), 0.05, 1);

/**
 * Where a pass or shot from `from` lands, clipped to the pitch. `out` is true
 * if it crossed a line. `rangeMul` is the kicker's pass/shot stat factor.
 */
export function passTarget(from: Vec2, flick: Flick, kind: 'pass' | 'shot' = 'pass', rangeMul = 1): { to: Vec2; out: boolean } {
  const range = (kind === 'shot' ? SHOT_RANGE : PASS_RANGE) * rangeMul;
  const raw = add(from, scale(normalize(flick.dir), flick.strength * range));
  const out = !inPitch(raw);
  return { to: out ? clipToEdge(from, raw) : raw, out };
}

/** Where a slide, run or dive from `from` ends, clipped to the pitch. `rangeMul` combines stat and booster factors. */
export function moveTarget(from: Vec2, flick: Flick, kind: 'slide' | 'run' | 'dive', rangeMul = 1): Vec2 {
  const base = kind === 'slide' ? SLIDE_RANGE : kind === 'run' ? RUN_RANGE : DIVE_RANGE;
  return clampToPitch(add(from, scale(normalize(flick.dir), flick.strength * base * rangeMul)));
}

/**
 * A movement flick may not end on another player: within two body radii of
 * anyone's position at the start of the turn, or of a spot (`reserved`) the
 * same team already sends someone to this turn. Opponent moves are hidden,
 * so they never block; the planning preview and the engine agree on this.
 */
export function spotTaken(at: Vec2, players: readonly PlayerState[], selfId: number, reserved: readonly Vec2[] = []): boolean {
  const min = BODY_RADIUS * 2;
  return players.some((p) => p.id !== selfId && dist(p.pos, at) < min) || reserved.some((r) => dist(r, at) < min);
}

/** Range factor for a player's pass or shot. */
export const kickRange = (p: PlayerState, kind: 'pass' | 'shot'): number => statFactor(kind === 'shot' ? p.stats.shot : p.stats.pass);

/** Range factor for a player's slide, run or dive (before boosters). */
export const moveRange = (p: PlayerState, kind: 'slide' | 'run' | 'dive'): number =>
  statFactor(kind === 'run' ? p.stats.speed : kind === 'slide' ? p.stats.tackle : p.stats.keeping);

interface TurnMods {
  booster: Booster | null;
}

/** The teammate who collects a ball landing at `point`, or null if nobody is close enough. */
export function findReceiver(
  players: readonly PlayerState[],
  team: Team,
  point: Vec2,
  excludeId: number,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = RECEIVE_RADIUS;
  for (const p of players) {
    if (p.team !== team || p.id === excludeId) continue;
    const d = dist(p.pos, point);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function nearestOf(players: readonly PlayerState[], team: Team, point: Vec2): PlayerState {
  let best = players.find((p) => p.team === team)!;
  let bestD = Infinity;
  for (const p of players) {
    if (p.team !== team) continue;
    const d = dist(p.pos, point);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Walk back along from→raw until the point is inside the pitch. */
function clipToEdge(from: Vec2, raw: Vec2): Vec2 {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inPitch(lerp(from, raw, mid))) lo = mid;
    else hi = mid;
  }
  return lerp(from, raw, lo);
}

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

interface Move {
  idx: number;
  from: Vec2;
  to: Vec2;
  duration: number;
}

interface BallSegment {
  shot: boolean;
  /** Shot height after scatter, 0..1 (0 for passes). */
  height: number;
  /** The shot is going over the bar: nothing for the keeper to save. */
  over: boolean;
  /** Who kicked it; their pass/shot stat resists interception. */
  kicker: PlayerState;
  from: Vec2;
  to: Vec2;
  duration: number;
  startT: number;
  out: boolean;
  /** Defenders that already had their roll for this segment. */
  rolled: Set<number>;
  /** Unstoppable-pass booster: nobody gets a roll on this segment. */
  unstoppable: boolean;
  /** Index of this pass or shot in the attacker's chain (tiki-taka builds on completed passes). */
  chainPos: number;
  /** Kicker and intended receiver play for the same club (chemistry). */
  clubmates: boolean;
}

/** How a turn's chain of play ended; drives the restart. */
type Outcome =
  | { kind: 'settled' }
  | { kind: 'dead-ball' }
  | { kind: 'goal'; team: Team }
  | { kind: 'corner'; team: Team; at: Vec2 }
  | { kind: 'throw-in'; team: Team; at: Vec2 }
  | { kind: 'goal-kick'; team: Team };

/**
 * Resolve one turn: both plans run at the same time, the ball follows the
 * attacker's chain and defenders slide toward where they guessed. Pure and
 * deterministic for a given (state, plans, seed).
 */
export interface ResolveOptions {
  /** Skip per-tick keyframes (the CPU evaluator only needs the outcome). The first and last are always kept. */
  keyframes?: boolean;
}

export function resolveTurn(
  state: MatchState,
  attackPlan: Plan,
  defensePlan: Plan,
  seed: number,
  opts: ResolveOptions = {},
): TurnResult {
  const keepFrames = opts.keyframes !== false;
  const rng = mulberry32(seed);
  const attackTeam = state.possession.team;
  const defenseTeam = other(attackTeam);
  const players: PlayerState[] = state.players.map((p) => ({ ...p, pos: { ...p.pos } }));
  const byId = (id: number) => players[id];
  const events: TimelineEvent[] = [];
  const keyframes: Keyframe[] = [];

  let t = 0;
  let possession = { ...state.possession };
  let ball: Vec2 = { ...state.ball };
  // Boxed so assignments inside endChain() are visible to the switch below.
  const run: { outcome: Outcome } = { outcome: { kind: 'settled' } };

  // ---- Packs and boosters: set up this turn's modifiers ----
  const meta: Record<Team, TeamMeta> = {
    home: { ...state.meta.home, boosters: [...state.meta.home.boosters] },
    away: { ...state.meta.away, boosters: [...state.meta.away.boosters] },
  };
  const mods: Record<Team, TurnMods> = { home: { booster: null }, away: { booster: null } };
  // Tactics cards (catenaccio) set the base; packs and boosters adjust from there.
  const maxFlicks = { attack: maxFlicksFor(state.meta[attackTeam], 'attack'), defense: maxFlicksFor(state.meta[defenseTeam], 'defense') };
  const sides = [
    [attackPlan, attackTeam, 'attack'],
    [defensePlan, defenseTeam, 'defense'],
  ] as const;
  for (const [plan, team, role] of sides) {
    if (plan.team !== team) continue;
    const m = meta[team];
    // A pack traded for a flick: the card goes into the hand now, so it can be armed this very turn.
    if (plan.pack) {
      if (m.boosters.length >= MAX_BOOSTERS) {
        events.push({ t, type: 'invalid-flick', playerId: -1, reason: 'hand full' });
      } else {
        maxFlicks[role] -= 1;
        m.boosters.push(plan.pack);
        events.push({ t, type: 'pack', team, booster: plan.pack, free: false });
      }
    }
    if (plan.booster) {
      const i = m.boosters.indexOf(plan.booster);
      if (i < 0) {
        events.push({ t, type: 'invalid-flick', playerId: -1, reason: 'booster not held' });
      } else {
        m.boosters.splice(i, 1);
        mods[team].booster = plan.booster;
        if (plan.booster === 'extra-flick') maxFlicks[role] += 1;
        events.push({ t, type: 'booster', team, booster: plan.booster });
      }
    }
  }
  const speedMul = (p: PlayerState) => (mods[p.team].booster === 'double-speed' ? 2 : 1) * statFactor(p.stats.speed) * moveSpeedMul(state.meta[p.team]);
  const rangeMul = (p: PlayerState, kind: 'slide' | 'run' | 'dive') =>
    (kind !== 'run' && mods[p.team].booster === 'longer-slide' ? 1.5 : 1) * moveRange(p, kind);
  const superKeeper = mods[defenseTeam].booster === 'super-keeper';
  let unstoppableLeft = mods[attackTeam].booster === 'unstoppable-pass';

  const attackFlicks = attackPlan.team === attackTeam ? attackPlan.flicks.slice(0, maxFlicks.attack) : [];
  const defenseFlicks = defensePlan.team === defenseTeam ? defensePlan.flicks.slice(0, maxFlicks.defense) : [];

  // Every movement flick (slides, dives, runs) starts at t = 0 and runs in parallel.
  const moves: Move[] = [];
  const moving = new Set<number>();
  /** Spots each team already sends someone to this turn; a second move there is refused. */
  const reserved: Record<Team, Vec2[]> = { home: [], away: [] };
  const addMove = (p: PlayerState, f: Flick, kind: 'slide' | 'run' | 'dive') => {
    if (moving.has(p.id)) {
      events.push({ t, type: 'invalid-flick', playerId: p.id, reason: 'already moving' });
      return;
    }
    const to = moveTarget(p.pos, f, kind, rangeMul(p, kind));
    if (spotTaken(to, state.players, p.id, reserved[p.team])) {
      events.push({ t, type: 'invalid-flick', playerId: p.id, reason: 'spot taken' });
      return;
    }
    reserved[p.team].push(to);
    const speed = (kind === 'slide' ? SLIDE_SPEED : kind === 'run' ? RUN_SPEED : DIVE_SPEED) * speedMul(p);
    moves.push({ idx: p.id, from: { ...p.pos }, to, duration: dist(p.pos, to) / speed });
    moving.add(p.id);
    events.push({ t, type: kind, playerId: p.id });
  };

  for (const f of defenseFlicks) {
    const kind = flickKind(state, defenseTeam, 'defense', f);
    if (kind === 'invalid') {
      events.push({ t, type: 'invalid-flick', playerId: f.playerId, reason: 'not a defender' });
      continue;
    }
    addMove(byId(f.playerId), f, kind as 'slide' | 'dive');
  }

  // Attack: runs start now; passes and shots are queued and chained in order.
  // The chain is projected forward from the kickoff positions so that a flick
  // from the *next* carrier counts as a pass, not a run. This is the same
  // projection the planning preview shows.
  // The first chain flick of a restart turn is the set piece: its distance is
  // fixed by the engine and it can never be a shot; later flicks are ordinary.
  const chain: Flick[] = [];
  let projected: MatchState = { ...state, players, ball: { ...ball }, possession: { ...possession } };
  for (const raw of attackFlicks) {
    const kind = flickKind(projected, attackTeam, 'attack', raw);
    if (kind === 'invalid') {
      events.push({ t, type: 'invalid-flick', playerId: raw.playerId, reason: 'not an attacker' });
    } else if (kind === 'run') {
      addMove(byId(raw.playerId), raw, 'run');
    } else {
      const f = projected.setPiece ? { ...raw, strength: setPieceStrength(projected.setPiece, byId(raw.playerId)) } : raw;
      chain.push(f);
      const { to, out } = passTarget(projected.ball, f, kind as 'pass' | 'shot', kickRange(byId(f.playerId), kind as 'pass' | 'shot'));
      const receiver = kind === 'pass' && !out ? findReceiver(players, attackTeam, to, f.playerId) : null;
      projected = receiver
        ? { ...projected, setPiece: undefined, ball: { ...receiver.pos }, possession: { team: attackTeam, playerId: receiver.id } }
        : { ...projected, setPiece: undefined, possession: { team: attackTeam, playerId: -1 } };
    }
  }

  let flickIdx = 0;
  let seg: BallSegment | null = null;
  let chainDone = false;

  const frame = (): Keyframe => ({ t, ball: { ...ball }, players: players.map((p) => ({ ...p.pos })) });
  const snapshot = () => {
    if (keepFrames) keyframes.push(frame());
  };
  const movesDone = () => moves.every((m) => t >= m.duration);
  const endChain = (o: Outcome) => {
    run.outcome = o;
    seg = null;
    chainDone = true;
  };

  if (keepFrames) snapshot();
  else keyframes.push(frame());

  while (t < MAX_TURN_SECONDS) {
    // Start the next pass or shot when the ball is settled with a carrier.
    while (!chainDone && !seg) {
      if (flickIdx >= chain.length) {
        chainDone = true;
        break;
      }
      const f = chain[flickIdx++];
      if (f.playerId !== possession.playerId) {
        events.push({ t, type: 'invalid-flick', playerId: f.playerId, reason: 'not the ball carrier' });
        continue;
      }
      const from = { ...ball };
      // Re-classify against the live ball position: after a pass the carrier may now be in range.
      // Only the first chain flick of a restart turn is the set piece.
      const live: MatchState = { ...state, players, ball, possession, setPiece: flickIdx === 1 ? state.setPiece : undefined };
      const kind = flickKind(live, attackTeam, 'attack', f);
      const shot = kind === 'shot';
      const kicker = byId(f.playerId);
      // The timing game's accuracy scatters the line (and a shot's height). Plain
      // flicks draw nothing from the RNG, so their resolution is unchanged.
      let dir = f.dir;
      let height = 0;
      if (f.aim) {
        const err = 1 - clamp01(f.aim.accuracy);
        dir = rotate(f.dir, (rng() * 2 - 1) * AIM_SCATTER * err);
        if (shot) height = clamp(clamp01(f.aim.height) + (rng() * 2 - 1) * HEIGHT_SCATTER * err, 0, 1);
      }
      // A height locked over the bar stays over: the scatter only ever adds error.
      const over = shot && (height > OVER_BAR || (!!f.aim && clamp01(f.aim.height) > OVER_BAR));
      const { to, out } = passTarget(from, { ...f, dir }, shot ? 'shot' : 'pass', kickRange(kicker, shot ? 'shot' : 'pass'));
      const speed = shot ? SHOT_SPEED : BALL_SPEED;
      const unstoppable = !shot && unstoppableLeft;
      if (unstoppable) unstoppableLeft = false;
      const receiver = !shot && !out ? findReceiver(players, attackTeam, to, f.playerId) : null;
      const clubmates = kicker.club !== '' && receiver?.club === kicker.club;
      seg = { shot, height, over, kicker, from, to, duration: dist(from, to) / speed, startT: t, out, rolled: new Set(), unstoppable, chainPos: flickIdx - 1, clubmates };
      events.push({ t, type: shot ? 'shot' : 'pass', from: f.playerId, to });
    }

    if (chainDone && movesDone()) break;

    t += DT;

    for (const m of moves) {
      const k = m.duration > 0 ? Math.min(1, t / m.duration) : 1;
      byId(m.idx).pos = lerp(m.from, m.to, k);
    }

    if (seg) {
      const k = seg.duration > 0 ? Math.min(1, (t - seg.startT) / seg.duration) : 1;
      ball = lerp(seg.from, seg.to, k);

      // One roll per defender per segment, the first tick they are in reach.
      // Keepers have a longer reach and use the save odds; outfield use tackle/block odds.
      // Boosters tweak the keeper; stats and tactics shift the odds.
      let stopped = false;
      for (const p of players) {
        if (seg.unstoppable || p.team !== defenseTeam || seg.rolled.has(p.id)) continue;
        // A shot sailing over the bar is out of the keeper's hands (blockers still get their roll).
        if (p.keeper && seg.over) continue;
        const reach = p.keeper ? KEEPER_REACH * (superKeeper ? 2 : 1) * statFactor(p.stats.keeping) * keeperReachMul(state.meta[defenseTeam]) : TACKLE_REACH;
        if (dist(p.pos, ball) > reach) continue;
        seg.rolled.add(p.id);
        let chance = p.keeper ? SAVE_CHANCE : seg.shot ? BLOCK_CHANCE : INTERCEPT_CHANCE;
        // Stats: the stopper's tackle/keeping against the kicker's pass/shot.
        chance += statOdds(p.keeper ? p.stats.keeping : p.stats.tackle);
        chance -= statOdds(seg.shot ? seg.kicker.stats.shot : seg.kicker.stats.pass);
        // Tactics cards: cannon on shots; tiki-taka and clásicos on passes.
        chance += seg.shot ? shotChanceShift(state.meta[attackTeam]) : passChanceShift(state.meta[attackTeam], seg.chainPos, seg.clubmates);
        // High shots are harder for the keeper to reach.
        if (p.keeper && seg.shot) chance -= HEIGHT_SAVE_SHIFT * seg.height;
        // Placement: a shot past the keeper is harder to stop than one straight at him.
        if (p.keeper && seg.shot) chance -= PLACEMENT_SAVE_SHIFT * clamp01(pointToSegment(p.pos, ball, seg.to) / reach);
        if (p.keeper && superKeeper) chance += 0.25;
        if (rng() >= chance) continue;
        if (p.keeper && seg.shot) {
          events.push({ t, type: 'save', playerId: p.id });
          if (rng() < HOLD_CHANCE) {
            possession = { team: defenseTeam, playerId: p.id };
            ball = { ...p.pos };
            endChain({ kind: 'settled' });
          } else {
            endChain({ kind: 'corner', team: attackTeam, at: ball });
          }
        } else {
          possession = { team: defenseTeam, playerId: p.id };
          ball = { ...p.pos };
          events.push({ t, type: 'intercept', playerId: p.id });
          endChain({ kind: 'settled' });
        }
        stopped = true;
        break;
      }

      if (!stopped && k >= 1) {
        if (seg.out) {
          // clipToEdge lands a hair inside the line, so use a loose tolerance.
          const onGoalLine = ball.y < 1e-3 || ball.y > PITCH_L - 1e-3;
          if (seg.shot && onGoalLine && inGoalMouth(ball.x) && !seg.over) {
            events.push({ t, type: 'goal', team: attackTeam });
            endChain({ kind: 'goal', team: attackTeam });
          } else if (onGoalLine) {
            // Over the goal line they attack (wide or over the bar): goal kick for the defence.
            // Over their own goal line (a keeper clearing it behind himself): corner for the defence.
            const ownLine = Math.abs(ball.y - targetGoalY(attackTeam)) > PITCH_L / 2;
            if (ownLine) endChain({ kind: 'corner', team: defenseTeam, at: ball });
            else endChain({ kind: 'goal-kick', team: defenseTeam });
          } else {
            endChain({ kind: 'throw-in', team: defenseTeam, at: ball });
          }
        } else {
          const receiver = findReceiver(players, attackTeam, ball, possession.playerId);
          if (receiver) {
            possession = { team: attackTeam, playerId: receiver.id };
            ball = { ...receiver.pos };
            events.push({ t, type: 'receive', playerId: receiver.id });
            seg = null;
          } else {
            events.push({ t, type: 'dead-ball' });
            endChain({ kind: 'dead-ball' });
          }
        }
      }
    } else {
      // Ball rests with the carrier (who may be moving).
      ball = { ...byId(possession.playerId).pos };
    }

    snapshot();
  }

  if (!keepFrames) keyframes.push(frame());

  // ---- Restart placement (state only; the client snaps pieces after playback) ----
  let status: MatchState['status'] = 'playing';
  const score = { ...state.score };
  const outcome = run.outcome;
  // Corners and throw-ins hand the next attacker a set piece; every other turn clears it.
  let setPiece: SetPiece | undefined;
  switch (outcome.kind) {
    case 'goal': {
      score[outcome.team]++;
      resetFormations(players);
      const k = keeperOf(players, other(outcome.team));
      ball = { ...k.pos };
      possession = { team: k.team, playerId: k.id };
      break;
    }
    case 'corner': {
      const cornerX = outcome.at.x < PITCH_W / 2 ? 0 : PITCH_W;
      ball = { x: cornerX, y: targetGoalY(outcome.team) };
      const taker = nearestOf(players, outcome.team, ball);
      taker.pos = { ...ball };
      possession = { team: outcome.team, playerId: taker.id };
      setPiece = 'corner';
      events.push({ t, type: 'corner', team: outcome.team });
      break;
    }
    case 'throw-in': {
      ball = clampToPitch(outcome.at);
      const taker = nearestOf(players, outcome.team, ball);
      taker.pos = { ...ball };
      possession = { team: outcome.team, playerId: taker.id };
      setPiece = 'throw-in';
      events.push({ t, type: 'throw-in', team: outcome.team });
      break;
    }
    case 'goal-kick': {
      const k = keeperOf(players, outcome.team);
      ball = { ...k.pos };
      possession = { team: k.team, playerId: k.id };
      events.push({ t, type: 'goal-kick', team: outcome.team });
      break;
    }
    case 'dead-ball':
      status = 'duel';
      break;
    case 'settled':
      break;
  }

  // ---- Overtake: the interceptor's side gets a free booster pack, if its hand has room ----
  if (outcome.kind === 'settled' && possession.team === defenseTeam && events.some((e) => e.type === 'intercept')) {
    const m = meta[defenseTeam];
    if (m.boosters.length < MAX_BOOSTERS) {
      const booster = drawBooster(rng);
      m.boosters.push(booster);
      events.push({ t, type: 'pack', team: defenseTeam, booster, free: true });
    }
  }

  // ---- Clock ----
  let turn = state.turn + 1;
  let half = state.half;
  if (turn > TURNS_PER_HALF) {
    turn = 1;
    if (half === 1) {
      half = 2;
      status = 'half-time';
      resetFormations(players);
      const k = keeperOf(players, other(state.kickoff));
      ball = { ...k.pos };
      possession = { team: k.team, playerId: k.id };
      setPiece = undefined;
      events.push({ t, type: 'half-time' });
    } else {
      status = 'full-time';
      events.push({ t, type: 'full-time' });
    }
  }

  events.push({ t, type: 'end' });

  // Drop the previous turn's set piece from the state rather than carrying an undefined key.
  const { setPiece: _previous, ...rest } = state;
  const next: MatchState = { ...rest, turn, half, score, status, players, ball, possession, meta };
  if (setPiece) next.setPiece = setPiece;
  return { state: next, keyframes, events };
}

/**
 * After a dead-ball duel: the winner's nearest player collects the ball where
 * it stopped, and the winner gets a free booster pack (null when their hand is full).
 */
export function resolveDuel(state: MatchState, winner: Team, seed: number): { state: MatchState; booster: Booster | null } {
  const players = state.players.map((p) => ({ ...p, pos: { ...p.pos } }));
  const taker = nearestOf(players, winner, state.ball);
  taker.pos = { ...state.ball };
  const m: TeamMeta = { ...state.meta[winner], boosters: [...state.meta[winner].boosters] };
  const booster = m.boosters.length < MAX_BOOSTERS ? drawBooster(mulberry32(seed)) : null;
  if (booster) m.boosters.push(booster);
  const meta = { ...state.meta, [winner]: m };
  return { state: { ...state, status: 'playing', players, possession: { team: winner, playerId: taker.id }, meta }, booster };
}

/** Acknowledge half-time; the second-half kickoff is already set up. */
export function continueMatch(state: MatchState): MatchState {
  return state.status === 'half-time' ? { ...state, status: 'playing' } : state;
}

function resetFormations(players: PlayerState[]): void {
  for (const p of players) p.pos = { ...p.kickoff };
}

/** Closest distance from `p` to the segment a→b. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
