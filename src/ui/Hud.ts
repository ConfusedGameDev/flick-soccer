import { BOOSTER_INFO } from '../engine/dice';
import type { Booster, MatchState } from '../engine/types';
import { TURNS_PER_HALF } from '../engine/pitch';

export interface ExtrasSpec {
  canRoll: boolean;
  rolled: boolean;
  /** Turns the dice stay blocked, 0 if usable. */
  blocked: number;
  /** Total success bonus for this turn (banked + rolled). */
  bonus: number;
  boosters: { booster: Booster; usable: boolean; fresh?: boolean }[];
  armed: Booster | null;
}

/** DOM overlay: scoreboard, status text, planning buttons, the pass-the-device cover and toasts. */
export class Hud {
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly cover: HTMLElement;
  private readonly coverTitle: HTMLElement;
  private readonly coverText: HTMLElement;
  private readonly coverBtn: HTMLButtonElement;

  private readonly extras: HTMLElement;

  onUndo: () => void = () => {};
  onConfirm: () => void = () => {};
  onRoll: () => void = () => {};
  onBooster: (b: Booster) => void = () => {};

  constructor(readonly overlay: HTMLElement) {
    overlay.innerHTML = `
      <div class="bar top">
        <div>
          <div class="label" data-title></div>
          <div class="sub" data-sub></div>
        </div>
        <div class="scoreboard">
          <div class="score" data-score>0 – 0</div>
          <div class="clock" data-clock></div>
          <div class="timer" data-timer></div>
        </div>
      </div>
      <div class="bar bottom">
        <div class="extras" data-extras></div>
        <div class="actions">
          <button data-undo>Undo</button>
          <button class="primary" data-confirm>Confirm</button>
          <button class="primary hidden" data-next>Next turn</button>
        </div>
      </div>
      <div class="cover hidden" data-cover>
        <h1 data-cover-title></h1>
        <p data-cover-text></p>
        <button class="primary" data-cover-btn>Ready</button>
      </div>`;
    this.title = overlay.querySelector('[data-title]')!;
    this.sub = overlay.querySelector('[data-sub]')!;
    this.score = overlay.querySelector('[data-score]')!;
    this.clock = overlay.querySelector('[data-clock]')!;
    this.timerEl = overlay.querySelector('[data-timer]')!;
    this.undoBtn = overlay.querySelector('[data-undo]')!;
    this.confirmBtn = overlay.querySelector('[data-confirm]')!;
    this.nextBtn = overlay.querySelector('[data-next]')!;
    this.cover = overlay.querySelector('[data-cover]')!;
    this.coverTitle = overlay.querySelector('[data-cover-title]')!;
    this.coverText = overlay.querySelector('[data-cover-text]')!;
    this.coverBtn = overlay.querySelector('[data-cover-btn]')!;
    this.extras = overlay.querySelector('[data-extras]')!;

    this.undoBtn.addEventListener('click', () => this.onUndo());
    this.confirmBtn.addEventListener('click', () => this.onConfirm());
  }

  setStatus(title: string, sub = ''): void {
    this.title.textContent = title;
    this.sub.textContent = sub;
  }

  setScoreboard(state: MatchState): void {
    this.score.textContent = `Home ${state.score.home} – ${state.score.away} Away`;
    this.clock.textContent =
      state.status === 'full-time' ? 'Full time' : `Half ${state.half} · Turn ${state.turn}/${TURNS_PER_HALF}`;
  }

  /** Seconds left to plan, or null to hide. */
  setTimer(seconds: number | null): void {
    this.timerEl.textContent = seconds === null ? '' : `⏱ ${seconds}s`;
    this.timerEl.classList.toggle('urgent', seconds !== null && seconds <= 10);
  }

  /** Show the planning buttons; pass null to hide them. */
  setPlanning(state: { canUndo: boolean; canConfirm: boolean } | null): void {
    this.undoBtn.classList.toggle('hidden', !state);
    this.confirmBtn.classList.toggle('hidden', !state);
    if (state) {
      this.undoBtn.disabled = !state.canUndo;
      this.confirmBtn.disabled = !state.canConfirm;
    } else {
      this.setExtras(null);
    }
  }

  /** Dice and booster controls during planning; pass null to clear. */
  setExtras(spec: ExtrasSpec | null): void {
    this.extras.innerHTML = '';
    if (!spec) return;
    const roll = document.createElement('button');
    roll.textContent = spec.rolled ? '🎲 Rolled' : spec.blocked > 0 ? `🎲 Blocked (${spec.blocked})` : '🎲 Roll (−1 flick)';
    roll.disabled = !spec.canRoll;
    roll.addEventListener('click', () => this.onRoll());
    this.extras.appendChild(roll);
    for (const b of spec.boosters) {
      const btn = document.createElement('button');
      btn.textContent = `${BOOSTER_INFO[b.booster].name}${b.fresh ? ' ✨' : ''}`;
      btn.title = BOOSTER_INFO[b.booster].text;
      btn.disabled = !b.usable;
      btn.classList.toggle('armed', spec.armed === b.booster);
      btn.addEventListener('click', () => this.onBooster(b.booster));
      this.extras.appendChild(btn);
    }
    if (spec.bonus > 0) {
      const el = document.createElement('span');
      el.className = 'bonus';
      el.textContent = `+${Math.round(spec.bonus * 100)}% this turn`;
      this.extras.appendChild(el);
    }
  }

  /** Full-screen cover that hides the pitch until the next player taps the button. */
  showCover(title: string, text: string, button = 'Ready'): Promise<void> {
    this.coverTitle.textContent = title;
    this.coverText.textContent = text;
    this.coverBtn.textContent = button;
    this.cover.classList.remove('hidden');
    return new Promise((resolve) => {
      const done = () => {
        this.coverBtn.removeEventListener('click', done);
        this.cover.classList.add('hidden');
        resolve();
      };
      this.coverBtn.addEventListener('click', done);
    });
  }

  /** Full-screen cover with several choices; resolves with the chosen key. */
  showMenu<K extends string>(title: string, text: string, options: { key: K; label: string }[]): Promise<K> {
    this.coverTitle.textContent = title;
    this.coverText.textContent = text;
    this.coverBtn.classList.add('hidden');
    const list = document.createElement('div');
    list.className = 'menu';
    this.cover.appendChild(list);
    this.cover.classList.remove('hidden');
    return new Promise((resolve) => {
      for (const o of options) {
        const b = document.createElement('button');
        b.className = 'primary';
        b.textContent = o.label;
        b.addEventListener('click', () => {
          list.remove();
          this.coverBtn.classList.remove('hidden');
          this.cover.classList.add('hidden');
          resolve(o.key);
        });
        list.appendChild(b);
      }
    });
  }

  waitNext(label = 'Next turn'): Promise<void> {
    this.nextBtn.textContent = label;
    this.nextBtn.classList.remove('hidden');
    return new Promise((resolve) => {
      const done = () => {
        this.nextBtn.removeEventListener('click', done);
        this.nextBtn.classList.add('hidden');
        resolve();
      };
      this.nextBtn.addEventListener('click', done);
    });
  }

  toast(text: string, big = false): void {
    const el = document.createElement('div');
    el.className = big ? 'toast big' : 'toast';
    el.textContent = text;
    this.overlay.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}
