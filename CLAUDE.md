# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Docs

`Plan.md` is the original brief. `PRD.md` is the working spec: rules, the three game modes (vs CPU, hot-seat, online) and milestones M0–M8. Where the two disagree, follow `PRD.md`. Current status: **M3 (dice and boosters) done**; next is M4 (team building: player pool, stats, draft, formation editor). Live at https://flick-soccer.vercel.app (push to `main` deploys; branches get preview URLs).

## Commands

```
npm run dev          # Vite dev server (add --host to test on a phone over LAN)
npm run build        # tsc --noEmit && vite build
npm run typecheck
npm test             # vitest run (engine tests)
npm run test:watch
npx vitest run src/engine/sim.test.ts -t "intercept"   # single test by name
```

## Architecture

The split that matters: **`src/engine/` is pure TypeScript with no DOM or Pixi imports**. It is the single source of truth for match rules and must stay deterministic, because the CPU opponent (M2) and the online server (M8) will run the same code and compare results. Everything else is the client.

- `engine/sim.ts` — `resolveTurn(state, attackPlan, defensePlan, seed): TurnResult`. Takes both hidden plans at once and returns the new state, a list of `keyframes` (positions per fixed `DT` tick) and `events` (see `TimelineEvent`). All randomness goes through `mulberry32(seed)` from `engine/rng.ts`; never use `Math.random` in the engine. `flickKind()` is the single place that decides what a flick means (pass / shot / run / slide / dive) from who was flicked and where the ball is; `passTarget`, `moveTarget` and `findReceiver` are exported so the client preview uses the same math as the resolution. Restarts (goal reset, corner, throw-in, goal kick) are applied to the returned **state only**, not the keyframes, so the client snaps pieces to `result.state` after playback. A dead ball returns `status: 'duel'`; the client runs the mash and calls `resolveDuel(state, winner)`. Half-time returns `status: 'half-time'`, acknowledged with `continueMatch`.
- `engine/dice.ts` — `rollDice(rng)` (2d6 with doubles rerolls, booster packs on double 3/6, blocks under 4), `kickoffRoll`, and `BOOSTER_INFO` (name, text, which role can use each). Dice results always come from the seeded RNG: a human's trade roll is `rollDice(mulberry32(match.rollSeed(state, team)))` made client-side during planning and carried in `Plan.dice`; the dice overlay is theater that lands on those numbers. Free rolls (overtake, duel win) are rolled inside `resolveTurn`/`resolveDuel` and banked in `MatchState.meta[team].bonus` for that team's next turn. Boosters go in `Plan.booster` and are validated against `meta[team].boosters`.
- `engine/cpu.ts` — the CPU planner, also pure. `cpuExtras` decides its dice trade (~1/3 of the time) and booster use. It samples candidate plans (`sampleAttack` / `sampleDefense`) and scores each by running `resolveTurn` with `{ keyframes: false }` over a few seeds (`scoreTurn` is the single evaluation function). Defense first predicts the opponent's best attacks with the same sampler, then picks the slides/dive that minimise their score. `CPU_PARAMS` holds the per-difficulty sample counts, noise and duel mash rate. A plan costs ~10 ms; keep it that cheap, since M8 may run it server-side. There is a `cpu.batch.test.ts` probe that plays CPU-vs-CPU matches and prints scores: use it as a balance check when touching rules.
- `engine/pitch.ts` — every tuning constant (ranges, speeds, reach radii, the chance constants, `MAX_FLICKS`, `TURNS_PER_HALF`, `PLAN_SECONDS`). Units are meters/seconds on a 68×105 pitch; the length runs along **+y** and home attacks toward +y. Shots are only shots from the attacking third (`inAttackingThird`) and when the flick's ray crosses the goal mouth; otherwise the same flick is a pass.
- `engine/types.ts` — `Flick { playerId, dir, strength 0..1 }` is the one input primitive. `MatchState.players[i].id === i`, and `Keyframe.players` is indexed the same way. `MatchState.status` drives the client's flow between turns.
- `game/Match.ts` — the client loop: a mode `MENU` (hot-seat or vs CPU easy/normal; the human is always Home vs the CPU) then turns as a string-union `Phase` (`PLAN_ATTACK → HANDOFF → PLAN_DEFENSE → RESOLVE → DUEL? → REVIEW`, plus `BREAK`/`OVER`). It asks a `PlanController` per team for a plan, resolves, plays the result through `render/TimelinePlayer`, then reacts to `state.status`. Handoff covers only appear when both sides are local.
- `ui/DiceView.ts` — the dice overlay (flick-to-roll or auto-roll, lands on given values, shows doubles rounds). `ui/Hud.ts#setExtras` renders the roll button, held boosters and the bonus label during planning.
- `ui/Duel.ts` — the dead-ball mash mini-game (whistle, 3-2-1-GO, tug meter, two on-screen pads, `A`/`L` keys). It is client-only; the CPU (M2) and server (M8) will feed `resolveDuel` the same way.
- `game/controller.ts` — `PlanController` interface (`kind: 'local' | 'cpu' | 'remote'`). `CpuController` wraps `engine/cpu.ts` (seeded from the match seed and clock, so a replay thinks the same thoughts). `LocalController` owns the draft plan, ghost previews, the 60 s timer and the HUD buttons during planning. It keeps a `projected` state (ball + carrier after each queued pass) and feeds it to `flickKind`, mirroring the engine's own projection, so what the preview calls a pass/shot/run is what the engine will do. New modes are new implementations of this interface, not changes to `Match`.
- `input/FlickGesture.ts` — pointer-event pull-back gesture on the canvas (Angry Birds style: direction is opposite the pull, `MAX_PULL_M` meters = full strength). Uses pointer capture; the gesture does its own hit-testing via `FlickGesture.nearest`.
- `render/` — PixiJS 8. `PitchView` owns the world↔screen mapping (`toScreen`/`toWorld`); everything else draws in screen space using it, so there is no flipped container or scaled text to fight.
- `ui/Hud.ts` — DOM overlay (`#overlay`) for status, buttons, the "pass the device" cover and toasts. UI is HTML, not canvas, as in Claw Island.

## Conventions

Copied from the sibling project `../webClawMachine` (Claw Island), which this project follows for tooling and, at M7, Capacitor/CI: Vite + strict TS, `base: './'`, `touch-action: none` on the body, `localStorage` reads/writes wrapped in try/catch, WebAudio-synthesized sound.
