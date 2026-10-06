(function (PopoGame) {
'use strict';
const { STAGE_W, STAGE_H, SEABED_Y } = PopoGame;

const TAU = Math.PI * 2;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Ambient underwater motion and the small effect pools. Everything is pre-allocated and
// reused. The painted background layers carry the scene (see game.js); this only adds
// small bubbles, drifting specks and a soft light wash with no drawn shapes.
class Effects {
  constructor() {
    this.waterline = 390;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t = 0;
    this.bubbles = Array.from({ length: 14 }, () => this.newBubble(true));
    this.snow = Array.from({ length: 28 }, () => ({
      x: rand(0, STAGE_W), y: rand(this.waterline + 40, SEABED_Y), r: rand(0.7, 1.6), vx: rand(-5, 5), vy: rand(2, 6), phase: rand(0, TAU), a: rand(0.12, 0.26),
    }));
    this.ripples = Array.from({ length: 6 }, () => ({ life: 0 }));
    this.drops = Array.from({ length: 28 }, () => ({ life: 0 }));
    this.sparkles = Array.from({ length: 14 }, () => ({ life: 0 }));
  }

  setWaterline(y) {
    this.waterline = y;
  }

  newBubble(anywhere) {
    const r = rand(1.6, 5.5);
    return {
      x: rand(60, STAGE_W - 40),
      y: anywhere ? rand(this.waterline + 60, SEABED_Y + 20) : SEABED_Y + rand(0, 30),
      r,
      speed: 12 + r * 4,
      wobble: rand(0, TAU),
      wobbleAmp: rand(4, 10),
    };
  }

  // A bubble released at a point, e.g. from a fish's mouth. Reuses the bubble nearest the surface.
  bubbleAt(x, y, r = 2.5) {
    let slot = this.bubbles[0];
    for (const b of this.bubbles) if (b.y < slot.y) slot = b;
    Object.assign(slot, { x, y, r, speed: 12 + r * 4, wobble: rand(0, TAU), wobbleAmp: rand(3, 6) });
  }

  ripple(x, y, size = 1) {
    const r = this.ripples.find((p) => p.life <= 0) || this.ripples[0];
    Object.assign(r, { x, y, size, life: 1 });
  }

  splash(x, y, big = false) {
    const n = big ? 22 : 10;
    let used = 0;
    for (const d of this.drops) {
      if (d.life > 0 || used >= n) continue;
      used += 1;
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const v = big ? rand(220, 420) : rand(120, 240);
      Object.assign(d, { x: x + rand(-14, 14), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: big ? rand(3, 7) : rand(2, 4.5), life: 1, decay: big ? 1.2 : 1.8 });
    }
    this.ripple(x, y, big ? 1.8 : 1);
    if (big) this.ripple(x + 20, y, 1.2);
  }

  clearTransient() {
    for (const pool of [this.ripples, this.drops, this.sparkles]) {
      for (const particle of pool) particle.life = 0;
    }
    this.dipBubbles = [];
  }

  bubbleBurst(x, y) {
    this.dipBubbles = Array.from({ length: this.reduced ? 2 : 4 }, (_, i) =>
      ({ x: x + (i - 1.5) * 11, y: y + i * 7, r: 2 + i * 0.6, life: 0.55 }));
  }

  drips(point) {
    for (let i = 0; i < (this.reduced ? 1 : 3); i += 1) {
      const d = this.drops.find((p) => p.life <= 0);
      if (d) Object.assign(d, { x: point.x + (i - 1) * 18, y: point.y,
        vx: (i - 1) * 18, vy: 30, r: 2.5, life: 0.5, decay: 2 });
    }
  }

  sparkle(x, y, n = 10) {
    let used = 0;
    for (const s of this.sparkles) {
      if (s.life > 0 || used >= n) continue;
      used += 1;
      const a = rand(0, TAU);
      const v = rand(40, 120);
      Object.assign(s, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, r: rand(2, 4), life: 1 });
    }
  }

  update(dt) {
    this.t += dt;
    for (const b of this.dipBubbles || []) { b.y -= dt * 35; b.life -= dt; }
    const top = this.waterline + 40;
    for (let i = 0; i < this.bubbles.length; i += 1) {
      const b = this.bubbles[i];
      b.y -= b.speed * dt;
      b.wobble += dt * 2.4;
      b.x += Math.cos(b.wobble) * b.wobbleAmp * dt;
      if (b.y < this.waterline + 14) this.bubbles[i] = this.newBubble(false);
    }
    for (const s of this.snow) {
      s.phase += dt * 0.8;
      s.x += (s.vx + Math.sin(s.phase) * 3) * dt;
      s.y -= s.vy * dt;
      if (s.y < top) { s.y = SEABED_Y; s.x = rand(0, STAGE_W); }
      if (s.x < -10) s.x = STAGE_W + 10;
      if (s.x > STAGE_W + 10) s.x = -10;
    }
    for (const r of this.ripples) if (r.life > 0) r.life -= dt * 1.3;
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      d.vy += 900 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * d.decay;
      if (d.y > this.waterline + 6 && d.vy > 0) d.life = Math.min(d.life, 0.08);
    }
    for (const s of this.sparkles) {
      if (s.life <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 60 * dt;
      s.life -= dt * 1.6;
    }
  }

  // Soft shafts of light reaching down from the surface, swaying slowly.
  // Moving pools of light over the sand, on top of the painted caustic pattern.
  // Light filtering through the surface: a wide, soft brightening that slowly breathes and
  // drifts. It has no edges, so it reads as light rather than a drawn shape.
  drawLightWash(ctx, offsetX) {
    if (this.reduced) return;
    const top = this.waterline;
    const pulse = 0.5 + Math.sin(this.t * 0.35) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, top, 0, top + 260);
    g.addColorStop(0, `rgba(190, 235, 255, ${0.05 + pulse * 0.035})`);
    g.addColorStop(1, 'rgba(190, 235, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, STAGE_W, 260);
    const hx = STAGE_W * 0.5 + Math.sin(this.t * 0.11) * 420 + offsetX * 0.6;
    const r = ctx.createRadialGradient(hx, top, 0, hx, top, 900);
    r.addColorStop(0, `rgba(200, 240, 255, ${0.045 + pulse * 0.03})`);
    r.addColorStop(1, 'rgba(200, 240, 255, 0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, top, STAGE_W, SEABED_Y - top);
    ctx.restore();
  }

  drawWater(ctx, offsetX = 0) {
    const top = this.waterline + 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, STAGE_W, SEABED_Y + 30 - top);
    ctx.clip();
    this.drawLightWash(ctx, offsetX);
    for (const s of this.snow) {
      ctx.fillStyle = `rgba(215, 240, 255, ${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x + offsetX, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    for (const b of this.bubbles) {
      const x = b.x + offsetX;
      const fade = Math.min(1, (b.y - this.waterline - 14) / 30);
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, TAU);
      ctx.fillStyle = `rgba(220, 245, 255, ${0.16 * fade})`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * fade})`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, TAU);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * fade})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // Light playing just under the surface: soft sliding streaks and twinkles on the waterline.
  drawFront(ctx) {
    for (const b of this.dipBubbles || []) {
      if (b.life <= 0) continue;
      ctx.strokeStyle = `rgba(235, 250, 255, ${Math.min(0.7, b.life * 2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
    }
    for (const r of this.ripples) {
      if (r.life <= 0) continue;
      const k = 1 - r.life;
      ctx.strokeStyle = `rgba(255, 255, 255, ${r.life * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, (14 + k * 70) * r.size, (4 + k * 18) * r.size, 0, 0, TAU);
      ctx.stroke();
    }
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      ctx.fillStyle = `rgba(225, 245, 255, ${Math.min(1, d.life) * 0.9})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    for (const s of this.sparkles) {
      if (s.life <= 0) continue;
      ctx.fillStyle = `rgba(255, 220, 110, ${s.life})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - s.r * 2);
      ctx.lineTo(s.x + s.r * 0.7, s.y);
      ctx.lineTo(s.x, s.y + s.r * 2);
      ctx.lineTo(s.x - s.r * 0.7, s.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // A light veil over anything below the surface, so the raft and paddle look afloat.
  drawDepthVeil(ctx) {
    const y = this.waterline;
    const g = ctx.createLinearGradient(0, y, 0, y + 70);
    g.addColorStop(0, 'rgba(70, 180, 240, 0.55)');
    g.addColorStop(1, 'rgba(20, 110, 220, 0.15)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, STAGE_W, 70);
  }
}

Object.assign(PopoGame, { Effects });
})(window.PopoGame = window.PopoGame || {});
