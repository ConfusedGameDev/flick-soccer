import type { Team } from '../engine/types';
import { haptics } from '../input/haptics';
import { hex, type Kit } from '../render/kits';

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

export interface AutoMasher {
  side: 'left' | 'right';
  /** Average presses per second; the actual timing jitters around it. */
  rate: number;
}

/** Online duel: this device owns one pad; the server owns the meter and the verdict. */
export interface RemoteDuel {
  side: 'left' | 'right';
  openInMs: number;
  send: () => void;
  subscribe: (cb: (msg: { t: 'meter'; value: number } | { t: 'end'; winner: Team }) => void) => () => void;
}

export interface DuelSounds {
  whistle: () => void;
  countdown: (step: number) => void;
  mash: () => void;
}

/**
 * Dead-ball dispute: whistle, 3-2-1-GO, then both players mash their arcade
 * button. Every press pulls the rope's knot toward the presser; the first to
 * drag it all the way to their end wins. At the time limit whoever leads
 * wins, and a dead heat goes to sudden death (next press wins). Each press
 * also kicks the haptics.
 */
export class Duel {
  constructor(
    private readonly overlay: HTMLElement,
    private readonly sounds?: DuelSounds,
  ) {}

  run(sides: DuelSides, names: Record<Team, string>, auto?: AutoMasher, remote?: RemoteDuel, kits?: Record<Team, Kit>): Promise<Team> {
    const padLabel = (side: 'left' | 'right'): string => {
      if (auto?.side === side) return 'CPU';
      if (remote && remote.side !== side) return 'Opponent';
      return `Mash! (${side === 'left' ? 'A' : 'L'})`;
    };
    const colour = (side: 'left' | 'right'): string => {
      const kit = kits?.[sides[side]];
      return kit ? hex(kit.jersey) : side === 'left' ? 'var(--home)' : 'var(--away)';
    };
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'duel';
      root.style.setProperty('--left', colour('left'));
      root.style.setProperty('--right', colour('right'));
      root.innerHTML = `
        <div class="duel-top">
          <div class="duel-title">Dispute ball</div>
          <div class="duel-count" data-count>🔔</div>
          <div class="duel-rope" data-rope>
            <span class="duel-end left">${names[sides.left]}</span>
            <span class="duel-track"><i class="duel-pull left" data-pull-left></i><i class="duel-pull right" data-pull-right></i><b class="duel-knot" data-knot></b></span>
            <span class="duel-end right">${names[sides.right]}</span>
          </div>
          <div class="duel-timer" data-timer></div>
        </div>
        <div class="duel-pads">
          <div class="duel-slot"><button class="duel-pad left" data-pad="left"><span class="duel-cap"><b>${names[sides.left]}</b><small>${padLabel('left')}</small></span></button></div>
          <div class="duel-slot"><button class="duel-pad right" data-pad="right"><span class="duel-cap"><b>${names[sides.right]}</b><small>${padLabel('right')}</small></span></button></div>
        </div>`;
      this.overlay.appendChild(root);

      const count = root.querySelector<HTMLElement>('[data-count]')!;
      const knot = root.querySelector<HTMLElement>('[data-knot]')!;
      const pullLeft = root.querySelector<HTMLElement>('[data-pull-left]')!;
      const pullRight = root.querySelector<HTMLElement>('[data-pull-right]')!;
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
      let autoTimer: ReturnType<typeof setTimeout> | null = null;

      // The knot sits at the meter; each side's colour reaches from its end to the knot, so
      // the side that is winning holds more rope. A press moves the knot toward the presser.
      const paint = () => {
        const k = ((meter + 1) / 2) * 100;
        knot.style.left = `${k}%`;
        pullLeft.style.width = `${k}%`;
        pullRight.style.width = `${100 - k}%`;
        root.classList.toggle('left-ahead', meter < -0.02);
        root.classList.toggle('right-ahead', meter > 0.02);
      };
      paint();

      const finish = (winner: Team) => {
        if (done) return;
        done = true;
        open = false;
        cancelAnimationFrame(raf);
        if (autoTimer) clearTimeout(autoTimer);
        unsubscribe?.();
        window.removeEventListener('keydown', onKey);
        count.textContent = `${names[winner]} win the ball!`;
        root.classList.add('done');
        haptics.success();
        setTimeout(() => {
          root.remove();
          resolve(winner);
        }, 1200);
      };

      const press = (side: 'left' | 'right') => {
        if (!open) return;
        pads[side].classList.add('hit');
        setTimeout(() => pads[side].classList.remove('hit'), 80);
        this.sounds?.mash();
        if (human(side)) haptics.impact('medium');
        if (remote) {
          // The server keeps the score; we only report presses.
          remote.send();
          return;
        }
        meter += side === 'left' ? -PRESS_STEP : PRESS_STEP;
        meter = Math.max(-1, Math.min(1, meter));
        paint();
        if (sudden || meter <= -1 || meter >= 1) finish(meter < 0 ? sides.left : sides.right);
      };

      const human = (side: 'left' | 'right') => auto?.side !== side && (!remote || remote.side === side);
      let unsubscribe: (() => void) | null = null;
      if (remote) {
        unsubscribe = remote.subscribe((msg) => {
          if (msg.t === 'meter') {
            meter = msg.value;
            paint();
          } else {
            finish(msg.winner);
          }
        });
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.code === 'KeyA' && human('left')) press('left');
        else if (e.code === 'KeyL' && human('right')) press('right');
      };
      window.addEventListener('keydown', onKey);
      for (const side of ['left', 'right'] as const) {
        if (!human(side)) {
          pads[side].classList.add('cpu');
          continue;
        }
        pads[side].addEventListener('pointerdown', (e) => {
          e.preventDefault();
          press(side);
        });
        pads[side].addEventListener('contextmenu', (e) => e.preventDefault());
      }

      // CPU presses at roughly its rate, with a human-like wobble.
      const autoPress = () => {
        if (done || !auto) return;
        if (open) press(auto.side);
        const gap = (1000 / auto.rate) * (0.6 + Math.random() * 0.8);
        autoTimer = setTimeout(autoPress, gap);
      };

      const loop = () => {
        if (done) return;
        const left = Math.max(0, endAt - performance.now());
        timerEl.textContent = sudden ? 'Sudden death!' : (left / 1000).toFixed(1);
        // Online, the server decides the end; locally we do.
        if (open && !remote && !sudden && left <= 0) {
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
      this.sounds?.whistle();
      const advance = () => {
        if (step < COUNTDOWN.length) {
          this.sounds?.countdown(COUNTDOWN.length - 1 - step);
          count.textContent = COUNTDOWN[step++];
          count.classList.remove('pop');
          void count.offsetWidth; // restart the pop animation
          count.classList.add('pop');
          if (step === COUNTDOWN.length) {
            haptics.impact('heavy');
            open = true;
            root.classList.add('open');
            endAt = performance.now() + MASH_SECONDS * 1000;
            raf = requestAnimationFrame(loop);
            if (auto) autoTimer = setTimeout(autoPress, 150 + Math.random() * 200);
          } else {
            setTimeout(advance, COUNT_STEP_MS);
          }
        }
      };
      setTimeout(advance, 900);
    });
  }
}
