(function (PopoGame) {
'use strict';
const { SHEET_DATA, FISH_ATLAS } = PopoGame;

const TITLE = PopoGame.TITLE_DATA || 'assets/backgrounds/title.webp';
const PLAY = PopoGame.PLAY_DATA || 'assets/sprites/play.webp';
const BACKGROUNDS = PopoGame.BACKGROUND_DATA || [1, 2, 3, 4].map((n) => `assets/backgrounds/location-${n}.webp`);

const assets = {
  backgrounds: [],
  sheets: {},
  fish: null,
};

const pending = new Map();

// Canvas filters (hue-rotate) don't exist in Safari, so on iPhones and iPads every variant
// would keep its base colour. Check once by tinting a red pixel (no image, so never tainted).
function canvasFiltersWork() {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d');
  g.filter = 'hue-rotate(120deg)';
  g.fillStyle = '#f00';
  g.fillRect(0, 0, 1, 1);
  const [r, green] = g.getImageData(0, 0, 1, 1).data;
  return green > r;
}

// The main body hue of each base sprite (measured from the art), for the fallback recolour.
const BODY_HUE = { triangle: 0, 'triangle-right': 110, pentagon: 0, hexagon: 270, square: 110, rectangle: 30, rhombus: 50, parallelogram: 110 };

// Bake the variants once, including their dimensions and mouth anchors. Swimming,
// catching and the story can all use the same sprite without per-frame filters.
function generateFishVariants() {
  assets.fish.variants = {};
  const filters = canvasFiltersWork();
  for (const [key, variant] of Object.entries(PopoGame.FISH_VARIANTS)) {
    const [x0, y0, x1, y1] = assets.fish.boxes[variant.base];
    const img = document.createElement('canvas');
    img.width = Math.round((x1 - x0) * variant.sx);
    img.height = Math.round((y1 - y0) * variant.sy);
    const ctx = img.getContext('2d');
    const draw = () => ctx.drawImage(assets.fish.img, x0, y0, x1 - x0, y1 - y0, 0, 0, img.width, img.height);
    if (filters) {
      ctx.filter = `hue-rotate(${variant.hue}deg)`;
      draw();
    } else {
      // a "hue" blend takes the new hue but keeps each pixel's saturation and lightness, so
      // the eyes stay white and the outlines dark; then the fish's own outline cuts it out
      draw();
      ctx.globalCompositeOperation = 'hue';
      ctx.fillStyle = `hsl(${((BODY_HUE[variant.base] || 0) + variant.hue) % 360}, 90%, 50%)`;
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.globalCompositeOperation = 'destination-in';
      draw();
      ctx.globalCompositeOperation = 'source-over';
    }
    assets.fish.variants[key] = {
      img, box: [0, 0, img.width, img.height], mouth: assets.fish.mouths[variant.base],
    };
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Each background comes with a water mask (white where the surface waves may move it).
const WATER_MASKS = PopoGame.WATER_MASKS || [1, 2, 3, 4].map((n) => `assets/backgrounds/water-${n}.png`);

function preloadBackground(index) {
  if (!pending.has(index)) {
    pending.set(index, Promise.all([loadImage(BACKGROUNDS[index]), loadImage(WATER_MASKS[index])]).then(([img, mask]) => {
      img.waterMask = mask;
      assets.backgrounds[index] = img;
      return img;
    }, (err) => {
      pending.delete(index); // let the next attempt try again
      throw err;
    }));
  }
  return pending.get(index);
}

async function loadCoreAssets() {
  const [fishing, rowing, fish, bg0, props, mishapPoses, title, play, rowCycle, swiftee] = await Promise.all([
    loadImage('assets/sprites/popo-fishing.webp'),
    loadImage('assets/sprites/popo-rowing.webp'),
    loadImage('assets/sprites/fish.webp'),
    preloadBackground(0),
    loadImage('assets/sprites/popo-props.webp'),
    loadImage('assets/sprites/popo-mishap.png'),
    loadImage(TITLE),
    loadImage(PLAY),
    loadImage('assets/sprites/popo-row-cycle.webp'),
    loadImage('assets/sprites/swiftee.webp'),
  ]);
  assets.rowCycle = rowCycle;
  assets.title = title;
  assets.swiftee = swiftee;
  assets.play = play;
  assets.props = props;
  assets.mishapPoses = mishapPoses;
  assets.sheets = {
    fishing: { img: fishing, data: SHEET_DATA.fishing },
    casting: { img: fishing, data: SHEET_DATA.fishing },
    rowing: { img: rowing, data: SHEET_DATA.rowing },
  };
  assets.fish = { img: fish, boxes: FISH_ATLAS.boxes, mouths: FISH_ATLAS.mouths, width: FISH_ATLAS.width, height: FISH_ATLAS.height };
  generateFishVariants();
  preloadBackground(1);
  return bg0;
}

Object.assign(PopoGame, { BACKGROUNDS, assets, loadImage, preloadBackground, loadCoreAssets });
})(window.PopoGame = window.PopoGame || {});
