import type { Coin } from '../engine/types';
import { KITS, type Kit } from '../render/kits';
import { spriteCanvas } from '../render/sprites';

/** Length of the toss animation (matches the CSS keyframes). */
const FLIP_MS = 1500;

export interface CallSpec {
  title: string;
  text: string;
  kit?: Kit;
}

export interface FlipSpec {
  title: string;
  /** The face the engine decided; the animation lands on it. */
  coin: Coin;
  /** Shown once the coin has landed. */
  caption: string;
  kit?: Kit;
  /** Label on the closing button. */
  button?: string;
}

/**
 * The kickoff coin toss: `call` asks the caller for heads or tails, `flip`
 * spins the coin and lands it on the seeded result. Pure theater, as the
 * kickoff die was: the engine already knows the face.
 */
export class CoinToss {
  /** Closes the open call prompt, if any (online: the server called for a caller who dawdled). */
  private closeCall: (() => void) | null = null;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly onFlip?: () => void,
  ) {}

  call(spec: CallSpec): Promise<Coin> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'toss';
      root.innerHTML = `
        <div class="toss-title">${spec.title}</div>
        <div class="toss-stage">
          <div class="coin still"><span class="coin-face heads"><i></i>Heads</span><span class="coin-face tails"><i></i>Tails</span></div>
          <div class="toss-shadow"></div>
          <div class="toss-player" data-player></div>
        </div>
        <div class="toss-caption">${spec.text}</div>
        <div class="toss-call">
          <button class="primary" data-call="heads">Heads</button>
          <button class="primary" data-call="tails">Tails</button>
        </div>`;
      this.overlay.appendChild(root);
      root.querySelector<HTMLElement>('[data-player]')!.appendChild(spriteCanvas('stand', spec.kit ?? KITS[0], false, 3));
      this.closeCall = () => {
        root.remove();
        this.closeCall = null;
      };
      for (const b of root.querySelectorAll<HTMLButtonElement>('[data-call]')) {
        b.addEventListener('click', () => {
          this.closeCall?.();
          resolve(b.dataset.call === 'tails' ? 'tails' : 'heads');
        });
      }
    });
  }

  /** Take down the call prompt without an answer; the pending `call` never resolves. */
  cancel(): void {
    this.closeCall?.();
  }

  flip(spec: FlipSpec): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'toss';
      root.innerHTML = `
        <div class="toss-title">${spec.title}</div>
        <div class="toss-stage">
          <div class="coin" data-coin><span class="coin-face heads"><i></i>Heads</span><span class="coin-face tails"><i></i>Tails</span></div>
          <div class="toss-shadow"></div>
          <div class="toss-player" data-player></div>
        </div>
        <div class="toss-caption" data-caption></div>
        <button class="primary hidden" data-ok>${spec.button ?? 'OK'}</button>`;
      this.overlay.appendChild(root);
      root.querySelector<HTMLElement>('[data-player]')!.appendChild(spriteCanvas('stand', spec.kit ?? KITS[0], false, 3));
      const coin = root.querySelector<HTMLElement>('[data-coin]')!;
      const caption = root.querySelector<HTMLElement>('[data-caption]')!;
      const ok = root.querySelector<HTMLButtonElement>('[data-ok]')!;
      setTimeout(() => {
        this.onFlip?.();
        coin.classList.add(spec.coin);
        setTimeout(() => {
          caption.textContent = spec.caption;
          ok.classList.remove('hidden');
        }, FLIP_MS);
      }, 400);
      ok.addEventListener(
        'click',
        () => {
          root.remove();
          resolve();
        },
        { once: true },
      );
    });
  }
}
