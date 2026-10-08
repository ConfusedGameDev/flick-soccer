import { PITCH_L, PITCH_W } from './pitch';
import { defaultSquad, stats, type Squad } from './pool';
import type { Booster, MatchState, PlayerState, Team, TeamMeta, Vec2 } from './types';

/** Mirror a home-frame position for the away side, which defends the far goal. */
export const mirror = (p: Vec2): Vec2 => ({ x: PITCH_W - p.x, y: PITCH_L - p.y });

/** World-frame kickoff spot of a squad's i-th player. */
export function kickoffPosition(team: Team, i: number, squad: Squad = defaultSquad(team)): Vec2 {
  const p = squad.positions[i];
  return team === 'home' ? { ...p } : mirror(p);
}

function placeTeam(team: Team, firstId: number, squad: Squad): PlayerState[] {
  return squad.players.map((p, i) => {
    const kickoff = kickoffPosition(team, i, squad);
    return {
      id: firstId + i,
      team,
      number: i + 1,
      keeper: p.position === 'GK' && i === squad.players.findIndex((q) => q.position === 'GK'),
      name: p.short,
      stats: stats(p),
      kickoff,
      pos: { ...kickoff },
    };
  });
}

export const keeperOf = (players: readonly PlayerState[], team: Team): PlayerState =>
  players.find((p) => p.team === team && p.keeper)!;

/**
 * 11 v 11 at their kickoff spots, ball with the kicking-off keeper. Default
 * squads are all-3s baseline players. `boosters` seeds a side's hand (the
 * season run carries boosters between matches).
 */
export function initialMatch(kickoff: Team = 'home', squads?: Record<Team, Squad>, boosters?: Partial<Record<Team, Booster[]>>): MatchState {
  const home = placeTeam('home', 0, squads?.home ?? defaultSquad('home'));
  const away = placeTeam('away', home.length, squads?.away ?? defaultSquad('away'));
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
    meta: { home: emptyMeta(boosters?.home), away: emptyMeta(boosters?.away) },
  };
}

export const emptyMeta = (boosters: Booster[] = []): TeamMeta => ({ blocked: 0, bonus: 0, boosters: [...boosters] });
