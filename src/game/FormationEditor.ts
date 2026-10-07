import { FORMATIONS, FORMATION_NAMES, makeSquad, stats, type FormationName, type PoolPlayer, type Squad } from '../engine/pool';
import { clampToPitch } from '../engine/pitch';
import type { PlayerState, Vec2 } from '../engine/types';
import { dist } from '../engine/vec';
import { PLAYER_RADIUS_M, type PiecesView } from '../render/PiecesView';
import type { PitchView } from '../render/PitchView';
import type { Hud } from '../ui/Hud';

const GRAB_M = PLAYER_RADIUS_M * 2.2;
/** Pointer travel below this (meters) counts as a tap, which selects/swaps. */
const TAP_M = 1;
/** No ball while editing: park it far outside the window. */
const HIDDEN_BALL: Vec2 = { x: -1000, y: -1000 };

export interface EditorDeps {
  hud: Hud;
  pitch: PitchView;
  pieces: PiecesView;
  canvas: HTMLCanvasElement;
}

/**
 * Formation screen: choose a preset, then drag players anywhere on the pitch
 * or tap two to swap them. Always edited in the home frame (attacking up);
 * the match setup mirrors it for the away side.
 */
export class FormationEditor {
  constructor(private readonly deps: EditorDeps) {}

  run(title: string, players: readonly PoolPlayer[], initial: FormationName = '4-4-2'): Promise<Squad> {
    const { hud, pitch, pieces, canvas } = this.deps;
    return new Promise((resolve) => {
      let squad = makeSquad(players, initial);
      let selected: number | null = null;
      let drag: { id: number; pointerId: number; start: Vec2; moved: boolean } | null = null;

      const preview = (): PlayerState[] =>
        squad.players.map((p, i) => ({
          id: i,
          team: 'home',
          number: i + 1,
          keeper: p.position === 'GK' && i === squad.players.findIndex((q) => q.position === 'GK'),
          name: p.short,
          stats: stats(p),
          kickoff: { ...squad.positions[i] },
          pos: { ...squad.positions[i] },
        }));

      const refresh = () => {
        const ps = preview();
        pieces.rebuild(ps);
        pieces.setPositions(
          ps.map((p) => p.pos),
          HIDDEN_BALL,
        );
        pieces.setHighlights(selected, []);
        hud.setToolbar(
          FORMATION_NAMES.map((name) => ({
            label: name,
            active: squad.formation === name,
            onClick: () => {
              squad = makeSquad(squad.players, name);
              selected = null;
              refresh();
            },
          })),
        );
        hud.setStatus(title, selected === null ? 'Drag a player to move them, or tap two to swap' : `Tap another player to swap with #${selected + 1}`);
        hud.setPlanning({ canUndo: false, canConfirm: true });
      };

      const worldOf = (e: PointerEvent): Vec2 => {
        const r = canvas.getBoundingClientRect();
        return pitch.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
      };
      const pick = (w: Vec2): number | null => {
        let best: number | null = null;
        let bestD = GRAB_M;
        squad.positions.forEach((p, i) => {
          const d = dist(p, w);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        return best;
      };

      const down = (e: PointerEvent) => {
        if (drag) return;
        const w = worldOf(e);
        const id = pick(w);
        if (id === null) return;
        e.preventDefault();
        drag = { id, pointerId: e.pointerId, start: w, moved: false };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };
      const move = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const w = worldOf(e);
        if (!drag.moved && dist(w, drag.start) < TAP_M) return;
        drag.moved = true;
        squad.positions[drag.id] = clampToPitch(w);
        pieces.setPositions(
          squad.positions.map((p) => ({ ...p })),
          HIDDEN_BALL,
        );
      };
      const up = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { id, moved } = drag;
        drag = null;
        if (!moved) {
          if (selected === null) selected = id;
          else if (selected === id) selected = null;
          else {
            // Swap the two players' slots (positions stay, people move).
            const a = squad.players[selected];
            squad.players[selected] = squad.players[id];
            squad.players[id] = a;
            selected = null;
          }
        }
        refresh();
      };

      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);

      hud.onConfirm = () => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        hud.setToolbar([]);
        hud.setPlanning(null);
        pieces.setHighlights(null, []);
        resolve({ ...squad, positions: squad.positions.map((p) => ({ ...p })) });
      };
      hud.onUndo = () => {};

      refresh();
    });
  }
}

export { FORMATIONS };
