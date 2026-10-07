# Flick Soccer: PRD (proof of concept)

Last updated: 2026-10-07. Source brief: `Plan.md`.

Items marked **(proposed)** are defaults filled in to make the design complete. They are open to change. Unmarked items come from `Plan.md` or decisions already made.

## 1. Vision

A turn-based soccer strategy game. In each turn both players plan at the same time without seeing each other's moves. The attacker draws a chain of passes with Angry Birds-style flicks, and the defender tries to guess where to cut it off. Dice rolls, boosters and a draft with a points budget add luck and build variety in the spirit of Balatro. The look comes from SNES *International Superstar Soccer Deluxe*, and dramatic moments get Captain Tsubasa-style anime cutscenes. The game launches on web first, then on mobile using the same pipeline as Claw Island.

## 2. Game modes

All three modes run on one shared match engine. The only difference between them is where each side's plan comes from.

| Mode | Plan source | Hiding the plans |
|---|---|---|
| **vs CPU** | Human + AI | AI plans with no access to the human's plan |
| **Same-device (hot-seat)** | Two humans on one screen | P1 plans, then a "pass the device" cover screen appears, P2 plans, then the turn resolves |
| **Online 1v1** | Two humans on separate devices | The server collects both plans and resolves the turn |

## 3. Match rules

### 3.1 Match flow
1. **Draft:** each player picks a team (§5).
2. **Formation:** each player places their 11 players in their own half.
3. **Kickoff roll:** each player flicks a die. The higher roll attacks first, and a tie means both roll again. The ball starts with the attacker's goalkeeper.
4. **Turns** repeat until the match ends.
5. **Length (proposed):** 2 halves of 8 turns each. The second half starts with the side that defended first now attacking. A draw is a valid result in the PoC.

### 3.2 A turn
1. **Planning:** both players plan at the same time. The phase ends when both confirm or 60 s pass, and on timeout whatever has been planned so far is submitted. In hot-seat mode each player gets their own 60 s.
2. **Resolution:** the engine runs both plans at once and produces a timeline of events.
3. **Cutscene** if a dramatic event happened (§6.3).
4. **Next turn.** The attacker keeps possession from turn to turn until an overtake, a goal or the ball going out of play **(proposed)**.

### 3.3 Attacker: 3 flicks per turn
- **Pass:** pull back from the ball carrier and release. Pull length sets the distance. In the plan, a ghost ball shows the path, and the receiver is the nearest teammate to the landing point. The next flick is made from that receiver.
  - **Short pass** (short pull) **(proposed):** travels along the ground and can be intercepted anywhere along its line. It is more accurate.
  - **Long pass** (long pull) **(proposed):** lofted, so it can only be intercepted near where it lands. It scatters a little around the target.
- **Shot:** a flick toward goal. It is allowed only from the attacking third **(proposed)**.
- **Run (proposed):** flick a teammate who doesn't have the ball to move them into space. It uses up one flick.

### 3.4 Defender: 2 flicks per turn
- **Tackle:** flick an outfield player toward where you expect the pass to go. They slide along that line, and pull length sets the slide distance.
- **Goalkeeper dive:** flick the goalkeeper to cover a shot.

### 3.5 Resolution and interception (proposed)
- The ball moves along the attacker's chain at a fixed speed. Defender movements start at t=0 and run alongside it.
- When the ball passes within a defender's reach (ground pass) or lands within it (lofted pass), the engine rolls an **interception check**. The odds depend on how close the defender is, the defender's Tackle, the passer's Pass, and the dice bonus (§4.2). All rolls use a seeded RNG.
- **Shot vs goalkeeper:** if the goalkeeper covers the shot's line at the goal, the engine rolls a save check using Keeping against Shot.
- **Overtake:** the ball passes to the defender, the two sides swap roles next turn, and the new attacker gets a free dice roll (§4.2).

### 3.6 Restarts (proposed)
| Event | Restart |
|---|---|
| Ball crosses the sideline | Throw-in to the other team |
| Attacker puts it over the goal line | Goal kick: ball goes to the defending goalkeeper |
| Defender puts it over the goal line, or a save deflects it out | Corner to the attacker |
| Goal | The team that conceded restarts from its goalkeeper |

There are no offside or fouls in the PoC.

### 3.7 Dispute ball (button-mash tug of war)
- **When:** a pass stops in open field with no teammate close enough to receive it, and nobody intercepted it, so it becomes a dead ball. Any flicks the attacker still had planned for that turn are cancelled.
- **Sequence:**
  1. The referee whistles.
  2. A "3, 2, 1, GO!" countdown plays.
  3. Both players mash their button, and every press pulls a tug-of-war meter toward their side.
- **Winning:** the first player to pull the meter all the way to their end wins. If neither does within the time limit (5 s **(proposed)**), whoever is ahead wins. A press before "GO" doesn't count.
- **Result:** the winner becomes the attacker next turn, and their nearest player gets the ball at the spot where it stopped. Like an overtake, winning plays a cutscene and gives the winner a free dice roll (§4.2).
- **By mode:**

| Mode | How it works |
|---|---|
| Same-device | Two big buttons, one on each side of the screen, with multi-touch so both players can press at once. Keyboard fallback for desktop (`A` for the left player, `L` for the right) **(proposed)**. |
| vs CPU | The CPU presses at a rate set by difficulty, with some random variation. |
| Online | Each client sends its press counts to the server, which decides the winner. Presses are capped at about 15 per second to block auto-clickers **(proposed)**. |

## 4. Dice and boosters

### 4.1 Kickoff die
A single die that is flicked with physics (§3.1).

### 4.2 Trading a flick for a roll
A player can give up one flick to roll 2d6. The dice are flicked the same way as the kickoff die **(proposed)**.

- **Sum gives a success bonus this turn (proposed):** each point of the sum adds 2% to your own odds.
  - Attacker: less chance of interception, better shot accuracy.
  - Defender: better interception and save chances.
  - The bonus is capped at +30%.
- **Doubles:** roll again, and the sums add up (the cap still applies).
- **Double 3 or double 6:** you also get a booster pack.
- **Sum below 4** (1+1, 1+2): no bonus, and that player's dice are blocked for 3 turns. **Double 1 counts as blocked and does not give a reroll**, which settles the conflict between the two rules.
- The free roll after an overtake or a dispute-ball win follows the same rules.

### 4.3 Boosters
A booster pack contains one random booster. A player can hold at most 2 boosters and use one per turn during planning **(proposed)**.

| Booster | Effect (proposed numbers) |
|---|---|
| Longer slide | The next tackle or dive reaches 1.5× as far |
| Double speed | Your players move at 2× speed this turn |
| Extra flick | +1 flick this turn |
| Unstoppable pass | One pass this turn cannot be intercepted (passes only, not shots) |
| Super goalkeeper | Goalkeeper reach ×2 and +25% save chance this turn |

Unstoppable pass and super goalkeeper never conflict, because one affects passes and the other affects shots.

## 5. Teams

- **Player pool:** 52 real Liga MX players, 26 classic (1960–1987) and 26 modern (1988–2007). Real names are used for this proof of concept.
- **Stats (proposed):** Pass, Shot, Speed, Tackle and Keeping, each rated 1–5. Cost is derived from the stats.
- **Draft (proposed):** a budget of 100 points to buy exactly 11 players, at least one of whom is a goalkeeper. Both teams draft from the full pool on their own, so the two teams can share players.
- **Formation:** pick a preset (4-4-2, 4-3-3, 5-3-2), then drag players around within your own half.
- **Kits:** 1990-era América, Chivas, Pumas and Cruz Azul, plus custom kits (§6.4).
- The player pool lives in a data file (JSON) so it can be edited without touching code.

## 6. Presentation

### 6.1 Art
An SNES look in the style of *ISS Deluxe*: pixel-art sprites on an angled pitch. The simulation runs in flat top-down 2D, and only the rendering adds the pseudo-3D angle.

### 6.2 Input
Touch-first. The pull-back-and-release gesture must feel right on a phone browser from M0, and the same gesture works with a mouse.

### 6.3 Cutscenes
- **Triggers:** overtake, dispute-ball win, goal, goalkeeper save, corner, throw-in.
- **Style:** still, 90s anime-style frames with slow pans and parallax, Captain Tsubasa-like.
- **Scope (proposed):** one template scene per event type. Each scene is recolored to the team's kit and captioned with the featured player's name, so no per-player art is needed.

### 6.4 Uniform editor
- A pixel painter for shirts and shorts in the style of Animal Crossing's pattern designer.
- **(Proposed):** a 32×32 grid and a 15-colour palette.
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

## 8. Milestones

| # | Milestone | Scope | Done when |
|---|---|---|---|
| **M0** | Grey-box prototype | Pitch, discs, ball, flick input (touch + mouse), one plan-and-resolve turn on one device | The flick feels good on phone and desktop. The same seed and plans always give the same result. Playtesters find the guessing fun. |
| **M1** | Core match (hot-seat) | All of §3: possession, short and long passes, runs, shots, goalkeeper, interception odds, restarts, dispute-ball mash duel with two on-screen buttons, goals, halves, end screen, 60 s timer, pass-the-device screen | Two people can finish a full match on one device |
| **M2** | vs CPU | AI that plans attacks (scores candidate pass chains) and defense (predicts pass lanes), plus CPU button-mashing in dispute balls, with Easy and Normal levels | The CPU scores and defends believably and finishes matches |
| **M3** | Dice and boosters | All of §4 | The roll-trade is sometimes worth taking. All 5 boosters work and have tests. |
| **M4** | Team building | 52-player data, stats, budget draft, formation editor | Team choices visibly change how matches play out |
| **M5** | Presentation | ISS-style art, the 4 kits, the 6 cutscene templates, audio | It looks and sounds like the pitch |
| **M6** | Uniform editor | §6.4 | A player can paint a kit and use it in a match |
| **M7** | Mobile | Capacitor build and the CI pipeline from Claw Island | Signed builds reach TestFlight and the Play internal track |
| **M8** | Online 1v1 | Server, room codes, server-resolved turns, server-decided dispute balls, reconnects | Two devices finish a match online |
| **M9+** | Upgrade store / run mode | §9 | Design after M8 |

## 9. After M8: upgrade store ideas (not committed)

- **Season run:** a ladder of CPU clubs that get stronger as you go.
- **Currency:** earn coins from wins and goals and spend them between matches.
- **Store items:**
  - Player training (+1 to a stat).
  - Scouting for new players.
  - Extra booster slots.
  - **Tactics cards**, the Balatro "jokers": passive rules such as "Catenaccio: your defenders get 3 flicks once per half" or "Clásicos: +10% pass success for each classic-era player passing in a chain".
- Synergies between eras, clubs and positions give builds their identity.

## 10. Risks and open questions

- **Real names and kits:** these need to be replaced with licensed or parody versions before any public release. They are fine for the PoC.
- **Balance numbers:** every **(proposed)** value in §3–§5 needs playtesting at M1–M4.
- **Hiding plans in hot-seat mode:** check that the cover screen is enough in practice.
- **Server hosting and cost** for M8 are still to be decided.
- **Online mash fairness:** a player with higher latency gets their presses in later. To limit this, presses count by when the client says they happened, within the duel window and the per-second cap, rather than by when the server receives them.
- **Cutscene art production:** decide whether it is hand-drawn, commissioned or generated before M5.
