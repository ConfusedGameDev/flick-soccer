import type { MatchState, PlayerState, Team, TeamMeta, Vec2 } from './types';
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

/** Kickoff position of a team's i-th player (0 = keeper). Away defends the far goal, so it is mirrored. */
export function kickoffPosition(team: Team, i: number): Vec2 {
  const slot = FORMATION_442[i];
  return team === 'home' ? { ...slot } : { x: PITCH_W - slot.x, y: PITCH_L - slot.y };
}

function placeTeam(team: Team, firstId: number): PlayerState[] {
  return FORMATION_442.map((_, i) => ({
    id: firstId + i,
    team,
    number: i + 1,
    keeper: i === 0,
    pos: kickoffPosition(team, i),
  }));
}

export const keeperOf = (players: readonly PlayerState[], team: Team): PlayerState =>
  players.find((p) => p.team === team && p.keeper)!;

/** 11 v 11 in fixed formations, ball with the home keeper, home attacking first. */
export function initialMatch(kickoff: Team = 'home'): MatchState {
  const home = placeTeam('home', 0);
  const away = placeTeam('away', home.length);
  const players = [...home, ...away];
  const keeper = keeperOf(players, kickoff);
  return {
    turn: 1,
    half: 1,
    score: { home: 0, away: 0 },
    status: 'playing',
    kickoff,
    players,
    ball: { ...keeper.pos },
    possession: { team: kickoff, playerId: keeper.id },
    meta: { home: emptyMeta(), away: emptyMeta() },
  };
}

export const emptyMeta = (): TeamMeta => ({ blocked: 0, bonus: 0, boosters: [] });
