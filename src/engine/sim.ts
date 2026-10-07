import type {
  Flick,
  Keyframe,
  MatchState,
  Plan,
  PlayerState,
  Team,
  TimelineEvent,
  TurnResult,
  Vec2,
} from './types';
import {
  BALL_SPEED,
  DT,
  INTERCEPT_CHANCE,
  MAX_FLICKS,
  MAX_TURN_SECONDS,
  PASS_RANGE,
  RECEIVE_RADIUS,
  SLIDE_RANGE,
  SLIDE_SPEED,
  TACKLE_REACH,
  clampToPitch,
  inPitch,
  other,
} from './pitch';
import { mulberry32 } from './rng';
import { add, dist, lerp, normalize, scale } from './vec';

/** Where a pass from `from` lands, clipped to the pitch. `out` is true if it crossed a line. */
export function passTarget(from: Vec2, flick: Flick): { to: Vec2; out: boolean } {
  const raw = add(from, scale(normalize(flick.dir), flick.strength * PASS_RANGE));
  const out = !inPitch(raw);
  return { to: out ? clipToEdge(from, raw) : raw, out };
}

/** Where a tackle slide from `from` ends, clipped to the pitch. */
export function slideTarget(from: Vec2, flick: Flick): Vec2 {
  return clampToPitch(add(from, scale(normalize(flick.dir), flick.strength * SLIDE_RANGE)));
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

interface Slide {
  idx: number;
  from: Vec2;
  to: Vec2;
  duration: number;
}

interface BallSegment {
  from: Vec2;
  to: Vec2;
  duration: number;
  startT: number;
  out: boolean;
  /** Defenders that already had their interception roll for this pass. */
  rolled: Set<number>;
}

/**
 * Resolve one turn: both plans run at the same time, the ball follows the
 * attacker's chain and defenders slide toward where they guessed. Pure and
 * deterministic for a given (state, plans, seed).
 */
export function resolveTurn(
  state: MatchState,
  attackPlan: Plan,
  defensePlan: Plan,
  seed: number,
): TurnResult {
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

  const attackFlicks = attackPlan.team === attackTeam ? attackPlan.flicks.slice(0, MAX_FLICKS.attack) : [];
  const defenseFlicks = defensePlan.team === defenseTeam ? defensePlan.flicks.slice(0, MAX_FLICKS.defense) : [];

  // Defender slides all start at t = 0.
  const slides: Slide[] = [];
  for (const f of defenseFlicks) {
    const p = byId(f.playerId);
    if (!p || p.team !== defenseTeam) {
      events.push({ t, type: 'invalid-flick', playerId: f.playerId, reason: 'not a defender' });
      continue;
    }
    const to = slideTarget(p.pos, f);
    slides.push({ idx: p.id, from: { ...p.pos }, to, duration: dist(p.pos, to) / SLIDE_SPEED });
    events.push({ t, type: 'slide', playerId: p.id });
  }

  let flickIdx = 0;
  let seg: BallSegment | null = null;
  let chainDone = false;

  const snapshot = () => keyframes.push({ t, ball: { ...ball }, players: players.map((p) => ({ ...p.pos })) });
  const slidesDone = () => slides.every((s) => t >= s.duration);

  snapshot();

  while (t < MAX_TURN_SECONDS) {
    // Start the next pass when the ball is settled with a carrier.
    while (!chainDone && !seg) {
      if (flickIdx >= attackFlicks.length) {
        chainDone = true;
        break;
      }
      const f = attackFlicks[flickIdx++];
      if (f.playerId !== possession.playerId) {
        events.push({ t, type: 'invalid-flick', playerId: f.playerId, reason: 'not the ball carrier' });
        continue;
      }
      const from = { ...ball };
      const { to, out } = passTarget(from, f);
      seg = { from, to, duration: dist(from, to) / BALL_SPEED, startT: t, out, rolled: new Set() };
      events.push({ t, type: 'pass', from: f.playerId, to });
    }

    if (chainDone && slidesDone()) break;

    t += DT;

    for (const s of slides) {
      const k = s.duration > 0 ? Math.min(1, t / s.duration) : 1;
      byId(s.idx).pos = lerp(s.from, s.to, k);
    }

    if (seg) {
      const k = seg.duration > 0 ? Math.min(1, (t - seg.startT) / seg.duration) : 1;
      ball = lerp(seg.from, seg.to, k);

      // One interception roll per defender per pass, the first tick they are in reach.
      let intercepted = false;
      for (const p of players) {
        if (p.team !== defenseTeam || seg.rolled.has(p.id)) continue;
        if (dist(p.pos, ball) > TACKLE_REACH) continue;
        seg.rolled.add(p.id);
        if (rng() < INTERCEPT_CHANCE) {
          possession = { team: defenseTeam, playerId: p.id };
          ball = { ...p.pos };
          events.push({ t, type: 'intercept', playerId: p.id });
          intercepted = true;
          break;
        }
      }
      if (intercepted) {
        seg = null;
        chainDone = true;
      } else if (k >= 1) {
        if (seg.out) {
          // Ball crossed a line: the other side restarts from their nearest player.
          const nearest = nearestOf(players, defenseTeam, ball);
          possession = { team: defenseTeam, playerId: nearest.id };
          events.push({ t, type: 'out' });
          chainDone = true;
        } else {
          const receiver = findReceiver(players, attackTeam, ball, possession.playerId);
          if (receiver) {
            possession = { team: attackTeam, playerId: receiver.id };
            ball = { ...receiver.pos };
            events.push({ t, type: 'receive', playerId: receiver.id });
          } else {
            events.push({ t, type: 'dead-ball' });
            chainDone = true;
          }
        }
        seg = null;
      }
    } else {
      // Ball rests with the carrier (who may be sliding).
      ball = { ...byId(possession.playerId).pos };
    }

    snapshot();
  }

  events.push({ t, type: 'end' });

  return {
    state: { turn: state.turn + 1, players, ball, possession },
    keyframes,
    events,
  };
}

function nearestOf(players: readonly PlayerState[], team: Team, point: Vec2): PlayerState {
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
