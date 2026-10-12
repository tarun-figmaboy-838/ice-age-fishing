(function (PopoGame) {
'use strict';
// ?dev=1 adds a small panel for jumping straight to any screen of the game while building it.
// Number keys 1–9 and 0 press the buttons in order; ` folds the panel away.
if (new URLSearchParams(location.search).get('dev') !== '1') return;

const { state, PHASE, LOCATIONS, STORY, matchesTarget, travelTo, discovery, finale } = PopoGame;

function game() {
  return window.popoDebug && window.popoDebug.game;
}

// Leaves the title (as Play would) without starting the opening story.
function begin(g) {
  if (state.phase === PHASE.INTRO) {
    g.titleFade = 0;
    g.audio.init();
    g.audio.resume();
    g.audio.startMusic();
    g.ui.hideStart();
    g.ui.showHud();
  }
  g.reset();
}

function atLocation(g, index) {
  begin(g);
  state.locationIndex = index;
  state.challengeIndex = 0;
  g.applyLocation();
}

function level(index) {
  const g = game();
  atLocation(g, index);
  g.tutorialPending = false;
  g.setupChallenge();
}

function tapFish(right) {
  const g = game();
  if (state.phase !== PHASE.READY) level(state.phase === PHASE.INTRO ? 0 : state.locationIndex);
  const fish = state.fish.find((f) => !f.gone && !f.offstage && matchesTarget(f.key, state.target) === right);
  if (fish) g.onFishTap(fish, null);
}

const JUMPS = [
  ['Title', () => {
    const g = game();
    g.reset();
    g.audio.stopMusic();
    g.ui.showStart();
    g.showIdleScene();
  }],
  ['Intro', () => { const g = game(); begin(g); g.restart(); }],
  ...LOCATIONS.map((loc, i) => [`L${i + 1} ${loc.name.split(' ')[0]}`, () => level(i)]),
  ['Catch ✓', () => tapFish(true)],
  ['Wrong ✗', () => tapFish(false)],
  ['Row on', () => {
    const g = game();
    const from = state.phase === PHASE.INTRO ? 0 : Math.min(state.locationIndex, LOCATIONS.length - 2);
    atLocation(g, from);
    travelTo(g, from + 1);
  }],
  ['Mystery fish', () => { const g = game(); atLocation(g, LOCATIONS.length - 1); discovery(g); }],
  ['Swiftee', () => { const g = game(); atLocation(g, LOCATIONS.length - 1); finale(g); }],
];

const css = document.createElement('style');
css.textContent = `
.dev-panel { position: fixed; left: 8px; top: 8px; z-index: 50; display: flex; flex-wrap: wrap; gap: 4px;
  max-width: min(560px, 33vw); padding: 6px; border-radius: 10px; background: rgba(10, 20, 40, 0.82);
  font: 600 12px/1 system-ui, sans-serif; color: #fff; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); }
.dev-panel button { font: inherit; padding: 6px 8px; border: 0; border-radius: 6px; background: #2f4f7f; color: #fff; cursor: pointer; }
.dev-panel button:hover { background: #3f6aa8; }
.dev-panel button kbd { opacity: 0.6; font: inherit; margin-right: 4px; }
.dev-panel .dev-tag { padding: 6px 6px 6px 2px; color: #ffd23f; cursor: pointer; }
.dev-panel.folded button { display: none; }
`;
document.head.appendChild(css);

const panel = document.createElement('div');
panel.className = 'dev-panel';
panel.setAttribute('aria-label', 'Developer screen jumps');
const tag = document.createElement('span');
tag.className = 'dev-tag';
tag.textContent = 'DEV';
tag.title = 'Fold or unfold (`)';
tag.addEventListener('click', () => panel.classList.toggle('folded'));
panel.appendChild(tag);
JUMPS.forEach(([label, run], i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : '';
  b.appendChild(document.createTextNode(label));
  b.addEventListener('click', (e) => { e.stopPropagation(); if (game()) run(); });
  panel.appendChild(b);
});
document.body.appendChild(panel);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea')) return;
  if (e.key === '`') { panel.classList.toggle('folded'); return; }
  if (!/^[0-9]$/.test(e.key) || !game()) return;
  const jump = JUMPS[(Number(e.key) + 9) % 10];
  if (jump) jump[1]();
});
})(window.PopoGame = window.PopoGame || {});
