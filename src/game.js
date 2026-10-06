(function (PopoGame) {
'use strict';
const { assets, preloadBackground, clock, Effects, spawnFish, LOCATIONS, matchesTarget, getShape, Popo, correctCatch, wrongCatch, travelTo, tutorial, mouthOf, STAGE_W, STAGE_H, swimArea, raftAnchor, state, PHASE, resetProgress, newToken, isCurrent } = PopoGame;

const HINT_DELAY = 4;

// Each background is treated as three depth layers. During a row the far layer travels
// less than the near layer (parallax), and at rest the far and near layers drift a little
// against the water so the scene never sits perfectly still. Feather widths double as the
// per-layer blend into the next location's artwork.
const BANDS = [
  { top: 0, bottom: 340, feather: 640, drift: 1 },
  { top: 340, bottom: 640, feather: 320, drift: 0, wobble: { from: 346, to: 404, amp: 2.2, step: 6, flow: 9 } },
  { top: 640, bottom: STAGE_H, feather: 120, drift: -0.7, wobble: { from: 700, to: STAGE_H, amp: 2.6, step: 8 } },
];
const BAND_PAD = 14;

class Game {
  constructor({ stage, ui, audio }) {
    this.stage = stage;
    this.ui = ui;
    this.audio = audio;
    this.popo = new Popo();
    this.fx = new Effects();
    this.waterline = LOCATIONS[0].waterline;
    this.area = swimArea(this.waterline);
    this.transition = null;
    this.feathered = null;
    this.handFish = null;
    this.instructionRevert = 0;
    this.continueResolver = null;
    this.lastFrame = 0;
    this.running = false;
    ui.setScale(stage.scale);
  }

  // --- lifecycle ------------------------------------------------------------
  // The world renders behind the start screen as soon as the art is ready.
  showIdleScene() {
    this.applyLocation();
    if (!this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  start() {
    this.audio.init();
    this.audio.resume();
    this.audio.startMusic();
    resetProgress();
    this.ui.hideStart();
    this.ui.showHud();
    this.ui.setCollection(state.discovered);
    this.applyLocation();
    this.spawnChallengeFish();
    this.ui.setHitsEnabled(false);
    tutorial(this);
    this.showIdleScene();
  }

  restart() {
    newToken();
    clock.cancelAll();
    this.fx.clearTransient();
    this.audio.stopEffects();
    this.instructionRevert = 0;
    this.continueResolver = null;
    this.transition = null;
    this.ui.hideReward();
    this.ui.hideSummary();
    this.ui.showPause(false);
    this.ui.hideHand();
    this.ui.clearHits();
    this.handFish = null;
    const muted = state.muted;
    resetProgress();
    state.muted = muted;
    state.paused = false;
    this.audio.resume();
    this.popo = new Popo();
    this.ui.setCollection(state.discovered);
    this.applyLocation();
    this.spawnChallengeFish();
    tutorial(this);
  }

  dispose() {
    this.running = false;
    newToken();
    clock.cancelAll();
    this.continueResolver = null;
    this.transition = null;
    this.handFish = null;
    this.instructionRevert = 0;
    this.fx.clearTransient();
    this.audio.stopEffects();
    this.audio.stopMusic();
    this.popo.endMishap();
    this.ui.hideHand();
    this.ui.setHitsEnabled(false);
    state.selectedFish = null;
    state.phase = PHASE.INTRO;
  }

  applyLocation() {
    const loc = LOCATIONS[state.locationIndex];
    this.setWaterline(loc.waterline);
    this.ui.setLocation(loc.name, state.challengeIndex, loc.challenges.length);
    if (state.locationIndex + 1 < LOCATIONS.length) preloadBackground(LOCATIONS[state.locationIndex + 1].background);
  }

  setWaterline(y) {
    this.waterline = y;
    this.area = swimArea(y);
    this.fx.setWaterline(y);
    const a = raftAnchor(y);
    this.popo.setAnchor(a.x, a.y);
  }

  locationWaterline(index) {
    return LOCATIONS[index].waterline;
  }

  currentChallenge() {
    return LOCATIONS[state.locationIndex].challenges[state.challengeIndex];
  }

  spawnChallengeFish() {
    const ch = this.currentChallenge();
    state.target = ch.target;
    state.selectedFish = null;
    state.fish = spawnFish([ch.target, ...ch.others], this.area);
    state.idleTime = 0;
    state.hintShown = false;
    const name = getShape(ch.target).name.toLowerCase();
    this.ui.setInstruction(`Catch the ${name} fish!`, ch.target);
    this.ui.setLocation(LOCATIONS[state.locationIndex].name, state.challengeIndex, LOCATIONS[state.locationIndex].challenges.length);
  }

  setupChallenge() {
    this.spawnChallengeFish();
    state.phase = PHASE.READY;
    this.ui.setHitsEnabled(true);
  }

  nextChallenge() {
    const loc = LOCATIONS[state.locationIndex];
    state.challengeIndex += 1;
    if (state.challengeIndex < loc.challenges.length) {
      this.setupChallenge();
    } else if (state.locationIndex + 1 < LOCATIONS.length) {
      travelTo(this, state.locationIndex + 1);
    } else {
      this.complete();
    }
  }

  complete() {
    state.phase = PHASE.COMPLETE;
    this.ui.setHitsEnabled(false);
    this.ui.setInstruction('Great fishing, Popo!', null);
    this.audio.play('complete');
    this.ui.showSummary([...state.discovered]);
  }

  collect(fish) {
    state.collected.push(fish.key);
    state.discovered.add(fish.shape.shape);
    this.ui.setCollection(state.discovered);
    this.ui.setLocation(LOCATIONS[state.locationIndex].name, state.challengeIndex + 1, LOCATIONS[state.locationIndex].challenges.length);
  }

  waitForContinue(token) {
    return new Promise((resolve) => {
      this.continueResolver = () => { if (isCurrent(token)) resolve(); };
    });
  }

  onContinue() {
    this.audio.play('ui');
    if (this.continueResolver) {
      const r = this.continueResolver;
      this.continueResolver = null;
      r();
    }
  }

  // --- input ----------------------------------------------------------------
  // Hit targets are larger than the fish, so when two overlap the fish whose body is
  // nearest the pointer wins rather than whichever button happens to be on top.
  fishAt(point, fallback) {
    let best = fallback;
    let bestScore = Infinity;
    for (const f of state.fish) {
      if (f.gone || f.escaping) continue;
      const r = f.hitRect();
      if (point.x < r.x || point.x > r.x + r.w || point.y < r.y || point.y > r.y + r.h) continue;
      const score = Math.hypot((point.x - f.x) / f.w, (point.y - f.y) / f.h);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  onFishTap(tapped, point) {
    const fish = point ? this.fishAt(point, tapped) : tapped;
    if (state.paused || state.phase !== PHASE.READY || state.selectedFish || fish.gone || fish.escaping) return;
    state.selectedFish = fish;
    state.idleTime = 0;
    this.clearHint();
    this.instructionRevert = 0;
    this.ui.setInstruction(`Catch the ${getShape(state.target).name.toLowerCase()} fish!`, state.target);
    if (matchesTarget(fish.key, state.target)) {
      if (this.handFish) { this.ui.hideHand(); this.handFish = null; }
      correctCatch(this, fish);
    } else {
      wrongCatch(this, fish);
    }
  }

  showHandOn(fish) {
    this.handFish = fish || null;
    if (fish) this.ui.showHand();
  }

  togglePause() {
    if (state.phase === PHASE.INTRO || state.phase === PHASE.COMPLETE) return;
    state.paused = !state.paused;
    this.ui.showPause(state.paused);
    if (state.paused) this.audio.suspend();
    else this.audio.resume();
    if (!state.paused) this.lastFrame = performance.now();
  }

  toggleSound() {
    state.muted = !state.muted;
    this.audio.setMuted(state.muted);
    this.ui.setSound(state.muted);
    try { localStorage.setItem('popo-muted', state.muted ? '1' : '0'); } catch (e) { /* storage may be unavailable */ }
  }

  resize() {
    this.stage.resize();
    this.ui.setScale(this.stage.scale);
    this.ui.showRotateHint(this.stage.portrait);
  }

  // Shows feedback for a while, then brings the challenge instruction back.
  revertInstructionIn(ms) {
    this.instructionRevert = ms;
  }

  updateInstruction(dt) {
    if (this.instructionRevert <= 0) return;
    this.instructionRevert -= dt * 1000;
    if (this.instructionRevert <= 0 && state.phase === PHASE.READY) {
      const name = getShape(state.target).name.toLowerCase();
      this.ui.setInstruction(`Catch the ${name} fish!`, state.target);
    }
  }

  // --- hints ------------------------------------------------------------------
  clearHint() {
    for (const f of state.fish) f.hinted = false;
  }

  updateHint(dt) {
    if (state.phase !== PHASE.READY || state.selectedFish) return;
    state.idleTime += dt;
    if (state.idleTime > HINT_DELAY && !state.hintShown) {
      state.hintShown = true;
      const target = state.fish.find((f) => matchesTarget(f.key, state.target));
      if (target) target.hinted = true;
      this.ui.pulseTarget();
      this.audio.play('hint');
    }
    if (state.idleTime > HINT_DELAY + 3) {
      this.clearHint();
      state.idleTime = 0;
      state.hintShown = false;
    }
  }

  // --- travel -----------------------------------------------------------------
  async prepareTransition(nextIndex) {
    const img = await preloadBackground(LOCATIONS[nextIndex].background);
    const c = document.createElement('canvas');
    c.width = STAGE_W;
    c.height = STAGE_H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, STAGE_W, STAGE_H);
    const mask = document.createElement('canvas');
    mask.width = STAGE_W;
    mask.height = STAGE_H;
    const m = mask.getContext('2d');
    for (const band of BANDS) {
      const g = m.createLinearGradient(0, 0, band.feather, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      m.fillStyle = g;
      m.fillRect(0, band.top, band.feather, band.bottom - band.top);
      m.fillStyle = '#000';
      m.fillRect(band.feather, band.top, STAGE_W - band.feather, band.bottom - band.top);
    }
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    this.feathered = c;
    this.transition = { from: state.locationIndex, to: nextIndex, k: 0 };
  }

  finishTransition(nextIndex) {
    this.transition = null;
    this.feathered = null;
    state.locationIndex = nextIndex;
    state.challengeIndex = 0;
    this.applyLocation();
  }

  // --- loop -------------------------------------------------------------------
  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (!state.paused) this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    clock.update(dt);
    this.popo.update(dt);
    this.fx.update(dt);
    for (const f of state.fish) {
      f.update(dt, this.area, state.fish);
      if (f.breath <= 0 && !f.gone) {
        f.breath = 3 + Math.random() * 5;
        this.fx.bubbleAt(f.x + f.dir * f.w * 0.42, f.y - f.h * 0.05, 1.6 + Math.random() * 1.4);
      }
    }
    if (this.popo.line.mode === 'attached' && state.selectedFish) {
      const m = mouthOf(state.selectedFish);
      this.popo.line.hook.x = m.x;
      this.popo.line.hook.y = m.y;
    }
    if (this.handFish && !this.handFish.gone) this.ui.moveHand(this.handFish.x + 10, this.handFish.y + this.handFish.h * 0.3);
    this.updateHint(dt);
    this.updateInstruction(dt);
  }

  drawBand(ctx, img, band, ox) {
    const h = Math.min(STAGE_H, band.bottom + 3) - band.top;
    ctx.drawImage(img, 0, band.top, STAGE_W, h, ox - BAND_PAD, band.top, STAGE_W + BAND_PAD * 2, h);
    // water refraction: thin strips of the surface texture and the seabed sway sideways
    const w = band.wobble;
    if (!w || this.fx.reduced) return;
    const t = this.fx.t;
    for (let y = w.from; y < w.to; y += w.step) {
      const depth = (y - w.from) / (w.to - w.from);
      const dx = Math.sin(t * 1.1 + y * 0.045) * w.amp * (0.4 + depth) + Math.sin(t * 0.7 - y * 0.02) * w.amp * 0.5
        + (w.flow ? Math.sin(t * 0.21) * w.flow * (1 - depth * 0.5) : 0);
      const sh = Math.min(w.step, w.to - y);
      ctx.drawImage(img, 0, y, STAGE_W, sh, ox - BAND_PAD + dx, y, STAGE_W + BAND_PAD * 2, sh);
    }
  }

  // Returns the water layer's horizontal offset so the underwater effects can follow it.
  drawBackground(ctx) {
    const index = LOCATIONS[state.locationIndex].background;
    const current = assets.backgrounds[index];
    if (!current) {
      preloadBackground(index);
      return 0;
    }
    const sway = this.fx.reduced ? 0 : Math.sin(this.fx.t * 0.18) * 7;
    const k = this.transition ? this.transition.k : 0;
    const next = this.transition ? assets.backgrounds[LOCATIONS[this.transition.to].background] : null;
    let waterOffset = 0;
    for (const band of BANDS) {
      const travel = STAGE_W - band.feather;
      const ox = -k * travel + sway * band.drift;
      if (band.drift === 0) waterOffset = ox;
      ctx.save();
      ctx.beginPath();
      // bands overlap by a couple of pixels so anti-aliased clip edges never leave a seam
      ctx.rect(0, band.top, STAGE_W, band.bottom - band.top + 3);
      ctx.clip();
      if (this.transition) {
        // the next scenery sits underneath, so there is never a gap past the current edge,
        // and its feathered copy blends the seam once the overlap has started
        this.drawBand(ctx, next, band, ox + travel);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, band.top, ox + STAGE_W + BAND_PAD, band.bottom - band.top);
        ctx.clip();
        this.drawBand(ctx, current, band, ox);
        ctx.restore();
        ctx.globalAlpha = Math.min(1, k * 8);
        this.drawBand(ctx, this.feathered, band, ox + travel);
        if (k > 0.85) {
          ctx.globalAlpha = (k - 0.85) / 0.15;
          this.drawBand(ctx, next, band, ox + travel);
        }
        ctx.globalAlpha = 1;
      } else {
        this.drawBand(ctx, current, band, ox);
      }
      ctx.restore();
    }
    return waterOffset;
  }

  draw() {
    const ctx = this.stage.begin();
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    const offset = this.drawBackground(ctx);
    this.fx.drawWater(ctx, offset);
    for (const f of state.fish) f.draw(ctx);
    this.popo.drawLine(ctx);
    this.popo.draw(ctx);
    this.fx.drawDepthVeil(ctx);
    this.fx.drawFront(ctx);
    this.ui.syncHits(state.fish);
  }
}

Object.assign(PopoGame, { Game });
})(window.PopoGame = window.PopoGame || {});
