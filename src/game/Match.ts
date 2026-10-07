import { CPU_PARAMS, type Difficulty } from '../engine/cpu';
import { other } from '../engine/pitch';
import { initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { AutoMasher, Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import { CpuController, teamName, type PlanController } from './controller';

export type Phase =
  | 'MENU'
  | 'PLAN_ATTACK'
  | 'HANDOFF'
  | 'PLAN_DEFENSE'
  | 'RESOLVE'
  | 'DUEL'
  | 'REVIEW'
  | 'BREAK'
  | 'OVER';

export type Mode = 'hotseat' | 'cpu-easy' | 'cpu-normal';

export interface MatchDeps {
  hud: Hud;
  duel: Duel;
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  /** The human on this device. */
  local: PlanController;
}

const NAMES: Record<Team, string> = { home: 'Home', away: 'Away' };

/** Drives a match: menu → turns (plan attack → hand off → plan defense → resolve → duel? → review) → full time. */
export class Match {
  state: MatchState = initialMatch();
  phase: Phase = 'MENU';
  mode: Mode = 'hotseat';
  /** Per-match seed; each turn derives its own so a replay with the same plans matches exactly. */
  seed = newSeed();
  lastResult: TurnResult | null = null;
  private controllers: Record<Team, PlanController>;

  constructor(private readonly deps: MatchDeps) {
    this.controllers = { home: deps.local, away: deps.local };
  }

  async start(): Promise<void> {
    for (;;) {
      await this.menu();
      while (this.state.status !== 'full-time') await this.runTurn();
      await this.fullTime();
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

  private async menu(): Promise<void> {
    this.setPhase('MENU');
    this.state = initialMatch();
    this.seed = newSeed();
    this.snap();
    this.deps.hud.setStatus('Flick Soccer', '');
    this.deps.hud.setScoreboard(this.state);
    this.mode = await this.deps.hud.showMenu<Mode>('Flick Soccer', 'Pick a mode', [
      { key: 'hotseat', label: '2 players · same device' },
      { key: 'cpu-easy', label: 'vs CPU · easy' },
      { key: 'cpu-normal', label: 'vs CPU · normal' },
    ]);
    const { local, hud } = this.deps;
    if (this.mode === 'hotseat') {
      this.controllers = { home: local, away: local };
    } else {
      const difficulty: Difficulty = this.mode === 'cpu-easy' ? 'easy' : 'normal';
      // The CPU's seed comes from the match seed and clock, so a replay thinks the same thoughts.
      const cpu = new CpuController(difficulty, hud, (s) => (this.seed ^ ((s.half * 100 + s.turn) * 2654435761)) >>> 0);
      this.controllers = { home: local, away: cpu };
    }
  }

  /** Put every piece where the state says (restarts teleport players). */
  private snap(): void {
    this.deps.pieces.setPositions(
      this.state.players.map((p) => p.pos),
      this.state.ball,
    );
  }

  private get hotSeat(): boolean {
    return this.controllers.home.kind === 'local' && this.controllers.away.kind === 'local';
  }

  private cpuMasher(): AutoMasher | undefined {
    for (const side of ['left', 'right'] as const) {
      const team: Team = side === 'left' ? 'home' : 'away';
      const c = this.controllers[team];
      if (c.kind === 'cpu') return { side, rate: CPU_PARAMS[(c as CpuController).difficulty].mashRate };
    }
    return undefined;
  }

  private async runTurn(): Promise<void> {
    const { hud, player, pieces, preview, duel } = this.deps;
    const attackTeam = this.state.possession.team;
    const defenseTeam = other(attackTeam);
    const turnLabel = `Half ${this.state.half} · Turn ${this.state.turn}`;
    this.snap();
    hud.setScoreboard(this.state);

    if (this.hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${turnLabel}: ${teamName(attackTeam)} attack`,
        `Hand the device to the ${teamName(attackTeam)} player. Tap Ready when nobody else is looking.`,
      );
    }
    this.setPhase('PLAN_ATTACK');
    const attackPlan = await this.controllers[attackTeam].plan(this.state, attackTeam, 'attack');

    if (this.hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${teamName(defenseTeam)} defend`,
        `Hand the device to the ${teamName(defenseTeam)} player. The attack plan is hidden.`,
      );
    }
    this.setPhase('PLAN_DEFENSE');
    const defensePlan = await this.controllers[defenseTeam].plan(this.state, defenseTeam, 'defense');

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
      const winner = await duel.run({ left: 'home', right: 'away' }, NAMES, this.cpuMasher());
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
    this.deps.hud.setScoreboard(this.state);
    const { home, away } = this.state.score;
    const verdict = home === away ? 'A draw!' : `${home > away ? 'Home' : 'Away'} win!`;
    this.deps.hud.setStatus('Full time', verdict);
    await this.deps.hud.showCover('Full time', `Home ${home} – ${away} Away. ${verdict}`, 'Back to menu');
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
