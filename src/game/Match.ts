import { CPU_PARAMS, type Difficulty } from '../engine/cpu';
import { BOOSTER_INFO, kickoffRoll } from '../engine/dice';
import { other } from '../engine/pitch';
import { mulberry32 } from '../engine/rng';
import { initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { DiceRoll, MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import { DiceView } from '../ui/DiceView';
import type { AutoMasher, Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import { CpuController, teamName, type PlanController } from './controller';

export type Phase =
  | 'MENU'
  | 'KICKOFF'
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
  dice: DiceView;
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  /** The human on this device. */
  local: PlanController;
}

const NAMES: Record<Team, string> = { home: 'Home', away: 'Away' };

/** Drives a match: menu → kickoff dice → turns (plan attack → hand off → plan defense → resolve → duel? → review) → full time. */
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
      await this.kickoff();
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

  private clockKey(s: MatchState): number {
    return s.half * 100 + s.turn;
  }

  turnSeed(): number {
    return (this.seed + this.clockKey(this.state) * 7919) >>> 0;
  }

  /** Seed for a side's trade roll in the given turn. Deterministic, so a replay rolls the same. */
  rollSeed(state: MatchState, team: Team): number {
    return (this.seed ^ (this.clockKey(state) * 40503 + (team === 'home' ? 7919 : 15838))) >>> 0;
  }

  private isCpu(team: Team): boolean {
    return this.controllers[team].kind === 'cpu';
  }

  private async menu(): Promise<void> {
    this.setPhase('MENU');
    this.state = initialMatch();
    this.seed = newSeed();
    this.snap();
    this.deps.hud.setStatus('Flick Soccer', '');
    this.deps.hud.setPlanning(null);
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
      const cpu = new CpuController(difficulty, hud, (s) => (this.seed ^ (this.clockKey(s) * 2654435761)) >>> 0);
      this.controllers = { home: local, away: cpu };
    }
  }

  /** Each side flicks a die; the higher roll attacks first. */
  private async kickoff(): Promise<void> {
    this.setPhase('KICKOFF');
    const { dice, hud } = this.deps;
    const k = kickoffRoll(mulberry32(this.seed ^ 0x2545f491));
    const again = k.rounds.length > 1 ? ' (ties rolled again)' : '';
    for (const team of ['home', 'away'] as const) {
      const i = team === 'home' ? 0 : 1;
      const last = k.rounds[k.rounds.length - 1];
      await dice.show({
        title: `Kickoff: ${teamName(team)}${this.isCpu(team) ? ' (CPU)' : ''} roll`,
        rounds: k.rounds.map((r) => [r[i]]),
        caption: `${teamName(team)} rolled ${last[i]}${again}`,
        flick: !this.isCpu(team),
        hint: `${teamName(team)}, pull back and release your die`,
        again: 'Tie! Roll again…',
      });
    }
    this.state = initialMatch(k.winner);
    this.snap();
    await hud.showCover(
      `${teamName(k.winner)} attack first`,
      `Home ${k.rounds[k.rounds.length - 1][0]} – ${k.rounds[k.rounds.length - 1][1]} Away on the dice.`,
      'Kick off',
    );
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

  /** Show a free roll (overtake or duel win) landing on the engine's numbers. */
  private async showFreeRoll(team: Team, roll: DiceRoll, why: string): Promise<void> {
    await this.deps.dice.show({
      title: `${teamName(team)} ${why}: free roll!`,
      rounds: roll.pairs,
      caption: `${DiceView.caption(roll)} (banked for ${teamName(team)}'s next turn)`,
      flick: !this.isCpu(team),
      hint: `${teamName(team)}, pull back and release`,
    });
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

    const free = result.events.find((e) => e.type === 'dice' && e.free);
    if (free && free.type === 'dice') await this.showFreeRoll(free.team, free.roll, 'overtake');

    if (this.state.status === 'duel') {
      this.setPhase('DUEL');
      hud.setStatus('Dead ball!', 'Mash to win it');
      const winner = await duel.run({ left: 'home', right: 'away' }, NAMES, this.cpuMasher());
      const { state, roll } = resolveDuel(this.state, winner, this.turnSeed() ^ 0x7f4a7c15);
      this.state = state;
      this.snap();
      await this.showFreeRoll(winner, roll, 'win the ball');
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
      case 'dice':
        if (!e.free) hud.toast(`${teamName(e.team)} rolled ${e.roll.sum}: ${DiceView.caption(e.roll)}`);
        break;
      case 'booster':
        hud.toast(`${teamName(e.team)}: ${BOOSTER_INFO[e.booster].name}!`);
        break;
      case 'invalid-flick':
        hud.toast(`Ignored: ${e.reason}`);
        break;
      default:
        break;
    }
  }
}

function newSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
