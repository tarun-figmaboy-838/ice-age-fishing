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

// More fish of each shape, drawn in new colours and patterns (asset/fish-variants.png, cut and
// measured by tools/build-assets.py). Each is its base shape for every purpose but its art.
const FISH_VARIANTS = {};
for (const [key, base] of Object.entries(PopoGame.FISH_VARIANT_ATLAS.bases)) {
  FISH_VARIANTS[key] = { base };
  SHAPES[key] = { ...SHAPES[base], atlas: key };
}
const variantsOf = (base) => Object.keys(FISH_VARIANTS).filter((key) => FISH_VARIANTS[key].base === base);

const TARGET_POOLS = {
  triangle: ['triangle', 'triangle-right', ...variantsOf('triangle')],
  pentagon: ['pentagon', ...variantsOf('pentagon')],
  hexagon: ['hexagon', ...variantsOf('hexagon')],
};

// One challenge per level, and every level is "catch them all": each has several fish of
// its shape among others, and the level ends once every matching fish is caught. Distractors
// can never belong to the target's family (a square counts as a rectangle and a rhombus).
const LOCATIONS = [
  { name: 'Triangle Bay', background: 0, waterline: 388,
    challenges: [{ target: 'triangle', all: true, tutorial: true, fishScale: 0.9,
      targetCount: 3, targetPool: TARGET_POOLS.triangle,
      others: ['circle', 'square', 'oval', 'pentagon', 'hexagon'], distractorCount: 3 }] },
  { name: 'Pentagon Cove', background: 1, waterline: 390,
    challenges: [{ target: 'pentagon', all: true, fishScale: 0.9,
      targetCount: 3, targetPool: TARGET_POOLS.pentagon,
      others: ['hexagon', 'semicircle', 'triangle', 'rectangle', 'oval'], distractorCount: 3 }] },
  { name: 'Hexagon Pass', background: 2, waterline: 387,
    challenges: [{ target: 'hexagon', all: true, fishScale: 0.9,
      targetCount: 3, targetPool: TARGET_POOLS.hexagon,
      others: ['pentagon', 'octagon', 'circle', 'triangle-right', 'rhombus'], distractorCount: 3 }] },
  { name: 'Quadrilateral Waters', background: 3, waterline: 388,
    challenges: [{ target: 'quadrilateral', all: true, fishScale: 0.9,
      // Keep all four taught quadrilateral types; the trapezium is the story's surprise.
      targetGroups: [['square'], ['rectangle'], ['parallelogram'], ['rhombus', ...variantsOf('rhombus')]],
      others: ['triangle-right', 'oval', 'pentagon', 'hexagon', 'circle'], distractorCount: 2 }] },
];

function getShape(key) {
  return SHAPES[key];
}

function matchesTarget(fishKey, targetKey) {
  return SHAPES[fishKey].categories.includes(SHAPES[targetKey].shape);
}

function shuffleFish(keys) {
  const result = [...keys];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const previousTargets = new WeakMap();
function challengeFish(challenge) {
  if (!challenge.targetPool && !challenge.targetGroups) {
    return [...(challenge.fish || [challenge.target, ...challenge.others])];
  }
  const targets = challenge.targetGroups
    ? challenge.targetGroups.map((group) => shuffleFish(group)[0])
    : shuffleFish(challenge.targetPool).slice(0, challenge.targetCount);
  const previous = previousTargets.get(challenge);
  // Even unlucky random draws must not repeat the same school on consecutive visits.
  if (previous && targets.every((key) => previous.includes(key))) {
    const groups = challenge.targetGroups || [challenge.targetPool];
    for (let i = 0; i < groups.length; i += 1) {
      const replacement = groups[i].find((key) => !targets.includes(key));
      if (replacement) {
        targets[challenge.targetGroups ? i : 0] = replacement;
        break;
      }
    }
  }
  previousTargets.set(challenge, [...targets]);
  const others = shuffleFish(challenge.others.filter((key) => !matchesTarget(key, challenge.target)))
    .slice(0, challenge.distractorCount);
  return shuffleFish([...targets, ...others]);
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
    fish: ['trapezium', ...variantsOf('trapezium')], // one at random each journey
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


Object.assign(PopoGame, { TERMS, SHAPES, FISH_VARIANTS, LOCATIONS, STORY, getShape, matchesTarget, challengeFish, shuffleFish });
})(window.PopoGame = window.PopoGame || {});
