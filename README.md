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

## Notes on the supplied art

- The fish atlas has no heptagon, and two octagons (one tilted). The curriculum uses the
  tilted octagon in the last location as "still an octagon".
- The orange diamond is a kite (its widest point sits above centre and its side pairs differ),
  the blue diamond is a rotated square. Neither is used as a rhombus target.
- One casting frame has its raft cut off by the sheet edge and is excluded.
- No audio files were supplied; music and effects are synthesised with the Web Audio API.


## Wrong-answer animation

Wrong choices use the existing cast and game-time clock, followed by a single tug,
a double-take, independent fall, waterline splash, brief dip, resurface, climb and
wet recovery. Input stays locked until the rod is back in hand. Wrong fish remain
available and lesson progress is unchanged. Restart and disposal cancel the sequence;
pause freezes its clock, particles and audio context.

The standalone character poses in `asset/popo-mishap-poses.png` were generated from
the supplied Popo reference with the built-in image generator. The exact prompt is
in `tools/popo-pose-prompt.txt`. Pose rectangles and attachment anchors are manually
registered in `src/popo.js`; every pose uses a single common scale. No character is
cut from a boat sprite. The original raft, bucket and rod remain separate props.
`tools/build-popo-layers.py` rebuilds these props and the compressed character atlas,
and is also invoked by `tools/build-assets.py`.

The named `popo_s_splashy_fishing_adventure.png` sheet was not present. Generated
poses have small differences from the original idle artwork; the original idle and
correct-catch art are retained. There are no supplied voiceover recordings, so the
sequence reuses the existing feedback text and synthesized sounds.

Run browser regression checks with `python3 tests/wrong-answer.py` (requires Python
Playwright and an installed Chromium). The suite exercises input locking, hook
contact, recovery, pause, restart, orientation, audio failure, reduced motion,
all 14 correct catches through the summary, and disposal. It drives the actual
browser game loop at deterministic 60Hz; screenshots are written to `/tmp/popo-qa-*`.

## Underwater environment

The existing paintings remain the scene's artwork. Small horizontal refraction follows
registered plant bounds in `effects.js`, fading to zero at each root and patch boundary.
Rocks and the seabed stay fixed. Scene travel interpolates depth continuously rather than
sliding hard-edged horizontal bands. Surface refraction, three broad light washes, 18 faint
motes and 12 pooled bubbles use independent phases on the existing game clock. Bubbles
come from the location's plant/rock anchors or occasional fish breaths; visible bubbles
are never recycled mid-flight. Ambient detail fades around selectable shapes.

Fish anticipate edge turns and vary cruise speed without scaling their polygon bodies.
Raft float combines two small rhythms; local splash reactions add a damped, delayed bob.
The old full-width water veil is replaced with a small transparent raft contact treatment.
No separate decorative-fish or fin assets exist, so no competing silhouettes were added.

`python3 tests/environment.py` uses Python Playwright, Chromium and a temporary loopback
HTTP server to check anchored roots, pool reuse, a three-minute simulated soak, pause,
restart, resize, scene travel, reduced motion and disposal. Captures go to
`/tmp/environment-*.png`. Physical mobile-device performance has not been measured.
