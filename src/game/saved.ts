import type { MatchState, Plan, Team } from '../engine/types';
import type { Kit } from '../render/kits';

// A local match in progress, snapshotted at every turn boundary so that closing
// or backgrounding the app never loses more than the planning under way. The
// engine derives every per-turn seed from the match seed and the clock
// (engine/seeds.ts), so (seed, state) is enough to carry on exactly. Pure: no
// DOM here beyond the guarded localStorage calls, so it is unit-tested.

/** Modes that can be resumed. Online matches belong to the server; the tutorial's coach is scripted. */
export type SavedMode = 'hotseat' | 'cpu-easy' | 'cpu-normal' | 'run';

export const SAVED_MODES: readonly SavedMode[] = ['hotseat', 'cpu-easy', 'cpu-normal', 'run'];

export interface SavedMatch {
  v: 1;
  mode: SavedMode;
  seed: number;
  /** The state at a boundary: 'playing' before a turn, 'duel' or 'half-time' right after one. */
  state: MatchState;
  /** Full kits, not ids: a painted kit may be deleted before the match is resumed. */
  kits: Record<Team, Kit>;
  /** The attack plan already confirmed this turn, so the attacker need not redo it. */
  attackPlan?: Plan;
  /** Run mode: the run this match belongs to; a mismatch means the save is stale. */
  run?: { seed: number; stage: number };
}

export const SAVED_MATCH_KEY = 'flicksoccer.match';

const MODE_LABELS: Record<SavedMode, string> = {
  hotseat: '2 players',
  'cpu-easy': 'vs CPU · easy',
  'cpu-normal': 'vs CPU · normal',
  run: 'Season run',
};

/** One line for the resume prompt: mode, clock and score. */
export function savedMatchLabel(s: SavedMatch): string {
  const { half, turn, score } = s.state;
  return `${MODE_LABELS[s.mode]}: Half ${half} · Turn ${turn}, Home ${score.home} – ${score.away} Away.`;
}

export function loadSavedMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(SAVED_MATCH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMatch;
    if (!s || s.v !== 1 || !SAVED_MODES.includes(s.mode) || typeof s.seed !== 'number') return null;
    const st = s.state;
    if (!st || !Array.isArray(st.players) || st.players.length !== 22 || st.status === 'full-time') return null;
    if (!st.possession || !st.meta?.home || !st.meta?.away) return null;
    if (!s.kits?.home || !s.kits?.away) return null;
    if (s.mode === 'run' && !s.run) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveMatch(s: SavedMatch): void {
  try {
    localStorage.setItem(SAVED_MATCH_KEY, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}

export function clearSavedMatch(): void {
  try {
    localStorage.removeItem(SAVED_MATCH_KEY);
  } catch {
    /* no storage */
  }
}
