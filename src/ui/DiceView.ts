import type { DiceRoll } from '../engine/types';

const TUMBLE_MS = 900;
const PAIR_GAP_MS = 500;

export interface DiceShow {
  title: string;
  /** Caption under the dice, e.g. "+18% this turn" or "Blocked for 3 turns". */
  caption: string;
  /** Dice values per round; each round is shown in turn (doubles roll again). */
  rounds: number[][];
  /** When true the viewer must flick the dice to start; otherwise they roll by themselves. */
  flick: boolean;
  /** Label on the dice while waiting for the flick. */
  hint?: string;
  /** Caption between rounds (doubles or a kickoff tie). */
  again?: string;
}

/**
 * Dice overlay. The outcome is decided by the engine; the flick is theater:
 * pull back and release to tumble the dice, which then land on the given values.
 */
export class DiceView {
  constructor(private readonly overlay: HTMLElement) {}

  show(spec: DiceShow): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'dice';
      root.innerHTML = `
        <div class="dice-title">${spec.title}</div>
        <div class="dice-tray" data-tray>
          ${spec.rounds[0].map(() => '<div class="die" data-value="1"></div>').join('')}
        </div>
        <div class="dice-hint" data-hint>${spec.flick ? (spec.hint ?? 'Pull back and release to roll') : ''}</div>
        <div class="dice-caption" data-caption></div>
        <button class="primary hidden" data-ok>OK</button>`;
      this.overlay.appendChild(root);

      const tray = root.querySelector<HTMLElement>('[data-tray]')!;
      const dice = Array.from(root.querySelectorAll<HTMLElement>('.die'));
      const hint = root.querySelector<HTMLElement>('[data-hint]')!;
      const caption = root.querySelector<HTMLElement>('[data-caption]')!;
      const ok = root.querySelector<HTMLButtonElement>('[data-ok]')!;

      const setFaces = (values: number[]) => dice.forEach((d, i) => d.setAttribute('data-value', String(values[i] ?? 1)));
      setFaces(spec.rounds[0]);

      const tumble = (values: number[], dir: { x: number; y: number }) =>
        new Promise<void>((done) => {
          root.classList.add('rolling');
          tray.style.setProperty('--dx', `${dir.x}px`);
          tray.style.setProperty('--dy', `${dir.y}px`);
          const t0 = performance.now();
          const spin = () => {
            const k = (performance.now() - t0) / TUMBLE_MS;
            if (k >= 1) {
              setFaces(values);
              root.classList.remove('rolling');
              root.classList.add('landed');
              done();
              return;
            }
            setFaces(values.map(() => 1 + Math.floor(Math.random() * 6)));
            setTimeout(spin, 70 + k * 120);
          };
          spin();
        });

      const play = async (dir: { x: number; y: number }) => {
        hint.textContent = '';
        for (let i = 0; i < spec.rounds.length; i++) {
          if (i > 0) {
            caption.textContent = spec.again ?? 'Doubles! Roll again…';
            await new Promise((r) => setTimeout(r, PAIR_GAP_MS));
            root.classList.remove('landed');
          }
          await tumble(spec.rounds[i], i === 0 ? dir : { x: dir.x * 0.6, y: dir.y * 0.6 });
        }
        caption.textContent = spec.caption;
        ok.classList.remove('hidden');
        ok.addEventListener(
          'click',
          () => {
            root.remove();
            resolve();
          },
          { once: true },
        );
      };

      if (!spec.flick) {
        setTimeout(() => play({ x: 24, y: -40 }), 400);
        return;
      }

      // Flick gesture on the tray: direction of travel is opposite the pull.
      let pointerId: number | null = null;
      let start = { x: 0, y: 0 };
      const down = (e: PointerEvent) => {
        if (pointerId !== null) return;
        pointerId = e.pointerId;
        start = { x: e.clientX, y: e.clientY };
        try {
          tray.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        tray.style.transform = `translate(${(e.clientX - start.x) * 0.4}px, ${(e.clientY - start.y) * 0.4}px)`;
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        tray.style.transform = '';
        const dx = start.x - e.clientX;
        const dy = start.y - e.clientY;
        if (Math.hypot(dx, dy) < 12) return;
        tray.removeEventListener('pointerdown', down);
        tray.removeEventListener('pointermove', move);
        tray.removeEventListener('pointerup', up);
        tray.removeEventListener('pointercancel', up);
        // Travel is capped so the dice settle near the tray, whatever the pull.
        const len = Math.hypot(dx, dy);
        const travel = Math.min(44, len * 0.5);
        void play({ x: (dx / len) * travel, y: (dy / len) * travel });
      };
      tray.addEventListener('pointerdown', down);
      tray.addEventListener('pointermove', move);
      tray.addEventListener('pointerup', up);
      tray.addEventListener('pointercancel', up);
    });
  }

  /** Human-readable summary of a 2d6 trade roll. */
  static caption(roll: DiceRoll): string {
    const parts: string[] = [];
    if (roll.blocked) parts.push(`Under 4: dice blocked for 3 turns`);
    if (roll.sum > 0) parts.push(`+${Math.round(roll.bonus * 100)}% to your odds this turn`);
    if (roll.booster) parts.push('Booster pack!');
    return parts.join(' · ') || 'Nothing';
  }
}
