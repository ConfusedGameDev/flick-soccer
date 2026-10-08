import type { Sfx } from '../audio/Sfx';
import { BOOSTER_INFO } from '../engine/dice';
import { other } from '../engine/pitch';
import { defaultSquad, type PoolPlayer, type Squad } from '../engine/pool';
import type { DiceRoll, MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { ServerMessage } from '../net/protocol';
import { Socket } from '../net/Socket';
import type { Kit } from '../render/kits';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Cutscene, CutsceneKind } from '../ui/Cutscene';
import { DiceView } from '../ui/DiceView';
import type { Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import { teamName, type LocalController } from './controller';
import type { TeamBuilder } from './TeamBuilder';

export type OnlineMode = 'create' | 'join';

export interface OnlineDeps {
  serverUrl: string;
  hud: Hud;
  duel: Duel;
  dice: DiceView;
  cutscene: Cutscene;
  sfx: Sfx;
  builder: TeamBuilder;
  pool: readonly PoolPlayer[];
  pieces: PiecesView;
  preview: PlanPreview;
  player: TimelinePlayer;
  local: LocalController;
  /** Reuses the single-player kit picker. */
  pickKit: () => Promise<Kit>;
}

const NAMES: Record<Team, string> = { home: 'Home', away: 'Away' };
const SESSION_KEY = 'flicksoccer.online';

/**
 * One online match from this device's point of view. The server owns the
 * seed, resolves turns, rolls dice and runs the duel; this class drives the
 * same planning UI the local modes use and animates what the server sends.
 */
export class OnlineMatch {
  state: MatchState | null = null;
  side: Team = 'home';
  private socket: Socket | null = null;

  constructor(private readonly deps: OnlineDeps) {}

  async run(mode: OnlineMode): Promise<void> {
    const { hud, pieces, player } = this.deps;
    const socket = new Socket(this.deps.serverUrl);
    this.socket = socket;
    let code = '';
    let token = '';
    socket.onReconnect = () => {
      if (code && token) socket.send({ t: 'resume', code, token });
    };
    socket.onStatus = (s) => {
      if (s === 'reconnecting') hud.toast('Connection lost, reconnecting…');
    };

    try {
      hud.setStatus('Online', 'Connecting…');
      await socket.connect();
    } catch {
      await hud.showCover('No connection', 'Could not reach the match server. Try again in a moment.', 'Back');
      return;
    }

    try {
      // ---- Lobby ----
      const kit = await this.deps.pickKit();
      if (mode === 'create') {
        socket.send({ t: 'create', kit });
        const c = await socket.next(['created', 'error']);
        if (c.t === 'error') throw new Error(c.message);
        code = c.code;
        token = c.token;
        this.side = c.side;
        const outcome = await Promise.race([
          socket.next(['start', 'error']).then((m) => m),
          hud.showCover(`Room code: ${code}`, 'Tell your opponent the code. Waiting for them to join…', 'Cancel').then(() => null),
        ]);
        hud.hideCover();
        if (!outcome) {
          socket.send({ t: 'leave' });
          return;
        }
        if (outcome.t === 'error') throw new Error(outcome.message);
        await this.onStart(outcome);
      } else {
        const entered = await hud.prompt('Join a match', 'Enter the 4-letter room code', 'ABCD');
        if (!entered) return;
        socket.send({ t: 'join', code: entered.trim().toUpperCase(), kit });
        const j = await socket.next(['joined', 'error']);
        if (j.t === 'error') throw new Error(j.message);
        code = j.code;
        token = j.token;
        this.side = j.side;
        const s = await socket.next(['start', 'error']);
        if (s.t === 'error') throw new Error(s.message);
        await this.onStart(s);
      }
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token }));
      } catch {
        /* ignore */
      }

      // ---- Teams ----
      const squad = await this.chooseSquad();
      socket.send({ t: 'squad', squad });
      const kickoffOrLeft = await Promise.race([
        socket.next(['kickoff', 'opponent-left', 'error']),
        hud.showCover('Team sent', "Waiting for your opponent's team…", 'Leave match').then(() => null),
      ]);
      hud.hideCover();
      if (!kickoffOrLeft) {
        socket.send({ t: 'leave' });
        return;
      }
      if (kickoffOrLeft.t !== 'kickoff') {
        await this.ended(kickoffOrLeft);
        return;
      }
      await this.onKickoff(kickoffOrLeft);

      // ---- Turns ----
      for (;;) {
        const msg = await socket.next(['turn', 'result', 'duel', 'duel-result', 'over', 'opponent-left', 'error']);
        if (msg.t === 'turn') {
          this.state = msg.state;
          this.snap();
          hud.setScoreboard(msg.state);
          const plan = await this.deps.local.plan(msg.state, this.side, msg.role);
          socket.send({ t: 'plan', plan });
          hud.setStatus('Plan sent', 'Waiting for your opponent…');
        } else if (msg.t === 'result') {
          await this.onResult(msg.result);
        } else if (msg.t === 'duel') {
          await this.onDuel(msg);
        } else if (msg.t === 'duel-result') {
          this.state = msg.state;
          this.snap();
          await this.card('duel', msg.state.possession.playerId, msg.winner);
          await this.showFreeRoll(msg.winner, msg.roll, 'win the ball');
        } else {
          await this.ended(msg);
          break;
        }
      }
    } catch (e) {
      await hud.showCover('Online match', (e as Error).message || 'Something went wrong.', 'Back');
    } finally {
      socket.close();
      this.socket = null;
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
      hud.setPlanning(null);
      hud.setTimer(null);
      this.deps.preview.clear();
      pieces.setHighlights(null, []);
      if (player.playing) player.update(100);
    }
  }

  private async onStart(m: Extract<ServerMessage, { t: 'start' }>): Promise<void> {
    this.side = m.side;
    this.deps.local.setSeed(m.seed);
    this.deps.pieces.setKits({ ...m.kits });
    this.deps.hud.setKits(m.kits);
  }

  private async chooseSquad(): Promise<Squad> {
    const { hud, builder, pool } = this.deps;
    const setup = await hud.showMenu<'draft' | 'quick'>('Your team', 'Draft from the Liga MX pool, or play with a plain squad', [
      { key: 'draft', label: 'Draft a team (100 points)' },
      { key: 'quick', label: 'Quick squad' },
    ]);
    if (setup === 'quick') return defaultSquad(this.side);
    return builder.run(`${NAMES[this.side]}: build your team`, pool, Date.now() & 0xffff);
  }

  private async onKickoff(m: Extract<ServerMessage, { t: 'kickoff' }>): Promise<void> {
    const { hud, pieces, dice, sfx } = this.deps;
    this.state = m.state;
    pieces.rebuild(m.state.players);
    this.snap();
    hud.setScoreboard(m.state);
    hud.setStatus('Online match', `You are ${teamName(this.side)}`);
    const again = m.rounds.length > 1 ? ' (ties rolled again)' : '';
    for (const team of ['home', 'away'] as const) {
      const i = team === 'home' ? 0 : 1;
      const last = m.rounds[m.rounds.length - 1];
      await dice.show({
        title: `Kickoff: ${teamName(team)}${team === this.side ? ' (you)' : ''} roll`,
        rounds: m.rounds.map((r) => [r[i]]),
        caption: `${teamName(team)} rolled ${last[i]}${again}`,
        flick: team === this.side,
        hint: 'Shoot the ball at your die',
        again: 'Tie! Roll again…',
        kit: this.deps.pieces.currentKits[team],
      });
    }
    await hud.showCover(
      `${teamName(m.winner)} attack first`,
      `You are ${teamName(this.side)}. Home ${m.rounds[m.rounds.length - 1][0]} – ${m.rounds[m.rounds.length - 1][1]} Away on the dice.`,
      'Kick off',
    );
    sfx.whistle(true);
    sfx.crowdStart();
  }

  private async onResult(result: TurnResult): Promise<void> {
    const { hud, player, preview, pieces } = this.deps;
    const before = this.state!;
    hud.setPlanning(null);
    hud.setStatus(`Half ${before.half} · Turn ${before.turn}`, 'Both plans play out…');
    preview.clear();
    pieces.setHighlights(null, []);
    await player.play(result);
    this.state = result.state;
    this.snap();
    hud.setScoreboard(this.state);
    await this.dramatic(result);
    const free = result.events.find((e) => e.type === 'dice' && e.free);
    if (free && free.type === 'dice') await this.showFreeRoll(free.team, free.roll, 'overtake');
    if (this.state.status === 'half-time') {
      await hud.showCover(
        'Half time',
        `Home ${this.state.score.home} – ${this.state.score.away} Away. ${teamName(other(before.kickoff))} kick off the second half.`,
        'Second half',
      );
    }
  }

  private async onDuel(m: Extract<ServerMessage, { t: 'duel' }>): Promise<void> {
    const { hud, duel } = this.deps;
    const socket = this.socket!;
    hud.setStatus('Dead ball!', 'Mash to win it');
    await duel.run({ left: 'home', right: 'away' }, NAMES, undefined, {
      side: this.side === 'home' ? 'left' : 'right',
      openInMs: m.openInMs,
      send: () => socket.send({ t: 'mash' }),
      subscribe: (cb) =>
        socket.on((msg) => {
          if (msg.t === 'meter') cb({ t: 'meter', value: msg.value });
          else if (msg.t === 'duel-result') cb({ t: 'end', winner: msg.winner });
        }),
    });
  }

  private async ended(msg: ServerMessage): Promise<void> {
    const { hud, sfx } = this.deps;
    sfx.crowdStop();
    if (msg.t === 'over') {
      this.state = msg.state;
      hud.setScoreboard(msg.state);
      const { home, away } = msg.state.score;
      const verdict = home === away ? 'A draw!' : `${home > away ? 'Home' : 'Away'} win!`;
      await hud.showCover('Full time', `Home ${home} – ${away} Away. ${verdict}`, 'Back to menu');
    } else if (msg.t === 'opponent-left') {
      await hud.showCover('Opponent left', 'Your opponent disconnected from the match.', 'Back to menu');
    } else if (msg.t === 'error') {
      await hud.showCover('Online match', msg.message, 'Back to menu');
    }
  }

  private snap(): void {
    if (!this.state) return;
    this.deps.pieces.setPositions(
      this.state.players.map((p) => p.pos),
      this.state.ball,
    );
  }

  private async showFreeRoll(team: Team, roll: DiceRoll, why: string): Promise<void> {
    await this.deps.dice.show({
      title: `${teamName(team)} ${why}: free roll!`,
      rounds: roll.pairs,
      caption: `${DiceView.caption(roll)} (banked for ${teamName(team)}'s next turn)`,
      flick: team === this.side,
      hint: 'Shoot the ball at the dice',
      kit: this.deps.pieces.currentKits[team],
    });
  }

  private async dramatic(result: TurnResult): Promise<void> {
    const ev = result.events;
    const find = <T extends TimelineEvent['type']>(t: T) => ev.find((e) => e.type === t) as Extract<TimelineEvent, { type: T }> | undefined;
    const shot = find('shot');
    const goal = find('goal');
    const save = find('save');
    const intercept = find('intercept');
    const corner = find('corner');
    const throwIn = find('throw-in');
    if (goal) await this.card('goal', shot?.from ?? null, goal.team);
    else if (save) await this.card('save', save.playerId, null);
    else if (intercept) await this.card('overtake', intercept.playerId, null);
    else if (corner) await this.card('corner', null, corner.team);
    else if (throwIn) await this.card('throw-in', null, throwIn.team);
  }

  private async card(kind: CutsceneKind, playerId: number | null, team: Team | null): Promise<void> {
    const s = this.state!;
    const p = playerId !== null ? s.players[playerId] : null;
    const t = p?.team ?? team ?? s.possession.team;
    const featured = p ?? s.players[s.possession.playerId];
    const kits = this.deps.pieces.currentKits;
    await this.deps.cutscene.show({ kind, kit: kits[t], keeper: featured.keeper, name: featured.name, team: teamName(t) });
  }

  /** Sounds and slide poses for timeline events (same cues as the local match). */
  onEvent(e: TimelineEvent): void {
    const { hud, sfx, pieces } = this.deps;
    const who = (id: number) => {
      const p = this.state!.players[id];
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
      case 'corner':
      case 'throw-in':
      case 'goal-kick':
        sfx.whistle();
        break;
      case 'dice':
        if (!e.free) hud.toast(`${teamName(e.team)} rolled ${e.roll.sum}: ${DiceView.caption(e.roll)}`);
        break;
      case 'booster':
        hud.toast(`${teamName(e.team)}: ${BOOSTER_INFO[e.booster].name}!`);
        break;
      default:
        break;
    }
  }
}
