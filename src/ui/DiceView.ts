import type { DiceRoll } from '../engine/types';
import { KITS, type Kit } from '../render/kits';
import { spriteCanvas } from '../render/sprites';

const TUMBLE_MS = 900;
/** Fraction of the tumble during which faces still shuffle. */
const SHUFFLE_UNTIL = 0.6;
const PAIR_GAP_MS = 500;
/** Idle face cycling while the dice hover, Mario Party style. */
const SPIN_MS = 90;
/** Ball flight from the player's feet to the dice. */
const SHOT_MS = 320;
/** Ball drop back to the feet after a hit. */
const RETURN_MS = 450;

export interface DiceShow {
  title: string;
  /** Caption under the dice, e.g. "+18% this turn" or "Blocked for 3 turns". */
  caption: string;
  /** Dice values per round; each round is shown in turn (doubles roll again). */
  rounds: number[][];
  /** When true the viewer must shoot the ball at the dice to start; otherwise the shot is automatic. */
  flick: boolean;
  /** Label under the stage while waiting for the shot. */
  hint?: string;
  /** Caption between rounds (doubles or a kickoff tie). */
  again?: string;
  /** Kit of the player taking the shot; the first preset when not given. */
  kit?: Kit;
}

/**
 * Dice overlay in the spirit of Mario Party's dice block: the dice hover and
 * cycle their faces above a player with the ball at their feet. Pull back from
 * the ball and release to shoot it up; the hit sends the dice tumbling and they
 * land on the values the engine already decided. The shot is pure theater.
 */
export class DiceView {
  constructor(
    private readonly overlay: HTMLElement,
    private readonly onRoll?: () => void,
    private readonly onKick?: () => void,
  ) {}

  show(spec: DiceShow): Promise<void> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'dice';
      root.innerHTML = `
        <div class="dice-title">${spec.title}</div>
        <div class="dice-stage" data-stage>
          <div class="dice-tray" data-tray>
            ${spec.rounds[0].map(() => '<div class="die" data-value="1"></div>').join('')}
          </div>
          <div class="dice-shadow"></div>
          <div class="dice-player" data-player></div>
          <div class="dice-ball" data-ball></div>
        </div>
        <div class="dice-hint" data-hint>${spec.flick ? (spec.hint ?? 'Pull back from the ball and release to shoot the dice') : ''}</div>
        <div class="dice-caption" data-caption></div>
        <button class="primary hidden" data-ok>OK</button>`;
      this.overlay.appendChild(root);

      const stage = root.querySelector<HTMLElement>('[data-stage]')!;
      const tray = root.querySelector<HTMLElement>('[data-tray]')!;
      const dice = Array.from(root.querySelectorAll<HTMLElement>('.die'));
      const playerHost = root.querySelector<HTMLElement>('[data-player]')!;
      const ball = root.querySelector<HTMLElement>('[data-ball]')!;
      const hint = root.querySelector<HTMLElement>('[data-hint]')!;
      const caption = root.querySelector<HTMLElement>('[data-caption]')!;
      const ok = root.querySelector<HTMLButtonElement>('[data-ok]')!;

      const kit = spec.kit ?? KITS[0];
      const setPose = (pose: 'stand' | 'kick') => {
        playerHost.innerHTML = '';
        playerHost.appendChild(spriteCanvas(pose, kit, false, 3));
      };
      setPose('stand');

      const setFaces = (values: number[]) => dice.forEach((d, i) => d.setAttribute('data-value', String(values[i] ?? 1)));

      // Hovering dice cycle 1→6 in step, like the block over Mario's head.
      let face = 0;
      const spinner = setInterval(() => {
        face = (face % 6) + 1;
        setFaces(dice.map((_, i) => ((face + i * 2) % 6) + 1));
      }, SPIN_MS);

      const tumble = (values: number[], dx: number) =>
        new Promise<void>((done) => {
          this.onRoll?.();
          root.classList.remove('landed');
          root.classList.add('rolling');
          tray.style.setProperty('--dx', `${dx}px`);
          // Faces shuffle only while the dice are clearly airborne; the real
          // values are locked in before the CSS tumble settles, so the number
          // you see land is the number that counts.
          const t0 = performance.now();
          let locked = false;
          const spin = () => {
            const k = (performance.now() - t0) / TUMBLE_MS;
            if (k >= 1) {
              setFaces(values);
              root.classList.remove('rolling');
              root.classList.add('landed');
              done();
              return;
            }
            if (k < SHUFFLE_UNTIL) {
              setFaces(values.map(() => 1 + Math.floor(Math.random() * 6)));
            } else if (!locked) {
              locked = true;
              setFaces(values);
            }
            setTimeout(spin, 60);
          };
          spin();
        });

      /** Kick the ball up at the dice; resolves on impact. The ball drops back by itself. */
      const shoot = (dx: number) =>
        new Promise<void>((hit) => {
          this.onKick?.();
          setPose('kick');
          const tr = tray.getBoundingClientRect();
          const br = ball.getBoundingClientRect();
          const rise = br.top + br.height / 2 - (tr.top + tr.height * 0.6);
          ball.style.transition = `transform ${SHOT_MS}ms cubic-bezier(0.3, 0.6, 0.6, 1)`;
          ball.style.transform = `translate(${dx * 0.3}px, ${-rise}px) rotate(540deg)`;
          setTimeout(() => {
            hit();
            setPose('stand');
            ball.style.transition = `transform ${RETURN_MS}ms cubic-bezier(0.4, 0, 0.8, 1)`;
            ball.style.transform = 'translate(0, 0) rotate(720deg)';
            setTimeout(() => (ball.style.transform = ''), RETURN_MS);
          }, SHOT_MS);
        });

      const play = async (dx: number) => {
        hint.textContent = '';
        root.classList.add('armed');
        for (let i = 0; i < spec.rounds.length; i++) {
          if (i > 0) {
            caption.textContent = spec.again ?? 'Doubles! Roll again…';
            await new Promise((r) => setTimeout(r, PAIR_GAP_MS + RETURN_MS));
          }
          await shoot(i === 0 ? dx : dx * 0.5);
          if (i === 0) clearInterval(spinner);
          await tumble(spec.rounds[i], i === 0 ? dx : dx * 0.5);
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
        setTimeout(() => void play(8), 500);
        return;
      }

      // Pull-back shot: drag anywhere on the stage, the ball follows a little, release to shoot.
      let pointerId: number | null = null;
      let start = { x: 0, y: 0 };
      const down = (e: PointerEvent) => {
        if (pointerId !== null) return;
        pointerId = e.pointerId;
        start = { x: e.clientX, y: e.clientY };
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        e.preventDefault();
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        ball.style.transition = 'none';
        ball.style.transform = `translate(${(e.clientX - start.x) * 0.35}px, ${Math.max(0, e.clientY - start.y) * 0.35}px)`;
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        const dx = start.x - e.clientX;
        const dy = start.y - e.clientY;
        if (Math.hypot(dx, dy) < 12) {
          ball.style.transform = '';
          return;
        }
        stage.removeEventListener('pointerdown', down);
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        // The ball always reaches the dice; the pull only bends the shot sideways a little.
        void play(Math.max(-40, Math.min(40, dx * 0.4)));
      };
      stage.addEventListener('pointerdown', down);
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
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
