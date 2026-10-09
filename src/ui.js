(function (PopoGame) {
'use strict';
const { assets, SHAPES, learningLines, sideFact } = PopoGame;

const $ = (id) => document.getElementById(id);

function polygonPoints(n, r, rotate) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = rotate + (i / n) * Math.PI * 2;
    pts.push(`${(32 + Math.cos(a) * r).toFixed(1)},${(32 + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Draws one fish from the atlas into a canvas element, so DOM icons stay crisp at any size.
function fishCanvas(sprite, size) {
  const [x0, y0, x1, y1] = assets.fish.boxes[sprite];
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
      instruction: $('instruction'), instructionText: $('instruction-text'),
      sound: $('btn-sound'), pause: $('btn-pause'),
      reward: $('overlay-reward'), rewardFish: $('reward-fish'), rewardImg: $('reward-fish-img'), rewardName: $('reward-name'), rewardFact: $('reward-fact'),
      pauseOverlay: $('overlay-pause'), resume: $('btn-resume'), restart: $('btn-restart'),
      summary: $('overlay-summary'), summaryList: $('summary-list'), playAgain: $('btn-play-again'),
      rotate: $('rotate-hint'), scene: $('scene'), speech: $('speech'), caption: $('caption'),
    };
    this.handlers = {};
    this.hitButtons = new Map();
    this.scale = 1;
    this.hitsEnabled = false;
    const h = (name) => (e) => { e.preventDefault(); this.emit(name); };
    this.el.play.addEventListener('click', h('play'));
    this.el.play.addEventListener('pointerenter', () => this.emit('playHover', true));
    this.el.play.addEventListener('pointerleave', () => this.emit('playHover', false));
    this.el.play.addEventListener('pointerdown', () => this.emit('playPress'));
    this.el.sound.addEventListener('click', h('sound'));
    this.el.pause.addEventListener('click', h('pause'));
    this.el.resume.addEventListener('click', h('resume'));
    this.el.restart.addEventListener('click', h('restart'));
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

  // A story line: Popo's speech bubble (anchored at a stage point) or the narrator's caption.
  // Every word is laid out up front (hidden) so the bubble never resizes as words appear.
  showLine(who, words) {
    this.hideLines();
    const el = who === 'narrator' ? this.el.caption : this.el.speech;
    const line = el.querySelector('.line');
    line.innerHTML = '';
    this.wordEls = words.map((w, i) => {
      const span = document.createElement('span');
      span.className = w.em ? 'w em' : 'w';
      span.textContent = i < words.length - 1 ? `${w.text} ` : w.text;
      line.appendChild(span);
      return span;
    });
    el.hidden = false;
    el.classList.remove('pop', 'bump');
    void el.offsetWidth;
    el.classList.add('pop');
    this.el.hud.classList.add('talking');
    this.lineEl = el;
  }

  revealWord(i, bump) {
    const span = this.wordEls && this.wordEls[i];
    if (span) span.classList.add('in');
    if (bump && this.lineEl === this.el.speech) {
      this.el.speech.classList.remove('pop', 'bump');
      void this.el.speech.offsetWidth;
      this.el.speech.classList.add('bump');
    }
  }

  placePlay(x, y, r) {
    const k = this.scale;
    const s = this.el.play.style;
    s.transform = `translate(${((x - r) * k).toFixed(1)}px, ${((y - r) * k).toFixed(1)}px)`;
    s.width = s.height = `${(2 * r * k).toFixed(1)}px`;
  }

  placeSpeech(x, y) {
    this.el.speech.style.left = `${(x * this.scale).toFixed(1)}px`;
    this.el.speech.style.top = `${(y * this.scale).toFixed(1)}px`;
  }

  hideLines() {
    this.el.speech.hidden = true;
    this.el.caption.hidden = true;
    this.el.hud.classList.remove('talking');
    this.lineEl = null;
    this.wordEls = null;
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


  // *word* is highlighted (the shape to catch). The panel gives a little boing on every change.
  setInstruction(text) {
    const el = this.el.instructionText;
    this.el.instruction.classList.toggle('empty', !text);
    if (text === this.instructionShown) return;
    this.instructionShown = text;
    el.textContent = '';
    text.split(/(\*[^*]+\*)/).forEach((part) => {
      if (!part) return;
      if (part.startsWith('*')) {
        const b = document.createElement('b');
        b.className = 'hl';
        b.textContent = part.slice(1, -1);
        el.appendChild(b);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
    if (!text) return;
    this.el.instruction.classList.remove('say', 'pulse');
    void this.el.instruction.offsetWidth;
    this.el.instruction.classList.add('say');
  }


  pulseTarget() {
    this.el.instruction.classList.remove('pulse', 'say');
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
    this.el.scene.classList.toggle('blurred', on);
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

  // --- reward ---------------------------------------------------------------
  showReward(shape) {
    this.el.rewardImg.innerHTML = '';
    this.el.rewardImg.appendChild(fishCanvas(shape.atlas, 240));
    this.el.rewardName.textContent = shape.name.toUpperCase();
    const lines = learningLines(shape);
    this.el.rewardFact.innerHTML = `<span>${lines[0]}</span><span>${lines[1]}</span><em>${sideFact(shape)}</em>`;
    this.el.reward.hidden = false;
    this.el.reward.classList.remove('leave');
    this.el.hud.classList.add('prize');
    this.setWorldBlur(true);
  }

  hideReward() {
    this.el.reward.classList.add('leave');
    this.el.hud.classList.remove('prize');
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

Object.assign(PopoGame, { UI });
})(window.PopoGame = window.PopoGame || {});
