import data from '../data/frames.json';
import type { Look } from './sprites';

// Imported sprite frames (art/frames, via `npm run frames`): the generated
// 48x48 character in eight directions per state, stored as the painter's
// letter templates so kits and looks recolour them like the typed sprites.
// Pure: no DOM.

export type Dir8 = 's' | 'se' | 'e' | 'ne' | 'n' | 'nw' | 'w' | 'sw';
export const DIRS: Dir8[] = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
export type FrameState = 'idle' | 'run' | 'slide';
export const FRAME_STATES: FrameState[] = ['idle', 'run', 'slide'];

export interface Frame {
  rows: string[];
  /** Jersey box for the kit pattern: [top, rows, left, cols]. */
  jersey: [number, number, number, number];
  /** Lowest painted row: where the feet stand. */
  baseline: number;
}

const FRAMES = data as { size: number; states: Record<FrameState, Record<Dir8, Frame>> };

export const FRAME_SIZE = FRAMES.size;
/** Height of the standing figure inside a frame, for sizing on the pitch. */
export const FRAME_FIGURE_H = 44;

export const frame = (state: FrameState, dir: Dir8): Frame => FRAMES.states[state][dir];

const styled = new Map<string, string[]>();

/** Template rows for a state and direction with the look's hair style applied (bald shows skin). */
export function frameRows(state: FrameState, dir: Dir8, look: Look): string[] {
  const bald = look.style === 3;
  if (!bald) return frame(state, dir).rows;
  const key = `${state}:${dir}:bald`;
  let rows = styled.get(key);
  if (!rows) {
    rows = frame(state, dir).rows.map((r) => r.replace(/H/g, 'S').replace(/h/g, 'L').replace(/x/g, 's'));
    styled.set(key, rows);
  }
  return rows;
}

/**
 * Which of the eight directions a screen-space movement points to (+x right,
 * +y down, so 'n' is up the screen). Sectors are 45° wide, centred on the
 * compass points.
 */
export function dirFromDelta(dx: number, dy: number): Dir8 {
  const a = Math.atan2(dy, dx); // -PI..PI, 0 = east, PI/2 = south
  const sector = Math.round(a / (Math.PI / 4));
  const order: Dir8[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  return order[((sector % 8) + 8) % 8];
}
