(function (PopoGame) {
'use strict';
const { assets, preloadBackground, clock, Effects, WaterScene, spawnFish, LOCATIONS, matchesTarget, challengeFish, getShape, Popo, correctCatch, wrongCatch, travelTo, tutorial, mouthOf, STAGE_W, STAGE_H, swimArea, raftAnchor, state, PHASE, resetProgress, newToken, isCurrent } = PopoGame;

const HINT_DELAY = 4;


class Game {
  constructor({ stage, ui, audio }) {
    this.stage = stage;
    this.ui = ui;
    this.audio = audio;
    this.popo = new Popo();
    this.fx = new Effects();
    this.water = new WaterScene(document.getElementById('water'));
    this.tutorialPending = false;
    this.waterline = LOCATIONS[0].waterline;
    this.area = swimArea(this.waterline);
    this.transition = null;
    this.handFish = null;
    this.instructionRevert = 0;
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
    this.applyLocation();
    this.spawnChallengeFish();
    this.ui.setHitsEnabled(false);
    this.tutorialPending = true;
    tutorial(this);
    this.showIdleScene();
  }

  restart() {
    newToken();
    clock.cancelAll();
    this.fx.clearTransient();
    this.audio.stopEffects();
    this.instructionRevert = 0;
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
    this.applyLocation();
    this.spawnChallengeFish();
    this.tutorialPending = true;
    tutorial(this);
  }

  dispose() {
    this.running = false;
    newToken();
    clock.cancelAll();
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
    this.fx.setLocation(loc.background);
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
    state.fish = spawnFish(challengeFish(ch), this.area, ch.fishScale || 1);
    state.idleTime = 0;
    state.hintShown = false;
    this.ui.setInstruction(this.challengeText(), ch.target);
  }

  challengeText() {
    const ch = this.currentChallenge();
    const name = getShape(ch.target).name.toLowerCase();
    return ch.all ? `Catch all the ${name} fish!` : `Catch the ${name} fish!`;
  }

  remainingTargets() {
    return state.fish.filter((f) => !f.gone && matchesTarget(f.key, state.target));
  }

  // After a catch: a catch-all challenge carries on while matching fish remain.
  afterCatch() {
    if (this.currentChallenge().all && this.remainingTargets().length > 0) {
      state.selectedFish = null;
      state.idleTime = 0;
      state.hintShown = false;
      this.ui.setInstruction(this.challengeText(), state.target);
      state.phase = PHASE.READY;
      this.ui.setHitsEnabled(true);
      return;
    }
    this.nextChallenge();
  }

  setupChallenge() {
    this.spawnChallengeFish();
    if (!this.currentChallenge().tutorial) {
      this.tutorialPending = false;
      this.showHandOn(null);
      this.ui.hideHand();
    }
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

  puffFrom(fish, count, big = false) {
    this.fx.puff(fish.x + fish.dir * fish.w * 0.42 * fish.scale, fish.y + fish.h * 0.1 * fish.scale, fish.dir, count, big);
  }

  // Splashes make nearby fish dart away; a catch makes the others wiggle and blow bubbles.
  startleAround(point, radius = 320, except = null) {
    for (const f of state.fish) {
      if (f === except || f.gone || f === state.selectedFish) continue;
      if (Math.hypot(f.x - point.x, f.y - point.y) < radius) f.startle(point);
    }
  }

  cheer() {
    for (const f of state.fish) {
      if (f.gone || f.frozen) continue;
      f.wiggle();
      f.puffs += 3;
    }
  }

  // Tapping the water is just for fun: bubbles, a soft bloop, and curious fish come to look.
  onWaterTap(point) {
    if (state.paused || state.phase === PHASE.INTRO || state.phase === PHASE.COMPLETE) return;
    if (point.y < this.waterline) return;
    this.fx.puff(point.x, point.y, 0, 5, true);
    if (point.y < this.waterline + 40) this.fx.ripple(point.x, this.waterline, 0.6);
    this.audio.play('bloop');
    for (const f of state.fish) {
      if (f.gone || f === state.selectedFish) continue;
      if (Math.hypot(f.x - point.x, f.y - point.y) < 300) f.lookAt(point);
    }
  }

  onFishTap(tapped, point) {
    const fish = point ? this.fishAt(point, tapped) : tapped;
    if (state.paused || state.phase !== PHASE.READY || state.selectedFish || fish.gone || fish.escaping) return;
    state.selectedFish = fish;
    state.idleTime = 0;
    this.clearHint();
    this.puffFrom(fish, 4, true);
    this.instructionRevert = 0;
    this.ui.setInstruction(this.challengeText(), state.target);
    if (matchesTarget(fish.key, state.target)) {
      this.tutorialPending = false;
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

  // The tutorial hand stays until the first correct tap, so it comes back after a wrong one.
  restoreTutorialHand() {
    if (!this.tutorialPending || state.phase !== PHASE.READY) return;
    this.showHandOn(this.remainingTargets()[0]);
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
    this.syncWaterCanvas();
  }

  syncWaterCanvas() {
    const c = this.stage.canvas;
    this.water.resize(c.width, c.height, c.style.width, c.style.height);
  }

  // Shows feedback for a while, then brings the challenge instruction back.
  revertInstructionIn(ms) {
    this.instructionRevert = ms;
  }

  updateInstruction(dt) {
    if (this.instructionRevert <= 0) return;
    this.instructionRevert -= dt * 1000;
    if (this.instructionRevert <= 0 && state.phase === PHASE.READY) {
      this.ui.setInstruction(this.challengeText(), state.target);
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
      const target = this.remainingTargets()[0];
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
    await preloadBackground(LOCATIONS[nextIndex].background);
    this.transition = { from: state.locationIndex, to: nextIndex, k: 0 };
  }

  finishTransition(nextIndex) {
    this.transition = null;
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
    this.popo.waterResponse = this.fx.raftResponse(this.popo.anchor.x);
    for (const f of state.fish) {
      f.update(dt, this.area, state.fish);
      if (f.gone) continue;
      if (f.breath <= 0 && !f.frozen && !f.escaping) {
        f.breath = 1.6 + Math.random() * 2.6;
        f.puffs += 1 + Math.floor(Math.random() * 3);
      }
      if (f.puffs > 0) {
        this.puffFrom(f, f.puffs);
        f.puffs = 0;
      }
      if (f.trail > 0 && Math.random() < dt * 14) {
        this.fx.puff(f.x - f.dir * f.w * 0.45, f.y + (Math.random() - 0.5) * f.h * 0.3, -f.dir * 0.4, 1);
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

  // The painting goes through the per-pixel water pass (src/water.js); without WebGL it is
  // drawn plainly. Returns the ambient drift the underwater effects follow during a row.
  drawBackground(ctx) {
    const index = LOCATIONS[state.locationIndex].background;
    const current = assets.backgrounds[index];
    if (!current) { preloadBackground(index); return 0; }
    const k = this.transition ? this.transition.k : 0;
    const next = this.transition ? assets.backgrounds[LOCATIONS[this.transition.to].background] : null;
    if (this.water.ok) {
      this.syncWaterCanvas();
      const drawn = this.water.render({
        from: current, to: next, mix: k, time: this.fx.t, waterline: this.waterline,
        plants: this.fx.plantsFor(index), amplitude: this.fx.reduced ? 0.35 : 1,
      });
      if (drawn) {
        this.water.show(true);
        return -Math.sin(k * Math.PI) * 18;
      }
    }
    this.water.show(false);
    this.drawPaintingPlain(ctx, current, next, k);
    return 0;
  }

  // Fallback for browsers without WebGL: the painting drawn plainly; during a row the two
  // paintings slide with depth parallax and a feathered seam.
  drawPaintingPlain(ctx, current, next, k) {
    if (next) this.drawParallaxPlain(ctx, current, next, k);
    else ctx.drawImage(current, 0, 0, STAGE_W, STAGE_H);
  }

  featheredCopy(img) {
    if (this.featheredSource === img) return this.feathered;
    const c = document.createElement('canvas');
    c.width = STAGE_W;
    c.height = STAGE_H;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, STAGE_W, STAGE_H);
    // the mask is built on its own canvas and applied once: a second destination-in fill
    // would erase everything outside its own rectangle
    const mask = document.createElement('canvas');
    mask.width = STAGE_W;
    mask.height = STAGE_H;
    const m = mask.getContext('2d');
    const g = m.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    m.fillStyle = g;
    m.fillRect(0, 0, 256, STAGE_H);
    m.fillStyle = '#000';
    m.fillRect(256, 0, STAGE_W - 256, STAGE_H);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(mask, 0, 0);
    this.feathered = c;
    this.featheredSource = img;
    return c;
  }

  drawParallaxPlain(ctx, current, next, k) {
    const feathered = this.featheredCopy(next);
    const bands = [[0, 336, 1000], [336, 640, 1250], [640, STAGE_H, 1400]];
    for (const [top, bottom, dist] of bands) {
      const h = Math.min(STAGE_H, bottom + 3) - top;
      const ox = -k * dist;
      const nx = (1 - k) * dist;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, STAGE_W, h);
      ctx.clip();
      ctx.drawImage(next, 0, top, STAGE_W, h, nx, top, STAGE_W, h);
      ctx.drawImage(current, 0, top, STAGE_W, h, ox, top, STAGE_W, h);
      ctx.globalAlpha = Math.min(1, k * 8);
      ctx.drawImage(feathered, 0, top, STAGE_W, h, nx, top, STAGE_W, h);
      if (k > 0.85) {
        ctx.globalAlpha = (k - 0.85) / 0.15;
        ctx.drawImage(next, 0, top, STAGE_W, h, nx, top, STAGE_W, h);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  draw() {
    const ctx = this.stage.begin();
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    const offset = this.drawBackground(ctx);
    this.fx.drawWater(ctx, offset, state.fish);
    for (const f of state.fish) f.draw(ctx);
    this.popo.drawLine(ctx);
    this.popo.draw(ctx);
    this.fx.drawDepthVeil(ctx, this.popo);
    this.fx.drawSurface(ctx, this.popo.anchor.x);
    this.fx.drawFront(ctx);
    this.ui.syncHits(state.fish);
  }
}

Object.assign(PopoGame, { Game });
})(window.PopoGame = window.PopoGame || {});
