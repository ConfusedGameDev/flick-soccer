import { PITCH_W } from './pitch';
import { mulberry32 } from './rng';
import type { Vec2 } from './types';
import { clamp } from './vec';

// Player pool, squads and formations. Pure: shared by the draft UI, the CPU
// auto-picker and the match setup.

export type League = 'mx' | 'en' | 'it' | 'es' | 'de';
export type Position = 'GK' | 'DF' | 'MF' | 'FW';

export const LEAGUES: League[] = ['mx', 'en', 'it', 'es', 'de'];
/** Players per league in the pool (the 26 best of each). */
export const POOL_PER_LEAGUE = 26;
export const LEAGUE_INFO: Record<League, { name: string; short: string; flag: string }> = {
  mx: { name: 'Mexico', short: 'MEX', flag: '🇲🇽' },
  en: { name: 'England', short: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  it: { name: 'Italy', short: 'ITA', flag: '🇮🇹' },
  es: { name: 'Spain', short: 'ESP', flag: '🇪🇸' },
  de: { name: 'Germany', short: 'GER', flag: '🇩🇪' },
};

export interface Stats {
  pass: number;
  shot: number;
  speed: number;
  tackle: number;
  keeping: number;
}

export interface PoolPlayer extends Stats {
  id: string;
  name: string;
  short: string;
  league: League;
  club: string;
  position: Position;
}

/** The slice of the pool a league drafts from. */
export const leaguePool = (pool: readonly PoolPlayer[], league: League): PoolPlayer[] => pool.filter((p) => p.league === league);

export const BUDGET = 100;
export const SQUAD_SIZE = 11;
export const STAT_KEYS: (keyof Stats)[] = ['pass', 'shot', 'speed', 'tackle', 'keeping'];
export const POSITIONS: Position[] = ['GK', 'DF', 'MF', 'FW'];

/** Baseline every stat is measured against; a 3 changes nothing. */
export const STAT_BASE = 3;
/** A stat point is worth ±8% range/speed and ±5 percentage points of odds. */
export const statFactor = (stat: number): number => 1 + (stat - STAT_BASE) * 0.08;
export const statOdds = (stat: number): number => (stat - STAT_BASE) * 0.05;

/**
 * What a player costs in the draft. Keepers are priced on keeping; outfield on
 * the rest. The curve is convex so stars cost far more than journeymen and a
 * 100-point budget forces real choices (~5 for a journeyman, ~8 average, 12–15 for a star).
 */
export function cost(p: Stats & { position: Position }): number {
  // Role-weighted quality: what the stat does for that position in the engine.
  const raw =
    p.position === 'GK'
      ? p.keeping * 2.5 + p.speed * 0.5 + p.pass * 0.5
      : p.position === 'DF'
        ? p.tackle * 2 + p.speed + p.pass * 0.5 + p.shot * 0.25
        : p.position === 'MF'
          ? p.pass * 2 + p.tackle * 0.75 + p.shot * 0.75 + p.speed * 0.5
          : p.shot * 2 + p.speed + p.pass * 0.75 + p.tackle * 0.25;
  // Pool quality spans roughly 11.5..16.5; map that onto 3..15 with a convex curve.
  return clamp(3 + Math.round(12 * Math.max(0, (raw - 11.5) / 5) ** 1.4), 3, 15);
}

export const stats = (p: Stats): Stats => ({ pass: p.pass, shot: p.shot, speed: p.speed, tackle: p.tackle, keeping: p.keeping });

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------

export type FormationName = '4-4-2' | '4-3-3' | '5-3-2';

export interface FormationSlot {
  role: Position;
  /** Kickoff position in the home frame (attacking +y). */
  pos: Vec2;
}

// Rows are spread over the whole pitch so a chain can progress to the far
// goal; the x values are offset so the mirrored away side interleaves.
const ROW_Y: Record<Position, number> = { GK: 3, DF: 20, MF: 48, FW: 78 };

function row(role: Position, xs: number[]): FormationSlot[] {
  return xs.map((x) => ({ role, pos: { x, y: ROW_Y[role] } }));
}

export const FORMATIONS: Record<FormationName, FormationSlot[]> = {
  '4-4-2': [...row('GK', [PITCH_W / 2]), ...row('DF', [10, 26, 42, 58]), ...row('MF', [14, 30, 46, 62]), ...row('FW', [22, 46])],
  '4-3-3': [...row('GK', [PITCH_W / 2]), ...row('DF', [10, 26, 42, 58]), ...row('MF', [18, 34, 50]), ...row('FW', [14, 34, 54])],
  '5-3-2': [...row('GK', [PITCH_W / 2]), ...row('DF', [8, 21, 34, 47, 60]), ...row('MF', [18, 34, 50]), ...row('FW', [22, 46])],
};

export const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];

/** A drafted team: 11 players in shirt order plus their kickoff spots (home frame). */
export interface Squad {
  players: PoolPlayer[];
  positions: Vec2[];
  formation: FormationName;
}

export function squadCost(players: readonly PoolPlayer[]): number {
  return players.reduce((s, p) => s + cost(p), 0);
}

/** Why a draft is not yet a legal squad, or null when it is. */
export function squadProblem(players: readonly PoolPlayer[]): string | null {
  if (players.length !== SQUAD_SIZE) return `Pick ${SQUAD_SIZE} players (${players.length} so far)`;
  if (!players.some((p) => p.position === 'GK')) return 'You need a goalkeeper';
  const c = squadCost(players);
  if (c > BUDGET) return `Over budget by ${c - BUDGET}`;
  return null;
}

/**
 * Order players into a formation's slots: keepers to GK, then each outfield
 * slot takes the best remaining player of its role, and leftovers fill in.
 * Returns the players in slot (shirt) order.
 */
export function autoAssign(players: readonly PoolPlayer[], formation: FormationName): PoolPlayer[] {
  const slots = FORMATIONS[formation];
  const left = [...players];
  const out: (PoolPlayer | null)[] = slots.map(() => null);
  const fit = (p: PoolPlayer, role: Position) =>
    role === 'GK' ? p.keeping * 3 : role === 'DF' ? p.tackle * 2 + p.speed : role === 'MF' ? p.pass * 2 + p.tackle : p.shot * 2 + p.speed;
  // Natural positions first.
  slots.forEach((slot, i) => {
    const candidates = left.filter((p) => p.position === slot.role).sort((a, b) => fit(b, slot.role) - fit(a, slot.role));
    if (candidates.length) {
      out[i] = candidates[0];
      left.splice(left.indexOf(candidates[0]), 1);
    }
  });
  // Then whoever fits an empty slot best.
  slots.forEach((slot, i) => {
    if (out[i] || left.length === 0) return;
    left.sort((a, b) => fit(b, slot.role) - fit(a, slot.role));
    out[i] = left.shift()!;
  });
  return out.filter((p): p is PoolPlayer => p !== null);
}

export function makeSquad(players: readonly PoolPlayer[], formation: FormationName): Squad {
  const ordered = autoAssign(players, formation);
  return { players: ordered, positions: FORMATIONS[formation].map((s) => ({ ...s.pos })), formation };
}

/**
 * A legal squad picked from the pool without a human: best value per slot
 * while keeping enough budget for the rest. Deterministic for a seed; the
 * seed shuffles ties so two CPU teams are not clones.
 */
export function cpuSquad(pool: readonly PoolPlayer[], formation: FormationName, seed: number, budget = BUDGET): Squad {
  const rng = mulberry32(seed);
  const slots = FORMATIONS[formation];
  const picked: PoolPlayer[] = [];
  /** The least the remaining slots can cost from `free` once `p` is taken. */
  const reserve = (free: readonly PoolPlayer[], p: PoolPlayer, remaining: number) => {
    const costs = free.filter((q) => q !== p).map(cost).sort((a, b) => a - b);
    return costs.slice(0, remaining).reduce((s, c) => s + c, 0);
  };
  // Quality for the slot, with a little noise so two CPU squads differ.
  const value = (p: PoolPlayer, role: Position) => {
    const s = role === 'GK' ? p.keeping * 3 : role === 'DF' ? p.tackle * 2 + p.speed : role === 'MF' ? p.pass * 2 + p.tackle : p.shot * 2 + p.speed;
    return s + rng() * 2.5;
  };
  // Keeper first (there must be one), then the outfield slots in a seeded
  // random order so the stars end up spread around the team, not all in defence.
  const outfield = slots.filter((s) => s.role !== 'GK');
  for (let i = outfield.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [outfield[i], outfield[j]] = [outfield[j], outfield[i]];
  }
  const order = [...slots.filter((s) => s.role === 'GK'), ...outfield];
  for (let i = 0; i < order.length; i++) {
    const role = order[i].role;
    const remaining = order.length - i - 1;
    const free = pool.filter((p) => !picked.includes(p));
    // Reserve enough for the cheapest possible fill of the remaining slots.
    const affordable = free.filter((p) => cost(p) <= budget - reserve(free, p, remaining));
    const sameRole = affordable.filter((p) => p.position === role);
    // Fall back to the cheapest player left if nothing fits (cannot happen with a sane pool, but never crash).
    const from = sameRole.length ? sameRole : affordable.length ? affordable : [free.sort((a, b) => cost(a) - cost(b))[0]];
    const best = from.sort((a, b) => value(b, role) - value(a, role))[0];
    picked.push(best);
    budget -= cost(best);
  }
  return makeSquad(picked, formation);
}

/** Eleven identical baseline players: every stat 3, so nothing in the engine changes. */
export function defaultSquad(team: 'home' | 'away', formation: FormationName = '4-4-2'): Squad {
  const slots = FORMATIONS[formation];
  const players: PoolPlayer[] = slots.map((s, i) => ({
    id: `${team}-${i + 1}`,
    name: `${team === 'home' ? 'Home' : 'Away'} #${i + 1}`,
    short: `#${i + 1}`,
    league: 'mx',
    club: '',
    position: s.role,
    pass: STAT_BASE,
    shot: STAT_BASE,
    speed: STAT_BASE,
    tackle: STAT_BASE,
    keeping: STAT_BASE,
  }));
  return { players, positions: slots.map((s) => ({ ...s.pos })), formation };
}
