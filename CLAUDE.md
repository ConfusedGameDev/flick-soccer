# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Docs

`Plan.md` is the original brief. `PRD.md` is the working spec: rules, the three game modes (vs CPU, hot-seat, online) and milestones M0–M8. Where the two disagree, follow `PRD.md`. Current status: **M0 (grey-box prototype) done**; next is M1 (full hot-seat match).

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

- `engine/sim.ts` — `resolveTurn(state, attackPlan, defensePlan, seed): TurnResult`. Takes both hidden plans at once and returns the new state, a list of `keyframes` (positions per fixed `DT` tick) and `events` (`pass`, `receive`, `intercept`, `dead-ball`, `out`, `invalid-flick`, `end`). All randomness goes through `mulberry32(seed)` from `engine/rng.ts`; never use `Math.random` in the engine. Helpers `passTarget`, `slideTarget` and `findReceiver` are exported so the client preview uses the same math as the resolution.
- `engine/pitch.ts` — every tuning constant (ranges, speeds, reach radii, `INTERCEPT_CHANCE`, `MAX_FLICKS`). Units are meters/seconds on a 68×105 pitch; the length runs along **+y** and home attacks toward +y.
- `engine/types.ts` — `Flick { playerId, dir, strength 0..1 }` is the one input primitive; the engine decides whether it is a pass, slide, etc. by who was flicked. `MatchState.players[i].id === i`, and `Keyframe.players` is indexed the same way.
- `game/Match.ts` — the client turn loop as a string-union `Phase` (`PLAN_ATTACK → HANDOFF → PLAN_DEFENSE → RESOLVE → REVIEW`). It asks a `PlanController` per team for a plan, resolves, then plays the result through `render/TimelinePlayer`.
- `game/controller.ts` — `PlanController` interface (`kind: 'local' | 'cpu' | 'remote'`). Only `LocalController` exists; it owns the draft plan, ghost previews and the HUD buttons during planning. New modes are new implementations of this interface, not changes to `Match`.
- `input/FlickGesture.ts` — pointer-event pull-back gesture on the canvas (Angry Birds style: direction is opposite the pull, `MAX_PULL_M` meters = full strength). Uses pointer capture; the gesture does its own hit-testing via `FlickGesture.nearest`.
- `render/` — PixiJS 8. `PitchView` owns the world↔screen mapping (`toScreen`/`toWorld`); everything else draws in screen space using it, so there is no flipped container or scaled text to fight.
- `ui/Hud.ts` — DOM overlay (`#overlay`) for status, buttons, the "pass the device" cover and toasts. UI is HTML, not canvas, as in Claw Island.

## Conventions

Copied from the sibling project `../webClawMachine` (Claw Island), which this project follows for tooling and, at M7, Capacitor/CI: Vite + strict TS, `base: './'`, `touch-action: none` on the body, `localStorage` reads/writes wrapped in try/catch, WebAudio-synthesized sound.
