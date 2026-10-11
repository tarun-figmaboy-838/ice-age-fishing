(function (PopoGame) {
'use strict';
const { assets } = PopoGame;

// Swiftee, the little teal bird who drops in at the end of the journey. Four wing beats from
// one atlas, every frame registered on the belly so the body holds still while the wings flap.
const BEAT = [0, 1, 2, 1, 3, 1, 2, 1];
const SCALE = 0.68;

class Swiftee {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.dir = -1; // the art faces right; Swiftee arrives from the right, facing Popo
    this.time = 0;
    this.beat = 0; // wing-beat phase, in frames; the rate eases down as Swiftee settles
    this.lean = 0;
    this.spin = null;
    this.flapRate = 16;
    this.lastBeat = -1;
    this.onDownstroke = null;
  }

  // a quick loop-de-loop on the stressed word
  twirl() {
    this.spin = { t: 0 };
  }

  // a little bounce, now and then while waiting for Next
  hop() {
    this.bounce = { t: 0 };
  }

  update(dt) {
    this.time += dt;
    this.beat += dt * this.flapRate;
    const beat = Math.floor(this.beat);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      if (BEAT[beat % BEAT.length] === 2 && this.onDownstroke) this.onDownstroke();
    }
    if (this.spin) {
      this.spin.t += dt / 0.55;
      if (this.spin.t >= 1) this.spin = null;
    }
    if (this.bounce) {
      this.bounce.t += dt / 0.45;
      if (this.bounce.t >= 1) this.bounce = null;
    }
  }

  // where a speech bubble's tail should point: just above Swiftee's head
  head() {
    const d = PopoGame.SWIFTEE_DATA;
    return { x: this.x + 18, y: this.bobY() - d.belly[1] * SCALE + 6 };
  }

  bobY() {
    const hop = this.bounce ? Math.sin(this.bounce.t * Math.PI) * 26 : 0;
    return this.y + Math.sin(this.time * 7) * 6 - hop;
  }

  draw(ctx) {
    const d = PopoGame.SWIFTEE_DATA;
    const img = assets.swiftee;
    if (!img || !d) return;
    const frame = BEAT[Math.floor(this.beat) % BEAT.length];
    const spin = this.spin ? Math.sin(this.spin.t * Math.PI / 2) ** 2 * Math.PI * 2 : 0;
    ctx.save();
    ctx.translate(this.x, this.bobY());
    ctx.rotate(this.dir * (this.lean + spin));
    // a little squash on the downstroke makes the flap read at a glance
    const squash = frame === 2 ? 0.05 : 0;
    ctx.scale(this.dir * SCALE * (1 + squash), SCALE * (1 - squash));
    ctx.drawImage(img, frame * d.width, 0, d.width, d.height, -d.belly[0], -d.belly[1], d.width, d.height);
    ctx.restore();
  }
}

Object.assign(PopoGame, { Swiftee });
})(window.PopoGame = window.PopoGame || {});
