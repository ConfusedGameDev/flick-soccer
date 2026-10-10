import type { Sfx } from '../audio/Sfx';
import { BOOSTER_INFO } from '../engine/boosters';
import { other } from '../engine/pitch';
import { keeperOf } from '../engine/setup';
import { defaultSquad, type PoolPlayer, type Squad } from '../engine/pool';
import type { Booster, MatchState, Team, TimelineEvent, TurnResult } from '../engine/types';
import type { ServerMessage } from '../net/protocol';
import { Socket } from '../net/Socket';
import type { Kit } from '../render/kits';
import type { PiecesView } from '../render/PiecesView';
import type { PlanPreview } from '../render/PlanPreview';
import type { TimelinePlayer } from '../render/TimelinePlayer';
import type { Cutscene, CutsceneKind } from '../ui/Cutscene';
import type { CoinToss } from '../ui/CoinToss';
import type { PackView } from '../ui/PackView';
import type { Duel } from '../ui/Duel';
import type { Hud } from '../ui/Hud';
import { teamName, type LocalController } from './controller';
import type { TeamBuilder } from './TeamBuilder';

export type OnlineMode = 'create' | 'join';

export interface OnlineDeps {
  serverUrl: string;
  hud: Hud;
  duel: Duel;
  pack: PackView;
  toss: CoinToss;
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
 * seed, flips the coin, resolves turns, draws the packs and runs the duel; this class drives the
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
      const tossOrLeft = await Promise.race([
        socket.next(['toss', 'kickoff', 'opponent-left', 'error']),
        hud.showCover('Team sent', "Waiting for your opponent's team…", 'Leave match').then(() => null),
      ]);
      hud.hideCover();
      if (!tossOrLeft) {
        socket.send({ t: 'leave' });
        return;
      }
      let kickoff: ServerMessage | null = tossOrLeft;
      if (tossOrLeft.t === 'toss') {
        // The caller picks; the server calls heads for them if they dawdle. The other side just waits.
        if (tossOrLeft.caller === this.side) {
          const call = await Promise.race([
            this.deps.toss.call({ title: 'You call the toss', text: 'Heads or tails? Call it right and you attack first.', kit: pieces.currentKits[this.side] }),
            socket.next(['kickoff', 'opponent-left', 'error']).then(() => null),
          ]);
          if (call) socket.send({ t: 'call', call });
          else this.deps.toss.cancel();
        } else {
          hud.setStatus('Coin toss', `${teamName(tossOrLeft.caller)} are calling…`);
        }
        kickoff = await socket.next(['kickoff', 'opponent-left', 'error']);
      }
      if (kickoff.t !== 'kickoff') {
        await this.ended(kickoff);
        return;
      }
      await this.onKickoff(kickoff);

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
          if (msg.booster) await this.showFreePack(msg.winner, msg.booster, 'win the ball');
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
    const setup = await hud.showMenu<'draft' | 'quick'>('Your team', 'Pick a league and draft its best players, or play with a plain squad', [
      { key: 'draft', label: 'Draft a team (100 points)' },
      { key: 'quick', label: 'Quick squad' },
    ]);
    if (setup === 'quick') return defaultSquad(this.side);
    return builder.run(`${NAMES[this.side]}: build your team`, pool, Date.now() & 0xffff);
  }

  private async onKickoff(m: Extract<ServerMessage, { t: 'kickoff' }>): Promise<void> {
    const { hud, pieces, toss, sfx } = this.deps;
    this.state = m.state;
    pieces.rebuild(m.state.players);
    this.snap();
    hud.setScoreboard(m.state);
    hud.setStatus('Online match', `You are ${teamName(this.side)}`);
    const who = m.caller === this.side ? 'You' : teamName(m.caller);
    await toss.flip({
      title: 'The toss',
      coin: m.coin,
      caption: `${who} called ${m.call}: it is ${m.coin}. ${teamName(m.winner)} attack first.`,
      kit: pieces.currentKits[m.caller],
      button: 'Kick off',
    });
    hud.toast(`${teamName(m.winner)} attack first · you are ${teamName(this.side)}`, true);
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
    const free = result.events.find((e) => e.type === 'pack' && e.free);
    if (free && free.type === 'pack') await this.showFreePack(free.team, free.booster, 'overtake');
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

  private async showFreePack(team: Team, booster: Booster, why: string): Promise<void> {
    await this.deps.pack.show({
      title: `${teamName(team)} ${why}: free pack!`,
      booster,
      pick: team === this.side,
      caption: `${BOOSTER_INFO[booster].name} (${BOOSTER_INFO[booster].text}) goes into ${teamName(team)}'s hand`,
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
    const passBefore = (t: number) => {
      const passes = ev.filter((e): e is Extract<TimelineEvent, { type: 'pass' }> => e.type === 'pass' && e.t <= t);
      return passes.length ? passes[passes.length - 1].from : null;
    };
    if (goal) await this.card('goal', shot?.from ?? null, goal.team, keeperOf(this.state!.players, other(goal.team)).id);
    else if (save) await this.card('save', save.playerId, null, shot?.from ?? null);
    else if (intercept) await this.card('overtake', intercept.playerId, null, passBefore(intercept.t));
    else if (corner) await this.card('corner', null, corner.team);
    else if (throwIn) await this.card('throw-in', null, throwIn.team);
  }

  private async card(kind: CutsceneKind, playerId: number | null, team: Team | null, foilId: number | null = null): Promise<void> {
    const s = this.state!;
    const p = playerId !== null ? s.players[playerId] : null;
    const t = p?.team ?? team ?? s.possession.team;
    const featured = p ?? s.players[s.possession.playerId];
    const foil = foilId !== null ? s.players[foilId] : null;
    const kits = this.deps.pieces.currentKits;
    await this.deps.cutscene.show({
      kind,
      kit: kits[t],
      keeper: featured.keeper,
      name: featured.name,
      team: teamName(t),
      foil: { kit: kits[other(t)], keeper: foil?.keeper ?? kind === 'goal', name: foil?.name },
    });
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
      case 'pack':
        if (!e.free) hud.toast(`${teamName(e.team)} opened a pack: ${BOOSTER_INFO[e.booster].name}`);
        break;
      case 'booster':
        hud.toast(`${teamName(e.team)}: ${BOOSTER_INFO[e.booster].name}!`);
        break;
      default:
        break;
    }
  }
}
