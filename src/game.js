(function (PopoGame) {
'use strict';
const { assets, preloadBackground, clock, Effects, WaterScene, surfaceWave, PAN_OVERLAP, spawnFish, LOCATIONS, matchesTarget, challengeFish, getShape, Popo, correctCatch, wrongCatch, travelTo, tutorial, opening, discovery, mouthOf, Cancelled, STAGE_W, STAGE_H, swimArea, raftAnchor, state, PHASE, resetProgress, newToken, isCurrent } = PopoGame;

const HINT_DELAY = 4;

// The title banner: its water surface, sand line, the open water the decorative fish swim
// in, where the hooked fish splashes, and sparkle points along the logo's snowy edges.
const TITLE = {
  waterline: 610,
  seabed: 860,
  area: { left: 60, right: 1612, top: 680, bottom: 905 },
  fish: ['triangle', 'square', 'pentagon', 'hexagon', 'circle'],
  // the play button floats in the middle of the banner's water; fish circle it
  play: { x: 836, y: 772, r: 112 },
  orbit: { rx: 270, ry: 92, speed: 0.55 },
  splash: { left: 790, right: 980, y: 588 },
  twinkles: [[884, 118], [1092, 86], [1360, 62], [1598, 142], [1588, 300], [962, 334]],
};


class Game {
  constructor({ stage, ui, audio }) {
    this.stage = stage;
    this.ui = ui;
    this.audio = audio;
    this.popo = new Popo();
    this.fx = new Effects();
    this.water = new WaterScene(document.getElementById('water'));
    this.titleFx = new Effects();
    this.titleFx.setWaterline(TITLE.waterline);
    this.titleFish = [];
    this.playAnim = { hover: 0, hoverTarget: 0, press: 0, burst: 0, angle: 0, bubbleIn: 0.3 };
    this.titleFade = 0;
    this.titleSplashIn = 0.8;
    this.raftRippleIn = 1;
    this.dialogue = null;
    this.leaper = null;
    this.waterQuality = 1;
    this.frameAvg = 1 / 60;
    this.slowFor = 0;
    this.surfaceColors = [];
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
    if (state.phase === PHASE.INTRO && !this.titleFish.length) {
      this.titleFish = spawnFish(TITLE.fish, TITLE.area, 0.62);
      this.titleFish.forEach((f, i) => { f.orbit = (i / TITLE.fish.length) * Math.PI * 2; });
    }
    if (!this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  start() {
    if (state.phase === PHASE.INTRO) this.titleFade = 1;
    this.audio.init();
    this.audio.resume();
    this.audio.startMusic();
    resetProgress();
    this.ui.hideStart();
    this.ui.showHud();
    this.applyLocation();
    this.ui.setHitsEnabled(false);
    this.tutorialPending = true;
    opening(this);
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
    this.endLine();
    this.leaper = null;
    this.applyLocation();
    this.tutorialPending = true;
    opening(this);
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

  // A wrong catch keeps the instruction but names the fish that was tapped.
  wrongText(fish) {
    return `${this.challengeText().replace(/!$/, '')}, not the ${fish.shape.name.toLowerCase()} one!`;
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
      const next = state.locationIndex + 1;
      if (LOCATIONS[next].discovery) discovery(this, next);
      else travelTo(this, next);
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
    if (state.phase === PHASE.INTRO) {
      this.onTitleTap(point);
      return;
    }
    if (state.paused || state.phase === PHASE.COMPLETE) return;
    if (point.y < this.waterline) return;
    this.fx.puff(point.x, point.y, 0, 5, true);
    if (point.y < this.waterline + 40) this.fx.ripple(point.x, this.waterline, 0.6);
    this.audio.play('bloop');
    for (const f of state.fish) {
      if (f.gone || f === state.selectedFish) continue;
      if (Math.hypot(f.x - point.x, f.y - point.y) < 300) f.lookAt(point);
    }
  }

  onTitleTap(point) {
    if (point.y < TITLE.waterline) {
      this.titleFx.sparkle(point.x, point.y, 8);
      return;
    }
    this.titleFx.puff(point.x, point.y, 0, 5, true);
    for (const f of this.titleFish) {
      if (Math.hypot(f.x - point.x, f.y - point.y) < 320) { f.wiggle(); f.puffs += 2; }
    }
  }

  onPlayHover(on) {
    if (state.phase !== PHASE.INTRO) return;
    this.playAnim.hoverTarget = on ? 1 : 0;
    if (on) this.audio.play('bloop');
  }

  onPlayPress() {
    if (state.phase !== PHASE.INTRO) return;
    this.playAnim.press = 1;
  }

  // Play: the button pops, bubbles and sparkles burst out, the fish scatter, the game begins.
  pressPlay() {
    if (state.phase !== PHASE.INTRO || !assets.title) return;
    const { x, y, r } = TITLE.play;
    this.audio.init();
    this.audio.resume();
    this.playAnim.burst = 0.001;
    this.playAnim.press = 1;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      this.titleFx.puff(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, Math.cos(a), 2, true);
    }
    this.titleFx.sparkle(x, y - r * 0.4, 14);
    for (const f of this.titleFish) f.wiggle();
    this.audio.play('splashSmall');
    this.audio.play('cheer');
    this.start();
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

  // The painting is STAGE_W pixels wide, so the water pass never renders more pixels than
  // that; on big or Retina screens the browser scales it up. waterQuality drops on slow devices.
  syncWaterCanvas() {
    const c = this.stage.canvas;
    const k = Math.min(1, STAGE_W / c.width) * this.waterQuality;
    this.water.resize(Math.round(c.width * k), Math.round(c.height * k), c.style.width, c.style.height);
  }

  watchFrameRate(dt) {
    this.frameAvg = this.frameAvg * 0.97 + dt * 0.03;
    this.slowFor = this.frameAvg > 0.026 ? this.slowFor + dt : 0;
    if (this.slowFor > 2 && this.waterQuality > 0.6) {
      this.waterQuality = 0.6;
      this.slowFor = 0;
    }
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

  // Shows one story line, typing it out with little voice blips. Resolves once it has been
  // on screen long enough to read, or straight away when the player taps to move on.
  say(text, who, token) {
    return new Promise((resolve, reject) => {
      if (this.dialogue) this.endLine();
      this.dialogue = {
        text, who, token, resolve, reject, shown: 0, held: 0,
        hold: 650 + text.length * 32, speed: who === 'narrator' ? 30 : 36,
      };
      this.ui.showLine(who, text);
      this.placeSpeech();
      if (who === 'narrator') this.audio.play('narrate');
    });
  }

  placeSpeech() {
    const p = this.popo;
    this.ui.placeSpeech(p.anchor.x + 78 + p.travelShift, p.anchor.y - 238 + p.bob);
  }

  endLine() {
    this.dialogue = null;
    this.ui.hideLines();
  }

  skipDialogue() {
    const d = this.dialogue;
    if (!d) return false;
    if (d.shown < d.text.length) d.shown = d.text.length;
    else d.held = d.hold;
    return true;
  }

  updateDialogue(dt) {
    const d = this.dialogue;
    if (!d) return;
    if (!isCurrent(d.token)) {
      this.endLine();
      d.reject(new Cancelled());
      return;
    }
    if (d.shown < d.text.length) {
      const before = Math.floor(d.shown);
      d.shown = Math.min(d.text.length, d.shown + dt * d.speed);
      const now = Math.floor(d.shown);
      if (d.who === 'popo' && Math.floor(now / 3) > Math.floor(before / 3) && /\w/.test(d.text[now - 1] || '')) this.audio.play('talk');
      this.ui.typeLine(d.text, now);
    } else {
      d.held += dt * 1000;
      if (d.held >= d.hold) {
        this.endLine();
        d.resolve();
        return;
      }
    }
    if (d.who === 'popo') this.placeSpeech();
  }

  // The raft sits on the animated surface: it rises, falls and tilts with the waves under its
  // two ends, and sends out a small ripple now and then.
  rideWaves(dt) {
    const popo = this.popo;
    const p = popo.placement('fishing', 'idle');
    const shift = popo.travelShift + popo.lean;
    const left = p.raftLeftX + shift;
    const right = p.raftRightX + shift;
    if (this.water.ok) {
      const amp = this.fx.reduced ? 0.35 : 1;
      const t = this.fx.t;
      const yl = -surfaceWave(left, t) * amp;
      const yr = -surfaceWave(right, t) * amp;
      const yc = -surfaceWave((left + right) / 2, t) * amp;
      popo.waveY = (yl + yr + 2 * yc) / 4;
      popo.waveAngle = Math.atan2(yr - yl, right - left) * 0.85;
    } else {
      popo.waveY = Math.sin(popo.bobT * 1.65) * 2.4 * (this.fx.reduced ? 0.2 : 1);
      popo.waveAngle = 0;
    }
    this.raftRippleIn -= dt;
    if (this.raftRippleIn <= 0 && state.phase !== PHASE.INTRO && !popo.mishap) {
      this.raftRippleIn = 1.4 + Math.random() * 1.4;
      this.fx.ripple(Math.random() < 0.5 ? left + 8 : right - 8, this.waterline + 4, 0.55);
    }
  }

  // Average colour of the painted water just below the surface, for the water over the raft.
  surfaceColor() {
    const index = LOCATIONS[state.locationIndex].background;
    if (this.surfaceColors[index]) return this.surfaceColors[index];
    const img = assets.backgrounds[index];
    if (!img) return null;
    let colour = [40, 170, 240];
    try {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 16;
      const cx = c.getContext('2d');
      cx.drawImage(img, 500, this.waterline + 8, 800, 32, 0, 0, 400, 16);
      const d = cx.getImageData(0, 0, 400, 16).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      colour = sum.map((v) => Math.round(v / (d.length / 4)));
    } catch (e) { /* a tainted canvas keeps the default colour */ }
    this.surfaceColors[index] = colour;
    return colour;
  }

  // Water lapping over the bottom of the raft, following the same waves, so the raft sits in
  // the water rather than on top of it. Fades out at both ends into the painted surface.
  drawRaftWater(ctx) {
    const colour = this.surfaceColor();
    if (!colour) return;
    const popo = this.popo;
    const p = popo.placement('fishing', 'idle');
    const shift = popo.travelShift + popo.lean;
    const x0 = Math.floor(p.raftLeftX + shift - 34);
    const x1 = Math.ceil(p.raftRightX + shift + 34);
    const top = Math.floor(this.waterline - 16);
    const w = x1 - x0;
    const h = 60;
    const c = this.raftWaterCanvas || (this.raftWaterCanvas = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const t = this.fx.t;
    const amp = this.water.ok ? (this.fx.reduced ? 0.35 : 1) : 0;
    const lap = this.fx.reduced ? 0.4 : 1.6;
    const edge = (x) => this.waterline - surfaceWave(x, t) * amp + lap * Math.sin(x * 0.08 + t * 2.6) - top;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 5) g.lineTo(x, edge(x0 + x));
    g.lineTo(w, h);
    g.closePath();
    const [r, gr, b] = colour;
    const fill = g.createLinearGradient(0, 10, 0, h);
    fill.addColorStop(0, `rgba(${r}, ${gr}, ${b}, 0.88)`);
    fill.addColorStop(0.45, `rgba(${r}, ${gr}, ${b}, 0.62)`);
    fill.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
    g.fillStyle = fill;
    g.fill();
    g.beginPath();
    for (let x = 0; x <= w; x += 5) {
      const y = edge(x0 + x);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    g.lineWidth = 2.2;
    g.stroke();
    g.globalCompositeOperation = 'destination-in';
    const ends = g.createLinearGradient(0, 0, w, 0);
    ends.addColorStop(0, 'rgba(0, 0, 0, 0)');
    ends.addColorStop(0.13, 'rgba(0, 0, 0, 1)');
    ends.addColorStop(0.87, 'rgba(0, 0, 0, 1)');
    ends.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = ends;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(c, x0, top);
  }

  // Fish, bubbles and splashes for the title banner. Also runs while it fades out after Play.
  updateTitle(dt) {
    this.titleFx.update(dt);
    const pa = this.playAnim;
    const { x: px, y: py } = TITLE.play;
    const { rx, ry, speed } = TITLE.orbit;
    pa.hover += (pa.hoverTarget - pa.hover) * Math.min(1, dt * 10);
    pa.press = Math.max(0, pa.press - dt * 4);
    if (pa.burst > 0) pa.burst += dt;
    pa.angle += dt * speed * (1 + pa.burst * 4);
    pa.bubbleIn -= dt;
    if (pa.bubbleIn <= 0) {
      pa.bubbleIn = 0.28 + Math.random() * 0.3;
      this.titleFx.puff(px + (Math.random() - 0.5) * 150, py + 70, 0, 1);
    }
    for (const f of this.titleFish) {
      // a 3D orbit: the far side runs behind the button, smaller and dimmer, and each fish
      // turns edge-on at the sides instead of flipping
      const a = pa.angle + f.orbit;
      const spread = 1 + pa.burst * 2.4;
      f.x = px + Math.cos(a) * rx * spread;
      f.y = py + Math.sin(a) * ry * spread + Math.sin(a * 2 + f.orbit) * 8;
      const facing = -Math.sin(a);
      f.dir = Math.sign(facing || 1) * Math.max(0.12, Math.abs(facing));
      f.scale = 0.82 + 0.26 * (Math.sin(a) + 1) / 2;
      f.depth = Math.sin(a);
      f.bobPhase += dt * 2.2;
      f.breath -= dt;
      if (f.wiggleT >= 0) { f.wiggleT += dt; if (f.wiggleT > 0.45) f.wiggleT = -1; }
      if (f.breath <= 0) {
        f.breath = 1.4 + Math.random() * 2.4;
        f.puffs += 1 + Math.floor(Math.random() * 3);
      }
      if (f.puffs > 0) {
        this.titleFx.puff(f.x + Math.sign(f.dir) * f.w * 0.42 * f.scale, f.y + f.h * 0.1, Math.sign(f.dir), f.puffs);
        f.puffs = 0;
      }
    }
    this.titleSplashIn -= dt;
    if (this.titleSplashIn <= 0) {
      this.titleSplashIn = 0.9 + Math.random() * 1.1;
      const s = TITLE.splash;
      this.titleFx.splash(s.left + Math.random() * (s.right - s.left), s.y, false);
    }
    if (state.phase !== PHASE.INTRO) this.titleFade = Math.max(0, this.titleFade - dt / 0.7);
  }

  update(dt) {
    if (state.phase === PHASE.INTRO || this.titleFade > 0) this.updateTitle(dt);
    clock.update(dt);
    this.popo.update(dt);
    this.fx.update(dt);
    this.popo.waterResponse = this.fx.raftResponse(this.popo.anchor.x);
    this.rideWaves(dt);
    this.updateDialogue(dt);
    this.watchFrameRate(dt);
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
    const mask = cx.createLinearGradient(0, 0, PAN_OVERLAP, 0);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 1)');
    cx.globalCompositeOperation = 'destination-in';
    cx.fillStyle = mask;
    cx.fillRect(0, 0, PAN_OVERLAP, STAGE_H);
    cx.fillStyle = '#000';
    cx.fillRect(PAN_OVERLAP, 0, STAGE_W - PAN_OVERLAP, STAGE_H);
    this.feathered = c;
    this.featheredSource = img;
    return c;
  }

  drawParallaxPlain(ctx, current, next, k) {
    const pan = STAGE_W - PAN_OVERLAP;
    const ox = -k * pan;
    ctx.drawImage(current, ox, 0, STAGE_W, STAGE_H);
    ctx.save();
    ctx.translate(ox + STAGE_W * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(current, 0, 0, STAGE_W, STAGE_H);
    ctx.restore();
    const ease = (a, b, x) => { const v = Math.min(1, Math.max(0, (x - a) / (b - a))); return v * v * (3 - 2 * v); };
    ctx.globalAlpha = ease(0, 0.07, k);
    ctx.drawImage(this.featheredCopy(next), ox + pan, 0, STAGE_W, STAGE_H);
    ctx.globalAlpha = ease(0.93, 1, k);
    if (ctx.globalAlpha > 0) ctx.drawImage(next, 0, 0, STAGE_W, STAGE_H);
    ctx.globalAlpha = 1;
  }

  // The play button floats in the water: a gentle bob and sway, a breathing warm glow behind
  // it, an occasional shine across its face, a grow on hover and a squash when pressed.
  drawPlayButton(ctx, alpha) {
    const img = assets.play;
    if (!img) return;
    const pa = this.playAnim;
    const t = this.titleFx.t;
    const { x, y, r } = TITLE.play;
    const still = this.fx.reduced;
    const bob = still ? 0 : Math.sin(t * 1.6) * 7;
    const sway = still ? 0 : Math.sin(t * 1.1) * 0.035;
    const breathe = still ? 1 : 1 + Math.sin(t * 2.4) * 0.025;
    const squash = 1 - pa.press * 0.12;
    const pop = pa.burst > 0 ? 1 + Math.sin(Math.min(1, pa.burst / 0.35) * Math.PI) * 0.18 : 1;
    const s = breathe * (1 + pa.hover * 0.07) * pop;
    const cy = y + bob;
    this.ui.placePlay(x, cy, r * s);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(x, cy, r * 0.6, x, cy, r * 1.9);
    glow.addColorStop(0, `rgba(255, 210, 110, ${0.42 + 0.16 * Math.sin(t * 2.4) + pa.hover * 0.15})`);
    glow.addColorStop(1, 'rgba(255, 210, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 2, cy - r * 2, r * 4, r * 4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(x, cy);
    ctx.rotate(sway);
    ctx.scale(s * (1 + pa.press * 0.06), s * squash);
    const w = img.width * (r * 2 / img.height);
    ctx.drawImage(img, -w / 2, -r, w, r * 2);
    // shine: a soft diagonal band sweeping across the disc every few seconds
    const sweep = (t % 3.4) / 1.1;
    if (sweep < 1 && !still) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2);
      ctx.clip();
      const sx = -r * 1.6 + sweep * r * 3.2;
      const band = ctx.createLinearGradient(sx - r * 0.35, -r, sx + r * 0.35, r);
      band.addColorStop(0, 'rgba(255, 255, 255, 0)');
      band.addColorStop(0.5, 'rgba(255, 255, 255, 0.38)');
      band.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = band;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawTitle(ctx, alpha) {
    const t = this.fx.t;
    if (alpha >= 1) {
      // the banner runs through the water pass, with the surface band kept still because the
      // raft and the leaping fish sit on it; without WebGL it is drawn plainly
      this.syncWaterCanvas();
      const drawn = this.water.ok && this.water.render({
        from: assets.title, to: null, mix: 0, time: this.titleFx.t, waterline: TITLE.waterline,
        plants: [], amplitude: this.fx.reduced ? 0.35 : 1, surface: 0, seabed: TITLE.seabed,
      });
      this.water.show(Boolean(drawn));
      if (!drawn) ctx.drawImage(assets.title, 0, 0, STAGE_W, STAGE_H);
    } else {
      ctx.globalAlpha = alpha;
      ctx.drawImage(assets.title, 0, 0, STAGE_W, STAGE_H);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    this.titleFx.drawWater(ctx, 0, this.titleFish);
    ctx.restore();
    const fishBehind = this.titleFish.filter((f) => f.depth < 0);
    const fishInFront = this.titleFish.filter((f) => f.depth >= 0);
    for (const f of fishBehind) {
      f.alpha = alpha * (0.72 + 0.28 * (1 + f.depth));
      f.draw(ctx);
    }
    this.drawPlayButton(ctx, alpha);
    for (const f of fishInFront) {
      f.alpha = alpha;
      f.draw(ctx);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    this.titleFx.drawFront(ctx);
    // a warm, breathing sun glow in the corner and twinkles on the logo's snowy rim
    ctx.globalCompositeOperation = 'screen';
    const sun = ctx.createRadialGradient(1650, 18, 10, 1650, 18, 300);
    sun.addColorStop(0, `rgba(255, 250, 220, ${(0.32 + Math.sin(t * 0.9) * 0.08) * alpha})`);
    sun.addColorStop(1, 'rgba(255, 250, 220, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(1350, 0, STAGE_W - 1350, 320);
    ctx.globalCompositeOperation = 'source-over';
    TITLE.twinkles.forEach(([x, y], i) => {
      const k = Math.max(0, Math.sin(t * 1.3 + i * 1.7)) ** 4;
      if (k < 0.02) return;
      const r = 4 + k * 9;
      ctx.fillStyle = `rgba(255, 255, 255, ${k * alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.quadraticCurveTo(x, y, x, y + r);
      ctx.quadraticCurveTo(x, y, x - r, y);
      ctx.quadraticCurveTo(x, y, x, y - r);
      ctx.fill();
    });
    ctx.restore();
  }

  draw() {
    const ctx = this.stage.begin();
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    if (state.phase === PHASE.INTRO) {
      this.drawTitle(ctx, 1);
      return;
    }
    const offset = this.drawBackground(ctx);
    this.fx.drawWater(ctx, offset, state.fish);
    for (const f of state.fish) f.draw(ctx);
    if (this.leaper) this.leaper.draw(ctx);
    this.popo.drawLine(ctx);
    this.popo.draw(ctx);
    this.drawRaftWater(ctx);
    this.fx.drawFront(ctx);
    if (this.titleFade > 0) this.drawTitle(ctx, this.titleFade);
    this.ui.syncHits(state.fish);
  }
}

Object.assign(PopoGame, { Game });
})(window.PopoGame = window.PopoGame || {});
