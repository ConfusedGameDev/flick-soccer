import { BOOSTER_INFO, PACK_CARDS, decoysFor } from '../engine/boosters';
import type { Booster } from '../engine/types';
import { KITS, type Kit } from '../render/kits';
import { spriteCanvas } from '../render/sprites';

/** Flip time of a card (matches the CSS transition). */
const FLIP_MS = 520;
/** Pause before the two other cards turn over. */
const OTHERS_MS = 450;
/** Auto-pick delay when the viewer is not the one choosing. */
const AUTO_MS = 650;
/** The foil tearing and the cards fanning out of the pack (matches the CSS). */
const TEAR_MS = 650;

export interface PackShow {
  title: string;
  /** The booster the engine drew: whichever card is tapped holds it. */
  booster: Booster;
  /** True: the viewer taps a card. False: the middle card turns by itself (CPU, remote, the other side's pack). */
  pick: boolean;
  /** Kit of the player opening the pack; the first preset when not given. */
  kit?: Kit;
  /** Line under the cards once the booster shows; defaults to the booster's effect. */
  caption?: string;
  /** Label under the cards while waiting for the tap. */
  hint?: string;
}

/**
 * Booster pack overlay: a sealed foil pack hovers above a player. Tap it to
 * tear it open and three face-down cards fan out; tap one and it turns over
 * to show the booster the engine already drew from the shared seed, and the
 * other two then show what you did not get. The choice is pure theater, like
 * the dice shot it replaces.
 */
export class PackView {
  private done: (() => void) | null = null;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly onFlip?: () => void,
  ) {}

  show(spec: PackShow): Promise<void> {
    this.cancel();
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'pack';
      root.innerHTML = `
        <div class="pack-title">${spec.title}</div>
        <div class="pack-stage" data-stage>
          <button class="booster" data-booster>
            <span class="booster-tear"></span>
            <span class="booster-body"><span class="booster-label">Booster<br>pack</span></span>
          </button>
          <div class="pack-cards" data-cards>
            ${Array.from({ length: PACK_CARDS }, () => '<button class="card" data-card><span class="card-inner"><span class="card-back">?</span><span class="card-face"><b data-name></b><small data-text></small></span></span></button>').join('')}
          </div>
          <div class="pack-shadow"></div>
          <div class="pack-player" data-player></div>
        </div>
        <div class="pack-hint" data-hint>${spec.pick ? 'Tap the pack to tear it open' : ''}</div>
        <div class="pack-caption" data-caption></div>
        <button class="primary hidden" data-ok>OK</button>`;
      this.overlay.appendChild(root);
      this.done = () => {
        root.remove();
        this.done = null;
        resolve();
      };

      const booster = root.querySelector<HTMLButtonElement>('[data-booster]')!;
      const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-card]'));
      const hint = root.querySelector<HTMLElement>('[data-hint]')!;
      const caption = root.querySelector<HTMLElement>('[data-caption]')!;
      const ok = root.querySelector<HTMLButtonElement>('[data-ok]')!;
      const playerHost = root.querySelector<HTMLElement>('[data-player]')!;
      playerHost.appendChild(spriteCanvas('cheer', spec.kit ?? KITS[0], false, 3));

      const face = (card: HTMLElement, b: Booster) => {
        card.querySelector('[data-name]')!.textContent = BOOSTER_INFO[b].name;
        card.querySelector('[data-text]')!.textContent = BOOSTER_INFO[b].text;
      };

      // Step one: tear the foil; the cards fan out face down.
      let torn = false;
      const tear = () => {
        if (torn) return;
        torn = true;
        booster.disabled = true;
        hint.textContent = '';
        root.classList.add('torn');
        this.onFlip?.();
        setTimeout(() => {
          root.classList.add('dealt');
          hint.textContent = spec.pick ? (spec.hint ?? 'Tap a card') : '';
          if (!spec.pick) setTimeout(() => open(Math.floor(PACK_CARDS / 2)), AUTO_MS);
        }, TEAR_MS);
      };

      // Step two: turn a card.
      let picked = false;
      const open = (i: number) => {
        if (picked || !torn) return;
        picked = true;
        hint.textContent = '';
        root.classList.add('opened');
        const card = cards[i];
        face(card, spec.booster);
        card.classList.add('picked', 'flipped');
        for (const c of cards) c.disabled = true;
        this.onFlip?.();
        const decoys = decoysFor(spec.booster);
        setTimeout(() => {
          let d = 0;
          for (const c of cards) {
            if (c === card) continue;
            face(c, decoys[d++]);
            c.classList.add('flipped', 'dim');
          }
          this.onFlip?.();
        }, FLIP_MS + OTHERS_MS);
        setTimeout(() => {
          caption.textContent = spec.caption ?? `${BOOSTER_INFO[spec.booster].name}: ${BOOSTER_INFO[spec.booster].text}`;
          ok.classList.remove('hidden');
        }, FLIP_MS + OTHERS_MS + FLIP_MS);
      };

      ok.addEventListener('click', () => this.done?.(), { once: true });
      if (spec.pick) {
        booster.addEventListener('click', tear);
        cards.forEach((c, i) => c.addEventListener('click', () => open(i)));
      } else {
        booster.disabled = true;
        for (const c of cards) c.disabled = true;
        setTimeout(tear, AUTO_MS);
      }
    });
  }

  /** Close an open pack (the planning clock ran out); resolves the pending show. */
  cancel(): void {
    this.done?.();
  }
}
