import {
  BUDGET,
  POSITIONS,
  SQUAD_SIZE,
  cost,
  cpuSquad,
  squadCost,
  squadProblem,
  type Era,
  type PoolPlayer,
  type Position,
} from '../engine/pool';

type EraFilter = Era | 'all';
type PosFilter = Position | 'all';

const STAT_LABELS: [keyof PoolPlayer, string][] = [
  ['pass', 'PAS'],
  ['shot', 'SHT'],
  ['speed', 'SPD'],
  ['tackle', 'TKL'],
  ['keeping', 'GK'],
];

/** Draft screen: pick 11 players from the pool within the budget. */
export class Draft {
  constructor(private readonly overlay: HTMLElement) {}

  run(title: string, pool: readonly PoolPlayer[], seed: number): Promise<PoolPlayer[]> {
    return new Promise((resolve) => {
      const picked = new Set<string>();
      let era: EraFilter = 'all';
      let pos: PosFilter = 'all';

      const root = document.createElement('div');
      root.className = 'draft';
      root.innerHTML = `
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
          <button class="primary" data-done disabled>Done</button>
        </div>`;
      this.overlay.appendChild(root);

      const sub = root.querySelector<HTMLElement>('[data-sub]')!;
      const budget = root.querySelector<HTMLElement>('[data-budget]')!;
      const list = root.querySelector<HTMLElement>('[data-list]')!;
      const done = root.querySelector<HTMLButtonElement>('[data-done]')!;
      const eraChips = root.querySelector<HTMLElement>('[data-era]')!;
      const posChips = root.querySelector<HTMLElement>('[data-pos]')!;

      const chips = <T extends string>(host: HTMLElement, values: T[], labels: string[], get: () => T, set: (v: T) => void) => {
        host.innerHTML = '';
        values.forEach((v, i) => {
          const b = document.createElement('button');
          b.className = 'chip' + (get() === v ? ' active' : '');
          b.textContent = labels[i];
          b.addEventListener('click', () => {
            set(v);
            render();
          });
          host.appendChild(b);
        });
      };

      const selected = () => pool.filter((p) => picked.has(p.id));

      const render = () => {
        chips<EraFilter>(eraChips, ['all', 'classic', 'modern'], ['All eras', 'Classic 60–87', 'Modern 88–07'], () => era, (v) => (era = v));
        chips<PosFilter>(posChips, ['all', ...POSITIONS], ['All', ...POSITIONS], () => pos, (v) => (pos = v));

        const chosen = selected();
        const spent = squadCost(chosen);
        const problem = squadProblem(chosen);
        budget.textContent = `${spent} / ${BUDGET}`;
        budget.classList.toggle('over', spent > BUDGET);
        sub.textContent = problem ?? 'Squad is ready';
        done.disabled = problem !== null;

        list.innerHTML = '';
        const rows = pool
          .filter((p) => (era === 'all' || p.era === era) && (pos === 'all' || p.position === pos))
          .sort((a, b) => cost(b) - cost(a) || a.short.localeCompare(b.short));
        for (const p of rows) {
          const on = picked.has(p.id);
          const row = document.createElement('button');
          row.className = 'draft-row' + (on ? ' picked' : '');
          row.innerHTML = `
            <span class="pos ${p.position}">${p.position}</span>
            <span class="who"><b>${p.name}</b><small>${p.club} · ${p.era === 'classic' ? 'Classic' : 'Modern'}</small></span>
            <span class="stats">${STAT_LABELS.map(([k, l]) => `<i title="${l}">${l}<b>${p[k]}</b></i>`).join('')}</span>
            <span class="cost">${cost(p)}</span>`;
          row.addEventListener('click', () => {
            if (on) picked.delete(p.id);
            else if (picked.size < SQUAD_SIZE) picked.add(p.id);
            render();
          });
          list.appendChild(row);
        }
      };

      root.querySelector('[data-auto]')!.addEventListener('click', () => {
        picked.clear();
        for (const p of cpuSquad(pool, '4-4-2', seed + picked.size).players) picked.add(p.id);
        render();
      });
      root.querySelector('[data-clear]')!.addEventListener('click', () => {
        picked.clear();
        render();
      });
      done.addEventListener('click', () => {
        const chosen = selected();
        if (squadProblem(chosen)) return;
        root.remove();
        resolve(chosen);
      });

      render();
    });
  }
}
