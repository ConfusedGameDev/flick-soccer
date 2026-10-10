import type { Booster, Coin, Team } from './types';

export const MAX_BOOSTERS = 2;
/** Cards shown when a pack is opened; one of them holds the drawn booster. */
export const PACK_CARDS = 3;

export const BOOSTERS: Booster[] = ['longer-slide', 'double-speed', 'extra-flick', 'unstoppable-pass', 'super-keeper'];

export const BOOSTER_INFO: Record<Booster, { name: string; text: string; roles: ('attack' | 'defense')[] }> = {
  'longer-slide': { name: 'Longer slide', text: 'Tackles and dives reach 1.5× as far this turn', roles: ['defense'] },
  'double-speed': { name: 'Double speed', text: 'Your players move twice as fast this turn', roles: ['attack', 'defense'] },
  'extra-flick': { name: 'Extra flick', text: '+1 flick this turn', roles: ['attack', 'defense'] },
  'unstoppable-pass': { name: 'Unstoppable pass', text: 'Your first pass cannot be intercepted', roles: ['attack'] },
  'super-keeper': { name: 'Super goalkeeper', text: 'Keeper reach ×2 and +25% save chance this turn', roles: ['defense'] },
};

/** The one random booster inside a pack. */
export const drawBooster = (rng: () => number): Booster => BOOSTERS[Math.floor(rng() * BOOSTERS.length)];

/** The boosters shown on the two cards that were not picked: the next two in the list. Display only. */
export function decoysFor(booster: Booster): [Booster, Booster] {
  const i = BOOSTERS.indexOf(booster);
  return [BOOSTERS[(i + 1) % BOOSTERS.length], BOOSTERS[(i + 2) % BOOSTERS.length]];
}

/** Kickoff: the coin lands on the face the seed decides. */
export const flipCoin = (rng: () => number): Coin => (rng() < 0.5 ? 'heads' : 'tails');

/** The caller attacks first when the coin shows what they called; otherwise the other side does. */
export const tossWinner = (coin: Coin, call: Coin, caller: Team): Team => (coin === call ? caller : caller === 'home' ? 'away' : 'home');
