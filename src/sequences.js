(function (PopoGame) {
'use strict';
const { clock, ease, Cancelled, state, PHASE, newToken, isCurrent, getShape, Fish, Swiftee, STORY, STAGE_W } = PopoGame;

// The hook hangs this far below the line's end.
// the line ends at the lip; the hooked fish is drawn over the hook, so it sits inside the mouth
const HOOK_DROP = 2;

// Where the hook grabs a fish: its smile (measured from the art), mirrored when it swims left,
// with the line ending just above it so the hook's bend sits in the mouth.
// The corner of the fish's smile on the stage, through the same bob, tilt and wiggle the fish
// is drawn with, so the hook stays in its mouth however the fish moves.
function mouthOf(fish) {
  const [mx, my] = fish.mouth;
  const lx = fish.dir * (mx - 0.5) * fish.w * fish.scale;
  const ly = (my - 0.5) * fish.h * fish.scale;
  const turn = fish.drawTurn || 0;
  return {
    x: fish.x + lx * Math.cos(turn) - ly * Math.sin(turn),
    y: fish.y + (fish.drawBob || 0) + lx * Math.sin(turn) + ly * Math.cos(turn) - HOOK_DROP,
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
    // the right fish turns to face Popo, so the hook flies straight into its mouth
    fish.dir = Math.sign(popo.anchor.x - fish.x) || -1;
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
    state.phase = PHASE.CELEBRATING;
    state.streak += 1;
    const combo = Math.min(3, state.streak);
    game.cheer();
    audio.play('cheer');
    if (combo >= 2) {
      // on a streak, Popo bounces twice and the fish cheer harder
      audio.play(combo >= 3 ? 'combo3' : 'combo2');
      fx.sparkle(bucket.x, bucket.y - 30, 10 + combo * 6);
      game.cheer();
      clock.wait(380, token).then(() => game.storyCue('hop')).catch(() => {});
    }
    await game.say(STORY.catch, token);
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
    state.streak = 0; // a wrong tap ends the streak
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
      // the quick acting changes snap like a cartoon take; a crossfade would ghost the paws
      [180, 4, 0, .025, 'surprise', 'cut'],
      [400, 13, -2, .05, 'surprise'],
      [680, 25, -5, -.055, 'brace', 'cut'],
      [950, landingX * .47, -12, .13, 'brace'],
      [1130, landingX * .70, -30, .20, 'slip', 'cut'],
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
      [4150, 0, 0, 0, 'wet', 'cut'],
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
    // the tug-of-war: three hard yanks before Popo is pulled off his feet
    const YANKS = [60, 360, 660];
    const yank = (ms) => YANKS.reduce((sum, at) => {
      const d = ms - at;
      return sum + (d < 0 || d > 280 ? 0 : d < 50 ? d / 50 : (1 - (d - 50) / 230) ** 2);
    }, 0);
    const lineEntry = () => {
      const tip = popo.rodTip(), hook = popo.line.hook;
      const k = Math.max(0, Math.min(1, (game.waterline - tip.y) / ((hook.y - tip.y) || 1)));
      return tip.x + (hook.x - tip.x) * k;
    };
    const yanked = () => {
      sound('tug');
      fx.splash(lineEntry(), game.waterline, false);
      fx.puff(fish.x - fish.dir * fish.w * 0.4, fish.y, -fish.dir, 3);
      fish.wiggle();
    };
    let released = null, hookRelease = null, impacted = false;
    let previousContact = null;
    let eventIndex = 0;
    let feedback = Promise.resolve();
    const events = [
      [0, () => { state.phase = PHASE.WRONG_PULL; try { audio.duck(WRONG_DURATION); } catch (e) { /* optional music */ } }],
      [YANKS[0], yanked],
      [YANKS[1], yanked],
      [400, () => { state.phase = PHASE.LOSING_BALANCE; fish.wiggle(); }],
      [YANKS[2], () => { yanked(); sound('reel'); }],
      [950, () => { state.phase = PHASE.FALLING; sound('slip');
        released = { ...popo.mishapRod() }; hookRelease = { ...popo.line.hook };
        popo.line.mode = 'slack'; popo.line.tension = 0;
        fish.frozen = false;
      }],
      [1750, () => { state.phase = PHASE.SUBMERGED; sound('bubbles');
        fx.bubbleBurst(origin.x + landingX, game.waterline + 20); }],
      [2050, () => { state.phase = PHASE.RESURFACING; }],
      [2300, () => { sound('bloop'); fx.ripple(origin.x + landingX, game.waterline, .85); }],
      [2450, () => {
        feedback = game.say(STORY.wrong, token);
        // Attach cancellation handling immediately, even while the motion is running.
        feedback.catch(() => {});
      }],
      [2600, () => { fx.drips(popo.bodyLandmark('head')); }],
      [2750, () => { state.phase = PHASE.RECOVERING; }],
      [3080, () => { sound('bloop'); fx.ripple(gripPoint.x + 10, game.waterline, .7); }],
      [3640, () => { sound('splashSmall'); fx.splash(edge - 20, game.waterline, false); }],
      [3720, () => { sound('boing'); fx.drips(popo.bodyLandmark('head')); }],
      [3920, () => { sound('drip'); fx.drips(popo.bodyLandmark('head')); }],
      [4150, () => { ui.setInstruction(game.wrongText(fish)); }],
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
      const jerk = ms < 950 ? yank(ms) : 0;
      m.x += jerk * 16 * rotation;
      m.angle += jerk * .06 * rotation;
      m.raftAngle = (ms < 1450 ? Math.sin(ms / 1450 * Math.PI) * .012 : 0) + jerk * .03 * rotation;
      m.rodBend = ms < 950 ? Math.sin(ms / 950 * Math.PI) * .06 + jerk * .2 : 0;
      m.deckOcclusion = ms > 2950 && ms < 3720;
      while (eventIndex < events.length && ms >= events[eventIndex][0]) events[eventIndex++][1]();
      if (ms < 950) {
        // the fish darts and dives on each yank, thrashing against the line
        const k = ease.inOut(Math.min(1, ms / 400));
        fish.x = home.x + pull * k + jerk * 26;
        fish.y = home.y + Math.sin(ms / 950 * Math.PI) * 7 + jerk * 16;
        fish.pitch = jerk * .35;
        popo.line.tension = 1 + .8 * Math.sin(Math.min(1, ms / 950) * Math.PI) + jerk * .9;
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
    audio.setTravel(true);
    const fromWater = game.waterline;
    const toWater = game.locationWaterline(nextIndex);
    const duration = fx.reduced ? 2400 : 5400;
    const stroke = duration / (fx.reduced ? 1 : 3);
    popo.startRowing(stroke);
    let lastBlade = popo.paddleTip();
    let lastSplashStroke = -1;
    let lastWake = 0;
    await clock.tween(duration, token, (t) => {
      const k = ease.inOut(t);
      game.transition.k = k;
      game.setWaterline(fromWater + (toWater - fromWater) * k);
      const elapsed = t * duration;
      popo.setRowingTime(elapsed);
      // every pull drives the raft forward and lifts the bow a little; it settles as the blade lifts
      const surge = popo.rowRig.sample(elapsed, stroke).power;
      const pace = Math.sin(t * Math.PI);
      popo.travelShift = pace * (18 + surge * 24);
      popo.tilt = -pace * (0.012 + surge * 0.014);
      const blade = popo.paddleTip();
      const strokeIndex = Math.floor(elapsed / stroke);
      if (strokeIndex !== lastSplashStroke && lastBlade.y < game.waterline && blade.y >= game.waterline) {
        lastSplashStroke = strokeIndex;
        const crossing = (game.waterline - lastBlade.y) / (blade.y - lastBlade.y);
        fx.splash(lastBlade.x + (blade.x - lastBlade.x) * crossing, game.waterline, false);
        audio.play('paddle');
      }
      lastBlade = blade;
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
    popo.idle();
    popo.travelShift = 0;
    popo.tilt = 0;
    if (isCurrent(token)) audio.setTravel(false);
    swallow(e);
  }
}

async function tutorial(game) {
  const token = newToken();
  const { ui } = game;
  try {
    state.phase = PHASE.TUTORIAL;
    ui.setHitsEnabled(false);
    ui.setInstruction(game.challengeText());
    game.speakInstruction();
    // the hand points at a fish to catch once one has swum into view, and follows it around
    await clock.wait(700, token);
    while (!game.inViewTarget()) await clock.wait(100, token);
    game.showHandOn(game.inViewTarget());
    state.phase = PHASE.READY;
    state.idleTime = 0;
    ui.setHitsEnabled(true);
  } catch (e) {
    swallow(e);
  }
}

// Before the first line, a cartoon entrance: Popo zooms in rowing flat out (honk honk!), slams
// on the brakes with a screech, overshoots and springs back boing-boing, swaps paddle for rod
// in a poof (ta-da!), and hops for joy as a fish leaps up to say hello.
async function popoArrives(game, token) {
  const { popo, fx, audio } = game;
  const reduced = fx.reduced;
  const from = -620;
  const overshoot = reduced ? 0 : 110;
  const stroke = 520; // frantic paddling
  const raftFront = () => popo.placement('fishing', 'idle').raftRightX + popo.travelShift;
  popo.travelShift = from;
  popo.startRowing(stroke);
  try {
    await clock.wait(120, token);
    audio.play('honk');
    audio.play('whoosh');
    audio.setTravel(true);
    let lastBlade = popo.paddleTip();
    let lastWake = 0;
    // a fish or two dart out of the way somewhere ahead of the raft
    const darting = shuffled(JUMPERS);
    const scatter = reduced ? [] : [[darting[0], between(400, 450)], [darting[1], between(500, 560)]].slice(0, Math.random() < 0.4 ? 1 : 2);
    const zoom = reduced ? 1300 : 1500;
    await clock.tween(zoom, token, (t) => {
      const elapsed = t * zoom;
      popo.travelShift = from + (overshoot - from) * (t < 0.15 ? (t * t) / 0.3 : t - 0.075) / 0.925;
      popo.setRowingTime(elapsed);
      popo.tilt = -0.03 - popo.rowRig.sample(elapsed, stroke).power * 0.03; // leaning into it
      const blade = popo.paddleTip();
      if (lastBlade && blade && lastBlade.y < game.waterline && blade.y >= game.waterline) {
        const crossing = (game.waterline - lastBlade.y) / (blade.y - lastBlade.y);
        fx.splash(lastBlade.x + (blade.x - lastBlade.x) * crossing, game.waterline, false);
        audio.play('paddle');
      }
      lastBlade = blade;
      // fish leap out of the way as the raft comes zooming through
      const bow = popo.placement('fishing', 'idle').raftRightX + popo.travelShift;
      if (scatter.length && bow > scatter[0][1] - 60) {
        const [shape, x] = scatter.shift();
        jump(game, token, shape, x, 1, { dx: between(130, 210), height: between(110, 180), ms: between(650, 850), scale: between(0.5, 0.65) }).catch(() => {});
      }
      if (elapsed - lastWake > 160) {
        lastWake = elapsed;
        const stern = popo.placement('fishing', 'idle').raftLeftX + popo.travelShift;
        fx.ripple(stern - 12, game.waterline + 6, 0.9);
        if (stern > 0) fx.splash(stern - 6, game.waterline, false); // spray kicked up behind
        fx.splash(stern + 340, game.waterline, false); // and off the bow
      }
    });
    audio.setTravel(false);
    const held = popo.rowing.time;
    if (overshoot) {
      // brakes! the raft screeches past the spot, squashing up in a fan of spray
      audio.play('skid');
      audio.play('woah');
      let lastSpray = 0;
      await clock.tween(520, token, (t) => {
        popo.travelShift = overshoot + 34 * Math.sin(t * Math.PI / 2);
        popo.tilt = 0.12 * Math.sin(t * Math.PI);
        popo.squash = 0.12 * Math.sin(t * Math.PI);
        popo.setRowingTime(held);
        if (t - lastSpray > 0.18) { lastSpray = t; fx.splash(raftFront() + 10, game.waterline, true); }
      });
      // ...and springs back onto it, boing-boing
      audio.play('boing');
      const back = overshoot + 34;
      let boinged = false;
      await clock.tween(820, token, (t) => {
        popo.travelShift = back * (1 - ease.outBack(t));
        popo.tilt = -Math.sin(t * Math.PI * 3) * 0.08 * (1 - t);
        popo.squash = -Math.sin(t * Math.PI * 3) * 0.1 * (1 - t);
        popo.setRowingTime(held);
        if (!boinged && t > 0.45) { boinged = true; audio.play('boing'); }
      });
    }
    popo.squash = 0;
    popo.tilt = 0;
    // ta-da: a poof, and the paddle has turned into his fishing rod
    const head = popo.headTop();
    game.poof = { x: head.x + 30, y: head.y + 120, t: 0 };
    audio.play('poof');
    await clock.wait(130, token); // the swap happens inside the cloud
  } finally {
    // however the entrance ends (even cancelled by a restart), Popo is left sitting on his spot
    popo.idle();
    popo.travelShift = 0;
    popo.tilt = 0;
    popo.squash = 0;
    if (isCurrent(token)) audio.setTravel(false);
  }
  audio.play('tada');
  fx.sparkle(popo.headTop().x + 40, popo.headTop().y + 50, 18);
  await clock.wait(380, token);
  // a happy hop, and a fish leaps up to say hello
  game.storyCue('hop');
  await fishSaysHello(game, token);
  await clock.wait(250, token);
}

// One fish jumps out of the water in an arc and dives back in, with a splash each way.
async function jump(game, token, shape, x0, dir, { dx = 150, height = 190, ms = 900, scale = 0.7 } = {}) {
  const { fx, audio } = game;
  const wl = game.waterline;
  const fish = new Fish(shape, x0, wl + 30, dir, scale);
  game.leapers.push(fish);
  let out = false;
  let back = false;
  try {
    audio.play('leap');
    await clock.tween(ms, token, (t) => {
      fish.x = x0 + dir * dx * t;
      fish.y = wl + 30 - height * 4 * t * (1 - t);
      fish.pitch = Math.max(-0.8, Math.min(0.8, -(1 - 2 * t) * 0.9));
      if (!out && fish.y < wl) { out = true; fx.splash(fish.x, wl, false); audio.play('splashSmall'); }
      if (out && !back && t > 0.5 && fish.y > wl) { back = true; fx.splash(fish.x, wl, true); audio.play('splashSmall'); }
    });
  } finally {
    game.leapers = game.leapers.filter((f) => f !== fish);
  }
}

const JUMPERS = ['triangle', 'pentagon', 'hexagon', 'circle', 'square', 'oval', 'rhombus'];
const between = (a, b) => a + Math.random() * (b - a);
const anyOf = (list) => list[Math.floor(Math.random() * list.length)];
// a different fish each time, in a random order
const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// A few fish leap for joy around the raft at uneven moments, each its own size, height,
// speed and direction. Resolves after the first ones; the rest finish on their own.
async function fishSaysHello(game, token) {
  const raft = game.popo.placement('fishing', 'idle').raftRightX;
  const count = 3 + Math.floor(Math.random() * 2);
  const fish = shuffled(JUMPERS);
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    at += between(120, 420);
    const dir = Math.random() < 0.65 ? 1 : -1;
    const x0 = between(raft + 60, raft + 620);
    const opts = { dx: between(90, 200), height: between(110, 220), ms: between(700, 980), scale: between(0.5, 0.68) };
    clock.wait(at, token).then(() => jump(game, token, fish[i], x0, dir, opts)).catch(() => {});
  }
  await clock.wait(900, token);
}

// The journey opens with the narrator; then the first fish swim in and the tutorial starts.
async function opening(game) {
  const token = newToken();
  try {
    state.phase = PHASE.TUTORIAL;
    game.ui.setHitsEnabled(false);
    state.fish = [];
    game.ui.setInstruction('');
    await popoArrives(game, token);
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
    popo.blendMishapPose('surprise', 'surprise', 0);
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
    await askAndAnswer(game, token);
  } catch (e) {
    game.leaper = null;
    swallow(e);
  }
}

// Popo wonders what that was; Swiftee flies in with "Let's find out!"; Next appears.
async function askAndAnswer(game, token) {
  for (const line of STORY.ending.after) await game.say(line, token);
  await swifteeArrives(game, STORY.ending.swiftee, token);
  await clock.wait(250, token);
  game.awaitingNext = true;
  game.ui.showNext();
  game.audio.play('bloop');
}

// The end of the story without the leap (for the ?dev=1 screen jumps).
async function finale(game) {
  const token = newToken();
  try {
    state.phase = PHASE.LEVEL_TRANSITION;
    game.ui.setHitsEnabled(false);
    game.ui.setInstruction('');
    state.fish = [];
    game.ui.clearHits();
    await clock.wait(400, token);
    await askAndAnswer(game, token);
  } catch (e) {
    swallow(e);
  }
}

// Swiftee swoops in from the right, answers Popo while still in flight, and settles into a
// hover beside him, facing him.
async function swifteeArrives(game, line, token) {
  const { popo, fx, audio } = game;
  const from = { x: STAGE_W + 140, y: 120 };
  const to = { x: popo.anchor.x + 360, y: popo.anchor.y - 130 };
  const bird = new Swiftee(from.x, from.y);
  bird.onDownstroke = () => audio.play('flap');
  game.swiftee = bird;
  audio.play('whoosh');
  let talking = null;
  await clock.tween(fx.reduced ? 1200 : 2400, token, (t) => {
    const k = ease.out(t);
    bird.x = from.x + (to.x - from.x) * k;
    // a swoop: dips on the way in and pulls up into the hover
    bird.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 80;
    bird.lean = 0.32 * (1 - t) ** 1.5;
    bird.flapRate = 11 + 9 * (1 - t);
    if (Math.random() < 0.25 * (1 - t)) fx.sparkle(bird.x + 70, bird.y + (Math.random() - 0.5) * 60, 1);
    if (!talking && t > 0.3) {
      talking = game.say(line, token);
      talking.catch(() => {});
    }
  });
  bird.lean = 0;
  bird.onDownstroke = null;
  if (talking) await talking;
}

Object.assign(PopoGame, { mouthOf, correctCatch, wrongCatch, travelTo, tutorial, opening, discovery, finale });
})(window.PopoGame = window.PopoGame || {});
