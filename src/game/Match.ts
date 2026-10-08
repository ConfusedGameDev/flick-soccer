import { CPU_PARAMS, type Difficulty } from '../engine/cpu';
import { BOOSTER_INFO, kickoffRoll } from '../engine/dice';
import { other } from '../engine/pitch';
import { FORMATION_NAMES, cpuSquad, defaultSquad, type PoolPlayer, type Squad } from '../engine/pool';
import { mulberry32 } from '../engine/rng';
import { cpuSeed, duelSeed, kickoffSeed, newSeed, turnSeed } from '../engine/seeds';
import { initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { Booster, DiceRoll, MatchState, Tactic, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Sfx } from '../audio/Sfx';
import { KITS, kitPreview, loadCustomKits, saveCustomKits, type Kit } from '../render/kits';
import type { KitEditor } from '../ui/KitEditor';
import type { Store } from '../ui/Store';
import type { Cutscene, CutsceneKind } from '../ui/Cutscene';
import { DiceView } from '../ui/DiceView';
import type { AutoMasher, Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import type { Coach } from '../ui/Coach';
import { CpuController, teamName, type LocalController, type PlanController } from './controller';
import type { TeamBuilder } from './TeamBuilder';
import { Tutor, setTutorialState, tutorialState } from './Tutorial';
import { RUN_STAGES, applyResult, clearRun, loadRun, newRun, opponentFor, saveRun, type RunState } from './run';

export type Phase =
  | 'MENU'
  | 'BUILD'
  | 'KICKOFF'
  | 'PLAN_ATTACK'
  | 'HANDOFF'
  | 'PLAN_DEFENSE'
  | 'RESOLVE'
  | 'DUEL'
  | 'REVIEW'
  | 'BREAK'
  | 'OVER'
  | 'ONLINE';

export type Mode = 'tutorial' | 'run' | 'hotseat' | 'cpu-easy' | 'cpu-normal' | 'online-create' | 'online-join';
export type Setup = 'quick' | 'draft';

export interface MatchDeps {
  hud: Hud;
  duel: Duel;
  dice: DiceView;
  builder: TeamBuilder;
  pool: readonly PoolPlayer[];
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  /** The human on this device. */
  local: LocalController;
  sfx: Sfx;
  cutscene: Cutscene;
  kitEditor: KitEditor;
  coach: Coach;
  store: Store;
}

/** Set by main.ts after construction (it needs this Match's kit picker). */
export interface OnlineRunner {
  run(mode: 'create' | 'join'): Promise<void>;
}

const NAMES: Record<Team, string> = { home: 'Home', away: 'Away' };

/** Drives a match: menu → teams → kickoff dice → turns (plan attack → hand off → plan defense → resolve → duel? → review) → full time. */
export class Match {
  state: MatchState = initialMatch();
  phase: Phase = 'MENU';
  mode: Mode = 'hotseat';
  squads: Record<Team, Squad> = { home: defaultSquad('home'), away: defaultSquad('away') };
  kits: Record<Team, Kit> = { home: KITS[0], away: KITS[1] };
  /** Per-match seed; each turn derives its own so a replay with the same plans matches exactly. */
  seed = newSeed();
  lastResult: TurnResult | null = null;
  online: OnlineRunner | null = null;
  /** The first-time tutorial's coach, only in tutorial mode. */
  private tutor: Tutor | null = null;
  /** Set when the tutorial's player chose to leave the match early. */
  private quit = false;
  /** Boosters each side starts the next match with (the season run carries them over). */
  private startBoosters: Partial<Record<Team, Booster[]>> = {};
  /** Tactics cards in play for the next match (season run). */
  private startTactics: Partial<Record<Team, Tactic[]>> = {};
  private controllers: Record<Team, PlanController>;

  constructor(private readonly deps: MatchDeps) {
    this.controllers = { home: deps.local, away: deps.local };
  }

  async start(): Promise<void> {
    for (;;) {
      await this.menu();
      if (this.mode === 'online-create' || this.mode === 'online-join') {
        if (this.online) {
          this.setPhase('ONLINE');
          await this.online.run(this.mode === 'online-create' ? 'create' : 'join');
        }
        continue;
      }
      if (this.mode === 'run') {
        await this.seasonRun();
        continue;
      }
      if (this.mode === 'tutorial') {
        // Straight to the pitch: preset kits and plain squads, the coach does the talking.
        this.tutor = new Tutor(this.deps.coach, this.deps.local);
        this.kits = { home: KITS[0], away: KITS[1] };
        this.deps.coach.setKit(this.kits.home);
        this.deps.pieces.setKits({ ...this.kits });
        this.deps.hud.setKits(this.kits);
        this.squads = { home: defaultSquad('home'), away: defaultSquad('away') };
      } else {
        await this.pickKits();
        await this.teams();
      }
      await this.playMatch();
      this.tutor?.retire();
      this.tutor = null;
    }
  }

  /** Kickoff dice, the turns and the full-time card, for whatever squads and kits are set. */
  private async playMatch(button = 'Back to menu'): Promise<void> {
    await this.kickoff();
    this.deps.sfx.crowdStart();
    while (this.state.status !== 'full-time' && !this.quit) await this.runTurn();
    if (!this.quit) await this.fullTime(button);
    this.deps.sfx.crowdStop();
    this.quit = false;
    this.startBoosters = {};
    this.startTactics = {};
  }

  /**
   * The season run: a ladder of CPU clubs, coins from results and the store
   * between matches. The run is saved after every step, so it can be resumed.
   */
  private async seasonRun(): Promise<void> {
    const { hud, builder, pool, pieces, local, store } = this.deps;
    let run: RunState | null = loadRun();
    if (run && !run.over) {
      const pick = await hud.showMenu<'continue' | 'new'>('Season run', `A run is in progress: match ${run.stage + 1} of ${RUN_STAGES}, 🪙 ${run.coins}.`, [
        { key: 'continue', label: 'Continue the run' },
        { key: 'new', label: 'Start a new run' },
      ]);
      if (pick === 'new') run = null;
    } else {
      run = null;
    }
    if (!run) {
      const kit = await this.chooseKit('home', new Set(), 'Your run: pick a kit');
      const seed = newSeed();
      this.setPhase('BUILD');
      const squad = await builder.run('Your run: build your team', pool, seed);
      run = newRun(seed, squad, kit.id);
      saveRun(run);
    }
    for (;;) {
      const opponent = opponentFor(pool, run);
      if (run.results.length > 0) {
        const next = await store.run(run, pool, opponent);
        if (!next) return;
        run = next;
        saveRun(run);
      }
      const home = [...KITS, ...loadCustomKits()].find((k) => k.id === run!.kitId) ?? KITS[0];
      const away = KITS.filter((k) => k.id !== home.id)[(run.seed + run.stage) % (KITS.length - 1)];
      this.kits = { home, away };
      pieces.setKits({ ...this.kits });
      hud.setKits(this.kits);
      this.squads = { home: run.squad, away: opponent.squad };
      this.startBoosters = { home: run.boosters };
      this.startTactics = { home: run.tactics };
      this.seed = newSeed();
      local.setSeed(this.seed);
      this.controllers = { home: local, away: new CpuController(opponent.difficulty, hud, (s) => cpuSeed(this.seed, s)) };
      await hud.showCover(
        `Match ${run.stage + 1} of ${RUN_STAGES}: ${opponent.name}`,
        `${opponent.difficulty === 'easy' ? 'An easy opponent' : 'A sharp opponent'} drafted with ${opponent.budget} points. Win to move up the ladder; a draw replays the stage; a loss ends the run.`,
        'Kick off',
      );
      await this.playMatch('Continue');
      run = applyResult(run, this.state.score, opponent.name, this.state.meta.home.boosters);
      saveRun(run);
      if (run.over) {
        const wins = run.results.filter((r) => r.outcome === 'win').length;
        await hud.showCover(
          run.over === 'won' ? 'Champions!' : 'Run over',
          run.over === 'won'
            ? `You climbed all ${RUN_STAGES} stages with ${run.coins} coins to spare.`
            : `${opponent.name} ended the run after ${wins} win${wins === 1 ? '' : 's'}.`,
          'Back to menu',
        );
        clearRun();
        return;
      }
    }
  }

  update(dtSeconds: number): void {
    this.deps.player.update(dtSeconds);
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
  }

  turnSeed(): number {
    return turnSeed(this.seed, this.state);
  }

  private isCpu(team: Team): boolean {
    return this.controllers[team].kind === 'cpu';
  }

  private async menu(): Promise<void> {
    this.setPhase('MENU');
    this.state = initialMatch();
    this.seed = newSeed();
    this.deps.pieces.rebuild(this.state.players);
    this.snap();
    const { local, hud } = this.deps;
    hud.setStatus('Super Soccer Deluxo', '');
    hud.setPlanning(null);
    hud.setScoreboard(this.state);
    local.setSeed(this.seed);
    const cpuEasy = () => {
      this.controllers = { home: local, away: new CpuController('easy', hud, (s) => cpuSeed(this.seed, s)) };
    };
    if (tutorialState() === 'new') {
      setTutorialState('offered');
      const pick = await hud.showMenu<'tutorial' | 'skip'>('Welcome!', 'First time here? A short guided match teaches flicks, defending and the dice.', [
        { key: 'tutorial', label: 'Play the tutorial' },
        { key: 'skip', label: 'Skip, I know the game' },
      ]);
      if (pick === 'tutorial') {
        this.mode = 'tutorial';
        cpuEasy();
        return;
      }
    }
    this.mode = await hud.showMenu<Mode>('Super Soccer Deluxo', 'Pick a mode', [
      { key: 'tutorial', label: 'How to play · tutorial' },
      { key: 'run', label: 'Season run' },
      { key: 'hotseat', label: '2 players · same device' },
      { key: 'cpu-easy', label: 'vs CPU · easy' },
      { key: 'cpu-normal', label: 'vs CPU · normal' },
      { key: 'online-create', label: 'Online · create a match' },
      { key: 'online-join', label: 'Online · join with a code' },
    ]);
    if (this.mode === 'online-create' || this.mode === 'online-join' || this.mode === 'run') return;
    if (this.mode === 'tutorial') {
      cpuEasy();
    } else if (this.mode === 'hotseat') {
      this.controllers = { home: local, away: local };
    } else {
      const difficulty: Difficulty = this.mode === 'cpu-easy' ? 'easy' : 'normal';
      // The CPU's seed comes from the match seed and clock, so a replay thinks the same thoughts.
      const cpu = new CpuController(difficulty, hud, (s) => cpuSeed(this.seed, s));
      this.controllers = { home: local, away: cpu };
    }
  }

  /** Each human picks a kit (preset or painted); the CPU takes a different preset. */
  private async pickKits(): Promise<void> {
    const { hud, pieces } = this.deps;
    const taken = new Set<string>();
    for (const team of ['home', 'away'] as const) {
      let kit: Kit;
      if (this.isCpu(team)) {
        const options = KITS.filter((k) => !taken.has(k.id));
        kit = options[(this.seed >>> 3) % options.length];
      } else {
        if (this.hotSeat && team === 'away') await hud.showCover('Away kit', 'Hand the device to the Away player.', 'OK');
        kit = await this.chooseKit(team, taken);
      }
      taken.add(kit.id);
      this.kits[team] = kit;
    }
    pieces.setKits({ ...this.kits });
    hud.setKits(this.kits);
  }

  /** The kit menu for a human: presets and painted kits, with the editor reachable from it. */
  async chooseKit(team: Team, taken: Set<string> = new Set(), title = `${teamName(team)}: pick a kit`): Promise<Kit> {
    const { hud, kitEditor } = this.deps;
    let kit: Kit | null = null;
    {
      {
        while (!kit) {
          const custom = loadCustomKits();
          const options = [...KITS, ...custom].filter((k) => !taken.has(k.id));
          const id = await hud.showMenu<string>(title, 'Classic 1990 colours, or paint your own', [
            ...options.map((k) => ({ key: k.id, label: k.name, icon: kitPreview(k, 3) })),
            { key: '__new', label: '✎ Paint a new kit' },
            ...(custom.length ? [{ key: '__edit', label: '✎ Edit a painted kit' }] : []),
          ]);
          if (id === '__new') {
            const r = await kitEditor.run();
            if (r) saveCustomKits([...loadCustomKits(), r.kit]);
          } else if (id === '__edit') {
            const which = await hud.showMenu<string>('Edit which kit?', '', custom.map((k) => ({ key: k.id, label: k.name, icon: kitPreview(k, 3) })));
            const r = await kitEditor.run(custom.find((k) => k.id === which));
            if (r) {
              const rest = loadCustomKits().filter((k) => k.id !== r.kit.id);
              saveCustomKits(r.deleted ? rest : [...rest, r.kit]);
            }
          } else {
            kit = options.find((k) => k.id === id) ?? null;
          }
        }
      }
    }
    return kit;
  }

  /** Quick match uses baseline squads; draft lets each human pick and arrange a team. The CPU auto-picks. */
  private async teams(): Promise<void> {
    const { hud, builder, pool } = this.deps;
    const setup = await hud.showMenu<Setup>('Teams', 'Draft from the Liga MX pool, or play with plain squads', [
      { key: 'draft', label: 'Draft teams (100 points)' },
      { key: 'quick', label: 'Quick match' },
    ]);
    if (setup === 'quick') {
      this.squads = { home: defaultSquad('home'), away: defaultSquad('away') };
      return;
    }
    for (const team of ['home', 'away'] as const) {
      const seed = (this.seed ^ (team === 'home' ? 0x1234 : 0x5678)) >>> 0;
      if (this.isCpu(team)) {
        const formation = FORMATION_NAMES[seed % FORMATION_NAMES.length];
        this.squads[team] = cpuSquad(pool, formation, seed);
        continue;
      }
      if (this.hotSeat) {
        await hud.showCover(`${teamName(team)} draft`, `Hand the device to the ${teamName(team)} player.`, 'Start drafting');
      }
      this.setPhase('BUILD');
      this.squads[team] = await builder.run(`${teamName(team)}: build your team`, pool, seed);
    }
  }

  /** Each side flicks a die; the higher roll attacks first. */
  private async kickoff(): Promise<void> {
    this.setPhase('KICKOFF');
    const { dice, hud, pieces } = this.deps;
    this.state = initialMatch('home', this.squads);
    pieces.rebuild(this.state.players);
    this.snap();
    const k = kickoffRoll(mulberry32(kickoffSeed(this.seed)));
    const again = k.rounds.length > 1 ? ' (ties rolled again)' : '';
    await this.tutor?.beat('kickoff');
    for (const team of ['home', 'away'] as const) {
      const i = team === 'home' ? 0 : 1;
      const last = k.rounds[k.rounds.length - 1];
      await dice.show({
        title: `Kickoff: ${teamName(team)}${this.isCpu(team) ? ' (CPU)' : ''} roll`,
        rounds: k.rounds.map((r) => [r[i]]),
        caption: `${teamName(team)} rolled ${last[i]}${again}`,
        flick: !this.isCpu(team),
        hint: `${teamName(team)}, shoot the ball at your die`,
        again: 'Tie! Roll again…',
        kit: this.kits[team],
      });
    }
    this.state = initialMatch(k.winner, this.squads, this.startBoosters, this.startTactics);
    this.snap();
    await hud.showCover(
      `${teamName(k.winner)} attack first`,
      `Home ${k.rounds[k.rounds.length - 1][0]} – ${k.rounds[k.rounds.length - 1][1]} Away on the dice.`,
      'Kick off',
    );
    this.deps.sfx.whistle(true);
  }

  /** The one dramatic moment of a turn, if any, as a cutscene card. */
  private async dramatic(result: TurnResult): Promise<void> {
    const ev = result.events;
    const byType = <T extends TimelineEvent['type']>(t: T) => ev.find((e) => e.type === t) as Extract<TimelineEvent, { type: T }> | undefined;
    const shot = byType('shot');
    const goal = byType('goal');
    const save = byType('save');
    const intercept = byType('intercept');
    const corner = byType('corner');
    const throwIn = byType('throw-in');
    let kind: CutsceneKind | null = null;
    let playerId: number | null = null;
    let team: Team | null = null;
    if (goal) {
      kind = 'goal';
      playerId = shot?.from ?? null;
      team = goal.team;
    } else if (save) {
      kind = 'save';
      playerId = save.playerId;
    } else if (intercept) {
      kind = 'overtake';
      playerId = intercept.playerId;
    } else if (corner) {
      kind = 'corner';
      team = corner.team;
    } else if (throwIn) {
      kind = 'throw-in';
      team = throwIn.team;
    }
    if (!kind) return;
    await this.card(kind, playerId, team);
  }

  private async card(kind: CutsceneKind, playerId: number | null, team: Team | null): Promise<void> {
    const p = playerId !== null ? this.state.players[playerId] : null;
    const t = p?.team ?? team ?? this.state.possession.team;
    const featured = p ?? this.state.players[this.state.possession.playerId];
    await this.deps.cutscene.show({
      kind,
      kit: this.kits[t],
      keeper: featured.keeper,
      name: featured.name,
      team: teamName(t),
    });
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
      hint: `${teamName(team)}, shoot the ball at the dice`,
      kit: this.kits[team],
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
    if (this.tutor && !this.isCpu(attackTeam)) {
      hud.setStatus(`${teamName(attackTeam)} attack`, 'The coach has a word…');
      await this.tutor.beat('attack');
    }
    const attackPlan = await this.controllers[attackTeam].plan(this.state, attackTeam, 'attack');

    if (this.hotSeat) {
      this.setPhase('HANDOFF');
      await hud.showCover(
        `${teamName(defenseTeam)} defend`,
        `Hand the device to the ${teamName(defenseTeam)} player. The attack plan is hidden.`,
      );
    }
    this.setPhase('PLAN_DEFENSE');
    if (this.tutor && !this.isCpu(defenseTeam)) {
      hud.setStatus(`${teamName(defenseTeam)} defend`, 'The coach has a word…');
      await this.tutor.beat('defense');
    }
    const defensePlan = await this.controllers[defenseTeam].plan(this.state, defenseTeam, 'defense');

    this.setPhase('RESOLVE');
    await this.tutor?.beat('resolve');
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
    await this.dramatic(result);

    const free = result.events.find((e) => e.type === 'dice' && e.free);
    if (free && free.type === 'dice') await this.showFreeRoll(free.team, free.roll, 'overtake');
    await this.tutor?.beat('resolved');

    if (this.state.status === 'duel') {
      this.setPhase('DUEL');
      await this.tutor?.beat('duel');
      hud.setStatus('Dead ball!', 'Mash to win it');
      const winner = await duel.run({ left: 'home', right: 'away' }, NAMES, this.cpuMasher());
      const { state, roll } = resolveDuel(this.state, winner, duelSeed(this.seed, this.state));
      this.state = state;
      this.snap();
      await this.card('duel', this.state.possession.playerId, winner);
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
    if ((await this.tutor?.beat('review')) === 'quit') {
      this.quit = true;
      return;
    }
    await hud.waitNext();
  }

  private async fullTime(button = 'Back to menu'): Promise<void> {
    this.setPhase('OVER');
    this.deps.hud.setScoreboard(this.state);
    const { home, away } = this.state.score;
    const verdict = home === away ? 'A draw!' : `${home > away ? 'Home' : 'Away'} win!`;
    this.deps.hud.setStatus('Full time', verdict);
    await this.deps.hud.showCover('Full time', `Home ${home} – ${away} Away. ${verdict}`, button);
  }

  onEvent(e: TimelineEvent): void {
    const { hud, sfx, pieces } = this.deps;
    const who = (id: number) => {
      const p = this.state.players[id];
      return `${p.name} (${teamName(p.team)})`;
    };
    switch (e.type) {
      case 'pass':
        sfx.kick(0.4);
        break;
      case 'shot':
        sfx.kick(1);
        break;
      case 'slide':
      case 'dive':
        pieces.setSliding(e.playerId);
        break;
      case 'goal':
        sfx.goal();
        hud.toast(`GOAL! ${teamName(e.team)}`, true);
        break;
      case 'save':
        sfx.save();
        hud.toast(`Saved by ${who(e.playerId)}!`, true);
        break;
      case 'intercept':
        sfx.tackle();
        hud.toast(`Intercepted by ${who(e.playerId)}!`);
        break;
      case 'dead-ball':
        sfx.whistle();
        hud.toast('Dead ball');
        break;
      case 'corner':
        sfx.whistle();
        hud.toast(`Corner to ${teamName(e.team)}`);
        break;
      case 'throw-in':
        sfx.whistle();
        hud.toast(`Throw-in to ${teamName(e.team)}`);
        break;
      case 'goal-kick':
        sfx.whistle();
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

