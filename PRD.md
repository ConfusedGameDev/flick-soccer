# Flick Soccer: PRD (proof of concept)

Last updated: 2026-10-07. Source brief: `Plan.md`.

Items marked **(proposed)** are defaults filled in to make the design complete. They are open to change. Unmarked items come from `Plan.md` or decisions already made.

## 1. Vision

A turn-based soccer strategy game. In each turn both players plan at the same time without seeing each other's moves. The attacker draws a chain of passes with Angry Birds-style flicks, and the defender tries to guess where to cut it off. A coin toss, booster packs and a draft with a points budget add luck and build variety in the spirit of Balatro. The look comes from SNES *International Superstar Soccer Deluxe*, and dramatic moments get Captain Tsubasa-style anime cutscenes. The game launches on web first, then on mobile using the same pipeline as Claw Island.

## 2. Game modes

All three modes run on one shared match engine. The only difference between them is where each side's plan comes from.

| Mode | Plan source | Hiding the plans |
|---|---|---|
| **vs CPU** | Human + AI | AI plans with no access to the human's plan |
| **Same-device (hot-seat)** | Two humans on one screen | P1 plans, then a "pass the device" cover screen appears, P2 plans, then the turn resolves |
| **Online 1v1** | Two humans on separate devices | The server collects both plans and resolves the turn |

**Tutorial:** on first launch the menu offers a guided match against the easy CPU. A coach card explains the coin toss, attacking, defending, the resolution, the booster packs, and the dispute ball as each comes up, reacting to the player's own flicks, and leaves after three turns. It stays in the menu as "How to play".

## 3. Match rules

### 3.1 Match flow
1. **Draft:** each player picks a team (§5).
2. **Formation:** each player places their 11 players anywhere on the pitch. Kickoff shapes span the full field (forwards start deep in the opponent's half) so a pass chain can progress toward the far goal.
3. **Coin toss:** one side calls heads or tails (§4.1); a right call attacks first. The ball starts with the attacker's goalkeeper.
4. **Turns** repeat until the match ends.
5. **Length (proposed):** 2 halves of 8 turns each. The second half starts with the side that defended first now attacking. A draw is a valid result in the PoC.

### 3.2 A turn
1. **Planning:** both players plan at the same time. The phase ends when both confirm or 60 s pass, and on timeout whatever has been planned so far is submitted. In hot-seat mode each player gets their own 60 s. Undo takes back the last flick, except one a mini-game produced: a shot, a corner or a throw-in is final once taken.
2. **Resolution:** the engine runs both plans at once and produces a timeline of events.
3. **Cutscene** if a dramatic event happened (§6.3).
4. **Next turn.** The attacker keeps possession from turn to turn until an overtake, a goal or the ball going out of play **(proposed)**.

### 3.3 Attacker: 3 flicks per turn
- **Pass:** pull back from the ball carrier and release. Pull length sets the distance. In the plan, a ghost ball shows the path, and the receiver is the nearest teammate to the landing point. The next flick is made from that receiver.
  - **Short pass** (short pull) **(proposed):** travels along the ground and can be intercepted anywhere along its line. It is more accurate.
  - **Long pass** (long pull) **(proposed):** lofted, so it can only be intercepted near where it lands. It scatters a little around the target.
- **Shot:** a flick toward goal. It is allowed only from the attacking third **(proposed)**.
- **Run (proposed):** flick a teammate who doesn't have the ball to move them into space. It uses up one flick. No movement flick (run, slide or dive) may end on another player, of either team, or where a team-mate is already being sent this turn: the preview shows the ghost in red and refuses the flick, and the engine ignores such a move if one arrives anyway.

### 3.4 Defender: 2 flicks per turn
- **Tackle:** flick an outfield player toward where you expect the pass to go. They slide along that line, and pull length sets the slide distance.
- **Goalkeeper dive:** flick the goalkeeper to cover a shot.

### 3.5 Resolution and interception (proposed)
- The ball moves along the attacker's chain at a fixed speed. Defender movements start at t=0 and run alongside it.
- When the ball passes within a defender's reach (ground pass) or lands within it (lofted pass), the engine rolls an **interception check**. The odds depend on how close the defender is, the defender's Tackle, the passer's Pass, and any booster in play (§4.3). All rolls use a seeded RNG.
- **Shot vs goalkeeper:** if the goalkeeper covers the shot's line at the goal, the engine rolls a save check using Keeping against Shot.
- **Overtake:** the ball passes to the defender, the two sides swap roles next turn, and the new attacker gets a free booster pack (§4.2).

### 3.6 Restarts (proposed)
| Event | Restart |
|---|---|
| Ball crosses the sideline | Throw-in to the other team |
| Attacker puts it over the goal line they attack | Goal kick: ball goes to the defending goalkeeper |
| A side puts it over its own goal line (e.g. the keeper clears it behind himself), or a save deflects it out | Corner to the other side |
| Goal | The team that conceded restarts from its goalkeeper |

There are no offside or fouls in the PoC.

### 3.7 Dispute ball (button-mash tug of war)
- **When:** a pass stops in open field with no teammate close enough to receive it, and nobody intercepted it, so it becomes a dead ball. Any flicks the attacker still had planned for that turn are cancelled.
- **Sequence:**
  1. The referee whistles.
  2. A "3, 2, 1, GO!" countdown plays.
  3. Both players mash their button, and every press pulls a tug-of-war meter toward their side.
- **Winning:** the first player to pull the meter all the way to their end wins. If neither does within the time limit (5 s **(proposed)**), whoever is ahead wins. A press before "GO" doesn't count.
- **Result:** the winner becomes the attacker next turn, and their nearest player gets the ball at the spot where it stopped. Like an overtake, winning plays a cutscene and gives the winner a free booster pack (§4.2).
- **By mode:**

| Mode | How it works |
|---|---|
| Same-device | Two big buttons, one on each side of the screen, with multi-touch so both players can press at once. Keyboard fallback for desktop (`A` for the left player, `L` for the right) **(proposed)**. |
| vs CPU | The CPU presses at a rate set by difficulty, with some random variation. |
| Online | Each client sends its press counts to the server, which decides the winner. Presses are capped at about 15 per second to block auto-clickers **(proposed)**. |

## 4. Coin toss and booster packs

The dice of earlier drafts are gone: there is no success bonus and no blocked turns. Luck enters the match only through the toss and the cards.

### 4.1 Coin toss
Before kickoff one side calls heads or tails, the coin spins and lands on the face the seeded engine decided, and the caller attacks first if the call was right. The caller is the side a human controls: against the CPU the human (always Home) calls; in hot-seat and online the Away side calls, as the visitors do in football. Online the server owns the toss: it asks the caller, calls heads for them after 20 s, and tells both clients the result.

### 4.2 Trading a flick for a pack
During planning a side can give up one flick to open a booster pack: three face-down cards hover above one of your players, you tap one, and it turns over to show a booster. The engine draws the booster from the shared seed before the cards appear, so whichever card you tap holds it; the other two then show what you did not get. The pack is only offered while your hand has room.

- The booster goes into your hand at once and can be armed in the same turn.
- The free pack after an overtake or a dispute-ball win is opened the same way (the CPU's and a remote opponent's cards turn by themselves). A full hand gets nothing.
- Online the server redraws the card from the same seed, so a client cannot claim a booster it did not draw.

### 4.3 Boosters
A booster pack contains one random booster. A player can hold at most 2 boosters and use one per turn during planning.

| Booster | Effect (proposed numbers) |
|---|---|
| Longer slide | The next tackle or dive reaches 1.5× as far |
| Double speed | Your players move at 2× speed this turn |
| Extra flick | +1 flick this turn |
| Unstoppable pass | One pass this turn cannot be intercepted (passes only, not shots) |
| Super goalkeeper | Goalkeeper reach ×2 and +25% save chance this turn |

Unstoppable pass and super goalkeeper never conflict, because one affects passes and the other affects shots.

## 5. Teams

- **Player pool:** 260 players: for each of five leagues (Mexico, England, Italy, Spain, Germany) the 26 best of today, as of the start of the 2026–27 season, and the 26 all-time greats before the modern era (Di Stéfano, Baggio, Charlton, Beckenbauer, Hugo Sánchez…), each with the club they are most associated with. They ship under fake names that are close enough to be recognisable ("Erling Holland"); the real-to-fake map is `docs/player-names.csv` (also as `docs/player-names.xlsx`), from which the JSON is generated. The draft opens with a league menu and then shows that league's pool, with era and position filters.
- **Stats (proposed):** Pass, Shot, Speed, Tackle and Keeping, each rated 1–5. Cost is derived from the stats.
- **Draft (proposed):** a budget of 100 points to buy exactly 11 players, at least one of whom is a goalkeeper. Both teams draft from the full pool on their own, so the two teams can share players.
- **Formation:** picked and arranged on the same screen as the draft. Each pick lands on the next free slot of the chosen preset (4-4-2, 4-3-3, 5-3-2); drag players anywhere on the pitch or tap two to swap while you keep picking.
- **Kits:** six club-inspired presets (Madrid, Barcelona, Milan, Paris, Dortmund, Manchester United: colours only, no crests or names), plus custom kits (§6.4).
- The player pool lives in a data file (JSON) so it can be edited without touching code.

## 6. Presentation

### 6.1 Art
An SNES look in the style of *ISS Deluxe*: pixel-art sprites on an angled pitch. The simulation runs in flat top-down 2D, and only the rendering adds the pseudo-3D angle. Pitch players are generated 48×48 frames in eight directions (`art/frames`, imported into material templates so kits and looks recolour them); the typed 16×24 templates remain behind `?sprites=classic` and for the poses not generated yet.

### 6.2 Input
Touch-first. The pull-back-and-release gesture must feel right on a phone browser from M0, and the same gesture works with a mouse. With two fingers, the first finger's pull sets only the power and the second finger points where the flick goes; lifting the second finger returns to one-finger aiming, lifting the first releases the flick.

### 6.3 Cutscenes
- **Triggers:** overtake, dispute-ball win, goal, goalkeeper save, corner, throw-in.
- **Style:** still frames with a slow pan, in the look of the *ISS Deluxe* cutscenes: large shaded pixel figures with a dark outline on a black stage with a strip of grass.
- **Scope:** one composed scene per event type, with the featured player and, where it helps, the other side's figure (the beaten keeper, the shooter, the robbed passer). The figures are procedural (jointed rigs rasterised at runtime and recoloured to the kits, `render/rig.ts`), so no art files ship and painted kits work on them too.

### 6.4 Uniform editor
- A pixel painter for shirts and shorts in the style of Animal Crossing's pattern designer.
- A 16×16 grid and a 15-colour palette (M6 decision: the in-game sprite's shirt is only 10 pixels wide, so 32×32 would be wasted detail and fiddly on a phone), with pencil, fill, mirror mode, and shorts/socks colours. Keeper colours are derived to contrast with the shirt.
- Kits are saved locally. In an online match, your kit is sent to your opponent.

## 7. Technical direction

- **Stack:** Vite + TypeScript for web and Capacitor for iOS/Android, plus GitHub Actions CI. This copies `../webClawMachine`.
- **Engine module:** pure TypeScript with no DOM or rendering. It takes `(match state, plan A, plan B, seed)` and returns a new state plus an event timeline. The client and the server run the same code.
- **Controllers:** one interface with three implementations (local human, CPU, remote). This keeps the game modes separate from the engine.
- **Seeded RNG** for every chance roll, so any turn can be replayed and tested exactly.
- **Online (proposed):** the server decides every result.
  - Clients send their plans.
  - The server resolves the turn and broadcasts the timeline.
  - Clients animate the timeline.
  - Matches are joined with a room code; there are no accounts in the PoC.
  - A player who disconnects can rejoin within the turn timer.
- **Renderer:** PixiJS 8 (decided at M0). Server stack **(proposed):** Node with WebSockets (possibly Colyseus), to be decided at M8.
- **Tests:** vitest on the engine; determinism is a tested invariant.
- **M8 decisions:** Node + `ws` on Fly.io (one always-on machine; rooms in memory), room codes only, no accounts. The server is the authority for the seed, the toss, the packs, turn resolution and the duel; clients only submit plans and presses. Planning stays simultaneous and hidden: both sides get `turn` at once and the server resolves when both plans arrive or the 60 s (+5 s grace) timer fires. A disconnected player can resume with the room token; the opponent is told if someone leaves. Kits are exchanged as plain JSON at join (painted kits included).
- **M7 decisions:** Capacitor 8 with the Claw Island pipeline (port-app skill): push to `main` builds signed iOS and Android; TestFlight and Play internal uploads turn on once the store records exist. The web checklist (relative base, bundled fonts, safe areas, audio on first gesture, touch controls, DPR ≤ 2) was already met by the web build; only the native status-bar style was added.
- **M6 decisions:** a painted kit is just a `Kit` with a 16×16 design, so it flows through sprites, cutscenes and the picker unchanged; it is stored locally and is plain JSON for online exchange.
- **M5 decisions:** all art is procedural placeholders behind a stable API: runtime-painted pixel sprites recoloured per kit, procedural stands and nets, CSS/DOM cutscene cards with rasterised rig figures instead of hand-drawn frames (the same figures take the shot mini-game), WebAudio-synthesized sound. The view stays flat top-down (no pseudo-3D angle) so the flick geometry is exact. Kits are "inspired by" 1990 colours with no crests; each side picks one before the match (the CPU takes a different one).
- **M4 decisions:** stats enter the engine only as range/speed factors (±8%/point) and odds shifts (±5 pts/point) around a baseline of 3; the pass stat resists interception, shot resists blocks and saves, tackle and keeping improve them, speed moves everything faster, keeping extends the keeper's reach. Prices are role-weighted (a striker's shot counts, his tackling doesn't) on a convex 3–15 curve. The CPU drafts with a deterministic greedy picker. Formations are edited in the home frame and mirrored for Away. The draft is optional ("Quick match" uses baseline squads).
- **M3 decisions:** the coin and the card inside a pack come from the seeded engine RNG; the toss and the three cards only land on them (so replays and the server agree). The dice, their odds bonus and the blocked turns were dropped in favour of packs. A hand holds 2; a pack opened this turn can be used the same turn and is refused when the hand is full. Unstoppable pass applies to the first pass of the chain. Both an overtake and a duel win hand the winner a free pack when there is room.
- **M2 decisions:** the CPU is a sampler + the real engine as evaluator (no hand-written tactics). Easy = fewer samples plus aiming noise and a slower mash; Normal = more samples, no noise. The human always plays Home against the CPU.
- **Set-piece decisions (M12):** shots, corners and throw-ins are taken in a behind-the-kicker scene with a timing game. A shot starts from the **Shoot** button (live when the carrier is in the attacking third and in range), never from a drag: the swinging arrow picks the line across the goal (beyond the posts is wide), a rising arrow picks the height (above the bar is over; higher is harder to save), and a timing bar with a randomly placed block gives 0–100 % accuracy. Corners and throw-ins get the arrow and the bar; their distance is fixed by the engine. Accuracy only scatters the ball (direction, and a shot's height); odds stay stat-based. The result travels inside the plan like a dice trade, so the CPU draws its own (by difficulty) and the server clamps a client's claim, which is trusted like mash presses. The planning clock keeps running; at the deadline an unfinished shot is dropped and an unfinished restart goes straight ahead with accuracy 0.
- **M1 decisions:** a flick from the carrier is a shot only from the attacking third *and* when its ray crosses the goal mouth, otherwise it is a pass *(superseded by the set-piece decisions: shots are explicit and may go wide)*. Outfield players can block shots (50%) and keepers save (65%, reach 3.5 m); a save is held 50% of the time, otherwise it's a corner. Runs are flicks on a teammate without the ball (14 m). Throw-ins and corners teleport the nearest taker to the ball at the end of the turn.

## 8. Milestones

| # | Milestone | Scope | Done when |
|---|---|---|---|
| **M0** | Grey-box prototype | Pitch, discs, ball, flick input (touch + mouse), one plan-and-resolve turn on one device | The flick feels good on phone and desktop. The same seed and plans always give the same result. Playtesters find the guessing fun. |
| **M1** | Core match (hot-seat) | All of §3: possession, short and long passes, runs, shots, goalkeeper, interception odds, restarts, dispute-ball mash duel with two on-screen buttons, goals, halves, end screen, 60 s timer, pass-the-device screen | Two people can finish a full match on one device |
| **M2** | vs CPU | AI that plans attacks (scores candidate pass chains) and defense (predicts pass lanes), plus CPU button-mashing in dispute balls, with Easy and Normal levels | The CPU scores and defends believably and finishes matches |
| **M3** | Coin toss and boosters | All of §4 | The pack trade is sometimes worth taking. All 5 boosters work and have tests. |
| **M4** | Team building | 52-player data, stats, budget draft, formation editor | Team choices visibly change how matches play out |
| **M5** | Presentation | ISS-style art, the 4 kits, the 6 cutscene templates, audio | It looks and sounds like the pitch |
| **M6** | Uniform editor | §6.4 | A player can paint a kit and use it in a match |
| **M7** | Mobile | Capacitor build and the CI pipeline from Claw Island | Signed builds reach TestFlight and the Play internal track |
| **M8** | Online 1v1 | Server, room codes, server-resolved turns, server-decided dispute balls, reconnects | Two devices finish a match online |
| **M9** | Dual-screen (iPhone Duo) layouts | Detect the two-screen posture (Viewport Segments API) and snap panels to the hinge: lineup/pool on one screen and the pitch on the other in the team builder and during planning; sprite preview on one screen and the paint grid on the other in the kit editor. No engine changes: `PitchView.insets` and the existing side panels already split the layout. **Done:** `ui/segments.ts` reads the segments (Viewport Segments API, `visualViewport.segments`, `getWindowSegments`, or the CSS `viewport-segment-*` env values) and publishes `html[data-posture="book"\|"laptop"]` plus `--pane-*`/`--pitch-*` variables; the HUD overlay is pinned to the pane screen (book: left, laptop: bottom) and the pitch fills the other. The pane shows a lineup panel during the match, the draft pool in the team builder, and the kit editor's grid; the pitch screen shows the pitch, or the blown-up kit preview while painting. `?segments=book` / `?segments=laptop` fakes a hinge for testing. | On a dual-screen device each mode uses both screens with no content under the hinge; single-screen layouts are unchanged |
| **M10** | Season run (first slice) | §9: a five-club ladder with rising draft budgets, coins from results, and a store between matches (training, scouts, booster packs); runs are saved and resumable | A run can be won or lost; the store changes the next match |
| **M11** | Tactics cards (first set) | §9: six passive rules bought in the run store and carried for the whole run, wired through `engine/tactics.ts` | Cards change odds, reach, speed and flick counts in the engine, the CPU and the planning UI alike |

## 9. Season run and upgrade store

**Built (M10, first slice):**

- **Season run:** draft a team with the usual 100 points, then climb a ladder of 5 CPU clubs drafted with 80, 92, 104, 116 and 130 points (the first two on easy, the rest on normal). A win moves you up, a draw replays the stage, a loss ends the run. Winning the fifth match wins the run.
- **Currency:** 5 coins for a win, 2 for a draw, plus 1 per goal scored.
- **Store, between matches:** training (+1 to one stat of one player, 3 coins, stats cap at 5); three scouted players per stage (a signing costs about half their draft price and replaces your cheapest player in that position); booster packs (4 coins, one random booster, hand limit 2). Unused boosters carry over into the next match.
- The run is saved after every step and can be resumed or abandoned from the menu.

- **Tactics cards (M11):** passive rules bought in the store (two on offer per stage, hold up to three) that apply to every match of the run. Catenaccio: three defensive flicks. Tiki-taka: each completed pass makes the next 5% harder to intercept, up to 15%. Chemistry: a pass between two club-mates is 10% harder to intercept. Cannon: shots 10% harder to save or block. Iron wall: keeper reach ×1.3. Engine room: slides, runs and dives 20% faster. They live in `TeamMeta.tactics`, so the CPU opponent could carry them too.

**Ideas still open:**

- Extra booster slots.
  - **Tactics cards**, the Balatro "jokers": passive rules such as "Catenaccio: your defenders get 3 flicks once per half" or "Clásicos: +10% pass success for each classic-era player passing in a chain".
- Synergies between eras, clubs and positions give builds their identity.

## 10. Risks and open questions

- **Names and kits:** players use parody names (`docs/player-names.csv` maps them) and kits are colours only; club names in the pool data are still real and need the same treatment before any public release.
- **Balance numbers:** every **(proposed)** value in §3–§5 needs playtesting at M1–M4.
- **Hiding plans in hot-seat mode:** check that the cover screen is enough in practice.
- **Server hosting and cost** for M8 are still to be decided.
- **Online mash fairness:** a player with higher latency gets their presses in later. To limit this, presses count by when the client says they happened, within the duel window and the per-second cap, rather than by when the server receives them.
- **Cutscene art production:** procedural rigs for now (decided after M12); hand-drawn frames could still replace them pose by pose behind the same `spriteCanvas` API.
