(function (PopoGame) {
'use strict';
const { clock, ease, Cancelled, state, PHASE, newToken, isCurrent, getShape } = PopoGame;

// Where the hook grabs a fish: just in front of its mouth.
function mouthOf(fish) {
  return { x: fish.x + fish.dir * fish.w * 0.4 * fish.scale, y: fish.y + fish.h * 0.08 * fish.scale };
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

function reelLineHome(game, token) {
  const { popo } = game;
  const start = { ...popo.line.hook };
  popo.line.mode = 'slack';
  return clock.tween(380, token, (t) => {
    const tip = popo.rodTip();
    const k = ease.inOut(t);
    popo.line.hook.x = start.x + (tip.x + 4 - start.x) * k;
    popo.line.hook.y = start.y + (tip.y + popo.line.length - start.y) * k;
    popo.line.arc = 0.6 * (1 - k);
  }).then(() => { popo.line.mode = 'dangle'; popo.line.arc = 0; popo.line.tension = 0; });
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
    await clock.wait(420, token);

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

// Durations use game time, so pause freezes the whole mishap, including its effects.
const WRONG = { acknowledge: 160, tug: 220, yank: 230, slack: 240, brace: 320, doubleTake: 140, hang: 100, fall: 380,
  dipIn: 160, dip: 300, emerge: 340, blink: 100, reach: 240, climb: 420, seat: 260, wet: 300, grip: 260, smile: 160 };

async function wrongCatch(game, fish) {
  if (state.phase !== PHASE.READY) return;
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  const target = getShape(state.target);
  const home = { x: fish.x, y: fish.y };
  // Optional audio must never be able to abort the animation or retain its lock.
  const sound = (name) => { try { audio.play(name); } catch (e) { /* silent fallback */ } };
  const castGame = Object.create(game);
  castGame.audio = { play: sound };
  const move = (duration, values, easing = ease.inOut) => {
    const m = popo.mishap;
    const start = Object.fromEntries(Object.keys(values).map((key) => [key, m[key]]));
    return clock.tween(duration, token, (t) => {
      const k = easing(t);
      for (const key of Object.keys(values)) m[key] = start[key] + (values[key] - start[key]) * k;
    });
  };
  try {
    state.phase = PHASE.CASTING;
    state.selectedFish = fish;
    ui.setHitsEnabled(false);
    game.showHandOn(null);
    ui.hideHand();
    fish.frozen = true;
    fish.wiggle(true);
    sound('fishTap');
    await clock.wait(WRONG.acknowledge, token);
    await castTo(castGame, fish, token);

    // castTo resolves on contact with the frozen fish's actual mouth.
    state.phase = PHASE.WRONG_PULL;
    popo.beginMishap(game.waterline);
    const m = popo.mishap;
    const reduced = fx.reduced;
    const rotation = reduced ? 0.45 : 1;
    const edge = popo.placement('fishing', 'idle').raftRightX;
    const seat = popo.mishapBodyPoint(178, 300);
    const fallX = edge - seat.x + (reduced ? 45 : 65);
    const pull = Math.min(reduced ? 16 : 30, Math.max(8, game.area.right - fish.w / 2 - fish.x));
    sound('tug');
    await clock.tween(WRONG.tug, token, (t) => {
      const k = ease.out(t);
      fish.x = home.x + pull * k;
      m.x = 9 * k;
      m.angle = 0.045 * k * rotation;
      m.rodBend = 0.035 * k;
      popo.line.tension = 1.4;
    });
    // tug-of-war: three pulls, each harder. The fish dives away and Popo leans after it;
    // between pulls the line slackens and both ease back, ending on the values the next
    // beat starts from so nothing snaps.
    for (let i = 1; i <= 3; i += 1) {
      const strength = i / 3;
      const last = i === 3;
      const dartX = home.x + pull + 22 * i;
      const backX = last ? home.x + pull : home.x + pull + 10 * i;
      const slide = 9 + 5 * i;
      sound('tug');
      fish.wiggle();
      await clock.tween(WRONG.yank, token, (t) => {
        const k = ease.inOut(t);
        fish.x = home.x + pull + (dartX - home.x - pull) * k;
        fish.y = home.y + 6 * strength * Math.sin(k * Math.PI / 2);
        m.x = 9 + (slide - 9) * k;
        m.y = -4 * strength * Math.sin(k * Math.PI);
        m.angle = (0.045 + 0.065 * strength * k) * rotation;
        m.rodBend = 0.035 + 0.045 * strength * k;
        m.raftAngle = reduced ? 0 : 0.01 * strength * k;
        popo.line.tension = 1.5 + strength;
      });
      await clock.tween(WRONG.slack, token, (t) => {
        const k = ease.inOut(t);
        const relax = last ? 1 : 0.5;
        fish.x = dartX + (backX - dartX) * k;
        fish.y = home.y + 6 * strength * (1 - k);
        m.x = slide + (9 - slide) * k * relax;
        m.angle = (0.045 + 0.065 * strength * (1 - k * relax)) * rotation;
        m.raftAngle *= 1 - 0.6 * k;
        popo.line.tension = 1.2;
      });
    }
    state.phase = PHASE.LOSING_BALANCE;
    // One small double-take, then the comic beat before gravity wins.
    await clock.tween(WRONG.doubleTake, token, (t) => {
      m.angle = (0.045 - Math.sin(t * Math.PI) * 0.075) * rotation;
    });
    popo.setMishapPose('brace', 'hand');
    await move(WRONG.brace, { x: fallX * 0.38, y: -8, angle: 0.16 * rotation,
      rodBend: 0.06, raftAngle: reduced ? 0 : 0.008 });

    await clock.wait(WRONG.hang, token);
    state.phase = PHASE.FALLING;
    sound('slip');
    const start = { x: m.x, y: m.y, angle: m.angle };
    let released = null;
    let releasedHook = null;
    let impact = false;
    const footY = popo.sourcePoint(242, 336).y;
    const fallY = game.waterline - footY + 35;
    await clock.tween(WRONG.fall, token, (t) => {
      m.x = start.x + (fallX - start.x) * ease.out(t);
      m.y = start.y + (fallY - start.y) * t * t - 22 * Math.sin(Math.PI * t);
      m.angle = start.angle + (0.38 * rotation - start.angle) * t;
      m.raftAngle *= 0.92;
      if (t >= 0.2 && !released) {
        released = { ...popo.mishapRod() };
        releasedHook = { ...popo.line.hook };
        m.rod = { ...released };
        popo.setMishapPose('slip', 'head');
        popo.line.mode = 'slack';
        popo.line.tension = 0;
      }
      if (released) {
        const k = ease.out(Math.min(1, (t - 0.2) / 0.8));
        m.rod.x = released.x + (edge - 105 - released.x) * k;
        m.rod.y = released.y + (game.waterline - 57 - released.y) * k - Math.sin(k * Math.PI) * 16;
        m.rod.angle = released.angle + (0.83 - released.angle) * k;
        popo.line.arc = k * 0.7;
        const tip = popo.rodTip();
        popo.line.hook.x = releasedHook.x + (tip.x - releasedHook.x) * k * 0.25;
        popo.line.hook.y = releasedHook.y + (tip.y + popo.line.length - releasedHook.y) * k * 0.25;
      }
      const foot = popo.bodyLandmark('contact');
      if (!impact && foot.y >= game.waterline && foot.x > edge) {
        impact = true;
        fx.splash(foot.x, game.waterline, false);
        fx.ripple(foot.x, game.waterline, reduced ? 0.6 : 1.1);
        sound('splashSmall');
      }
    });
    ui.setInstruction(`That's a ${fish.shape.name.toLowerCase()}. Let's find the ${target.name.toLowerCase()}!`, state.target);
    // Keep the released hook visible on its slack line during the quick dip.
    const submergedY = game.waterline - (popo.bodyLandmark('top').y - m.y) + 22;
    await move(WRONG.dipIn, { y: submergedY, angle: 0 });
    popo.setMishapPose('surface');
    const headY = popo.bodyLandmark('top').y - m.y;
    m.y = game.waterline - headY + 8;
    state.phase = PHASE.SUBMERGED;
    fx.bubbleBurst(popo.mishapBodyPoint(210, 175).x, game.waterline + 16);
    sound('bubbles');
    await clock.wait(WRONG.dip, token);

    state.phase = PHASE.RESURFACING;
    sound('recover');
    await move(WRONG.emerge, { y: game.waterline - headY - 85 });
    fx.ripple(popo.bodyLandmark('head').x, game.waterline, 0.7);
    // Puff-cheek pop, blink, then an eager look toward the raft.
    popo.setMishapPose('blink', 'head');
    sound('puff');
    await clock.wait(WRONG.blink, token);
    popo.setMishapPose('surface', 'head');
    await reelLineHome(game, token);
    state.phase = PHASE.RECOVERING;
    popo.setMishapPose('climb', 'head');
    // Approach the edge, lift onto the deck, then scoot back to the registered seat.
    await move(WRONG.reach, { x: fallX * 0.7, angle: -0.12 * rotation });
    await move(WRONG.climb, { x: fallX * 0.42, y: -15, angle: -0.08 * rotation });
    popo.setMishapPose('shake', 'head');
    await move(WRONG.seat, { x: 0, y: 0, angle: 0, raftAngle: 0, rodBend: 0 });
    fx.drips(popo.mishapBodyPoint(190, 230));
    sound('drip');
    await clock.tween(WRONG.wet, token, (t) => {
      m.angle = Math.sin(t * Math.PI * 4) * 0.045 * (1 - t) * rotation;
      m.y = -Math.sin(t * Math.PI * 2) * 3 * (1 - t) * rotation;
    });
    popo.setMishapPose('wet', 'head');
    const restingRod = { ...m.rod };
    await clock.tween(WRONG.grip, token, (t) => {
      const k = ease.inOut(t);
      const grip = popo.bodyLandmark('hand');
      m.rod.x = restingRod.x + (grip.x - restingRod.x) * k;
      m.rod.y = restingRod.y + (grip.y - restingRod.y) * k - Math.sin(t * Math.PI) * 18;
      m.rod.angle = restingRod.angle * (1 - k);
      fish.x = home.x + pull * (1 - k);
    });
    await clock.wait(WRONG.smile, token);
    popo.endMishap();
    fish.x = home.x;
    fish.y = home.y;
    fish.frozen = false;
    state.phase = PHASE.READY;
    state.selectedFish = null;
    state.idleTime = 0;
    ui.setHitsEnabled(true);
    game.revertInstructionIn(3500);
    game.restoreTutorialHand();
  } catch (e) {
    if (isCurrent(token)) {
      popo.endMishap();
      fish.x = home.x;
      fish.y = home.y;
      fish.frozen = false;
      state.selectedFish = null;
      state.phase = PHASE.READY;
      ui.setHitsEnabled(true);
      game.restoreTutorialHand();
    }
    swallow(e);
  }
}

async function travelTo(game, nextIndex) {
  const token = newToken();
  const { popo, fx, audio, ui } = game;
  try {
    state.phase = PHASE.LEVEL_TRANSITION;
    ui.setHitsEnabled(false);
    ui.setInstruction('Great catch! Popo rows on…', null);
    audio.play('complete');
    for (const f of state.fish) { f.frozen = false; f.escape(); }
    await clock.wait(900, token);
    state.fish = [];
    ui.clearHits();

    await game.prepareTransition(nextIndex);
    if (!isCurrent(token)) return;
    popo.playFrames('rowing', ['raise', 'reach', 'dip', 'deep', 'pull', 'lift'], 150, true);
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
    ui.setInstruction('Help Popo find the shapes!', null);
    await clock.wait(1900, token);
    ui.setInstruction(`Tap the ${getShape(state.target).name.toLowerCase()} fish.`, state.target);
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

Object.assign(PopoGame, { mouthOf, correctCatch, wrongCatch, travelTo, tutorial });
})(window.PopoGame = window.PopoGame || {});
