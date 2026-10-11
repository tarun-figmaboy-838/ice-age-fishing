(function (PopoGame) {
'use strict';
const { clock, ease, Cancelled, state, PHASE, newToken, isCurrent, getShape, Fish, STORY, STAGE_W } = PopoGame;

// The hook hangs this far below the line's end.
const HOOK_DROP = 11;

// Where the hook grabs a fish: its smile (measured from the art), mirrored when it swims left,
// with the line ending just above it so the hook's bend sits in the mouth.
function mouthOf(fish) {
  const [mx, my] = fish.mouth;
  return {
    x: fish.x + fish.dir * (mx - 0.5) * fish.w * fish.scale,
    y: fish.y + (my - 0.5) * fish.h * fish.scale - HOOK_DROP,
  };
}

function swallow(e) {
  if (!(e instanceof Cancelled)) throw e;
}

// Popo casts and the hook flies to the chosen fish. Shared by the correct and wrong flows.
async function castTo(game, fish, token) {
  const { popo, fx, audio } = game;
  popo.playFrames('casting', ['lift', 'up', 'back'], 110);
  await clock.wait(340, token);
  audio.play('whoosh');
  popo.playFrames('casting', ['swing', 'follow', 'hold'], 120);
  const from = popo.hookPosition();
  popo.line.mode = 'flight';
  popo.line.hook = { ...from };
  popo.line.tension = 0.6;
  const target = mouthOf(fish);
  const apexY = Math.min(from.y, target.y) - 150;
  let splashed = false;
  await clock.tween(560, token, (t) => {
    const k = ease.out(t);
    const x = from.x + (target.x - from.x) * k;
    const y = (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * apexY + k * k * target.y;
    popo.line.hook.x = x;
    popo.line.hook.y = y;
    popo.line.arc = -0.9 * (1 - k);
    if (!splashed && y >= game.waterline) {
      splashed = true;
      fx.splash(x, game.waterline, false);
      game.startleAround({ x, y: game.waterline + 60 }, 300, fish);
      audio.play('splashSmall');
    }
  });
  popo.line.mode = 'attached';
  popo.line.arc = 0;
  popo.line.tension = 1;
}


async function correctCatch(game, fish) {
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  try {
    state.phase = PHASE.CASTING;
    fish.frozen = true;
    fish.wiggle();
    audio.play('fishTap');
    ui.setHitsEnabled(false);
    await clock.wait(330, token);
    await castTo(game, fish, token);

    fish.wiggle();
    audio.play('hooked');
    await clock.wait(380, token);

    state.phase = PHASE.REELING;
    audio.play('reel');
    popo.playFrames('casting', ['reel', 'reel2'], 150, true);
    const start = { x: fish.x, y: fish.y };
    const surface = { x: popo.raftRight().x + 70, y: game.waterline - 14 };
    fish.dir = -1;
    await clock.tween(950, token, (t) => {
      const k = ease.inOut(t);
      fish.x = start.x + (surface.x - start.x) * k;
      fish.y = start.y + (surface.y - start.y) * k;
      popo.line.tension = 1.3;
    });
    fx.splash(surface.x, game.waterline, false);
    audio.play('splashSmall');

    popo.stopFrames();
    popo.setPose('casting', 'up', 140);
    const bucket = popo.bucketPoint();
    const peak = { x: (surface.x + bucket.x) / 2, y: Math.min(surface.y, bucket.y) - 170 };
    await clock.tween(680, token, (t) => {
      const k = ease.inOut(t);
      fish.x = (1 - k) * (1 - k) * surface.x + 2 * (1 - k) * k * peak.x + k * k * bucket.x;
      fish.y = (1 - k) * (1 - k) * surface.y + 2 * (1 - k) * k * peak.y + k * k * bucket.y;
      fish.scale = 1 - 0.6 * k;
      popo.line.tension = 1;
    });

    fish.gone = true;
    fx.sparkle(bucket.x, bucket.y - 10, 12);
    audio.play('collect');
    popo.line.mode = 'dangle';
    popo.line.tension = 0;
    popo.idle();
    game.collect(fish);
    game.cheer();
    audio.play('cheer');
    await game.say(STORY.catch, token);

    state.phase = PHASE.CELEBRATING;
    audio.duck(2200);
    audio.play('success');
    ui.showReward(fish.shape);
    await clock.wait(3800, token);
    ui.hideReward();
    await clock.wait(400, token);
    game.afterCatch();
  } catch (e) {
    swallow(e);
  }
}

// A single game-clock tween owns the complete reaction. No frame-count damping or
// chained waits: dropped frames still cross every event once, in chronological order.
const WRONG_DURATION = 4800;
async function wrongCatch(game, fish) {
  if (state.phase !== PHASE.READY || game.popo.mishap) return;
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  const home = { x: fish.x, y: fish.y };
  const sound = name => { try { audio.play(name); } catch (e) { /* optional audio */ } };
  const restore = () => {
    popo.endMishap();
    fish.frozen = false;
    state.selectedFish = null;
    state.idleTime = 0;
    state.hintShown = false;
    state.phase = PHASE.READY;
    ui.setHitsEnabled(true);
    game.restoreTutorialHand();
  };
  try {
    state.phase = PHASE.CASTING;
    state.selectedFish = fish;
    game.instructionRevert = 0;
    ui.setHitsEnabled(false);
    game.showHandOn(null);
    ui.hideHand();
    fish.frozen = true;
    fish.wiggle(true);
    sound('fishTap');
    const castGame = Object.create(game);
    castGame.audio = { play: sound };
    await castTo(castGame, fish, token);
    popo.beginMishap(game.waterline);
    const m = popo.mishap;
    const pull = Math.min(38, game.area.right - fish.w / 2 - home.x);
    const edge = popo.placement('fishing', 'idle').raftRightX;
    const origin = popo.mishapBodyPoint(178, 300);
    const landingX = edge + 76 - origin.x;
    const rotation = fx.reduced ? 0.55 : 1;
    const nodes = [
      // Time, lateral offset, vertical offset, body rotation, acting pose.
      [0, 0, 0, 0, 'idle'],
      [180, 4, 0, .025, 'surprise'],
      [400, 13, -2, .05, 'surprise'],
      [680, 25, -5, -.055, 'brace'],
      [950, landingX * .47, -12, .13, 'brace'],
      [1130, landingX * .70, -30, .20, 'slip'],
      [1450, landingX, 22, .30, 'slip'],
      [1750, landingX + 6, 190, .06, 'surface'],
      [2050, landingX + 3, 191, 0, 'surface'],
      [2430, landingX, 63, -.025, 'surface'],
      [2600, landingX - 5, 69, 0, 'blink'],
      [2750, landingX - 12, 68, 0, 'surface'],
      // swim to the edge, grab it, haul up, belly-slide onto the deck, then pop up to sit
      [3000, landingX - 40, 64, 0, 'surface'],
      [3080, 0, 0, 0, 'climb', 'cut'],
      [3380, 0, 0, 0, 'climb'],
      [3640, 0, 0, 0, 'climb', null, .16],
      [3720, 92, 0, 0, 'shake', 'cut', -.14],
      [3940, 30, -5, 0, 'shake', null, .05],
      [4150, 0, 0, 0, 'wet'],
      [4450, 0, -2, -.018, 'wet'],
      [4630, 0, 0, 0, 'idle'],
      [4800, 0, 0, 0, 'idle'],
    ];
    // Calibrate submersion and emergence against the actual art, not an assumed
    // foot height. World offsets stay invariant when the viewport is resized.
    const top = popo.poseLocalPoint('surface', 'top').y;
    const underwater = game.waterline - origin.y - top + 8;
    nodes[7][2] = underwater;
    nodes[8][2] = underwater + 2;
    const afloat = underwater - 112;
    for (const i of [9, 10, 11, 12]) nodes[i][2] += afloat - 63;
    // The climb keys place the reaching forepaw: on the raft's edge while hauling up (a small
    // lift, so the legs come up out of the water rather than swinging high), then further in
    // on the deck once the belly has slid aboard.
    const gripPoint = { x: edge-5, y: game.waterline-21 };
    // a key that lands one landmark of a pose on a stage point at a given tilt
    const place = (index, pose, landmark, angle, at) => {
      const local = popo.poseLocalPoint(pose, landmark);
      const theta = angle * rotation;
      nodes[index][3] = angle;
      nodes[index][1] = at.x - origin.x - (local.x * Math.cos(theta) - local.y * Math.sin(theta));
      nodes[index][2] = at.y - origin.y - (local.x * Math.sin(theta) + local.y * Math.cos(theta));
    };
    place(13, 'climb', 'hand', 0, gripPoint);
    place(14, 'climb', 'hand', -.2, gripPoint);
    // belly aboard: the body lies along the back of the deck, clear of the water
    place(15, 'climb', 'pivot', -.03, { x: edge - 96, y: game.waterline - 57 });
    // sit up right where the body lies, then scoot back to the seat
    nodes[16][1] = nodes[15][1] + 14;
    nodes[17][1] = nodes[15][1] * .45;
    let released = null, hookRelease = null, impacted = false;
    let previousContact = null;
    let eventIndex = 0;
    let feedback = Promise.resolve();
    const events = [
      [0, () => { state.phase = PHASE.WRONG_PULL; sound('tug'); try { audio.duck(WRONG_DURATION); } catch (e) { /* optional music */ } }],
      [400, () => { state.phase = PHASE.LOSING_BALANCE; fish.wiggle(); }],
      [950, () => { state.phase = PHASE.FALLING; sound('slip');
        released = { ...popo.mishapRod() }; hookRelease = { ...popo.line.hook };
        popo.line.mode = 'slack'; popo.line.tension = 0;
        fish.frozen = false;
      }],
      [1750, () => { state.phase = PHASE.SUBMERGED; sound('bubbles');
        fx.bubbleBurst(origin.x + landingX, game.waterline + 20); }],
      [2050, () => { state.phase = PHASE.RESURFACING; }],
      [2300, () => { sound('bloop'); fx.ripple(origin.x + landingX, game.waterline, .85); }],
      [2600, () => { fx.drips(popo.bodyLandmark('head')); }],
      [2750, () => { state.phase = PHASE.RECOVERING; }],
      [3080, () => { sound('bloop'); fx.ripple(gripPoint.x + 10, game.waterline, .7); }],
      [3640, () => { sound('splashSmall'); fx.splash(edge - 20, game.waterline, false); }],
      [3720, () => { sound('boing'); fx.drips(popo.bodyLandmark('head')); }],
      [3920, () => { sound('drip'); fx.drips(popo.bodyLandmark('head')); }],
      [4150, () => {
        ui.setInstruction(game.wrongText(fish));
        feedback = game.say(STORY.wrong, token);
        // Attach cancellation handling immediately, even while the motion is running.
        feedback.catch(() => {});
      }],
    ];
    await clock.tween(WRONG_DURATION, token, progress => {
      const ms = progress * WRONG_DURATION;
      m.time = ms;
      let i = 0;
      while (i < nodes.length - 2 && ms > nodes[i + 1][0]) i++;
      const a = nodes[i], b = nodes[i + 1];
      const t = Math.max(0, Math.min(1, (ms - a[0]) / (b[0] - a[0])));
      // Cubic Hermite position interpolation preserves velocity at interior keys.
      const before = nodes[Math.max(0, i - 1)], after = nodes[Math.min(nodes.length - 1, i + 2)];
      for (const [key, col] of [['x', 1], ['y', 2], ['angle', 3]]) {
        const span = b[0] - a[0];
        const va = i === 0 ? 0 : (b[col] - before[col]) / (b[0] - before[0]);
        const vb = i + 1 === nodes.length - 1 ? 0 : (after[col] - a[col]) / (after[0] - a[0]);
        m[key] = (2*t*t*t-3*t*t+1)*a[col] + (t*t*t-2*t*t+t)*span*va
          + (-2*t*t*t+3*t*t)*b[col] + (t*t*t-t*t)*span*vb;
      }
      m.angle *= rotation;
      // 'cut' switches pose on the key itself (squash and stretch sell the change instead of a
      // see-through blend); otherwise the last 110 ms before a key blend into its pose
      const poseMix = a[4] === b[4] || b[5] === 'cut' ? 0 : ease.inOut(Math.max(0,Math.min(1,(ms-b[0]+110)/110)));
      popo.blendMishapPose(a[4], b[4], poseMix);
      m.squash = (a[6] || 0) + ((b[6] || 0) - (a[6] || 0)) * ease.inOut(t);
      if (ms >= 3080 && ms <= 3380) {
        const paw=popo.bodyLandmark('hand');
        m.x += gripPoint.x-paw.x;
        m.y += gripPoint.y-paw.y;
      }
      m.raftAngle = ms < 1450 ? Math.sin(ms / 1450 * Math.PI) * .012 * rotation : 0;
      m.rodBend = ms < 950 ? Math.sin(ms / 950 * Math.PI) * .06 : 0;
      m.deckOcclusion = ms > 2950 && ms < 3720;
      while (eventIndex < events.length && ms >= events[eventIndex][0]) events[eventIndex++][1]();
      if (ms < 950) {
        const k = ease.inOut(Math.min(1, ms / 400));
        fish.x = home.x + pull * k;
        fish.y = home.y + Math.sin(ms / 950 * Math.PI) * 7;
        popo.line.tension = 1 + .8 * Math.sin(Math.min(1, ms / 950) * Math.PI);
      }
      if (released) {
        const k = ease.out(Math.max(0, Math.min(1, (ms - 950) / 500)));
        const resting = { x: edge - 88, y: game.waterline - 47, angle: .74 };
        m.rod = { x: released.x + (resting.x - released.x) * k,
          y: released.y + (resting.y - released.y) * k - Math.sin(k * Math.PI) * 18,
          angle: released.angle + (resting.angle - released.angle) * k };
        if (ms > 4150) {
          const grip = popo.bodyLandmark('hand');
          const take = ease.inOut(Math.min(1, (ms - 4150) / 480));
          m.rod.x += (grip.x - m.rod.x) * take;
          m.rod.y += (grip.y - m.rod.y) * take;
          m.rod.angle *= 1 - take;
        }
        const tip = popo.rodTip();
        const reel = ease.inOut(Math.min(1, Math.max(0, (ms - 950) / 850)));
        popo.line.hook.x = hookRelease.x + (tip.x + Math.sin(popo.swayT) * 7 - hookRelease.x) * reel;
        popo.line.hook.y = hookRelease.y + (tip.y + popo.line.length + Math.cos(popo.swayT) * 1.5 - hookRelease.y) * reel;
        popo.line.arc = Math.sin(reel * Math.PI) * .5;
      }
      const contact = popo.bodyLandmark('contact');
      if (!impacted && ms >= 950 && contact.y >= game.waterline && contact.x > edge + 15) {
        impacted = true;
        // Interpolate the crossing, even if an entire contact frame was skipped.
        const k = previousContact ? Math.max(0, Math.min(1,
          (game.waterline - previousContact.y) / (contact.y - previousContact.y || 1))) : 1;
        m.impactX = previousContact ? previousContact.x + (contact.x - previousContact.x) * k : contact.x;
        m.impactTime = ms;
        fx.splash(m.impactX, game.waterline, true);
        sound('splashBig');
      }
      previousContact = contact;
    });
    await feedback;
    if (!isCurrent(token)) throw new Cancelled();
    restore();
    game.revertInstructionIn(3500);
  } catch (e) {
    if (isCurrent(token)) { game.endLine(); audio.stopEffects(); fx.clearTransient(); restore(); }
    else { popo.endMishap(); fish.frozen = false; }
    swallow(e);
  }
}

async function travelTo(game, nextIndex) {
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  try {
    state.phase = PHASE.LEVEL_TRANSITION;
    ui.setHitsEnabled(false);
    ui.setInstruction('Popo rows on…');
    audio.play('complete');
    for (const f of state.fish) { f.frozen = false; f.escape(); }
    await clock.wait(900, token);
    state.fish = [];
    ui.clearHits();

    try {
      await game.prepareTransition(nextIndex, token);
    } catch (e) {
      // the next scenery couldn't load: arrive without the row rather than get stuck
      if (!isCurrent(token)) return;
      game.finishTransition(nextIndex);
      game.setupChallenge();
      return;
    }
    if (!isCurrent(token)) return;
    popo.playFrames('rowing', ['row0', 'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8'], 160, true);
    audio.setTravel(true);
    const fromWater = game.waterline;
    const toWater = game.locationWaterline(nextIndex);
    const duration = fx.reduced ? 2400 : 5400;
    const stroke = 900;
    let strokes = 0;
    let lastWake = 0;
    await clock.tween(duration, token, (t) => {
      const k = ease.inOut(t);
      game.transition.k = k;
      game.setWaterline(fromWater + (toWater - fromWater) * k);
      const elapsed = t * duration;
      const phase = (elapsed % stroke) / stroke;
      // every pull drives the raft forward and lifts the bow a little; it settles as the blade lifts
      const surge = Math.max(0, Math.sin(phase * Math.PI * 2 - Math.PI / 2));
      const pace = Math.sin(t * Math.PI);
      popo.travelShift = pace * (18 + surge * 24);
      popo.tilt = -pace * (0.012 + surge * 0.014);
      const cycle = Math.floor(elapsed / stroke);
      if (cycle > strokes && t < 0.9) {
        strokes = cycle;
        const edge = popo.raftRight();
        fx.splash(edge.x + 36, game.waterline, false);
        audio.play('paddle');
      }
      if (elapsed - lastWake > 380 && t > 0.06 && t < 0.94) {
        lastWake = elapsed;
        const stern = popo.placement(popo.pose.sheet, popo.pose.frame).raftLeftX + popo.travelShift;
        fx.ripple(stern - 12, game.waterline + 6, 0.7);
      }
    });
    game.finishTransition(nextIndex);
    audio.setTravel(false);
    popo.idle();
    popo.travelShift = 0;
    popo.tilt = 0;
    await clock.wait(350, token);
    game.setupChallenge();
  } catch (e) {
    swallow(e);
  }
}

async function tutorial(game) {
  const token = newToken();
  const { ui } = game;
  try {
    state.phase = PHASE.TUTORIAL;
    ui.setHitsEnabled(false);
    for (const f of state.fish) f.frozen = true;
    ui.setInstruction(game.challengeText());
    await clock.wait(900, token);
    game.showHandOn(state.fish.find((f) => f.key === state.target));
    await clock.wait(1500, token);
    for (const f of state.fish) f.frozen = false;
    state.phase = PHASE.READY;
    state.idleTime = 0;
    ui.setHitsEnabled(true);
  } catch (e) {
    swallow(e);
  }
}

// The journey opens with the narrator; then the first fish swim in and the tutorial starts.
async function opening(game) {
  const token = newToken();
  try {
    state.phase = PHASE.TUTORIAL;
    game.ui.setHitsEnabled(false);
    state.fish = [];
    game.ui.setInstruction('');
    await clock.wait(800, token);
    for (const line of STORY.intro) await game.say(line, token);
    game.fishIn();
    await clock.wait(400, token);
    tutorial(game);
  } catch (e) {
    swallow(e);
  }
}

// After the last level: a fish Popo has never seen races in, leaps out of the water and dives
// away; Popo wonders about it, and the journey's summary follows.
async function discovery(game) {
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  const story = STORY.ending;
  try {
    state.phase = PHASE.LEVEL_TRANSITION;
    ui.setHitsEnabled(false);
    ui.setInstruction('');
    for (const f of state.fish) { f.frozen = false; f.escape(); }
    await clock.wait(700, token);
    state.fish = [];
    ui.clearHits();

    const wl = game.waterline;
    const fish = new Fish(story.fish, STAGE_W + 120, wl + 170, -1, 1.15);
    game.leaper = fish;
    audio.play('whoosh');
    await clock.tween(950, token, (t) => {
      const k = ease.out(t);
      fish.x = STAGE_W + 120 + (1180 - STAGE_W - 120) * k;
      fish.y = wl + 170 - 90 * k + Math.sin(t * Math.PI * 2) * 8;
      fish.pitch = -0.12 * k;
      if (Math.random() < 0.35) fx.puff(fish.x + fish.dir * fish.w * 0.42, fish.y, fish.dir, 1);
    });

    // the leap: out of the water in an arc over toward the raft, then back in
    const x0 = 1180;
    const x1 = 760;
    const y0 = wl + 80;
    const height = 290;
    let out = false;
    let back = false;
    audio.play('leap');
    const arc = clock.tween(1500, token, (t) => {
      fish.x = x0 + (x1 - x0) * t;
      fish.y = y0 - height * 4 * t * (1 - t);
      const vy = -height * 4 * (1 - 2 * t);
      fish.pitch = Math.max(-0.9, Math.min(0.9, Math.atan2(vy, Math.abs(x1 - x0)) * 0.9));
      if (!out && fish.y < wl) {
        out = true;
        fx.splash(fish.x, wl, true);
        audio.play('splashSmall');
      }
      if (out && !back && t > 0.5 && fish.y > wl) {
        back = true;
        fx.splash(fish.x, wl, true);
        audio.play('splashBig');
      }
    });
    arc.catch(() => {});
    await clock.wait(420, token);
    popo.beginMishap(wl);
    const woah = (async () => { for (const line of story.woah) await game.say(line, token); })();
    woah.catch(() => {});
    await arc;
    await clock.tween(900, token, (t) => {
      const k = ease.in(t);
      fish.x = x1 - 900 * k;
      fish.y = y0 + 60 * k;
      fish.pitch = 0.25 * (1 - k);
      if (Math.random() < 0.3) fx.puff(fish.x + fish.dir * fish.w * 0.42, fish.y, fish.dir, 1);
    });
    game.leaper = null;
    await woah;
    popo.endMishap();
    for (const line of story.after) await game.say(line, token);
    game.complete();
  } catch (e) {
    game.leaper = null;
    swallow(e);
  }
}

Object.assign(PopoGame, { mouthOf, correctCatch, wrongCatch, travelTo, tutorial, opening, discovery });
})(window.PopoGame = window.PopoGame || {});
