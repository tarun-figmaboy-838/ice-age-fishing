(function (PopoGame) {
'use strict';

// Shape curriculum and the four fishing locations. Everything the challenges need lives here.

// Curriculum names that differ between regions. Change the value, not the key.
const TERMS = {
  trapezium: 'Trapezium',
};

// atlas: sprite index in assets/sprites/fish.webp (row-major, see FISH_ATLAS)
// categories: every shape family this body belongs to, so "a square is also a rectangle"
// never produces wrong feedback. The taught name is `shape`.
const SHAPES = {
  triangle: { shape: 'triangle', name: 'Triangle', atlas: 'triangle', sides: 3, categories: ['triangle'] },
  'triangle-right': { shape: 'triangle', name: 'Triangle', atlas: 'triangle-right', sides: 3, categories: ['triangle'] },
  square: { shape: 'square', name: 'Square', atlas: 'square', sides: 4,
    categories: ['square', 'rectangle', 'rhombus', 'parallelogram', 'quadrilateral'] },
  rectangle: { shape: 'rectangle', name: 'Rectangle', atlas: 'rectangle', sides: 4,
    categories: ['rectangle', 'parallelogram', 'quadrilateral'] },
  rhombus: { shape: 'rhombus', name: 'Rhombus', atlas: 'rhombus', sides: 4,
    categories: ['rhombus', 'parallelogram', 'quadrilateral'] },
  parallelogram: { shape: 'parallelogram', name: 'Parallelogram', atlas: 'parallelogram', sides: 4,
    categories: ['parallelogram', 'quadrilateral'] },
  trapezium: { shape: 'trapezium', name: TERMS.trapezium, atlas: 'trapezium', sides: 4,
    categories: ['trapezium', 'quadrilateral'] },
  pentagon: { shape: 'pentagon', name: 'Pentagon', atlas: 'pentagon', sides: 5, categories: ['pentagon'] },
  hexagon: { shape: 'hexagon', name: 'Hexagon', atlas: 'hexagon', sides: 6, categories: ['hexagon'] },
  octagon: { shape: 'octagon', name: 'Octagon', atlas: 'octagon', sides: 8, categories: ['octagon'] },
  nonagon: { shape: 'nonagon', name: 'Nonagon', atlas: 'nonagon', sides: 9, categories: ['nonagon'] },
  decagon: { shape: 'decagon', name: 'Decagon', atlas: 'decagon', sides: 10, categories: ['decagon'] },
  circle: { shape: 'circle', name: 'Circle', atlas: 'circle', curved: true, categories: ['circle'] },
  oval: { shape: 'oval', name: 'Oval', atlas: 'oval', curved: true, categories: ['oval'] },
  semicircle: { shape: 'semicircle', name: 'Semicircle', atlas: 'semicircle', categories: ['semicircle'] },
  // a shape family used as a challenge target; it has no fish of its own
  quadrilateral: { shape: 'quadrilateral', name: 'Quadrilateral', sides: 4, categories: ['quadrilateral'] },
};

// One challenge per level, and every level is "catch them all": each has several fish of
// its shape among others, and the level ends once every matching fish is caught. Distractors
// can never belong to the target's family (a square counts as a rectangle and a rhombus).
const LOCATIONS = [
  { name: 'Triangle Bay', background: 0, waterline: 388,
    challenges: [{ target: 'triangle', all: true, tutorial: true, fishScale: 0.9,
      fish: ['triangle', 'triangle-right', 'triangle', 'circle', 'square', 'oval'] }] },
  { name: 'Pentagon Cove', background: 1, waterline: 390,
    challenges: [{ target: 'pentagon', all: true, fishScale: 0.9,
      fish: ['pentagon', 'pentagon', 'pentagon', 'hexagon', 'semicircle', 'triangle'] }] },
  { name: 'Hexagon Pass', background: 2, waterline: 387,
    challenges: [{ target: 'hexagon', all: true, fishScale: 0.9,
      fish: ['hexagon', 'hexagon', 'hexagon', 'pentagon', 'octagon', 'circle'] }] },
  { name: 'Quadrilateral Waters', background: 3, waterline: 388,
    challenges: [{ target: 'quadrilateral', all: true, fishScale: 0.9,
      fish: ['square', 'rectangle', 'parallelogram', 'rhombus', 'triangle-right', 'oval'] }] },
];

function getShape(key) {
  return SHAPES[key];
}

function matchesTarget(fishKey, targetKey) {
  return SHAPES[fishKey].categories.includes(SHAPES[targetKey].shape);
}

function challengeFish(challenge) {
  return challenge.fish || [challenge.target, ...challenge.others];
}

// Story lines, delivered word by word. *Stressed* words land bigger with a boing, and a cue
// fires a moment in the scene when its word appears (see Game.storyCue).
const STORY = {
  intro: [
    { who: 'narrator', text: 'Popo *loves* fishing.', cue: { word: 1, do: 'hop' } },
    { who: 'narrator', text: 'And today…' },
    { who: 'narrator', text: 'he wants to catch *all* kinds of fish!', cue: { word: 4, do: 'fishIn' } },
  ],
  wrong: { who: 'popo', text: 'Whoopsie Doopsie!' },
  catch: { who: 'popo', text: '*Great* catch!', cue: { word: 0, do: 'hop' } },
  // after the last level, a fish Popo has never seen leaps out of the water; then Swiftee the
  // bird flies in with the answer to Popo's question and the Next button appears
  ending: {
    fish: 'trapezium',
    woah: [
      { who: 'popo', text: '*Woah!*', cue: { word: 0, do: 'exclaim' } },
      { who: 'popo', text: "I haven't seen *that* one before!" },
    ],
    after: [
      { who: 'popo', text: 'What *kind* of fish was that?', cue: { word: 1, do: 'wonder' } },
    ],
    // stays up beside Swiftee until Next is pressed
    swiftee: { who: 'swiftee', text: "Let's find *out!*", cue: { word: 2, do: 'twirl' }, stay: true },
  },
};


Object.assign(PopoGame, { TERMS, SHAPES, LOCATIONS, STORY, getShape, matchesTarget, challengeFish });
})(window.PopoGame = window.PopoGame || {});
