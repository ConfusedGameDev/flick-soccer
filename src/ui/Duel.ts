import type { Team } from '../engine/types';

/** How far one press moves the tug meter (range -1..1). */
const PRESS_STEP = 0.07;
const MASH_SECONDS = 5;
const COUNTDOWN = ['3', '2', '1', 'GO!'];
const COUNT_STEP_MS = 700;

export interface DuelSides {
  /** Team on the left button (and the `A` key). */
  left: Team;
  /** Team on the right button (and the `L` key). */
  right: Team;
}

/**
 * Dead-ball dispute: whistle, 3-2-1-GO, then both players mash. The first to
 * pull the meter fully to their side wins; at the time limit whoever leads
 * wins, and a dead heat goes to sudden death (next press wins).
 */
export class Duel {
  constructor(private readonly overlay: HTMLElement) {}

  run(sides: DuelSides, names: Record<Team, string>): Promise<Team> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'duel';
      root.innerHTML = `
        <div class="duel-top">
          <div class="duel-title">Dispute ball</div>
          <div class="duel-count" data-count>🔔</div>
          <div class="duel-meter"><div class="duel-fill" data-fill></div></div>
          <div class="duel-timer" data-timer></div>
        </div>
        <div class="duel-pads">
          <button class="duel-pad left" data-pad="left">${names[sides.left]}<small>mash! (A)</small></button>
          <button class="duel-pad right" data-pad="right">${names[sides.right]}<small>mash! (L)</small></button>
        </div>`;
      this.overlay.appendChild(root);

      const count = root.querySelector<HTMLElement>('[data-count]')!;
      const fill = root.querySelector<HTMLElement>('[data-fill]')!;
      const timerEl = root.querySelector<HTMLElement>('[data-timer]')!;
      const pads = {
        left: root.querySelector<HTMLButtonElement>('[data-pad="left"]')!,
        right: root.querySelector<HTMLButtonElement>('[data-pad="right"]')!,
      };

      let meter = 0; // -1 = left wins, +1 = right wins
      let open = false;
      let sudden = false;
      let done = false;
      let endAt = 0;
      let raf = 0;

      const paint = () => {
        fill.style.width = `${((meter + 1) / 2) * 100}%`;
      };
      paint();

      const finish = (winner: Team) => {
        if (done) return;
        done = true;
        open = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        count.textContent = `${names[winner]} win the ball!`;
        root.classList.add('done');
        setTimeout(() => {
          root.remove();
          resolve(winner);
        }, 1200);
      };

      const press = (side: 'left' | 'right') => {
        if (!open) return;
        pads[side].classList.add('hit');
        setTimeout(() => pads[side].classList.remove('hit'), 80);
        meter += side === 'left' ? -PRESS_STEP : PRESS_STEP;
        meter = Math.max(-1, Math.min(1, meter));
        paint();
        if (sudden || meter <= -1 || meter >= 1) finish(meter < 0 ? sides.left : sides.right);
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.code === 'KeyA') press('left');
        else if (e.code === 'KeyL') press('right');
      };
      window.addEventListener('keydown', onKey);
      for (const side of ['left', 'right'] as const) {
        pads[side].addEventListener('pointerdown', (e) => {
          e.preventDefault();
          press(side);
        });
        pads[side].addEventListener('contextmenu', (e) => e.preventDefault());
      }

      const loop = () => {
        if (done) return;
        const left = Math.max(0, endAt - performance.now());
        timerEl.textContent = sudden ? 'Sudden death!' : (left / 1000).toFixed(1);
        if (open && !sudden && left <= 0) {
          if (meter !== 0) finish(meter < 0 ? sides.left : sides.right);
          else {
            sudden = true;
            count.textContent = 'Next press wins!';
          }
        }
        raf = requestAnimationFrame(loop);
      };

      // Whistle, then the countdown.
      let step = 0;
      const advance = () => {
        if (step < COUNTDOWN.length) {
          count.textContent = COUNTDOWN[step++];
          count.classList.remove('pop');
          void count.offsetWidth; // restart the pop animation
          count.classList.add('pop');
          if (step === COUNTDOWN.length) {
            open = true;
            root.classList.add('open');
            endAt = performance.now() + MASH_SECONDS * 1000;
            raf = requestAnimationFrame(loop);
          } else {
            setTimeout(advance, COUNT_STEP_MS);
          }
        }
      };
      setTimeout(advance, 900);
    });
  }
}
