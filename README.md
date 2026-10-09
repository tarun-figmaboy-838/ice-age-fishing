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

Title banner with a floating play button (fish circle it) → the narrator's opening line →
Triangle Bay, Pentagon Cove, Hexagon Pass (one catch each, Popo says "Great catch!") → a
four-sided fish leaps out of the water and Popo wonders what it was → Quadrilateral Waters
(catch all the four-sided fish) → summary. Story lines live in `STORY` and the
`discovery` entry in `src/levels.js`.

## Notes on the supplied art

- Popo's fishing and casting poses come from `asset/popo-fishing-clean.png`: a clean 3x3 sheet
  of the character and rod only. Each pose is seated on one shared raft prop (cut from the
  first fishing sheet's idle frame), so the raft never changes between poses. The rowing frames
  have their painted raft stripped by the build and sit on the same prop.
- Fish come from the two fish sheets in `asset/`, sliced by grid cell with a margin so no fish
  is cut, then cleaned of stray specks. The second sheet is drawn at twice the scale and is
  halved. Unused cells: an irregular 9-gon, a capsule, a second right triangle, a second
  trapezium and a star. Each used fish's side count was checked by measuring its outline.
- The title banner (`asset/title-banner.png`) and play button (`asset/play-button.png`) are built
  into `assets/` and embedded as data URLs so the canvas can use them from the file system.
- No audio files were supplied; music and effects are synthesised with the Web Audio API.
