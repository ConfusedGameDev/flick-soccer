# Generated sprite frames

Source PNGs for the pitch players: one 48×48 frame per state and direction
(`s, se, e, ne, n, nw, w, sw`; `s` faces the camera), generated with the
"16-bit ISS" character (white kit with blue trim, brown hair, navy boots).

`npm run frames` turns them into `src/data/frames.json`: each pixel becomes a
material letter (shirt, shorts, socks, trim, skin, hair, boots, outline) so the
game recolours them per kit and per look at runtime, like the typed sprites.
Shirt and shorts share the white ramp and are split along the body axis
(`SHORTS_AT` in `scripts/import-frames.mjs`); the Idle frames' ball is cut out.

States so far: `idle` (with ball, cut out), `run` (one frame), `slide`.

Still wanted, same character, same camera, **no ball**:
- `idle` without the ball (removes the cut marks on the near foot)
- a second `run` frame (the cycle currently alternates run and idle)
- `kick`, `cheer`, keeper `ready` and `dive`

Generating the character in a key-colour kit (red shirt, green shorts, blue
socks) would make the shirt/shorts/socks split exact instead of a band
heuristic.
