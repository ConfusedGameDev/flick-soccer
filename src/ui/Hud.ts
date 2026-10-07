import type { MatchState } from '../engine/types';
import { TURNS_PER_HALF } from '../engine/pitch';

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

  onUndo: () => void = () => {};
  onConfirm: () => void = () => {};

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
        <button data-undo>Undo</button>
        <button class="primary" data-confirm>Confirm</button>
        <button class="primary hidden" data-next>Next turn</button>
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
