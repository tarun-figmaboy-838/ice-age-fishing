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
  circle: { shape: 'circle', name: 'Circle', atlas: 3, curved: true, categories: ['circle'],
    fact: 'Round all the way around, with no corners.' },
  oval: { shape: 'oval', name: 'Oval', atlas: 4, curved: true, categories: ['oval'],
    fact: 'A stretched circle: curved, with no corners.' },
  triangle: { shape: 'triangle', name: 'Triangle', atlas: 0, sides: 3, categories: ['triangle'] },
  square: { shape: 'square', name: 'Square', atlas: 1, sides: 4,
    categories: ['square', 'rectangle', 'rhombus', 'parallelogram', 'kite', 'quadrilateral'],
    fact: '4 equal sides and 4 square corners.' },
  'square-tilted': { shape: 'square', name: 'Square', atlas: 5, sides: 4,
    categories: ['square', 'rectangle', 'rhombus', 'parallelogram', 'kite', 'quadrilateral'],
    fact: 'Turned on its corner, it is still a square.' },
  rectangle: { shape: 'rectangle', name: 'Rectangle', atlas: 2, sides: 4,
    categories: ['rectangle', 'parallelogram', 'quadrilateral'],
    fact: '4 square corners. Two long sides and two short sides.' },
  parallelogram: { shape: 'parallelogram', name: 'Parallelogram', atlas: 6, sides: 4,
    categories: ['parallelogram', 'quadrilateral'],
    fact: 'Opposite sides are parallel, like a leaning rectangle.' },
  trapezium: { shape: 'trapezium', name: TERMS.trapezium, atlas: 7, sides: 4,
    categories: ['trapezium', 'quadrilateral'],
    fact: 'Only one pair of sides is parallel.' },
  kite: { shape: 'kite', name: 'Kite', atlas: 8, sides: 4, categories: ['kite', 'quadrilateral'],
    fact: 'Two short sides at the top, two long sides at the bottom.' },
  rhombus: { shape: 'rhombus', name: 'Rhombus', atlas: 16, sides: 4,
    categories: ['rhombus', 'parallelogram', 'quadrilateral'],
    fact: '4 equal sides, like a square pushed over.' },
  pentagon: { shape: 'pentagon', name: 'Pentagon', atlas: 9, sides: 5, categories: ['pentagon'] },
  hexagon: { shape: 'hexagon', name: 'Hexagon', atlas: 10, sides: 6, categories: ['hexagon'] },
  heptagon: { shape: 'heptagon', name: 'Heptagon', atlas: 15, sides: 7, categories: ['heptagon'] },
  octagon: { shape: 'octagon', name: 'Octagon', atlas: 12, sides: 8, categories: ['octagon'] },
  nonagon: { shape: 'nonagon', name: 'Nonagon', atlas: 13, sides: 9, categories: ['nonagon'] },
  decagon: { shape: 'decagon', name: 'Decagon', atlas: 14, sides: 10, categories: ['decagon'] },
  // a shape family used as a challenge target; it has no fish of its own
  quadrilateral: { shape: 'quadrilateral', name: 'Four-sided', sides: 4, categories: ['quadrilateral'] },
};

// One challenge per level. A challenge names a target shape (or a shape family such as
// 'quadrilateral') and the distractors, which can never belong to the target's family: a
// square counts as a rectangle, a rhombus and a kite, so it is never a distractor for those.
// With `all`, every fish matching the target has to be caught before the level ends.
const LOCATIONS = [
  { name: 'Triangle Bay', background: 0, waterline: 388,
    challenges: [{ target: 'triangle', others: ['circle', 'square'], tutorial: true }] },
  { name: 'Pentagon Cove', background: 1, waterline: 390,
    challenges: [{ target: 'pentagon', others: ['triangle', 'hexagon'] }] },
  { name: 'Hexagon Pass', background: 2, waterline: 387,
    challenges: [{ target: 'hexagon', others: ['pentagon', 'octagon'] }] },
  { name: 'Quadrilateral Waters', background: 3, waterline: 388,
    challenges: [{ target: 'quadrilateral', all: true, fishScale: 0.82,
      fish: ['square', 'rectangle', 'parallelogram', 'rhombus', 'kite', 'triangle', 'circle'] }] },
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

function learningLines(shape) {
  if (shape.curved) return ['Curved all around', 'No corners'];
  return [`${shape.sides} straight sides`, `${shape.sides} corners`];
}

function sideFact(shape) {
  return shape.fact || `${shape.sides} straight sides and ${shape.sides} corners.`;
}

Object.assign(PopoGame, { TERMS, SHAPES, LOCATIONS, getShape, matchesTarget, challengeFish, learningLines, sideFact });
})(window.PopoGame = window.PopoGame || {});
