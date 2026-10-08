import { KITS, type Kit } from '../render/kits';
import { spriteCanvas } from '../render/sprites';

export interface CoachButton<K extends string> {
  key: K;
  label: string;
}

/**
 * The tutorial's coach: a speech-bubble card under the top bar with a pixel
 * coach, a title, a line or two of text and, when the step needs it, buttons.
 * `tip` leaves the card up without buttons until the next call or `hide`.
 */
export class Coach {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly avatar: HTMLElement;
  private kit: Kit = KITS[0];

  constructor(private readonly overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'coach hidden';
    this.root.innerHTML = `
      <div class="coach-avatar" data-avatar></div>
      <div class="coach-bubble">
        <div class="coach-title" data-title></div>
        <div class="coach-text" data-text></div>
        <div class="coach-buttons" data-buttons></div>
      </div>`;
    this.title = this.root.querySelector('[data-title]')!;
    this.text = this.root.querySelector('[data-text]')!;
    this.buttons = this.root.querySelector('[data-buttons]')!;
    this.avatar = this.root.querySelector('[data-avatar]')!;
    this.setKit(this.kit);
  }

  /** Attach the card to the overlay (once); it is inserted before later overlays so dice and covers paint above it. */
  private mount(): void {
    if (!this.root.isConnected) this.overlay.appendChild(this.root);
  }

  setKit(kit: Kit): void {
    this.kit = kit;
    this.avatar.innerHTML = '';
    this.avatar.appendChild(spriteCanvas('stand', kit, true, 4));
  }

  /** Show a card with buttons; resolves with the tapped key. `text` may contain simple HTML. */
  ask<K extends string>(title: string, text: string, buttons: CoachButton<K>[]): Promise<K> {
    this.mount();
    this.title.textContent = title;
    this.text.innerHTML = text;
    this.buttons.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.classList.add('pop');
    return new Promise((resolve) => {
      buttons.forEach((b, i) => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (i === buttons.length - 1) el.classList.add('primary');
        el.addEventListener('click', () => {
          this.hide();
          resolve(b.key);
        });
        this.buttons.appendChild(el);
      });
    });
  }

  /** A card with one "Got it" button. */
  say(title: string, text: string, button = 'Got it'): Promise<void> {
    return this.ask(title, text, [{ key: 'ok', label: button }]).then(() => undefined);
  }

  /** A card with no buttons that stays until the next call or `hide`. */
  tip(title: string, text: string): void {
    this.mount();
    this.title.textContent = title;
    this.text.innerHTML = text;
    this.buttons.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.classList.remove('pop');
    void this.root.offsetWidth;
    this.root.classList.add('pop');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.buttons.innerHTML = '';
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
