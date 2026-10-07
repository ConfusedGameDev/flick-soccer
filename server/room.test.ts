import { describe, expect, it } from 'vitest';
import { PLAN_SECONDS } from '../src/engine/pitch';
import { defaultSquad } from '../src/engine/pool';
import type { Team } from '../src/engine/types';
import type { ServerMessage } from '../src/net/protocol';
import { KITS } from '../src/render/kits';
import { DUEL, Room } from './room';

/** A room with fake timers and a message log. */
function harness() {
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const log: { side: Team; msg: ServerMessage }[] = [];
  const room = new Room(
    'ABCD',
    1234,
    {
      send: (side, msg) => log.push({ side, msg }),
      schedule: (fn, ms) => {
        const t = { at: now + ms, fn, cancelled: false };
        timers.push(t);
        return () => (t.cancelled = true);
      },
      now: () => now,
    },
    () => 'tok',
  );
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((t) => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
    }
    now = target;
  };
  const last = (side: Team, t: ServerMessage['t']) => [...log].reverse().find((e) => e.side === side && e.msg.t === t)?.msg;
  const seatBoth = () => {
    room.seat(KITS[0]);
    room.seat(KITS[1]);
    room.handle('home', { t: 'squad', squad: defaultSquad('home') });
    room.handle('away', { t: 'squad', squad: defaultSquad('away') });
  };
  return { room, log, advance, last, seatBoth };
}

describe('Room', () => {
  it('starts once both players are seated and kicks off when both squads arrive', () => {
    const h = harness();
    expect(h.room.seat(KITS[0])).toBe('home');
    expect(h.log).toHaveLength(0);
    expect(h.room.seat(KITS[1])).toBe('away');
    expect(h.room.seat(KITS[2])).toBeNull();
    expect(h.last('home', 'start')).toMatchObject({ side: 'home', seed: 1234 });
    expect(h.last('away', 'start')).toMatchObject({ side: 'away' });
    h.room.handle('home', { t: 'squad', squad: defaultSquad('home') });
    expect(h.last('home', 'kickoff')).toBeUndefined();
    // A bogus squad from the other client falls back to the baseline eleven instead of crashing.
    h.room.handle('away', { t: 'squad', squad: { players: [], positions: [], formation: '4-4-2' } as never });
    const k = h.last('home', 'kickoff') as Extract<ServerMessage, { t: 'kickoff' }>;
    expect(k).toBeDefined();
    expect(k.state.possession.team).toBe(k.winner);
    // Both get a turn with complementary roles.
    const th = h.last('home', 'turn') as Extract<ServerMessage, { t: 'turn' }>;
    const ta = h.last('away', 'turn') as Extract<ServerMessage, { t: 'turn' }>;
    expect(new Set([th.role, ta.role])).toEqual(new Set(['attack', 'defense']));
  });

  it('resolves when both plans are in and hands out the next turn', () => {
    const h = harness();
    h.seatBoth();
    const before = h.room.state!;
    h.room.handle('home', { t: 'plan', plan: { team: 'home', flicks: [] } });
    expect(h.last('home', 'result')).toBeUndefined();
    h.room.handle('away', { t: 'plan', plan: { team: 'away', flicks: [] } });
    const r = h.last('away', 'result') as Extract<ServerMessage, { t: 'result' }>;
    expect(r.result.state.turn).toBe(before.turn + 1);
    expect(h.room.state!.turn).toBe(before.turn + 1);
    expect((h.last('home', 'turn') as Extract<ServerMessage, { t: 'turn' }>).state.turn).toBe(before.turn + 1);
  });

  it('auto-submits empty plans when the planning timer runs out', () => {
    const h = harness();
    h.seatBoth();
    h.room.handle('home', { t: 'plan', plan: { team: 'home', flicks: [] } });
    h.advance(PLAN_SECONDS * 1000 + 6000);
    expect(h.last('away', 'result')).toBeDefined();
  });

  it('replaces a client-claimed dice roll with the server roll', () => {
    const h = harness();
    h.seatBoth();
    const attack = h.room.state!.possession.team;
    const fake = { pairs: [[6, 6]] as [number, number][], sum: 99, bonus: 0.3, booster: 'extra-flick' as const, blocked: false };
    h.room.handle(attack, { t: 'plan', plan: { team: attack, flicks: [], dice: fake } });
    h.room.handle(attack === 'home' ? 'away' : 'home', { t: 'plan', plan: { team: attack === 'home' ? 'away' : 'home', flicks: [] } });
    const r = h.last('home', 'result') as Extract<ServerMessage, { t: 'result' }>;
    const dice = r.result.events.find((e) => e.type === 'dice') as Extract<(typeof r.result.events)[number], { type: 'dice' }>;
    expect(dice).toBeDefined();
    expect(dice.roll.sum).not.toBe(99);
    expect(dice.roll.bonus).toBeLessThanOrEqual(0.3);
  });

  it('runs a duel: counts presses after GO, rate-limits, and awards the ball', () => {
    const h = harness();
    h.seatBoth();
    // Force a dead ball: the attacker lobs it into empty space.
    const s = h.room.state!;
    const attack = s.possession.team;
    const gk = s.players[s.possession.playerId];
    const dir = attack === 'home' ? { x: 0, y: 1 } : { x: 0, y: -1 };
    h.room.handle(attack, { t: 'plan', plan: { team: attack, flicks: [{ playerId: gk.id, dir, strength: 0.8 }] } });
    const def = attack === 'home' ? 'away' : 'home';
    h.room.handle(def, { t: 'plan', plan: { team: def, flicks: [] } });
    expect(h.room.phase).toBe('duel');
    expect(h.last('home', 'duel')).toMatchObject({ openInMs: DUEL.countdownMs });
    // Presses before GO are ignored.
    h.room.handle('home', { t: 'mash' });
    h.advance(DUEL.countdownMs + 1);
    expect(h.last('home', 'meter')).toMatchObject({ value: 0 });
    // Ten presses move the meter toward home without deciding it.
    for (let i = 0; i < 10; i++) h.room.handle('home', { t: 'mash' });
    h.advance(DUEL.meterIntervalMs);
    expect((h.last('away', 'meter') as Extract<ServerMessage, { t: 'meter' }>).value).toBeCloseTo(-10 * DUEL.pressStep, 5);
    expect(h.room.phase).toBe('duel');
    // Pulling the meter all the way ends it; the rate limit caps a burst at 15 per second,
    // which is just enough to cross from here.
    for (let i = 0; i < 30; i++) h.room.handle('home', { t: 'mash' });
    const dr = h.last('away', 'duel-result') as Extract<ServerMessage, { t: 'duel-result' }>;
    expect(dr).toBeDefined();
    expect(dr.winner).toBe('home');
    expect(dr.state.possession.team).toBe('home');
    expect(h.room.phase).toBe('playing');
    expect(h.last('home', 'turn')).toBeDefined();
  });

  it('tells the other side when a player leaves and replays state on resume', () => {
    const h = harness();
    h.seatBoth();
    const before = h.log.length;
    h.room.resume('away');
    expect(h.log[h.log.length - 1].msg.t).toBe('turn');
    expect(h.log.length).toBe(before + 1);
    h.room.handle('home', { t: 'leave' });
    expect(h.last('away', 'opponent-left')).toBeDefined();
    expect(h.room.phase).toBe('over');
  });
});
