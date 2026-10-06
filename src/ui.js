(function (PopoGame) {
'use strict';
const { assets, SHAPES, learningLines, sideFact, TOTAL_SHAPES } = PopoGame;

const $ = (id) => document.getElementById(id);

function polygonPoints(n, r, rotate) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = rotate + (i / n) * Math.PI * 2;
    pts.push(`${(32 + Math.cos(a) * r).toFixed(1)},${(32 + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Plain geometric symbol for a shape key: this is the learning cue, so it carries no colour.
function shapeSymbol(key) {
  const s = SHAPES[key];
  const style = 'fill="#fff" stroke="#f08a1d" stroke-width="3.5" stroke-linejoin="round"';
  let body;
  switch (key) {
    case 'circle': body = `<circle cx="32" cy="32" r="24" ${style}/>`; break;
    case 'oval': body = `<ellipse cx="32" cy="32" rx="28" ry="18" ${style}/>`; break;
    case 'triangle': body = `<polygon points="32,8 57,54 7,54" ${style}/>`; break;
    case 'square': body = `<rect x="11" y="11" width="42" height="42" ${style}/>`; break;
    case 'square-tilted': body = `<polygon points="32,5 59,32 32,59 5,32" ${style}/>`; break;
    case 'rectangle': body = `<rect x="5" y="17" width="54" height="30" ${style}/>`; break;
    case 'parallelogram': body = `<polygon points="19,16 61,16 45,48 3,48" ${style}/>`; break;
    case 'trapezium': body = `<polygon points="19,16 45,16 60,48 4,48" ${style}/>`; break;
    case 'kite': body = `<polygon points="32,4 56,27 32,60 8,27" ${style}/>`; break;
    default: {
      const n = s.sides;
      const rotate = n % 2 === 1 ? -Math.PI / 2 : Math.PI / n - Math.PI / 2;
      body = `<polygon points="${polygonPoints(n, 26, rotate)}" ${style}/>`;
    }
  }
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${body}</svg>`;
}

// Draws one fish from the atlas into a canvas element, so DOM icons stay crisp at any size.
function fishCanvas(atlasIndex, size) {
  const [x0, y0, x1, y1] = assets.fish.boxes[atlasIndex];
  const w = x1 - x0;
  const h = y1 - y0;
  const k = size / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k * 2);
  c.height = Math.round(h * k * 2);
  c.style.width = `${w * k}px`;
  c.style.height = `${h * k}px`;
  c.getContext('2d').drawImage(assets.fish.img, x0, y0, w, h, 0, 0, c.width, c.height);
  return c;
}

class UI {
  constructor() {
    this.el = {
      hud: $('hud'), hits: $('hits'), hand: $('hand'), start: $('screen-start'), loading: $('loading'), play: $('btn-play'),
      locationName: $('location-name'), progress: $('location-progress'),
      instruction: $('instruction'), instructionIcon: $('instruction-icon'), instructionText: $('instruction-text'),
      sound: $('btn-sound'), pause: $('btn-pause'), collectionCount: $('collection-count'), badges: $('collection-badges'),
      reward: $('overlay-reward'), rewardFish: $('reward-fish'), rewardImg: $('reward-fish-img'), rewardName: $('reward-name'), rewardFact: $('reward-fact'), cont: $('btn-continue'),
      pauseOverlay: $('overlay-pause'), resume: $('btn-resume'), restart: $('btn-restart'),
      summary: $('overlay-summary'), summaryList: $('summary-list'), playAgain: $('btn-play-again'),
      rotate: $('rotate-hint'), world: $('world'),
    };
    this.handlers = {};
    this.hitButtons = new Map();
    this.scale = 1;
    this.hitsEnabled = false;
    const h = (name) => (e) => { e.preventDefault(); this.emit(name); };
    this.el.play.addEventListener('click', h('play'));
    this.el.sound.addEventListener('click', h('sound'));
    this.el.pause.addEventListener('click', h('pause'));
    this.el.resume.addEventListener('click', h('resume'));
    this.el.restart.addEventListener('click', h('restart'));
    this.el.cont.addEventListener('click', h('continue'));
    this.el.playAgain.addEventListener('click', h('playAgain'));
    this.el.rewardFish.addEventListener('click', () => {
      this.el.rewardFish.classList.remove('bounce');
      void this.el.rewardFish.offsetWidth;
      this.el.rewardFish.classList.add('bounce');
      this.emit('heroTap');
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, ...args) {
    if (this.handlers[name]) this.handlers[name](...args);
  }

  setScale(scale) {
    this.scale = scale;
  }

  toStage(clientX, clientY) {
    const r = this.el.hits.getBoundingClientRect();
    return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
  }

  setLoading(text) {
    this.el.loading.textContent = text;
    this.el.loading.hidden = !text;
    this.el.play.disabled = Boolean(text);
  }

  hideStart() {
    this.el.start.classList.add('fade-out');
    setTimeout(() => { this.el.start.hidden = true; }, 500);
  }

  showStart() {
    this.el.start.hidden = false;
    this.el.start.classList.remove('fade-out');
    this.el.hud.hidden = true;
  }

  showHud() {
    this.el.hud.hidden = false;
  }

  setLocation(name, done, total) {
    this.el.locationName.textContent = name;
    this.el.progress.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join('');
  }

  setInstruction(text, shapeKey = null) {
    this.el.instructionText.textContent = text;
    this.el.instructionIcon.innerHTML = shapeKey ? shapeSymbol(shapeKey) : '';
    this.el.instructionIcon.hidden = !shapeKey;
  }

  pulseTarget() {
    this.el.instruction.classList.remove('pulse');
    void this.el.instruction.offsetWidth;
    this.el.instruction.classList.add('pulse');
  }

  setSound(muted) {
    this.el.sound.setAttribute('aria-pressed', String(!muted));
    this.el.sound.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    this.el.sound.classList.toggle('muted', muted);
  }

  showPause(show) {
    this.el.pauseOverlay.hidden = !show;
    if (show) this.el.resume.focus();
  }

  setWorldBlur(on) {
    this.el.world.classList.toggle('blurred', on);
  }

  // --- fish hit targets -------------------------------------------------
  setHitsEnabled(on) {
    this.hitsEnabled = on;
    this.el.hits.classList.toggle('enabled', on);
  }

  syncHits(fishList) {
    const alive = new Set();
    for (const fish of fishList) {
      if (fish.gone) continue;
      alive.add(fish);
      let btn = this.hitButtons.get(fish);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fish-hit';
        btn.setAttribute('aria-label', `${fish.shape.name} fish`);
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.emit('fishTap', fish, this.toStage(e.clientX, e.clientY)); });
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.emit('fishTap', fish, null); } });
        this.el.hits.appendChild(btn);
        this.hitButtons.set(fish, btn);
      }
      const r = fish.hitRect();
      const k = this.scale;
      btn.style.transform = `translate(${(r.x * k).toFixed(1)}px, ${(r.y * k).toFixed(1)}px)`;
      btn.style.width = `${Math.max(44, r.w * k).toFixed(1)}px`;
      btn.style.height = `${Math.max(44, r.h * k).toFixed(1)}px`;
    }
    for (const [fish, btn] of this.hitButtons) {
      if (!alive.has(fish)) { btn.remove(); this.hitButtons.delete(fish); }
    }
  }

  clearHits() {
    for (const btn of this.hitButtons.values()) btn.remove();
    this.hitButtons.clear();
  }

  // --- tutorial hand --------------------------------------------------------
  showHand() { this.el.hand.hidden = false; }
  hideHand() { this.el.hand.hidden = true; }
  moveHand(x, y) {
    this.el.hand.style.transform = `translate(${(x * this.scale).toFixed(1)}px, ${(y * this.scale).toFixed(1)}px)`;
  }

  // --- collection -----------------------------------------------------------
  setCollection(discovered) {
    this.el.collectionCount.textContent = `${discovered.size} / ${TOTAL_SHAPES}`;
    this.el.badges.innerHTML = '';
    for (const shapeId of discovered) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.title = SHAPES[shapeId].name;
      b.innerHTML = shapeSymbol(shapeId);
      this.el.badges.appendChild(b);
    }
  }

  // --- reward ---------------------------------------------------------------
  showReward(shape) {
    this.el.rewardImg.innerHTML = '';
    this.el.rewardImg.appendChild(fishCanvas(shape.atlas, 240));
    this.el.rewardName.textContent = shape.name.toUpperCase();
    const lines = learningLines(shape);
    this.el.rewardFact.innerHTML = `<span>${lines[0]}</span><span>${lines[1]}</span><em>${sideFact(shape)}</em>`;
    this.el.reward.hidden = false;
    this.el.reward.classList.remove('leave');
    this.setWorldBlur(true);
    this.el.cont.focus({ preventScroll: true });
  }

  hideReward() {
    this.el.reward.classList.add('leave');
    this.setWorldBlur(false);
    setTimeout(() => { this.el.reward.hidden = true; }, 400);
  }

  // --- summary --------------------------------------------------------------
  showSummary(discoveredKeys) {
    this.el.summaryList.innerHTML = '';
    for (const key of discoveredKeys) {
      const li = document.createElement('li');
      li.appendChild(fishCanvas(SHAPES[key].atlas, 70));
      const name = document.createElement('span');
      name.textContent = SHAPES[key].name;
      li.appendChild(name);
      this.el.summaryList.appendChild(li);
    }
    this.el.summary.hidden = false;
    this.setWorldBlur(true);
    this.el.playAgain.focus({ preventScroll: true });
  }

  hideSummary() {
    this.el.summary.hidden = true;
    this.setWorldBlur(false);
  }

  showRotateHint(show) {
    this.el.rotate.hidden = !show;
  }
}

Object.assign(PopoGame, { shapeSymbol, UI });
})(window.PopoGame = window.PopoGame || {});
