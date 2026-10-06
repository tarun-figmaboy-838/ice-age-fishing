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
  pentagon: { shape: 'pentagon', name: 'Pentagon', atlas: 9, sides: 5, categories: ['pentagon'] },
  hexagon: { shape: 'hexagon', name: 'Hexagon', atlas: 10, sides: 6, categories: ['hexagon'] },
  octagon: { shape: 'octagon', name: 'Octagon', atlas: 12, sides: 8, categories: ['octagon'] },
  'octagon-tilted': { shape: 'octagon', name: 'Octagon', atlas: 11, sides: 8, categories: ['octagon'],
    fact: 'Turned a little, it is still an octagon.' },
  nonagon: { shape: 'nonagon', name: 'Nonagon', atlas: 13, sides: 9, categories: ['nonagon'] },
  decagon: { shape: 'decagon', name: 'Decagon', atlas: 14, sides: 10, categories: ['decagon'] },
};

// Each challenge lists the target and the distractors explicitly so no distractor can ever
// also belong to the target's family (see categories above).
const LOCATIONS = [
  {
    name: 'Frosty Bay', background: 0, waterline: 388,
    challenges: [
      { target: 'circle', others: ['triangle', 'square'], tutorial: true },
      { target: 'triangle', others: ['circle', 'oval'] },
      { target: 'square', others: ['triangle', 'circle'] },
      { target: 'oval', others: ['circle', 'square'] },
    ],
  },
  {
    name: 'Glacier Cove', background: 1, waterline: 390,
    challenges: [
      { target: 'rectangle', others: ['trapezium', 'kite'] },
      { target: 'parallelogram', others: ['trapezium', 'triangle'] },
      { target: 'trapezium', others: ['parallelogram', 'kite'] },
      { target: 'kite', others: ['rectangle', 'trapezium'] },
    ],
  },
  {
    name: 'Iceberg Pass', background: 2, waterline: 387,
    challenges: [
      { target: 'pentagon', others: ['square', 'hexagon'] },
      { target: 'hexagon', others: ['pentagon', 'triangle'] },
      { target: 'octagon', others: ['hexagon', 'circle'] },
    ],
  },
  {
    name: 'Aurora Waters', background: 3, waterline: 388,
    challenges: [
      { target: 'octagon-tilted', others: ['hexagon', 'square-tilted'] },
      { target: 'nonagon', others: ['pentagon', 'hexagon'] },
      { target: 'decagon', others: ['octagon', 'hexagon'] },
    ],
  },
];

const TOTAL_SHAPES = new Set(Object.values(SHAPES).map((s) => s.shape)).size;

function getShape(key) {
  return SHAPES[key];
}

function matchesTarget(fishKey, targetKey) {
  return SHAPES[fishKey].categories.includes(SHAPES[targetKey].shape);
}

function learningLines(shape) {
  if (shape.curved) return ['Curved all around', 'No corners'];
  return [`${shape.sides} straight sides`, `${shape.sides} corners`];
}

function sideFact(shape) {
  return shape.fact || `${shape.sides} straight sides and ${shape.sides} corners.`;
}

Object.assign(PopoGame, { TERMS, SHAPES, LOCATIONS, TOTAL_SHAPES, getShape, matchesTarget, learningLines, sideFact });
})(window.PopoGame = window.PopoGame || {});
