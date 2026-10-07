import type { Booster, DiceRoll, Team } from './types';

export const DICE_BONUS_PER_PIP = 0.02;
export const MAX_DICE_BONUS = 0.3;
export const DICE_BLOCK_TURNS = 3;
export const MAX_BOOSTERS = 2;
/** Safety cap on doubles rerolls in one trade. */
const MAX_REROLLS = 5;

export const BOOSTERS: Booster[] = ['longer-slide', 'double-speed', 'extra-flick', 'unstoppable-pass', 'super-keeper'];

export const BOOSTER_INFO: Record<Booster, { name: string; text: string; roles: ('attack' | 'defense')[] }> = {
  'longer-slide': { name: 'Longer slide', text: 'Tackles and dives reach 1.5× as far this turn', roles: ['defense'] },
  'double-speed': { name: 'Double speed', text: 'Your players move twice as fast this turn', roles: ['attack', 'defense'] },
  'extra-flick': { name: 'Extra flick', text: '+1 flick this turn', roles: ['attack', 'defense'] },
  'unstoppable-pass': { name: 'Unstoppable pass', text: 'Your first pass cannot be intercepted', roles: ['attack'] },
  'super-keeper': { name: 'Super goalkeeper', text: 'Keeper reach ×2 and +25% save chance this turn', roles: ['defense'] },
};

export const diceBonus = (sum: number): number => Math.min(MAX_DICE_BONUS, sum * DICE_BONUS_PER_PIP);

const d6 = (rng: () => number): number => 1 + Math.floor(rng() * 6);

/**
 * Roll 2d6 by the house rules: doubles roll again (sums add up), double 3 or
 * double 6 also give a booster pack, and a pair below 4 (1+1 or 1+2) gives
 * nothing and blocks the dice. Double 1 is a block, not a reroll.
 */
export function rollDice(rng: () => number): DiceRoll {
  const pairs: [number, number][] = [];
  let sum = 0;
  let booster: Booster | null = null;
  let blocked = false;
  for (let i = 0; i <= MAX_REROLLS; i++) {
    const a = d6(rng);
    const b = d6(rng);
    pairs.push([a, b]);
    if (a + b < 4) {
      blocked = true;
      break;
    }
    sum += a + b;
    if (a === b && (a === 3 || a === 6)) booster = BOOSTERS[Math.floor(rng() * BOOSTERS.length)];
    if (a !== b) break;
  }
  return { pairs, sum, bonus: diceBonus(sum), booster, blocked };
}

/** Kickoff: one die each, higher attacks first, ties roll again. */
export function kickoffRoll(rng: () => number): { rounds: [number, number][]; winner: Team } {
  const rounds: [number, number][] = [];
  for (;;) {
    const home = d6(rng);
    const away = d6(rng);
    rounds.push([home, away]);
    if (home !== away) return { rounds, winner: home > away ? 'home' : 'away' };
  }
}
