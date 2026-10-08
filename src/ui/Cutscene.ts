import { hex, type Kit } from '../render/kits';
import { lookFor, spriteCanvas, type Pose } from '../render/sprites';

export type CutsceneKind = 'goal' | 'save' | 'overtake' | 'duel' | 'corner' | 'throw-in';

export interface CutsceneSpec {
  kind: CutsceneKind;
  kit: Kit;
  keeper?: boolean;
  /** Player featured on the card. */
  name: string;
  team: string;
}

const CAPTIONS: Record<CutsceneKind, { title: string; pose: Pose; major: boolean }> = {
  goal: { title: '¡GOOOL!', pose: 'cheer', major: true },
  save: { title: '¡ATAJADA!', pose: 'slide', major: true },
  overtake: { title: '¡ROBO!', pose: 'slide', major: false },
  duel: { title: '¡BALÓN GANADO!', pose: 'cheer', major: false },
  corner: { title: '¡CÓRNER!', pose: 'stand', major: false },
  'throw-in': { title: 'SAQUE DE BANDA', pose: 'stand', major: false },
};

/**
 * Dramatic freeze-frame card in the spirit of 90s anime football: a huge
 * pixel player, speed lines, a slow pan and a shouted caption. Procedural
 * for now; a hand-drawn frame can replace the figure later.
 */
export class Cutscene {
  constructor(private readonly overlay: HTMLElement) {}

  show(spec: CutsceneSpec): Promise<void> {
    const { title, pose, major } = CAPTIONS[spec.kind];
    const duration = major ? 2400 : 1600;
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = `cutscene ${major ? 'major' : 'minor'}`;
      root.style.setProperty('--kit', hex(spec.kit.jersey));
      root.style.setProperty('--kit2', hex(spec.kit.jersey2));
      root.innerHTML = `
        <div class="cs-lines"></div>
        <div class="cs-figure" data-figure></div>
        <div class="cs-text">
          <div class="cs-title">${title}</div>
          <div class="cs-sub">${spec.name} · ${spec.team}</div>
        </div>`;
      const figure = root.querySelector<HTMLElement>('[data-figure]')!;
      const k = Math.max(5, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 64));
      const canvas = spriteCanvas(pose, spec.kit, !!spec.keeper, k, lookFor(spec.name));
      figure.appendChild(canvas);
      this.overlay.appendChild(root);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        root.classList.add('out');
        setTimeout(() => {
          root.remove();
          resolve();
        }, 220);
      };
      root.addEventListener('pointerdown', finish);
      setTimeout(finish, duration);
    });
  }
}
