(function (PopoGame) {
'use strict';
const { assets, getShape } = PopoGame;

const TAU = Math.PI * 2;
const FISH_SCALE = 0.56;

class Fish {
  constructor(key, x, y, dir, sizeScale = 1) {
    this.key = key;
    this.shape = getShape(key);
    this.box = assets.fish.boxes[this.shape.atlas];
    this.w = (this.box[2] - this.box[0]) * FISH_SCALE * sizeScale;
    this.h = (this.box[3] - this.box[1]) * FISH_SCALE * sizeScale;
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.targetY = y;
    this.dir = dir;
    this.cruise = 45 + Math.random() * 30;
    this.speed = this.cruise;
    this.turn = null;
    this.turnIn = 4 + Math.random() * 5;
    this.wanderIn = 2 + Math.random() * 3;
    this.driftPhase = Math.random() * TAU;
    this.driftAmp = 8 + Math.random() * 8;
    this.driftFreq = 0.25 + Math.random() * 0.2;
    // Start on the drift curve so the first frame never jumps vertically.
    this.baseY = y - Math.sin(this.driftPhase) * this.driftAmp;
    this.targetY = this.baseY;
    this.bobPhase = Math.random() * TAU;
    this.frozen = false;
    this.wiggleT = -1;
    this.pulse = 0;
    this.scale = 1;
    this.alpha = 1;
    this.hinted = false;
    this.gone = false;
    this.escaping = false;
    this.breath = 2 + Math.random() * 4;
    this.pitch = 0;
    this.lastY = y;
  }

  startTurn() {
    if (!this.turn) this.turn = { stage: 'slow', t: 0 };
  }

  wiggle(subtle = false) {
    this.subtleWiggle = subtle;
    this.wiggleT = 0;
  }

  // Dash off to the right, then come back in from the edge at cruising speed.
  escape() {
    this.escaping = true;
    this.frozen = false;
    this.turn = null;
    this.dir = 1;
    this.speed = 260;
  }

  update(dt, area, others) {
    this.bobPhase += dt * 2.2;
    this.breath -= dt;
    // nose follows the vertical motion a little, smoothed so the body never jitters
    const vy = (this.y - this.lastY) / Math.max(dt, 0.001);
    this.lastY = this.y;
    const want = this.frozen || this.escaping ? 0 : Math.max(-0.09, Math.min(0.09, vy / 900));
    this.pitch += (want - this.pitch) * Math.min(1, dt * 3);
    if (this.wiggleT >= 0) {
      this.wiggleT += dt;
      if (this.wiggleT > (this.subtleWiggle ? 0.16 : 0.45)) this.wiggleT = -1;
    }
    if (this.frozen) return;
    if (this.escaping) {
      this.x += this.speed * dt;
      if (this.x > area.right + this.w * 1.5) {
        this.escaping = false;
        this.dir = -1;
        this.speed = this.cruise;
        this.turnIn = 6 + Math.random() * 5;
        this.baseY = area.top + this.h / 2 + Math.random() * (area.bottom - area.top - this.h);
        this.targetY = this.baseY;
      }
      return;
    }

    // turning: slow to a stop, flip, speed back up (no mid-flip squash of the body)
    if (this.turn) {
      this.turn.t += dt;
      const progress = Math.min(1, this.turn.t / 0.35);
      const k = progress * progress * (3 - 2 * progress);
      if (this.turn.stage === 'slow') {
        this.speed = this.cruise * (1 - k);
        if (k >= 1) {
          this.dir *= -1;
          this.turn = { stage: 'speed', t: 0 };
        }
      } else {
        this.speed = this.cruise * k;
        if (k >= 1) this.turn = null;
      }
    } else {
      this.turnIn -= dt;
      if (this.turnIn <= 0) {
        this.turnIn = 5 + Math.random() * 6;
        this.startTurn();
      }
    }

    const stoppingDistance = this.speed * 0.35 * 0.5 + 3;
    const edgeDistance = this.dir > 0 ? area.right - this.w / 2 - 10 - this.x : this.x - area.left - this.w / 2 - 10;
    if (!this.turn && edgeDistance < stoppingDistance) this.startTurn();
    if (!this.turn) {
      const cruise = this.cruise * (1 + Math.sin(this.bobPhase * 0.37) * 0.06);
      this.speed += (cruise - this.speed) * Math.min(1, dt * 1.4);
    }
    this.x += this.dir * this.speed * dt;
    const half = this.w / 2 + 10;
    if (this.x < area.left + half) {
      this.x = area.left + half;
      if (this.dir < 0) this.startTurn();
    } else if (this.x > area.right - half) {
      this.x = area.right - half;
      if (this.dir > 0) this.startTurn();
    }

    // slow wandering between depths plus a gentle drift
    this.wanderIn -= dt;
    if (this.wanderIn <= 0) {
      this.wanderIn = 3 + Math.random() * 4;
      this.targetY = area.top + this.h / 2 + Math.random() * (area.bottom - area.top - this.h);
    }
    this.baseY += (this.targetY - this.baseY) * Math.min(1, dt * 0.35);
    this.driftPhase += dt * this.driftFreq * TAU;

    // keep clear of the other fish
    for (const o of others) {
      if (o === this || o.gone) continue;
      const dx = o.x - this.x;
      const dy = o.baseY - this.baseY;
      const minX = (this.w + o.w) * 0.7;
      const minY = (this.h + o.h) * 0.85;
      if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
        const push = (minY - Math.abs(dy)) * dt * 4;
        const sign = dy >= 0 ? -1 : 1;
        this.baseY += sign * push;
        this.targetY += sign * push * 2;
        if (Math.sign(dx) === this.dir && !this.turn && Math.abs(dx) < minX * 0.8) this.startTurn();
      }
    }
    const minY = area.top + this.h / 2;
    const maxY = area.bottom - this.h / 2;
    this.baseY = Math.min(maxY, Math.max(minY, this.baseY));
    this.targetY = Math.min(maxY, Math.max(minY, this.targetY));
    this.y = this.baseY + Math.sin(this.driftPhase) * this.driftAmp;
  }

  draw(ctx) {
    if (this.gone) return;
    const bob = this.frozen && this.subtleWiggle ? 0 : Math.sin(this.bobPhase) * 2;
    let rot = 0;
    if (this.wiggleT >= 0) {
      const t = this.wiggleT;
      if (this.subtleWiggle) {
        rot = Math.sin(t / 0.16 * Math.PI * 2) * 0.045 * (1 - t / 0.16);
      } else {
        rot = Math.sin(t * 38) * 0.14 * Math.max(0, 1 - t / 0.45);
      }
    }
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y + bob);
    if (this.hinted) {
      const r = Math.max(this.w, this.h) * 0.62 * this.scale;
      const glow = 0.35 + Math.sin(this.bobPhase * 1.5) * 0.2;
      const g = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 1.15);
      g.addColorStop(0, `rgba(255, 240, 180, ${glow})`);
      g.addColorStop(1, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.15, 0, TAU);
      ctx.fill();
    }
    ctx.rotate(rot + this.pitch * this.dir);
    ctx.scale(this.dir * this.scale, this.scale);
    const [x0, y0, x1, y1] = this.box;
    ctx.drawImage(assets.fish.img, x0, y0, x1 - x0, y1 - y0, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }

  // Generous touch target around the visible fish.
  hitRect() {
    const margin = 14;
    const w = this.w * this.scale + margin * 2;
    const h = this.h * this.scale + margin * 2;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }
}

// Spread the fish across the swim area so none start on top of each other.
function spawnFish(keys, area, sizeScale = 1) {
  const lanes = keys.length;
  const span = area.right - area.left;
  const order = keys.map((k, i) => i).sort(() => Math.random() - 0.5);
  const depth = area.bottom - area.top;
  return keys.map((key, i) => {
    const slot = order[i];
    const x = area.left + span * ((slot + 0.5) / lanes) + (Math.random() - 0.5) * span * 0.12;
    const y = area.top + depth * (0.2 + 0.6 * ((slot * 2 + 1) % lanes) / Math.max(1, lanes - 1)) + (Math.random() - 0.5) * 40;
    return new Fish(key, x, Math.min(area.bottom - 60, Math.max(area.top + 60, y)), Math.random() < 0.5 ? 1 : -1, sizeScale);
  });
}

Object.assign(PopoGame, { FISH_SCALE, Fish, spawnFish });
})(window.PopoGame = window.PopoGame || {});
