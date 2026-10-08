import { MAX_FLICKS } from '../engine/pitch';
import type { Coach } from '../ui/Coach';
import type { DraftInfo, LocalController } from './controller';

/** Points in the match loop where the tutorial may speak. `Match` awaits each one. */
export type Beat = 'kickoff' | 'attack' | 'defense' | 'resolve' | 'resolved' | 'duel' | 'review';

const KEY = 'flicksoccer.tutorial';
/** Turns the coach stays for before offering to leave. */
const TURNS = 3;

export function tutorialState(): 'new' | 'offered' | 'done' {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'done' || v === 'offered' ? v : 'new';
  } catch {
    return 'done';
  }
}

export function setTutorialState(v: 'offered' | 'done'): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* no storage */
  }
}

/**
 * The first-time tutorial: a scripted coach that follows a normal match
 * against the easy CPU. It explains each phase the first time it comes up,
 * reacts to the player's flicks while they plan, and bows out after a few
 * turns. Rules stay in the engine; this only talks.
 */
export class Tutor {
  private attacks = 0;
  private defenses = 0;
  private reviews = 0;
  private diceExplained = false;
  private boosterExplained = false;
  private duelExplained = false;
  private retired = false;

  constructor(
    private readonly coach: Coach,
    private readonly local: LocalController,
  ) {
    local.onDraft = (info) => this.onDraft(info);
    local.timed = false;
  }

  /** Returns 'quit' when the player chose to leave the match. */
  async beat(b: Beat): Promise<'continue' | 'quit'> {
    if (this.retired) return 'continue';
    const { coach } = this;
    switch (b) {
      case 'kickoff':
        await coach.say(
          'Welcome, coach!',
          'This is a game of <b>hidden plans</b>: both sides plan at once, then the turn plays out. First, the kickoff roll. <b>Pull back from the ball and release</b> to shoot it at the die. The higher roll attacks first.',
          'Roll it',
        );
        return 'continue';
      case 'attack':
        if (this.attacks++ === 0) {
          await coach.say(
            'You attack',
            `You get <b>${MAX_FLICKS.attack} flicks</b>. Pull back from the <b>glowing player</b> (the ball carrier) and release to pass; the pull sets the distance. A ghost shows the path and the nearest teammate to the landing spot receives it. Short pulls stay on the ground; long pulls loft the ball.`,
            'Let me try',
          );
          coach.tip('Make a pass', 'Pull back from the carrier and let go.');
        } else if (!this.diceExplained) {
          this.diceExplained = true;
          await coach.say(
            'Trade a flick for luck',
            'The <b>🎲 Roll</b> button gives up one flick to roll 2d6: <b>+2% odds per point</b> this turn, up to +30%. Doubles roll again. Double 3 or 6 adds a <b>booster pack</b>. A total under 4 blocks your dice for three turns.',
          );
          coach.tip('Your call', 'Roll when the extra odds beat the lost flick. Then plan and confirm.');
        } else {
          coach.hide();
        }
        return 'continue';
      case 'defense':
        if (this.defenses++ === 0) {
          await coach.say(
            'You defend',
            `The CPU is planning a pass chain you cannot see. You get <b>${MAX_FLICKS.defense} flicks</b>: pull back from a <b>defender</b> to slide across where you think the ball will go, or from the <b>keeper</b> to dive. A pass that comes within reach of your player risks an interception, decided by distance and Tackle against Pass.`,
            'Set a trap',
          );
          coach.tip('Guess the pass', 'Slide a defender into the likely lane, then confirm.');
        } else if (!this.diceExplained) {
          this.diceExplained = true;
          await coach.say(
            'Trade a flick for luck',
            'The <b>🎲 Roll</b> button gives up one flick to roll 2d6: <b>+2% odds per point</b> this turn, up to +30%. Doubles roll again. Double 3 or 6 adds a <b>booster pack</b>. A total under 4 blocks your dice for three turns.',
          );
          coach.tip('Your call', 'Roll when the extra odds beat the lost flick. Then plan and confirm.');
        } else {
          coach.hide();
        }
        return 'continue';
      case 'resolve':
        coach.hide();
        return 'continue';
      case 'resolved':
        if (this.reviews === 0) {
          await coach.say(
            'Both plans played out',
            'Passes near a defender roll for an <b>interception</b>; a shot on target rolls Keeping against Shot. An interception <b>swaps the roles</b> for the next turn and gives the new attacker a free dice roll. The attacker keeps the ball otherwise.',
          );
        }
        return 'continue';
      case 'duel':
        if (!this.duelExplained) {
          this.duelExplained = true;
          await coach.say(
            'Dead ball!',
            'The ball stopped with nobody there. After the whistle and the countdown, <b>mash your pad</b> (or the A key) to pull the tug-of-war meter your way. The winner takes the ball and a free roll.',
            'Ready',
          );
        }
        return 'continue';
      case 'review':
        this.reviews++;
        if (this.reviews < TURNS) return 'continue';
        this.retire();
        setTutorialState('done');
        const pick = await coach.ask("That's the game", 'Two halves of eight turns; most goals win. The coach leaves you to it. Everything you saw is in the menu as <b>How to play</b> if you want it again.', [
          { key: 'quit', label: 'Back to menu' },
          { key: 'play', label: 'Keep playing' },
        ]);
        coach.hide();
        return pick === 'quit' ? 'quit' : 'continue';
    }
  }

  /** Reacts while the player drags flicks onto the pitch during planning. */
  private onDraft(info: DraftInfo | null): void {
    if (this.retired || !info) return;
    const first = info.role === 'attack' ? this.attacks === 1 : this.defenses === 1;
    if (info.boosters > 0 && !this.boosterExplained) {
      this.boosterExplained = true;
      this.coach.tip('You hold a booster', 'Tap it under the pitch to arm it for this turn: a longer slide, double speed, an extra flick, an unstoppable pass or a super keeper. You can hold two.');
      return;
    }
    if (!first) return;
    if (info.used === 0) {
      if (info.role === 'attack') this.coach.tip('Make a pass', 'Pull back from the carrier and let go.');
      else this.coach.tip('Guess the pass', 'Slide a defender into the likely lane, then confirm.');
    } else if (info.dead) {
      this.coach.tip('No receiver', 'That pass lands with no teammate near it: a <b>dead ball</b>, settled by a button-mash duel. <b>Undo</b> and pull a little longer, or flick a teammate to run there first.');
    } else if (info.left === 0) {
      this.coach.tip('Out of flicks', 'Tap <b>Confirm</b> to lock the plan in. Undo takes the last flick back.');
    } else if (info.used > 0 && info.role === 'attack') {
      this.coach.tip('Chain it', `Keep passing from the receiver, flick a teammate without the ball to <b>run</b> into space, or aim at the goal from the attacking third to <b>shoot</b>. ${info.left} left; confirm any time.`);
    } else if (info.used > 0) {
      this.coach.tip('One more', `${info.left} flick left: cover another lane, or dive the keeper. Confirm any time.`);
    }
  }

  retire(): void {
    this.retired = true;
    this.local.onDraft = null;
    this.local.timed = true;
    this.coach.hide();
  }
}
