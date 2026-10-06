(function (PopoGame) {
'use strict';
const { isCurrent } = PopoGame;

// Game-time timers in milliseconds. Driven by the update loop so pausing freezes every sequence.
class Cancelled extends Error {}

const waiting = [];

const clock = {
  time: 0,

  update(dt) {
    this.time += dt * 1000;
    for (let i = waiting.length - 1; i >= 0; i -= 1) {
      const w = waiting[i];
      if (!isCurrent(w.token)) {
        waiting.splice(i, 1);
        w.reject(new Cancelled());
        continue;
      }
      const t = Math.min(1, (this.time - w.start) / w.duration);
      if (w.onFrame) w.onFrame(t);
      if (t >= 1) {
        waiting.splice(i, 1);
        w.resolve();
      }
    }
  },

  wait(ms, token) {
    return new Promise((resolve, reject) => {
      waiting.push({ start: this.time, duration: Math.max(1, ms), token, resolve, reject });
    });
  },

  tween(ms, token, onFrame) {
    return new Promise((resolve, reject) => {
      waiting.push({ start: this.time, duration: Math.max(1, ms), token, resolve, reject, onFrame });
    });
  },

  cancelAll() {
    while (waiting.length) waiting.pop().reject(new Cancelled());
  },
};

const ease = {
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  outBack: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};

Object.assign(PopoGame, { Cancelled, clock, ease });
})(window.PopoGame = window.PopoGame || {});
