# Hand-drawn character sheets

Aseprite sources for the pitch players, the keeper and the ball (from the
`ArtContent/` drop; the flattened `*-Sheet.png` exports there are recolours of
these same frames made with the Character Customizator, so they are not needed).

`npm run sheet` (`scripts/import-sheet.mjs`) turns them into
`src/data/sheet.json`: every frame becomes a crop of material letters (the same
alphabet as the typed sprites, `render/rig.ts` `LETTERS`), so the game
recolours them per kit and look at runtime; no PNG is loaded by the app.
`render/sheet.ts` reads the JSON; the pitch uses it when `?sprites=sheet` (the
default on this branch).

## Files

| File | Canvas | Frames | Layers |
|---|---|---|---|
| `character.aseprite` | 128×64, 100 ms/frame | 194 in 37 tags | `body, socks, boots, short, jersey, stripes1-3, Hair..Hair5, ball, VFX` |
| `goalkeeper.aseprite` | 128×64 | 64 in 9 tags | as above plus `gloves`; `Hair..Hair4` |
| `referee.aseprite` | 64×64 | 23 in 4 tags | `body, clothes, Hair, VFX` (not imported: the game has no referee) |
| `ball.png` | 16×16 | one 7×7 ball | drawn with its own colours |

The figures are side views facing right. Every standing frame has its feet on
canvas row 47, centred on column 64: that is the pivot (`origin` in the JSON)
the runtime anchors to, so slides and dives that spill below or beside it stay
planted. The body layer draws the whole head: a hair layer is an overlay, and no
overlay is bald.

## Colour contract

A layer is one material; the pixel's colour picks the tone letter. The importer
fails on any colour it does not know, so a recoloured export cannot slip in.

| Layer | Material | Colours |
|---|---|---|
| `body` | skin | `#fdcbb0` hi, `#fca790` base, `#f68181` shade, `#f04f78` deep |
| `jersey` | jersey (kit pattern / design) | `#ffffff` hi, `#c7dcd0` base |
| `short` | shorts | `#ffffff`, `#c7dcd0` |
| `socks` | socks | `#ffffff` |
| `boots` | boots (always dark) | `#ed8099` hi; `#cf657f`, `#a24b6f`, `#3e3546` base |
| `gloves` | hands (gloves) | `#ffffff`, `#b33831`/`#ae2334`, `#2e222f` |
| `Hair*` | hair | any one colour per layer (most used = base; lighter = highlight, darker = shade) |
| `ball`, `VFX` | dropped | |
| `stripes1-3` | dropped (`TRIMS` in the importer paints them as the collar trim) | `#3e3546` |

## Imported animations

Player: `idle` 0-4, `run` 15-20, `sprint` 29-34, `jump` 41-52, `defensive_stance` 61-64,
`slide_tackle` 71-76, `shoot_ball` 77-85, `volley_kick` 94-102, `celebration_1` 185-193.
Keeper (`gk-` keys): `idle` 0-4, `defensive_stance` 15-18 (front-facing crouch), `slide` 19-24,
`clearance` 25-34 (low dive), `clearance_2` 35-45 (high dive), `hold_ball` 46-50.

Not in the files yet: a back view (the set-piece kicker keeps the rigged
figure), a throw-in, a keeper run (he runs with the outfield frames), and the
other seven directions (the pitch mirrors left/right only).
