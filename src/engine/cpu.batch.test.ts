import { describe, expect, it } from 'vitest';
import { planAttack, planDefense } from './cpu';
import { other } from './pitch';
import { initialMatch } from './setup';
import { continueMatch, resolveDuel, resolveTurn } from './sim';

// Balance probe: play CPU vs CPU matches headless and print the scores.
// Run it on its own (`npx vitest run src/engine/cpu.batch.test.ts`) after
// touching rules or the planner, and eyeball that goals still happen.
describe('cpu vs cpu', () => {
  it('finishes matches and scores sometimes', { timeout: 60_000 }, () => {
    const results: string[] = [];
    let plans = 0;
    const t0 = performance.now();
    for (let m = 0; m < 4; m++) {
      let s = initialMatch();
      let turn = 0;
      while (s.status !== 'full-time' && turn < 40) {
        turn++;
        const seed = m * 1000 + turn;
        const att = s.possession.team;
        const a = planAttack(s, att, 'normal', seed);
        const d = planDefense(s, other(att), 'normal', seed + 7);
        plans += 2;
        s = resolveTurn(s, a, d, seed, { keyframes: false }).state;
        if (s.status === 'duel') s = resolveDuel(s, seed % 2 ? 'home' : 'away');
        if (s.status === 'half-time') s = continueMatch(s);
      }
      results.push(`${s.score.home}-${s.score.away} (${turn} turns)`);
      expect(s.status).toBe('full-time');
    }
    const ms = performance.now() - t0;
    console.log(`scores: ${results.join(', ')} | ${(ms / plans).toFixed(0)} ms per plan`);
  });
});
