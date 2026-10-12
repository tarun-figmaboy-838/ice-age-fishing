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

// The extra fish (new colours and patterns, drawn as art) share one atlas; each is looked up
// by its own key, with its frame and measured mouth, like the original fish.
function mapFishVariants(img) {
  const { boxes, mouths } = PopoGame.FISH_VARIANT_ATLAS;
  assets.fish.variants = {};
  for (const key of Object.keys(boxes)) assets.fish.variants[key] = { img, box: boxes[key], mouth: mouths[key] };
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
  const [fishing, rowing, fish, bg0, props, mishapPoses, title, play, rowCycle, swiftee, fishVariants] = await Promise.all([
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
    loadImage('assets/sprites/fish-variants.webp'),
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
  mapFishVariants(fishVariants);
  preloadBackground(1);
  return bg0;
}

Object.assign(PopoGame, { BACKGROUNDS, assets, loadImage, preloadBackground, loadCoreAssets });
})(window.PopoGame = window.PopoGame || {});
