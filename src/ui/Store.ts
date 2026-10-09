import { BOOSTER_INFO } from '../engine/dice';
import { MAX_TACTICS, TACTIC_INFO } from '../engine/tactics';
import type { Tactic } from '../engine/types';
import { LEAGUE_INFO, STAT_KEYS, cost, type PoolPlayer, type Stats } from '../engine/pool';
import { MAX_STAT, PACK_COST, RUN_STAGES, TRAIN_COST, buyPack, buyTactic, hire, hireCost, scoutOffers, tacticOffers, train, type Opponent, type RunState } from '../game/run';

const STAT_LABELS: Record<keyof Stats, string> = { pass: 'PAS', shot: 'SHT', speed: 'SPD', tackle: 'TKL', keeping: 'GK' };

/**
 * The between-matches store of the season run: spend coins on training
 * (+1 to a stat), on scouted players, or on a booster pack, then play the
 * next club. Every action goes through the pure functions in game/run.ts.
 */
export class Store {
  constructor(private readonly overlay: HTMLElement) {}

  /** Resolves with the updated run on "Next match", or null to leave to the menu (the run stays saved). */
  run(initial: RunState, pool: readonly PoolPlayer[], next: Opponent): Promise<RunState | null> {
    return new Promise((resolve) => {
      let run = initial;
      const offers = scoutOffers(pool, run);
      const cards = tacticOffers(run);
      const root = document.createElement('div');
      root.className = 'store';
      this.overlay.appendChild(root);

      const row = (p: PoolPlayer, right: string, statCells: string) => `
        <div class="draft-row store-row">
          <span class="pos ${p.position}">${p.position}</span>
          <span class="who"><b>${p.name}</b><small>${p.club ? `${p.club} · ` : ''}${LEAGUE_INFO[p.league].name}</small></span>
          <span class="stats">${statCells}</span>
          <span class="cost">${right}</span>
        </div>`;

      const render = () => {
        const last = run.results[run.results.length - 1];
        const canTrain = run.coins >= TRAIN_COST;
        root.innerHTML = `
          <div class="store-head">
            <div>
              <div class="draft-title">Between matches</div>
              <div class="draft-sub">${last ? `${last.outcome === 'win' ? 'Won' : 'Drew'} ${last.home} – ${last.away} vs ${last.opponent}. ` : ''}Next: <b>${next.name}</b> (${next.difficulty}, match ${run.stage + 1} of ${RUN_STAGES})</div>
            </div>
            <div class="draft-budget" data-coins>🪙 ${run.coins}</div>
          </div>
          <div class="store-body">
            <div class="store-section">
              <div class="store-label">Train · tap a stat for +1 (🪙 ${TRAIN_COST})</div>
              ${run.squad.players
                .map((p, i) =>
                  row(
                    p,
                    `${cost(p)}`,
                    STAT_KEYS.map(
                      (k) =>
                        `<button class="stat${p[k] >= MAX_STAT ? ' maxed' : ''}" data-train="${i}" data-stat="${k}" ${!canTrain || p[k] >= MAX_STAT ? 'disabled' : ''} title="${STAT_LABELS[k]}">${STAT_LABELS[k]}<b>${p[k]}</b></button>`,
                    ).join(''),
                  ),
                )
                .join('')}
            </div>
            <div class="store-section">
              <div class="store-label">Scouts · a signing replaces your cheapest player in that position</div>
              ${offers
                .filter((o) => !run.squad.players.some((p) => p.id === o.id))
                .map((o) =>
                  row(
                    o,
                    `<button class="primary small" data-hire="${o.id}" ${run.coins < hireCost(o) ? 'disabled' : ''}>🪙 ${hireCost(o)}</button>`,
                    STAT_KEYS.map((k) => `<i>${STAT_LABELS[k]}<b>${o[k]}</b></i>`).join(''),
                  ),
                )
                .join('') || '<div class="store-empty">Everyone has signed. Nice squad.</div>'}
            </div>
            <div class="store-section">
              <div class="store-label">Tactics · passive rules for the whole run (max ${MAX_TACTICS})</div>
              <div class="store-cards">
                ${run.tactics.map((t) => `<div class="store-card owned"><b>${TACTIC_INFO[t].name}</b><span>${TACTIC_INFO[t].text}</span></div>`).join('')}
                ${cards
                  .filter((t) => !run.tactics.includes(t))
                  .map(
                    (t) =>
                      `<div class="store-card"><b>${TACTIC_INFO[t].name}</b><span>${TACTIC_INFO[t].text}</span><button class="primary small" data-tactic="${t}" ${run.coins < TACTIC_INFO[t].price || run.tactics.length >= MAX_TACTICS ? 'disabled' : ''}>🪙 ${TACTIC_INFO[t].price}</button></div>`,
                  )
                  .join('')}
              </div>
            </div>
            <div class="store-section">
              <div class="store-label">Boosters · carried into the next match (max 2)</div>
              <div class="store-boosters">
                ${run.boosters.map((b) => `<span class="store-booster" title="${BOOSTER_INFO[b].text}">${BOOSTER_INFO[b].name}</span>`).join('')}
                <button data-pack ${run.coins < PACK_COST || run.boosters.length >= 2 ? 'disabled' : ''}>Booster pack · 🪙 ${PACK_COST}</button>
              </div>
            </div>
          </div>
          <div class="draft-foot">
            <button data-quit>Save &amp; quit</button>
            <button class="primary" data-next>Next match</button>
          </div>`;

        root.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((b) =>
          b.addEventListener('click', () => {
            const r = train(run, Number(b.dataset.train), b.dataset.stat as keyof Stats);
            if (r) {
              run = r;
              render();
            }
          }),
        );
        root.querySelectorAll<HTMLButtonElement>('[data-hire]').forEach((b) =>
          b.addEventListener('click', () => {
            const offer = offers.find((o) => o.id === b.dataset.hire);
            const r = offer ? hire(run, offer) : null;
            if (r) {
              run = r;
              render();
            }
          }),
        );
        root.querySelectorAll<HTMLButtonElement>('[data-tactic]').forEach((b) =>
          b.addEventListener('click', () => {
            const r = buyTactic(run, b.dataset.tactic as Tactic);
            if (r) {
              run = r;
              render();
            }
          }),
        );
        root.querySelector('[data-pack]')!.addEventListener('click', () => {
          const r = buyPack(run);
          if (r) {
            run = r;
            render();
          }
        });
        root.querySelector('[data-quit]')!.addEventListener('click', () => {
          root.remove();
          resolve(null);
        });
        root.querySelector('[data-next]')!.addEventListener('click', () => {
          root.remove();
          resolve(run);
        });
      };
      render();
    });
  }
}
