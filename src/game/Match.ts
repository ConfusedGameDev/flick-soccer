import { CPU_PARAMS, type Difficulty } from '../engine/cpu';
import { BOOSTER_INFO, flipCoin, tossWinner } from '../engine/boosters';
import { other } from '../engine/pitch';
import { FORMATION_NAMES, LEAGUES, cpuSquad, defaultSquad, leaguePool, type PoolPlayer, type Squad } from '../engine/pool';
import { mulberry32 } from '../engine/rng';
import { cpuSeed, duelSeed, kickoffSeed, newSeed, turnSeed } from '../engine/seeds';
import { keeperOf, initialMatch } from '../engine/setup';
import { continueMatch, resolveDuel, resolveTurn } from '../engine/sim';
import type { Booster, MatchState, Plan, Tactic, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Sfx } from '../audio/Sfx';
import { KITS, kitPreview, loadCustomKits, saveCustomKits, type Kit } from '../render/kits';
import type { KitEditor } from '../ui/KitEditor';
import type { Store } from '../ui/Store';
import type { Cutscene, CutsceneKind } from '../ui/Cutscene';
import type { CoinToss } from '../ui/CoinToss';
import { diveName } from '../ui/SetPiece';
import type { PackView } from '../ui/PackView';
import type { AutoMasher, Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import type { Coach } from '../ui/Coach';
import { CpuController, teamName, type LocalController, type PlanController } from './controller';
import type { TeamBuilder } from './TeamBuilder';
import { Tutor, setTutorialState, tutorialState } from './Tutorial';
import { RUN_STAGES, applyResult, clearRun, loadRun, newRun, opponentFor, saveRun, type RunState } from './run';
import { SAVED_MODES, clearSavedMatch, loadSavedMatch, saveMatch, savedMatchLabel, type SavedMatch, type SavedMode } from './saved';

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
  pack: PackView;
  toss: CoinToss;
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

/** Drives a match: menu → teams → coin toss → turns (plan attack → hand off → plan defense → resolve → duel? → review) → full time. */
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
  /** A saved match the player chose to continue from the menu; consumed by the next playMatch. */
  private resume: SavedMatch | null = null;
  /** The attack plan restored with a saved match, used instead of asking the attacker again. */
  private resumedPlan: Plan | null = null;
  /** The run the match in play belongs to (season run only), stamped on every snapshot. */
  private runKey: { seed: number; stage: number } | undefined;

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
      if (this.resume) {
        // A saved match: kits and controllers were set by the menu, the state comes with it.
        const saved = this.resume;
        this.resume = null;
        await this.playMatch('Back to menu', saved);
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

  /**
   * The coin toss, the turns and the full-time card, for whatever squads and kits
   * are set; with a saved match, the turns carry on from its snapshot instead.
   */
  private async playMatch(button = 'Back to menu', saved?: SavedMatch): Promise<void> {
    if (saved) this.restore(saved);
    else await this.kickoff();
    this.deps.sfx.crowdStart();
    while (this.state.status !== 'full-time' && !this.quit) await this.runTurn();
    clearSavedMatch();
    if (!this.quit) await this.fullTime(button);
    this.deps.sfx.crowdStop();
    this.quit = false;
    this.startBoosters = {};
    this.startTactics = {};
  }

  /** Pick up a saved match where it stopped: the seed, the state and any confirmed attack plan. */
  private restore(saved: SavedMatch): void {
    const { pieces, hud, local } = this.deps;
    this.seed = saved.seed;
    local.setSeed(this.seed);
    this.state = saved.state;
    this.resumedPlan = saved.attackPlan ?? null;
    pieces.rebuild(this.state.players);
    this.snap();
    hud.setScoreboard(this.state);
    hud.toast('Match resumed', true);
  }

  /**
   * Snapshot the match so closing the app loses nothing. Called at every turn
   * boundary; the tutorial and online matches are never saved. `state` lets the
   * resolved state be saved before its playback has made it current.
   */
  private persist(state: MatchState = this.state, attackPlan?: Plan): void {
    if (this.tutor || !SAVED_MODES.includes(this.mode as SavedMode)) return;
    saveMatch({ v: 1, mode: this.mode as SavedMode, seed: this.seed, state, kits: this.kits, attackPlan, run: this.runKey });
  }

  /** The CPU opponent: seeded from the match seed and clock, so a replay thinks the same thoughts. */
  private useCpu(difficulty: Difficulty): void {
    const { local, hud } = this.deps;
    this.controllers = { home: local, away: new CpuController(difficulty, hud, (s) => cpuSeed(this.seed, s)) };
  }

  /**
   * The season run: a ladder of CPU clubs, coins from results and the store
   * between matches. The run is saved after every step, so it can be resumed.
   */
  private async seasonRun(): Promise<void> {
    const { hud, builder, pool, pieces, local, store } = this.deps;
    let run: RunState | null = loadRun();
    // A saved match of this run: straight back onto the pitch, no store and no cover.
    let saved = this.resume;
    this.resume = null;
    if (saved && (!run || run.over || saved.run?.seed !== run.seed || saved.run?.stage !== run.stage)) {
      clearSavedMatch();
      saved = null;
    }
    if (saved) {
      /* the menu already chose to continue */
    } else if (run && !run.over) {
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
      if (saved) {
        this.kits = saved.kits;
        pieces.setKits({ ...this.kits });
        hud.setKits(this.kits);
        this.useCpu(opponent.difficulty);
      } else {
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
        this.useCpu(opponent.difficulty);
        await hud.showCover(
          `Match ${run.stage + 1} of ${RUN_STAGES}: ${opponent.name}`,
          `${opponent.difficulty === 'easy' ? 'An easy opponent' : 'A sharp opponent'} drafted with ${opponent.budget} points. Win to move up the ladder; a draw replays the stage; a loss ends the run.`,
          'Kick off',
        );
      }
      this.runKey = { seed: run.seed, stage: run.stage };
      await this.playMatch('Continue', saved ?? undefined);
      this.runKey = undefined;
      saved = null;
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
    this.resume = null;
    if (tutorialState() === 'new') {
      setTutorialState('offered');
      const pick = await hud.showMenu<'tutorial' | 'skip'>('Welcome!', 'First time here? A short guided match teaches flicks, defending and the booster packs.', [
        { key: 'tutorial', label: 'Play the tutorial' },
        { key: 'skip', label: 'Skip, I know the game' },
      ]);
      if (pick === 'tutorial') {
        this.mode = 'tutorial';
        this.useCpu('easy');
        return;
      }
    }
    // A match left unfinished the last time the app closed: offer to pick it up.
    let saved = loadSavedMatch();
    if (saved?.mode === 'run') {
      const run = loadRun();
      if (!run || run.over || saved.run?.seed !== run.seed || saved.run?.stage !== run.stage) {
        clearSavedMatch();
        saved = null;
      }
    }
    if (saved) {
      const pick = await hud.showMenu<'continue' | 'discard'>('Match in progress', savedMatchLabel(saved), [
        { key: 'continue', label: 'Continue the match' },
        { key: 'discard', label: 'Abandon it' },
      ]);
      if (pick === 'continue') {
        this.mode = saved.mode;
        this.resume = saved;
        this.kits = saved.kits;
        this.deps.pieces.setKits({ ...this.kits });
        hud.setKits(this.kits);
        if (saved.mode === 'hotseat') this.controllers = { home: local, away: local };
        else if (saved.mode !== 'run') this.useCpu(saved.mode === 'cpu-easy' ? 'easy' : 'normal');
        return;
      }
      clearSavedMatch();
    }
    hud.overlay.classList.add('title');
    this.mode = await hud.showMenu<Mode>('Super Soccer Deluxo', 'Turn-based flick football', [
      { key: 'tutorial', label: 'How to play · tutorial' },
      { key: 'run', label: 'Season run' },
      { key: 'hotseat', label: '2 players · same device' },
      { key: 'cpu-easy', label: 'vs CPU · easy' },
      { key: 'cpu-normal', label: 'vs CPU · normal' },
      { key: 'online-create', label: 'Online · create a match' },
      { key: 'online-join', label: 'Online · join with a code' },
    ]);
    hud.overlay.classList.remove('title');
    if (this.mode === 'online-create' || this.mode === 'online-join' || this.mode === 'run') return;
    if (this.mode === 'tutorial') {
      this.useCpu('easy');
    } else if (this.mode === 'hotseat') {
      this.controllers = { home: local, away: local };
    } else {
      this.useCpu(this.mode === 'cpu-easy' ? 'easy' : 'normal');
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
          const id = await hud.showMenu<string>(title, 'Club colours, or paint your own', [
            ...options.map((k) => ({ key: k.id, label: k.name, icon: kitPreview(k, 3) })),
            { key: '__new', label: 'Paint a new kit' },
            ...(custom.length ? [{ key: '__edit', label: 'Edit a painted kit' }] : []),
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
    const setup = await hud.showMenu<Setup>('Teams', 'Pick a league and draft its best players, or play with plain squads', [
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
        const league = LEAGUES[(seed >>> 8) % LEAGUES.length];
        this.squads[team] = cpuSquad(leaguePool(pool, league), formation, seed);
        continue;
      }
      if (this.hotSeat) {
        await hud.showCover(`${teamName(team)} draft`, `Hand the device to the ${teamName(team)} player.`, 'Start drafting');
      }
      this.setPhase('BUILD');
      this.squads[team] = await builder.run(`${teamName(team)}: build your team`, pool, seed);
    }
  }

  /**
   * The coin toss: the visitors call in hot-seat (as in football); against the
   * CPU the human, who is always Home, calls. A right call attacks first.
   */
  private async kickoff(): Promise<void> {
    this.setPhase('KICKOFF');
    const { toss, hud, pieces } = this.deps;
    this.state = initialMatch('home', this.squads);
    pieces.rebuild(this.state.players);
    this.snap();
    const coin = flipCoin(mulberry32(kickoffSeed(this.seed)));
    const caller: Team = this.hotSeat ? 'away' : 'home';
    await this.tutor?.beat('kickoff');
    const call = await toss.call({
      title: `${teamName(caller)} call the toss`,
      text: this.hotSeat ? `${teamName(caller)} player: heads or tails? Call it right and you attack first.` : 'Heads or tails? Call it right and you attack first.',
      kit: this.kits[caller],
    });
    const winner = tossWinner(coin, call, caller);
    await toss.flip({
      title: 'The toss',
      coin,
      caption: `${teamName(caller)} called ${call}: it is ${coin}. ${teamName(winner)} attack first.`,
      kit: this.kits[caller],
      button: 'Kick off',
    });
    this.state = initialMatch(winner, this.squads, this.startBoosters, this.startTactics);
    this.snap();
    hud.toast(`${teamName(winner)} attack first`, true);
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
    // The other side's figure on the card: the beaten keeper, the shooter, the robbed passer.
    let foilId: number | null = null;
    if (goal) {
      kind = 'goal';
      playerId = shot?.from ?? null;
      team = goal.team;
      foilId = keeperOf(this.state.players, other(goal.team)).id;
    } else if (save) {
      kind = 'save';
      playerId = save.playerId;
      foilId = shot?.from ?? null;
    } else if (intercept) {
      kind = 'overtake';
      playerId = intercept.playerId;
      const passes = ev.filter((e): e is Extract<TimelineEvent, { type: 'pass' }> => e.type === 'pass' && e.t <= intercept.t);
      foilId = passes.length ? passes[passes.length - 1].from : null;
    } else if (corner) {
      kind = 'corner';
      team = corner.team;
    } else if (throwIn) {
      kind = 'throw-in';
      team = throwIn.team;
    }
    if (!kind) return;
    await this.card(kind, playerId, team, foilId);
  }

  private async card(kind: CutsceneKind, playerId: number | null, team: Team | null, foilId: number | null = null): Promise<void> {
    const p = playerId !== null ? this.state.players[playerId] : null;
    const t = p?.team ?? team ?? this.state.possession.team;
    const featured = p ?? this.state.players[this.state.possession.playerId];
    const foil = foilId !== null ? this.state.players[foilId] : null;
    await this.deps.cutscene.show({
      kind,
      kit: this.kits[t],
      keeper: featured.keeper,
      name: featured.name,
      team: teamName(t),
      foil: { kit: this.kits[other(t)], keeper: foil?.keeper ?? kind === 'goal', name: foil?.name },
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

  /** Show a free pack (overtake or duel win) turning up the engine's card. */
  private async showFreePack(team: Team, booster: Booster, why: string): Promise<void> {
    await this.deps.pack.show({
      title: `${teamName(team)} ${why}: free pack!`,
      booster,
      pick: !this.isCpu(team),
      hint: `${teamName(team)}, tap a card`,
      caption: `${BOOSTER_INFO[booster].name} (${BOOSTER_INFO[booster].text}) goes into ${teamName(team)}'s hand`,
      kit: this.kits[team],
    });
  }

  /**
   * One turn: both plans, the resolution, then whatever the result calls for
   * (a duel, half time, the review). A match restored right after a resolution
   * enters with status 'duel' or 'half-time' and only settles that.
   */
  private async runTurn(): Promise<void> {
    const { hud, player, pieces, preview, duel } = this.deps;
    const turnLabel = `Half ${this.state.half} · Turn ${this.state.turn}`;
    /** Who attacked this turn; null when the turn was resolved before the match was restored. */
    let attackTeam: Team | null = null;
    this.snap();
    hud.setScoreboard(this.state);

    if (this.state.status === 'playing') {
      attackTeam = this.state.possession.team;
      const defenseTeam = other(attackTeam);
      this.persist();

      let attackPlan = this.resumedPlan;
      this.resumedPlan = null;
      if (!attackPlan) {
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
        attackPlan = await this.controllers[attackTeam].plan(this.state, attackTeam, 'attack');
        this.persist(this.state, attackPlan);
      }

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
      // Saved before the playback: closing the app mid-animation cannot replay the turn.
      this.persist(result.state);
      await player.play(result);
      this.state = result.state;
      this.snap();
      hud.setScoreboard(this.state);
      await this.dramatic(result);

      const free = result.events.find((e) => e.type === 'pack' && e.free);
      if (free && free.type === 'pack') await this.showFreePack(free.team, free.booster, 'overtake');
      await this.tutor?.beat('resolved');
    }

    if (this.state.status === 'duel') {
      this.setPhase('DUEL');
      await this.tutor?.beat('duel');
      hud.setStatus('Dead ball!', 'Mash to win it');
      const winner = await duel.run({ left: 'home', right: 'away' }, NAMES, this.cpuMasher(), undefined, this.kits);
      const { state, booster } = resolveDuel(this.state, winner, duelSeed(this.seed, this.state));
      this.state = state;
      this.persist();
      this.snap();
      await this.card('duel', this.state.possession.playerId, winner);
      if (booster) await this.showFreePack(winner, booster, 'win the ball');
    }

    if (this.state.status === 'half-time') {
      this.setPhase('BREAK');
      await hud.showCover(
        'Half time',
        `Home ${this.state.score.home} – ${this.state.score.away} Away. ${teamName(this.state.possession.team)} kick off the second half.`,
        'Start second half',
      );
      this.state = continueMatch(this.state);
      this.persist();
      return;
    }
    if (this.state.status === 'full-time') return;

    this.setPhase('REVIEW');
    const next = this.state.possession.team;
    hud.setStatus(
      attackTeam ? `${turnLabel} done` : 'Match resumed',
      attackTeam === null ? `${teamName(next)} attack` : next === attackTeam ? `${teamName(next)} keep the ball` : `${teamName(next)} take over the attack`,
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
      case 'pack':
        if (!e.free) hud.toast(`${teamName(e.team)} opened a pack: ${BOOSTER_INFO[e.booster].name}`);
        break;
      case 'booster':
        hud.toast(`${teamName(e.team)}: ${BOOSTER_INFO[e.booster].name}!`);
        break;
      case 'keeper-game':
        hud.toast(`${teamName(e.team)}: the keeper dives ${diveName(e.dive)}!`);
        break;
      case 'invalid-flick':
        hud.toast(`Ignored: ${e.reason}`);
        break;
      default:
        break;
    }
  }
}

