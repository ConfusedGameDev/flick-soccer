import { clampToPitch } from '../engine/pitch';
import {
  BUDGET,
  FORMATIONS,
  FORMATION_NAMES,
  POSITIONS,
  SQUAD_SIZE,
  cost,
  cpuSquad,
  squadCost,
  squadProblem,
  stats,
  type Era,
  type FormationName,
  type PoolPlayer,
  type Position,
  type Squad,
} from '../engine/pool';
import type { PlayerState, Vec2 } from '../engine/types';
import { dist } from '../engine/vec';
import { PLAYER_RADIUS_M, type PiecesView } from '../render/PiecesView';
import type { PitchView } from '../render/PitchView';
import type { Hud } from '../ui/Hud';
import { isDualScreen } from '../ui/segments';

type EraFilter = Era | 'all';
type PosFilter = Position | 'all';

const STAT_LABELS: [keyof PoolPlayer, string][] = [
  ['pass', 'PAS'],
  ['shot', 'SHT'],
  ['speed', 'SPD'],
  ['tackle', 'TKL'],
  ['keeping', 'GK'],
];

const GRAB_M = PLAYER_RADIUS_M * 2.2;
/** Pointer travel below this (meters) counts as a tap, which selects/swaps. */
const TAP_M = 1;
const HIDDEN_BALL: Vec2 = { x: -1000, y: -1000 };

export interface BuilderDeps {
  hud: Hud;
  pitch: PitchView;
  pieces: PiecesView;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  /** Re-run the app layout after the pitch insets change. */
  relayout: () => void;
}

/**
 * Team builder: draft and formation on one screen. The pool is a panel beside
 * (or below) the pitch; every pick lands on the next free slot of the chosen
 * formation, and the discs can be dragged anywhere or tapped in pairs to swap
 * while you keep picking. Edited in the home frame; the match mirrors Away.
 */
export class TeamBuilder {
  constructor(private readonly deps: BuilderDeps) {}

  run(title: string, pool: readonly PoolPlayer[], seed: number): Promise<Squad> {
    const { hud, pitch, pieces, canvas, overlay, relayout } = this.deps;
    return new Promise((resolve) => {
      let formation: FormationName = '4-4-2';
      let slots: (PoolPlayer | null)[] = FORMATIONS[formation].map(() => null);
      let positions: Vec2[] = FORMATIONS[formation].map((s) => ({ ...s.pos }));
      let selected: number | null = null;
      let drag: { slot: number; pointerId: number; start: Vec2; moved: boolean } | null = null;
      let era: EraFilter = 'all';
      let pos: PosFilter = 'all';

      // ---- Pool panel ----
      const panel = document.createElement('div');
      panel.className = 'draft-panel';
      panel.innerHTML = `
        <div class="draft-head">
          <div>
            <div class="draft-title">${title}</div>
            <div class="draft-sub" data-sub></div>
          </div>
          <div class="draft-budget" data-budget></div>
        </div>
        <div class="draft-filters">
          <div class="chips" data-era></div>
          <div class="chips" data-pos></div>
        </div>
        <div class="draft-list" data-list></div>
        <div class="draft-foot">
          <button data-auto>Auto-pick</button>
          <button data-clear>Clear</button>
        </div>`;
      overlay.appendChild(panel);
      overlay.classList.add('building');
      const sub = panel.querySelector<HTMLElement>('[data-sub]')!;
      const budget = panel.querySelector<HTMLElement>('[data-budget]')!;
      const list = panel.querySelector<HTMLElement>('[data-list]')!;
      const eraChips = panel.querySelector<HTMLElement>('[data-era]')!;
      const posChips = panel.querySelector<HTMLElement>('[data-pos]')!;

      // Make room for the panel: beside the pitch in landscape, under it in portrait.
      // On two screens the panel fills the pane screen (CSS) and the pitch ignores insets.
      const applyInsets = () => {
        const landscape = window.innerWidth > window.innerHeight && !isDualScreen();
        panel.classList.toggle('side', landscape);
        const r = panel.getBoundingClientRect();
        pitch.insets = landscape ? { left: r.width, right: 0, top: 0, bottom: 0 } : { left: 0, right: 0, top: 0, bottom: r.height };
        relayout();
        refreshPitch();
      };
      window.addEventListener('resize', applyInsets);

      const picked = () => slots.filter((p): p is PoolPlayer => p !== null);

      /** Put a newly picked player on the first free slot of their role, else any free slot. */
      const place = (p: PoolPlayer) => {
        const roles = FORMATIONS[formation];
        let i = slots.findIndex((s, k) => s === null && roles[k].role === p.position);
        if (i < 0) i = slots.findIndex((s) => s === null);
        if (i >= 0) slots[i] = p;
      };

      const setFormation = (name: FormationName) => {
        const keep = picked();
        formation = name;
        slots = FORMATIONS[name].map(() => null);
        positions = FORMATIONS[name].map((s) => ({ ...s.pos }));
        selected = null;
        // Natural positions first, then the rest, so a re-pick keeps the shape sensible.
        const byRole = [...keep].sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
        for (const p of byRole) place(p);
      };

      const chips = <T extends string>(host: HTMLElement, values: T[], labels: string[], get: () => T, set: (v: T) => void) => {
        host.innerHTML = '';
        values.forEach((v, i) => {
          const b = document.createElement('button');
          b.className = 'chip' + (get() === v ? ' active' : '');
          b.textContent = labels[i];
          b.addEventListener('click', () => {
            set(v);
            refreshPanel();
          });
          host.appendChild(b);
        });
      };

      const refreshPanel = () => {
        chips<EraFilter>(eraChips, ['all', 'classic', 'modern'], ['All eras', 'Classic 60–87', 'Modern 88–07'], () => era, (v) => (era = v));
        chips<PosFilter>(posChips, ['all', ...POSITIONS], ['All', ...POSITIONS], () => pos, (v) => (pos = v));
        const chosen = picked();
        const spent = squadCost(chosen);
        const problem = squadProblem(chosen);
        budget.textContent = `${spent} / ${BUDGET}`;
        budget.classList.toggle('over', spent > BUDGET);
        sub.textContent = problem ?? 'Squad is ready: arrange them, then confirm';
        hud.setPlanning({ canUndo: false, canConfirm: problem === null });

        list.innerHTML = '';
        const rows = pool
          .filter((p) => (era === 'all' || p.era === era) && (pos === 'all' || p.position === pos))
          .sort((a, b) => cost(b) - cost(a) || a.short.localeCompare(b.short));
        for (const p of rows) {
          const on = slots.includes(p);
          const row = document.createElement('button');
          row.className = 'draft-row' + (on ? ' picked' : '');
          row.innerHTML = `
            <span class="pos ${p.position}">${p.position}</span>
            <span class="who"><b>${p.name}</b><small>${p.club} · ${p.era === 'classic' ? 'Classic' : 'Modern'}</small></span>
            <span class="stats">${STAT_LABELS.map(([k, l]) => `<i title="${l}">${l}<b>${p[k]}</b></i>`).join('')}</span>
            <span class="cost">${cost(p)}</span>`;
          row.addEventListener('click', () => {
            if (on) slots[slots.indexOf(p)] = null;
            else if (picked().length < SQUAD_SIZE) place(p);
            selected = null;
            refreshPanel();
            refreshPitch();
          });
          list.appendChild(row);
        }
      };

      // ---- Pitch ----
      /** Filled slots as preview players; `index[i]` maps piece i back to its slot. */
      let index: number[] = [];
      const previewPlayers = (): PlayerState[] => {
        index = [];
        const out: PlayerState[] = [];
        slots.forEach((p, slot) => {
          if (!p) return;
          index.push(slot);
          out.push({
            id: out.length,
            team: 'home',
            number: slot + 1,
            keeper: p.position === 'GK' && slots.findIndex((q) => q?.position === 'GK') === slot,
            name: p.short,
            stats: stats(p),
            kickoff: { ...positions[slot] },
            pos: { ...positions[slot] },
          });
        });
        return out;
      };

      const refreshPitch = () => {
        const ps = previewPlayers();
        pieces.rebuild(ps);
        pieces.setPositions(
          ps.map((p) => p.pos),
          HIDDEN_BALL,
        );
        pieces.setSlots(slots.map((p, i) => (p ? null : positions[i])).filter((v): v is Vec2 => v !== null));
        pieces.setHighlights(selected === null ? null : index.indexOf(selected), []);
        hud.setToolbar(
          FORMATION_NAMES.map((name) => ({
            label: name,
            active: formation === name,
            onClick: () => {
              setFormation(name);
              refreshPanel();
              refreshPitch();
            },
          })),
        );
        hud.setStatus(
          title,
          selected === null ? 'Pick players from the list; drag them on the pitch, or tap two to swap' : `Tap another player to swap with #${selected + 1}`,
        );
      };

      const worldOf = (e: PointerEvent): Vec2 => {
        const r = canvas.getBoundingClientRect();
        return pitch.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
      };
      const pickSlot = (w: Vec2): number | null => {
        let best: number | null = null;
        let bestD = GRAB_M;
        positions.forEach((p, i) => {
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
        const slot = pickSlot(w);
        if (slot === null) return;
        e.preventDefault();
        drag = { slot, pointerId: e.pointerId, start: w, moved: false };
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
        positions[drag.slot] = clampToPitch(w);
        const ps = previewPlayers();
        pieces.setPositions(
          ps.map((p) => p.pos),
          HIDDEN_BALL,
        );
        pieces.setSlots(slots.map((p, i) => (p ? null : positions[i])).filter((v): v is Vec2 => v !== null));
      };
      const up = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { slot, moved } = drag;
        drag = null;
        if (!moved && slots[slot]) {
          if (selected === null) selected = slot;
          else if (selected === slot) selected = null;
          else {
            [slots[selected], slots[slot]] = [slots[slot], slots[selected]];
            selected = null;
          }
        }
        refreshPitch();
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);

      panel.querySelector('[data-auto]')!.addEventListener('click', () => {
        const auto = cpuSquad(pool, formation, seed + picked().length);
        slots = auto.players.map((p) => p);
        positions = auto.positions.map((p) => ({ ...p }));
        selected = null;
        refreshPanel();
        refreshPitch();
      });
      panel.querySelector('[data-clear]')!.addEventListener('click', () => {
        slots = slots.map(() => null);
        selected = null;
        refreshPanel();
        refreshPitch();
      });

      hud.onUndo = () => {};
      hud.onConfirm = () => {
        const players = picked();
        if (squadProblem(players)) return;
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        window.removeEventListener('resize', applyInsets);
        panel.remove();
        overlay.classList.remove('building');
        pitch.insets = { left: 0, right: 0, top: 0, bottom: 0 };
        relayout();
        hud.setToolbar([]);
        hud.setPlanning(null);
        pieces.setSlots([]);
        pieces.setHighlights(null, []);
        // Squad order = slot order, so shirt numbers follow the formation.
        const ordered = slots.filter((p): p is PoolPlayer => p !== null);
        const orderedPositions = positions.filter((_, i) => slots[i] !== null);
        resolve({ players: ordered, positions: orderedPositions, formation });
      };

      refreshPanel();
      applyInsets();
    });
  }
}
