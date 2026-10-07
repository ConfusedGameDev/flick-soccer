import { other } from '../engine/pitch';
import { initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import { teamName, type PlanController } from './controller';

export type Phase = 'PLAN_ATTACK' | 'HANDOFF' | 'PLAN_DEFENSE' | 'RESOLVE' | 'DUEL' | 'REVIEW' | 'BREAK' | 'OVER';

export interface MatchDeps {
  hud: Hud;
  duel: Duel;
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  controllers: Record<Team, PlanController>;
}

const NAMES: Record<Team, string> = { home: 'Home', away: 'Away' };

/** Drives turns: plan attack → hand off → plan defense → resolve → (duel) → review → repeat. */
export class Match {
  state: MatchState = initialMatch();
  phase: Phase = 'PLAN_ATTACK';
  /** Per-match seed; each turn derives its own so a replay with the same plans matches exactly. */
  seed = newSeed();
  lastResult: TurnResult | null = null;

  constructor(private readonly deps: MatchDeps) {}

  async start(): Promise<void> {
    for (;;) {
      this.snap();
      this.deps.hud.setScoreboard(this.state);
      if (this.state.status === 'full-time') {
        await this.fullTime();
        continue;
      }
      await this.runTurn();
    }
  }

  update(dtSeconds: number): void {
    this.deps.player.update(dtSeconds);
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
  }

  turnSeed(): number {
    return (this.seed + (this.state.half * 100 + this.state.turn) * 7919) >>> 0;
  }

  /** Put every piece where the state says (restarts teleport players). */
  private snap(): void {
    this.deps.pieces.setPositions(
      this.state.players.map((p) => p.pos),
      this.state.ball,
    );
  }

  private get hotSeat(): boolean {
    const c = this.deps.controllers;
    return c.home.kind === 'local' && c.away.kind === 'local';
  }

  private async runTurn(): Promise<void> {
    const { hud, controllers, player, pieces, preview, duel } = this.deps;
    const attackTeam = this.state.possession.team;
    const defenseTeam = other(attackTeam);
    const turnLabel = `Half ${this.state.half} · Turn ${this.state.turn}`;

    if (this.hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${turnLabel}: ${teamName(attackTeam)} attack`,
        `Hand the device to the ${teamName(attackTeam)} player. Tap Ready when nobody else is looking.`,
      );
    }
    this.setPhase('PLAN_ATTACK');
    const attackPlan = await controllers[attackTeam].plan(this.state, attackTeam, 'attack');

    if (this.hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${teamName(defenseTeam)} defend`,
        `Hand the device to the ${teamName(defenseTeam)} player. The attack plan is hidden.`,
      );
    }
    this.setPhase('PLAN_DEFENSE');
    const defensePlan = await controllers[defenseTeam].plan(this.state, defenseTeam, 'defense');

    this.setPhase('RESOLVE');
    hud.setPlanning(null);
    hud.setStatus(turnLabel, 'Both plans play out…');
    preview.clear();
    pieces.setHighlights(null, []);
    const result = resolveTurn(this.state, attackPlan, defensePlan, this.turnSeed());
    this.lastResult = result;
    await player.play(result);
    this.state = result.state;
    this.snap();
    hud.setScoreboard(this.state);

    if (this.state.status === 'duel') {
      this.setPhase('DUEL');
      hud.setStatus('Dead ball!', 'Mash to win it');
      const winner = await duel.run({ left: 'home', right: 'away' }, NAMES);
      this.state = resolveDuel(this.state, winner);
      this.snap();
    }

    if (this.state.status === 'half-time') {
      this.setPhase('BREAK');
      await hud.showCover(
        'Half time',
        `Home ${this.state.score.home} – ${this.state.score.away} Away. ${teamName(this.state.possession.team)} kick off the second half.`,
        'Start second half',
      );
      this.state = continueMatch(this.state);
      return;
    }
    if (this.state.status === 'full-time') return;

    this.setPhase('REVIEW');
    const next = this.state.possession.team;
    hud.setStatus(
      `${turnLabel} done`,
      next === attackTeam ? `${teamName(next)} keep the ball` : `${teamName(next)} take over the attack`,
    );
    await hud.waitNext();
  }

  private async fullTime(): Promise<void> {
    this.setPhase('OVER');
    const { home, away } = this.state.score;
    const verdict = home === away ? 'A draw!' : `${home > away ? 'Home' : 'Away'} win!`;
    this.deps.hud.setStatus('Full time', verdict);
    await this.deps.hud.showCover('Full time', `Home ${home} – ${away} Away. ${verdict}`, 'Play again');
    this.state = initialMatch();
    this.seed = newSeed();
  }

  onEvent(e: TimelineEvent): void {
    const { hud } = this.deps;
    const who = (id: number) => {
      const p = this.state.players[id];
      return `${teamName(p.team)} #${p.number}`;
    };
    switch (e.type) {
      case 'goal':
        hud.toast(`GOAL! ${teamName(e.team)}`, true);
        break;
      case 'save':
        hud.toast(`Saved by ${who(e.playerId)}!`, true);
        break;
      case 'intercept':
        hud.toast(`Intercepted by ${who(e.playerId)}!`);
        break;
      case 'dead-ball':
        hud.toast('Dead ball');
        break;
      case 'corner':
        hud.toast(`Corner to ${teamName(e.team)}`);
        break;
      case 'throw-in':
        hud.toast(`Throw-in to ${teamName(e.team)}`);
        break;
      case 'goal-kick':
        hud.toast(`Goal kick for ${teamName(e.team)}`);
        break;
      case 'invalid-flick':
        hud.toast(`Flick ignored: ${e.reason}`);
        break;
      default:
        break;
    }
  }
}

function newSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
