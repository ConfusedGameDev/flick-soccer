import type { MatchState, PlayerState, Team, Vec2 } from './types';
import { PITCH_L, PITCH_W } from './pitch';

// 4-4-2 as (x, distance from own goal line), spread over the whole pitch so a
// pass chain can progress toward the far goal: forwards start deep in the
// opponent's half. The rows are offset in x so the mirrored away team's discs
// interleave with ours instead of landing on top of them. Shirt numbers follow
// the array order.
const FORMATION_442: Vec2[] = [
  { x: PITCH_W / 2, y: 3 }, // GK
  { x: 10, y: 20 },
  { x: 26, y: 20 },
  { x: 42, y: 20 },
  { x: 58, y: 20 },
  { x: 14, y: 48 },
  { x: 30, y: 48 },
  { x: 46, y: 48 },
  { x: 62, y: 48 },
  { x: 22, y: 78 },
  { x: 46, y: 78 },
];

function placeTeam(team: Team, firstId: number): PlayerState[] {
  return FORMATION_442.map((slot, i) => ({
    id: firstId + i,
    team,
    number: i + 1,
    keeper: i === 0,
    // Away defends the far goal, so mirror the whole formation.
    pos: team === 'home' ? { ...slot } : { x: PITCH_W - slot.x, y: PITCH_L - slot.y },
  }));
}

/** 11 v 11 in fixed formations, ball with the home keeper, home attacking first. */
export function initialMatch(): MatchState {
  const home = placeTeam('home', 0);
  const away = placeTeam('away', home.length);
  const keeper = home[0];
  return {
    turn: 1,
    players: [...home, ...away],
    ball: { ...keeper.pos },
    possession: { team: 'home', playerId: keeper.id },
  };
}
