(function (PopoGame) {
'use strict';
const { SHEET_DATA, FISH_ATLAS } = PopoGame;

const BACKGROUNDS = [1, 2, 3, 4].map((n) => `assets/backgrounds/location-${n}.webp`);

const assets = {
  backgrounds: [],
  sheets: {},
  fish: null,
};

const pending = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function preloadBackground(index) {
  if (!pending.has(index)) {
    pending.set(index, loadImage(BACKGROUNDS[index]).then((img) => {
      assets.backgrounds[index] = img;
      return img;
    }));
  }
  return pending.get(index);
}

async function loadCoreAssets() {
  const [fishing, casting, rowing, fish, bg0, props, mishapPoses] = await Promise.all([
    loadImage('assets/sprites/popo-fishing.webp'),
    loadImage('assets/sprites/popo-casting.webp'),
    loadImage('assets/sprites/popo-rowing.webp'),
    loadImage('assets/sprites/fish.webp'),
    preloadBackground(0),
    loadImage('assets/sprites/popo-props.webp'),
    loadImage('assets/sprites/popo-mishap-poses.webp'),
  ]);
  assets.props = props;
  assets.mishapPoses = mishapPoses;
  assets.sheets = {
    fishing: { img: fishing, data: SHEET_DATA.fishing },
    casting: { img: casting, data: SHEET_DATA.casting },
    rowing: { img: rowing, data: SHEET_DATA.rowing },
  };
  assets.fish = { img: fish, boxes: FISH_ATLAS.boxes, width: FISH_ATLAS.width, height: FISH_ATLAS.height };
  preloadBackground(1);
  return bg0;
}

Object.assign(PopoGame, { BACKGROUNDS, assets, loadImage, preloadBackground, loadCoreAssets });
})(window.PopoGame = window.PopoGame || {});
