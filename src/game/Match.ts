import { other } from '../engine/pitch';
import { initialMatch } from '../engine/setup';
import { resolveTurn } from '../engine/sim';
import type { MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Hud } from '../ui/Hud';
import { teamName, type PlanController } from './controller';

export type Phase = 'PLAN_ATTACK' | 'HANDOFF' | 'PLAN_DEFENSE' | 'RESOLVE' | 'REVIEW';

export interface MatchDeps {
  hud: Hud;
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  controllers: Record<Team, PlanController>;
}

/** Drives turns: plan attack → hand off → plan defense → resolve → review → repeat. */
export class Match {
  state: MatchState = initialMatch();
  phase: Phase = 'PLAN_ATTACK';
  /** Per-match seed; each turn derives its own so a replay with the same plans matches exactly. */
  readonly seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  lastResult: TurnResult | null = null;

  constructor(private readonly deps: MatchDeps) {}

  async start(): Promise<void> {
    this.deps.pieces.setPositions(
      this.state.players.map((p) => p.pos),
      this.state.ball,
    );
    for (;;) await this.runTurn();
  }

  update(dtSeconds: number): void {
    this.deps.player.update(dtSeconds);
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
  }

  turnSeed(turn: number): number {
    return (this.seed + turn * 7919) >>> 0;
  }

  private async runTurn(): Promise<void> {
    const { hud, controllers, player, pieces, preview } = this.deps;
    const attackTeam = this.state.possession.team;
    const defenseTeam = other(attackTeam);
    const hotSeat = controllers.home.kind === 'local' && controllers.away.kind === 'local';

    if (hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `Turn ${this.state.turn}: ${teamName(attackTeam)} attacks`,
        `Hand the device to the ${teamName(attackTeam)} player. Tap Ready when nobody else is looking.`,
      );
    }
    this.setPhase('PLAN_ATTACK');
    const attackPlan = await controllers[attackTeam].plan(this.state, attackTeam, 'attack');

    if (hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${teamName(defenseTeam)} defends`,
        `Hand the device to the ${teamName(defenseTeam)} player. The attack plan is hidden.`,
      );
    }
    this.setPhase('PLAN_DEFENSE');
    const defensePlan = await controllers[defenseTeam].plan(this.state, defenseTeam, 'defense');

    this.setPhase('RESOLVE');
    hud.setPlanning(null);
    hud.setStatus(`Turn ${this.state.turn}`, 'Both plans play out…');
    preview.clear();
    pieces.setHighlights(null, []);
    const result = resolveTurn(this.state, attackPlan, defensePlan, this.turnSeed(this.state.turn));
    this.lastResult = result;
    await player.play(result);

    this.state = result.state;
    this.setPhase('REVIEW');
    const next = this.state.possession.team;
    hud.setStatus(
      `Turn ${result.state.turn - 1} done`,
      next === attackTeam ? `${teamName(next)} keep the ball` : `${teamName(next)} take over the attack`,
    );
    await hud.waitNext();
  }

  onEvent(e: TimelineEvent): void {
    const { hud } = this.deps;
    const who = (id: number) => {
      const p = this.state.players[id];
      return `${teamName(p.team)} #${p.number}`;
    };
    switch (e.type) {
      case 'intercept':
        hud.toast(`Intercepted by ${who(e.playerId)}!`);
        break;
      case 'dead-ball':
        hud.toast('Dead ball');
        break;
      case 'out':
        hud.toast('Out of play');
        break;
      case 'invalid-flick':
        hud.toast(`Flick ignored: ${e.reason}`);
        break;
      default:
        break;
    }
  }
}
