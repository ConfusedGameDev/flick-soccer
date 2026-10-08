import { BOOSTER_INFO } from '../engine/dice';
import type { Booster, MatchState, PlayerStats, Team } from '../engine/types';
import { TURNS_PER_HALF } from '../engine/pitch';
import { hex, type Kit } from '../render/kits';

const STAT_LABELS: [keyof PlayerStats, string][] = [
  ['pass', 'PAS'],
  ['shot', 'SHT'],
  ['speed', 'SPD'],
  ['tackle', 'TKL'],
  ['keeping', 'GK'],
];

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
  /** Both elevens, shown on the pane screen of a dual-screen device (CSS hides it otherwise). */
  private readonly lineup: HTMLElement;
  private kits: Partial<Record<Team, Kit>> = {};

  onUndo: () => void = () => {};
  onConfirm: () => void = () => {};
  onRoll: () => void = () => {};
  onBooster: (b: Booster) => void = () => {};
  onMute: () => void = () => {};

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
        <button class="mute" data-mute title="Sound">🔊</button>
      </div>
      <div class="lineup" data-lineup></div>
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
    this.lineup = overlay.querySelector('[data-lineup]')!;

    this.undoBtn.addEventListener('click', () => this.onUndo());
    this.confirmBtn.addEventListener('click', () => this.onConfirm());
    overlay.querySelector('[data-mute]')!.addEventListener('click', () => this.onMute());
  }

  setMuted(muted: boolean): void {
    this.overlay.querySelector('[data-mute]')!.textContent = muted ? '🔇' : '🔊';
  }

  setStatus(title: string, sub = ''): void {
    this.title.textContent = title;
    this.sub.textContent = sub;
  }

  setScoreboard(state: MatchState): void {
    const chip = (team: Team) => {
      const kit = this.kits[team];
      return `<i style="background:${kit ? hex(kit.jersey) : 'rgba(255,255,255,0.3)'}"></i>`;
    };
    this.score.innerHTML = `${chip('home')}<span>HOM</span><b>${state.score.home}</b><em>–</em><b>${state.score.away}</b><span>AWY</span>${chip('away')}`;
    this.clock.textContent =
      state.status === 'full-time' ? 'Full time' : `Half ${state.half} · Turn ${state.turn}/${TURNS_PER_HALF}`;
    this.renderLineup(state);
  }

  /** Kit colours for the lineup headers. */
  setKits(kits: Partial<Record<Team, Kit>>): void {
    this.kits = { ...kits };
  }

  private renderLineup(state: MatchState): void {
    const carrier = state.possession.playerId;
    const parts: string[] = [];
    for (const team of ['home', 'away'] as const) {
      const kit = this.kits[team];
      const swatch = kit ? `<i style="background:${hex(kit.jersey)}"></i>` : '<i></i>';
      const tag = state.possession.team === team ? ' · in possession' : '';
      parts.push(`<div class="lineup-head">${swatch}<b>${team === 'home' ? 'Home' : 'Away'}</b><span>${tag}</span></div>`);
      for (const p of state.players) {
        if (p.team !== team) continue;
        const stats = STAT_LABELS.map(([k, l]) => `<i title="${l}">${l}<b>${p.stats[k]}</b></i>`).join('');
        parts.push(`<div class="draft-row lineup-row${p.id === carrier ? ' picked' : ''}">
          <span class="pos${p.keeper ? ' GK' : ''}">${p.number}</span>
          <span class="who"><b>${p.name}</b><small>${p.keeper ? 'Keeper' : p.id === carrier ? 'On the ball' : ''}</small></span>
          <span class="stats">${stats}</span></div>`);
      }
    }
    this.lineup.innerHTML = parts.join('');
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

  /** Generic buttons in the bottom-left slot (formation presets etc.). */
  setToolbar(items: { label: string; active?: boolean; onClick: () => void }[]): void {
    this.extras.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.classList.toggle('armed', !!it.active);
      b.addEventListener('click', it.onClick);
      this.extras.appendChild(b);
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
  showMenu<K extends string>(title: string, text: string, options: { key: K; label: string; icon?: HTMLElement }[]): Promise<K> {
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
        if (o.icon) {
          b.classList.add('with-kit');
          b.appendChild(o.icon);
          b.appendChild(document.createTextNode(o.label));
        } else {
          b.textContent = o.label;
        }
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

  /** Dismiss a cover that something else resolved (e.g. the opponent arrived). */
  hideCover(): void {
    this.cover.classList.add('hidden');
    this.cover.querySelector('.menu')?.remove();
    this.cover.querySelector('.prompt')?.remove();
    this.coverBtn.classList.remove('hidden');
  }

  /** Cover with a text field; resolves with the text, or null on cancel. */
  prompt(title: string, text: string, placeholder = ''): Promise<string | null> {
    this.coverTitle.textContent = title;
    this.coverText.textContent = text;
    this.coverBtn.classList.add('hidden');
    const box = document.createElement('div');
    box.className = 'prompt';
    box.innerHTML = `
      <input class="prompt-input" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="${placeholder}" />
      <div class="menu-row">
        <button data-cancel>Cancel</button>
        <button class="primary" data-ok>Join</button>
      </div>`;
    this.cover.appendChild(box);
    this.cover.classList.remove('hidden');
    const input = box.querySelector<HTMLInputElement>('input')!;
    setTimeout(() => input.focus(), 50);
    return new Promise((resolve) => {
      const done = (value: string | null) => {
        box.remove();
        this.coverBtn.classList.remove('hidden');
        this.cover.classList.add('hidden');
        resolve(value);
      };
      box.querySelector('[data-cancel]')!.addEventListener('click', () => done(null));
      box.querySelector('[data-ok]')!.addEventListener('click', () => done(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(input.value);
      });
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
