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
  'triangle-right': { shape: 'triangle', name: 'Triangle', atlas: 'triangle-right', sides: 3, categories: ['triangle'],
    fact: 'One square corner, and still a triangle.' },
  square: { shape: 'square', name: 'Square', atlas: 'square', sides: 4,
    categories: ['square', 'rectangle', 'rhombus', 'parallelogram', 'quadrilateral'],
    fact: '4 equal sides and 4 square corners.' },
  rectangle: { shape: 'rectangle', name: 'Rectangle', atlas: 'rectangle', sides: 4,
    categories: ['rectangle', 'parallelogram', 'quadrilateral'],
    fact: '4 square corners. Two long sides and two short sides.' },
  rhombus: { shape: 'rhombus', name: 'Rhombus', atlas: 'rhombus', sides: 4,
    categories: ['rhombus', 'parallelogram', 'quadrilateral'],
    fact: '4 equal sides, like a square pushed over.' },
  parallelogram: { shape: 'parallelogram', name: 'Parallelogram', atlas: 'parallelogram', sides: 4,
    categories: ['parallelogram', 'quadrilateral'],
    fact: 'Opposite sides are parallel, like a leaning rectangle.' },
  trapezium: { shape: 'trapezium', name: TERMS.trapezium, atlas: 'trapezium', sides: 4,
    categories: ['trapezium', 'quadrilateral'],
    fact: 'Only one pair of sides is parallel.' },
  pentagon: { shape: 'pentagon', name: 'Pentagon', atlas: 'pentagon', sides: 5, categories: ['pentagon'] },
  hexagon: { shape: 'hexagon', name: 'Hexagon', atlas: 'hexagon', sides: 6, categories: ['hexagon'] },
  octagon: { shape: 'octagon', name: 'Octagon', atlas: 'octagon', sides: 8, categories: ['octagon'] },
  nonagon: { shape: 'nonagon', name: 'Nonagon', atlas: 'nonagon', sides: 9, categories: ['nonagon'] },
  decagon: { shape: 'decagon', name: 'Decagon', atlas: 'decagon', sides: 10, categories: ['decagon'] },
  circle: { shape: 'circle', name: 'Circle', atlas: 'circle', curved: true, categories: ['circle'],
    fact: 'Round all the way around, with no corners.' },
  oval: { shape: 'oval', name: 'Oval', atlas: 'oval', curved: true, categories: ['oval'],
    fact: 'A stretched circle: curved, with no corners.' },
  semicircle: { shape: 'semicircle', name: 'Semicircle', atlas: 'semicircle', categories: ['semicircle'],
    lines: ['1 curved side, 1 straight side', '2 corners'], fact: 'Half of a circle.' },
  // a shape family used as a challenge target; it has no fish of its own
  quadrilateral: { shape: 'quadrilateral', name: 'Four-sided', sides: 4, categories: ['quadrilateral'] },
};

// One challenge per level. A challenge names a target shape (or a shape family such as
// 'quadrilateral') and the distractors, which can never belong to the target's family: a
// square counts as a rectangle and a rhombus, so it is never a distractor for those.
// With `all`, every fish matching the target has to be caught before the level ends.
const LOCATIONS = [
  { name: 'Triangle Bay', background: 0, waterline: 388,
    challenges: [{ target: 'triangle', others: ['circle', 'square'], tutorial: true }] },
  { name: 'Pentagon Cove', background: 1, waterline: 390,
    challenges: [{ target: 'pentagon', others: ['hexagon', 'semicircle'] }] },
  { name: 'Hexagon Pass', background: 2, waterline: 387,
    challenges: [{ target: 'hexagon', others: ['pentagon', 'octagon'] }] },
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

function learningLines(shape) {
  if (shape.lines) return shape.lines;
  if (shape.curved) return ['Curved all around', 'No corners'];
  return [`${shape.sides} straight sides`, `${shape.sides} corners`];
}

function sideFact(shape) {
  return shape.fact || `${shape.sides} straight sides and ${shape.sides} corners.`;
}

Object.assign(PopoGame, { TERMS, SHAPES, LOCATIONS, getShape, matchesTarget, challengeFish, learningLines, sideFact });
})(window.PopoGame = window.PopoGame || {});
