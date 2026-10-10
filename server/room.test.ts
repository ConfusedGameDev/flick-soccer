import { describe, expect, it } from 'vitest';
import { PLAN_SECONDS } from '../src/engine/pitch';
import { defaultSquad } from '../src/engine/pool';
import type { Team } from '../src/engine/types';
import type { ServerMessage } from '../src/net/protocol';
import { KITS } from '../src/render/kits';
import { drawBooster, tossWinner } from '../src/engine/boosters';
import { mulberry32 } from '../src/engine/rng';
import { packSeed } from '../src/engine/seeds';
import { CALL_MS, DUEL, Room } from './room';

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
    room.handle('away', { t: 'call', call: 'heads' });
  };
  return { room, log, advance, last, seatBoth };
}

describe('Room', () => {
  it('starts once both players are seated, asks Away to call the toss when both squads arrive, and kicks off on the call', () => {
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
    expect(h.last('home', 'toss')).toMatchObject({ caller: 'away' });
    expect(h.last('away', 'toss')).toMatchObject({ caller: 'away' });
    expect(h.last('home', 'kickoff')).toBeUndefined();
    // Only the caller's call counts.
    h.room.handle('home', { t: 'call', call: 'tails' });
    expect(h.last('home', 'kickoff')).toBeUndefined();
    h.room.handle('away', { t: 'call', call: 'tails' });
    const k = h.last('home', 'kickoff') as Extract<ServerMessage, { t: 'kickoff' }>;
    expect(k).toBeDefined();
    expect(k).toMatchObject({ call: 'tails', caller: 'away' });
    expect(k.winner).toBe(tossWinner(k.coin, 'tails', 'away'));
    expect(k.state.possession.team).toBe(k.winner);
    // A second call changes nothing.
    h.room.handle('away', { t: 'call', call: 'heads' });
    expect(h.last('home', 'kickoff')).toBe(k);
    // Both get a turn with complementary roles.
    const th = h.last('home', 'turn') as Extract<ServerMessage, { t: 'turn' }>;
    const ta = h.last('away', 'turn') as Extract<ServerMessage, { t: 'turn' }>;
    expect(new Set([th.role, ta.role])).toEqual(new Set(['attack', 'defense']));
  });

  it('calls heads for a caller who never calls', () => {
    const h = harness();
    h.room.seat(KITS[0]);
    h.room.seat(KITS[1]);
    h.room.handle('home', { t: 'squad', squad: defaultSquad('home') });
    h.room.handle('away', { t: 'squad', squad: defaultSquad('away') });
    expect(h.room.phase).toBe('toss');
    h.advance(CALL_MS - 1);
    expect(h.last('away', 'kickoff')).toBeUndefined();
    h.advance(2);
    const k = h.last('away', 'kickoff') as Extract<ServerMessage, { t: 'kickoff' }>;
    expect(k).toMatchObject({ call: 'heads', caller: 'away' });
    expect(h.room.phase).toBe('playing');
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

  it('replaces a client-claimed pack with its own seeded draw', () => {
    const h = harness();
    h.seatBoth();
    const state = h.room.state!;
    const attack = state.possession.team;
    const expected = drawBooster(mulberry32(packSeed(1234, state, attack)));
    const claimed = expected === 'super-keeper' ? 'extra-flick' : 'super-keeper';
    h.room.handle(attack, { t: 'plan', plan: { team: attack, flicks: [], pack: claimed } });
    h.room.handle(attack === 'home' ? 'away' : 'home', { t: 'plan', plan: { team: attack === 'home' ? 'away' : 'home', flicks: [] } });
    const r = h.last('home', 'result') as Extract<ServerMessage, { t: 'result' }>;
    const pack = r.result.events.find((e) => e.type === 'pack') as Extract<(typeof r.result.events)[number], { type: 'pack' }>;
    expect(pack).toBeDefined();
    expect(pack.booster).toBe(expected);
    expect(r.result.state.meta[attack].boosters).toEqual([expected]);
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
    // The winner's free pack is in the hand the clients receive.
    expect(dr.booster).not.toBeNull();
    expect(dr.state.meta.home.boosters).toEqual([dr.booster]);
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

describe('timing game fields', () => {
  it('clamps a client-claimed aim and only honours a real shot marker', () => {
    const h = harness();
    h.seatBoth();
    const attack = h.room.state!.possession.team;
    const defend = attack === 'home' ? 'away' : 'home';
    const carrier = h.room.state!.possession.playerId;
    const bogus = { playerId: carrier, dir: { x: 0, y: attack === 'home' ? 1 : -1 }, strength: 0.5, shot: 'yes' as unknown as boolean, aim: { accuracy: 7, height: -2 } };
    h.room.handle(attack, { t: 'plan', plan: { team: attack, flicks: [bogus] } });
    h.room.handle(defend, { t: 'plan', plan: { team: defend, flicks: [] } });
    const r = h.last('home', 'result') as Extract<ServerMessage, { t: 'result' }>;
    expect(r.result.events.some((e) => e.type === 'shot')).toBe(false);
    expect(r.result.events.some((e) => e.type === 'pass')).toBe(true);
  });
});
