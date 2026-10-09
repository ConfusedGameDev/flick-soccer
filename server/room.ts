import { DICE_BONUS_PER_PIP, kickoffRoll, rollDice } from '../src/engine/dice';
import { PLAN_SECONDS, other } from '../src/engine/pitch';
import { SQUAD_SIZE, defaultSquad, squadProblem, type Squad } from '../src/engine/pool';
import { mulberry32 } from '../src/engine/rng';
import { duelSeed, kickoffSeed, rollSeed, turnSeed } from '../src/engine/seeds';
import { initialMatch } from '../src/engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../src/engine/sim';
import type { Flick, MatchState, Plan, Team } from '../src/engine/types';
import { clamp01 } from '../src/engine/vec';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import type { Kit } from '../src/render/kits';

// A match room: pure state machine with injected timers and senders, so it
// can be unit-tested without sockets. One instance per room code.

export type Phase = 'lobby' | 'squads' | 'playing' | 'duel' | 'over';

export interface RoomDeps {
  send: (side: Team, msg: ServerMessage) => void;
  /** setTimeout-like; returns a cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  now: () => number;
}

/** Server-side duel timing (mirrors ui/Duel.ts). */
export const DUEL = {
  countdownMs: 900 + 4 * 700,
  durationMs: 5000,
  pressStep: 0.07,
  /** Presses above this rate are ignored (auto-clicker guard). */
  maxPressesPerSecond: 15,
  meterIntervalMs: 100,
};
/** Grace added to the client's planning timer before the server auto-submits. */
const PLAN_GRACE_MS = 5000;

export class Room {
  phase: Phase = 'lobby';
  readonly tokens: Record<Team, string>;
  kits: Partial<Record<Team, Kit>> = {};
  squads: Partial<Record<Team, Squad>> = {};
  state: MatchState | null = null;
  private plans: Partial<Record<Team, Plan>> = {};
  private cancelTimer: (() => void) | null = null;
  private duel: { open: boolean; presses: Record<Team, number[]>; meter: number; endAt: number; stop: (() => void)[] } | null = null;
  /** Last message sent to each side, replayed on resume. */
  private last: Partial<Record<Team, ServerMessage>> = {};
  private seated: Record<Team, boolean> = { home: false, away: false };

  constructor(
    readonly code: string,
    readonly seed: number,
    private readonly deps: RoomDeps,
    makeToken: () => string,
  ) {
    this.tokens = { home: makeToken(), away: makeToken() };
  }

  get full(): boolean {
    return this.seated.home && this.seated.away;
  }

  private emit(side: Team, msg: ServerMessage): void {
    this.last[side] = msg;
    this.deps.send(side, msg);
  }

  private both(msg: ServerMessage): void {
    this.emit('home', msg);
    this.emit('away', msg);
  }

  /** Seat a player; the creator is home, the joiner away. Returns the side or null if full. */
  seat(kit: Kit): Team | null {
    const side: Team | null = !this.seated.home ? 'home' : !this.seated.away ? 'away' : null;
    if (!side) return null;
    this.seated[side] = true;
    this.kits[side] = kit;
    if (this.full) this.start();
    return side;
  }

  /** A client reconnected: replay where they are. */
  resume(side: Team): void {
    const msg = this.last[side];
    if (msg) this.deps.send(side, msg);
  }

  private start(): void {
    this.phase = 'squads';
    const kits = { home: this.kits.home!, away: this.kits.away! };
    for (const side of ['home', 'away'] as const) this.emit(side, { t: 'start', side, seed: this.seed, kits });
  }

  handle(side: Team, msg: ClientMessage): void {
    switch (msg.t) {
      case 'squad':
        if (this.phase !== 'squads') return;
        this.squads[side] = msg.squad;
        if (this.squads.home && this.squads.away) this.kickoff();
        return;
      case 'plan':
        if (this.phase !== 'playing' || !this.state || this.plans[side]) return;
        if (msg.plan.team !== side) return;
        this.plans[side] = this.sanitize(side, msg.plan);
        if (this.plans.home && this.plans.away) this.resolve();
        return;
      case 'mash':
        this.mash(side);
        return;
      case 'leave':
        this.left(side);
        return;
      default:
        return;
    }
  }

  /**
   * The server rolls the dice itself; a client's claimed roll is replaced by
   * the real one. Flicks are rebuilt field by field: the timing game's
   * accuracy and height are clamped to 0..1 (they are client-claimed, like
   * mash presses) and the shot marker must be a real `true`.
   */
  private sanitize(side: Team, plan: Plan): Plan {
    const flicks = (Array.isArray(plan.flicks) ? plan.flicks : []).slice(0, 4).map((f) => {
      const out: Flick = { playerId: f.playerId, dir: f.dir, strength: f.strength };
      if (f.shot === true) out.shot = true;
      if (f.aim && typeof f.aim === 'object') {
        out.aim = { accuracy: clamp01(f.aim.accuracy) };
        if (f.aim.height !== undefined) out.aim.height = clamp01(f.aim.height);
      }
      return out;
    });
    const out: Plan = { team: side, flicks };
    if (plan.dice) out.dice = rollDice(mulberry32(rollSeed(this.seed, this.state!, side)));
    if (plan.booster) out.booster = plan.booster;
    return out;
  }

  /** A client squad is used only if it is a legal eleven; anything else gets the baseline squad. */
  private squadFor(side: Team): Squad {
    const s = this.squads[side];
    const legal = s && Array.isArray(s.players) && Array.isArray(s.positions) && s.players.length === SQUAD_SIZE && s.positions.length === SQUAD_SIZE && squadProblem(s.players) === null;
    return legal ? s : defaultSquad(side);
  }

  private kickoff(): void {
    const k = kickoffRoll(mulberry32(kickoffSeed(this.seed)));
    const squads = { home: this.squadFor('home'), away: this.squadFor('away') };
    this.state = initialMatch(k.winner, squads);
    this.phase = 'playing';
    this.both({ t: 'kickoff', state: this.state, rounds: k.rounds, winner: k.winner });
    this.sendTurn();
  }

  private sendTurn(): void {
    const s = this.state!;
    this.plans = {};
    const attack = s.possession.team;
    const deadlineMs = this.deps.now() + PLAN_SECONDS * 1000;
    this.emit(attack, { t: 'turn', state: s, role: 'attack', deadlineMs });
    this.emit(other(attack), { t: 'turn', state: s, role: 'defense', deadlineMs });
    this.cancelTimer?.();
    this.cancelTimer = this.deps.schedule(() => {
      // Whoever has not planned gets an empty plan.
      for (const side of ['home', 'away'] as const) if (!this.plans[side]) this.plans[side] = { team: side, flicks: [] };
      this.resolve();
    }, PLAN_SECONDS * 1000 + PLAN_GRACE_MS);
  }

  private resolve(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const s = this.state!;
    const attack = s.possession.team;
    const result = resolveTurn(s, this.plans[attack]!, this.plans[other(attack)]!, turnSeed(this.seed, s));
    this.state = result.state;
    this.plans = {};
    this.both({ t: 'result', result });
    this.afterTurn();
  }

  private afterTurn(): void {
    const s = this.state!;
    if (s.status === 'duel') {
      this.startDuel();
    } else if (s.status === 'half-time') {
      this.state = continueMatch(s);
      this.sendTurn();
    } else if (s.status === 'full-time') {
      this.phase = 'over';
      this.both({ t: 'over', state: s });
    } else {
      this.sendTurn();
    }
  }

  // ---- Duel ----

  private startDuel(): void {
    this.phase = 'duel';
    this.duel = { open: false, presses: { home: [], away: [] }, meter: 0, endAt: 0, stop: [] };
    this.both({ t: 'duel', openInMs: DUEL.countdownMs, durationMs: DUEL.durationMs });
    const d = this.duel;
    d.stop.push(
      this.deps.schedule(() => {
        d.open = true;
        d.endAt = this.deps.now() + DUEL.durationMs;
        const tick = () => {
          if (!this.duel || this.duel !== d) return;
          this.both({ t: 'meter', value: d.meter });
          if (this.deps.now() >= d.endAt && d.meter !== 0) {
            this.finishDuel(d.meter < 0 ? 'home' : 'away');
            return;
          }
          d.stop.push(this.deps.schedule(tick, DUEL.meterIntervalMs));
        };
        tick();
      }, DUEL.countdownMs),
    );
  }

  private mash(side: Team): void {
    const d = this.duel;
    if (!d || !d.open) return;
    const now = this.deps.now();
    const recent = d.presses[side].filter((t) => now - t < 1000);
    if (recent.length >= DUEL.maxPressesPerSecond) return;
    recent.push(now);
    d.presses[side] = recent;
    d.meter += side === 'home' ? -DUEL.pressStep : DUEL.pressStep;
    d.meter = Math.max(-1, Math.min(1, d.meter));
    // Sudden death after time: the next press decides.
    if (Math.abs(d.meter) >= 1 || now >= d.endAt) this.finishDuel(d.meter < 0 ? 'home' : 'away');
  }

  private finishDuel(winner: Team): void {
    const d = this.duel;
    if (!d) return;
    for (const stop of d.stop) stop();
    this.duel = null;
    const { state, roll } = resolveDuel(this.state!, winner, duelSeed(this.seed, this.state!));
    this.state = state;
    this.phase = 'playing';
    this.both({ t: 'duel-result', winner, state, roll });
    this.sendTurn();
  }

  private left(side: Team): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.duel) for (const stop of this.duel.stop) stop();
    this.duel = null;
    this.phase = 'over';
    this.emit(other(side), { t: 'opponent-left' });
  }
}

export { DICE_BONUS_PER_PIP };
