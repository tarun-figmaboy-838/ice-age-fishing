# Popo's Shape Fishing

A small browser game for early shape recognition. Popo the polar bear rows across four icy
locations and the player taps the fish whose body matches the shape he is asked for.

## Run

The game is plain HTML, CSS and JavaScript (canvas, WebGL for the water, Web Audio; no build
step and no dependencies). Double-click `index.html` to play, or serve the folder over HTTP:

```
python3 -m http.server 8000
# then visit http://localhost:8000/
```

The painted water runs through a per-pixel WebGL pass (waves, refraction, seaweed sway, light
on the sand). The backgrounds are embedded as data URLs in `src/background-data.js` so the
pass also works when the page is opened straight from the file system; without WebGL the
painting is drawn plainly.

Append `?debug` to the URL to expose `window.popoDebug = { state, game }` for testing.

## Deploy

The folder is a static site. On Vercel, import the GitHub repository and deploy with no build
command; `vercel.json` sets long cache headers for `assets/` and `.vercelignore` leaves the
original artwork and tools out of the deployment.

## Layout

- `index.html`, `src/` – the game. The scripts are classic scripts sharing the `PopoGame`
  namespace, loaded in dependency order from `index.html`. `game.js` orchestrates, `water.js`
  is the WebGL water pass, `sequences.js` holds the catch,
  wrong-catch, travel and tutorial flows, `levels.js` holds the shape data and the four
  locations, `popo.js` renders Popo from the sprite sheets, `fish.js` the swimming fish,
  `effects.js` the ambient water, `audio.js` the synthesised sound, `ui.js` the HUD/DOM.
- `asset/` – the untouched source artwork.
- `assets/` – the compressed WebP art the game loads, generated from `asset/`.
- `tools/build-assets.py` – rebuilds `assets/` and `src/sprite-data.js` (needs Pillow).
  `tools/build-popo-layers.py` cuts the raft and rod props used by the wrong-answer fall.
  It erases the baked fishing line and hook from the fishing sheets so the game can draw a
  single procedural line, measures each frame's raft anchor and rod tip, and compresses
  everything to WebP.

## Flow

Title banner with a floating play button (fish circle it) → the narrator's opening lines →
Triangle Bay, Pentagon Cove, Hexagon Pass (one catch each; Popo says "Great catch!" and the
reward shows the fish and its name) → Quadrilateral Waters (catch all the quadrilateral fish;
no trapezium) → a trapezium fish Popo has never seen leaps out of the water ("Woah! I haven't
seen that one before!") → summary. Story lines live in `STORY` in `src/levels.js`.

## Notes on the supplied art

- Popo's fishing and casting poses come from `asset/popo-fishing-clean.png` (character and rod
  only). His paddling comes from `asset/popo-paddling.png`, which the build cleans of red and
  yellow generation specks and repacks so every figure is whole. Every pose sits on one shared
  raft at the same seat on the deck, so the raft never changes between poses.
- The raft with its bucket and the rod come from `asset/props-new.png`; the build fits them into
  the cells the game registers to. The hint hand is `asset/hint-hand.png`.
- Fish come from the two fish sheets in `asset/`, sliced by grid cell with a margin so no fish
  is cut, then cleaned of stray specks. The second sheet is drawn at twice the scale and is
  halved. Unused cells: an irregular 9-gon, a capsule, a second right triangle, a second
  trapezium and a star. Each used fish's side count was checked by measuring its outline, and
  its smile is measured so the hook lands in its mouth.
- Each background gets a water mask: the surface waves move only open water, so the sky,
  mountains, ice shelves and icebergs stay still. The seaweed sway stops at the plant tips.
- The title banner (`asset/title-banner.png`) and play button (`asset/play-button.png`) are built
  into `assets/` and embedded as data URLs so the canvas can use them from the file system.
- No audio files were supplied; music and effects are synthesised with the Web Audio API.

## Wrong-answer reaction

The existing cast takes about 0.9 seconds, followed by one 4.8-second game-clock reaction
(about 5.7 seconds of motion). Popo says “Whoopsie Doopsie!” in his existing speech
bubble during seated recovery, using the existing synthesized character chatter. Retry waits
for both motion and dialogue to finish (about 6.37 seconds in the latest real-time check). The wrong
fish remains available for retry; the correct-catch and progression flows are unchanged.

| Reaction time after casting | Beat |
| --- | --- |
| 0–0.40 s | Fish tug, surprised expression, attached rod response |
| 0.40–0.95 s | Brace, anticipation, loss of balance |
| 0.95–1.45 s | Curved airborne fall and rod release |
| 1.45–1.75 s | Water entry; splash fires on measured contact, not a timer |
| 1.75–2.05 s | Brief visible underwater dip and bubbles |
| 2.05–2.75 s | Buoyant resurface, blink, water rings |
| 2.75–4.15 s | Reach, planted-paw pull, belly/feet over the rail, seat recovery |
| 4.15–4.80 s | Sheepish recovery, original idle art and rod grip restored |

`src/sequences.js` owns the time-based path and one-shot events. `src/popo.js` registers
poses by head landmarks, uses short interpolated pose blends, clips above/below the surface,
and pins the climb grip to the raft. The original fishing frame supplies the independent rod;
the shared raft/bucket prop is retained. The original idle frame is used at both ends.
`src/effects.js` draws the splash behind and in front of Popo. Existing synthesized audio
supplies the twang, slide, splash and bubbly recovery; no voiceover assets were supplied.
Input stays locked until recovery, and restart/disposal cancel the sequence and effects.
The clock now rejects failed tween callbacks so cleanup can release the input lock.
The RAF delta cap supports 15 FPS without slowing game time; hidden tabs suspend updates.

### New artwork and rebuild

- `asset/popo-mishap-new.png`: newly generated, subsequently alpha-cleaned Popo-only source.
- `assets/sprites/popo-mishap.png`: lossless 2048×1024 RGBA atlas, eight padded cells.
- `src/mishap-data.js`: generated pose boxes and attachment landmarks.
- `tools/popo-mishap-prompt.txt`: generation prompt and processing provenance.
- `tools/build-mishap.py`: deterministic Canvas packing; requires Python Playwright/Chromium.

Run `python3 tools/build-mishap.py` to repack the cleaned source without further erosion.
`--clean-source` is only for a fresh raw generation; it removes exterior matte/chroma noise
and isolated specks, preserves interior features, and antialiases the boundary before saving.
The old `popo-mishap-poses-v2` files are retained as legacy source and are no longer loaded.

### Verification (9 October 2026)

Run `python3 tests/mishap.py` and `python3 tests/asset_alpha.py`.
Gameplay screenshots and measurements are written to `/tmp/popo-qa`.

Passed in local headless Chromium: desktop 1600×900, laptop 1024×640, tablet 768×1024,
mobile 390×844, reduced-motion 844×390; simulated 15/30/60 FPS; rotation/resize during
animation; pause; 20 repeated taps; three consecutive retries; restart mid-fall; a subsequent
correct collection; all four location waterlines; optional audio failure. A separate actual
RAF run used the keyboard fish target, completed in 6.37 seconds including recovery dialogue, and dispatched each
impact SFX once with a running Web Audio context. Sampled animation frames were visually
reviewed for water clipping, pose continuity, equipment and recovery.

Asset checks passed for RGBA transparency, opaque interiors, fractional-alpha edges,
32-pixel minimum safety gutters (actual minimum 44 pixels), registered landmarks and absence
of saturated exterior red/yellow fringe. JavaScript syntax and `git diff --check` passed.
The project has no package-manager lint command or application compilation step; the new
sprite packing pipeline was run successfully.

Limits: animation uses eight raster key poses with short registered blends, not a skeletal
3D rig. Physical mobile devices, Safari and subjective loudspeaker/headphone playback have
not been validated. The checks above verify sound dispatch/timing, not perceived sound mix.

Files changed for this reaction: `index.html`, `src/assets.js`, `src/clock.js`,
`src/effects.js`, `src/game.js`, `src/popo.js`, `src/sequences.js`, and this README.
Added files are the four artwork/registration/provenance files listed above,
`tools/build-mishap.py`, `tests/mishap.py`, and `tests/asset_alpha.py`.
Existing unrelated working-tree changes were retained; no repository push was made.

Recovery dialogue checks also passed: exact “Whoopsie Doopsie!” text, locked input while
visible, restart during its post-motion hold, and recovery with optional audio unavailable.
The dialogue text is stored in `STORY.wrong` in `src/levels.js`.
