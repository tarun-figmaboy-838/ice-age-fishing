(function (PopoGame) {
'use strict';
const { STAGE_W, STAGE_H, SEABED_Y } = PopoGame;

const TAU = Math.PI * 2;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Bounds measured on the existing paintings, expressed in logical scene coordinates.
// Roots sit behind rocks. Only upper vegetation and the adjacent water are refracted.
const PLANTS = [
  [[5,145,680,845], [205,292,735,815], [1360,1518,704,854], [1550,1658,760,859]],
  [[5,140,677,842], [223,292,735,812], [1205,1290,747,827], [1390,1530,701,863], [1580,1658,788,869]],
  [[5,138,677,842], [190,263,737,810], [1400,1534,699,864], [1562,1644,739,822]],
  [[99,177,744,817], [1380,1470,750,850], [1520,1670,606,864]],
].map((group, location) => group.map(([left,right,top,root], i) => ({
  left, right, top, root, phase: 1.17 + i * 2.39 + location * 0.71,
  speed: 0.48 + i * 0.073, amp: root - top > 120 ? 3.4 : 1.5,
})));

// The painted scenery carries the scene. Small fixed pools, low-contrast light and
// registered plant deformation add life behind the learning fish. All motion uses game time.
class Effects {
  constructor() {
    this.waterline = 390;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t = 0;
    this.sources = [{ x: 85, y: 835 }, { x: 252, y: 808 }, { x: 1460, y: 850 }];
    this.bubbles = Array.from({ length: 12 }, () => {
      const b = {}; this.resetBubble(b); return b;
    });
    this.motes = Array.from({ length: 18 }, () => ({
      x: rand(0, STAGE_W), y: rand(this.waterline + 40, SEABED_Y),
      r: rand(0.5, 1.3), vx: rand(-1.8, 1.8), vy: rand(0.4, 1.7),
      depth: rand(0.15, 0.8), phase: rand(0, TAU), a: rand(0.035, 0.1),
    }));
    this.lights = Array.from({ length: 3 }, (_, i) => ({
      x: STAGE_W * (0.16 + i * 0.34), phase: rand(0, TAU), speed: rand(0.06, 0.11),
    }));
    this.reactions = Array.from({ length: 3 }, () => ({ life: 0 }));
    this.sourceIn = rand(2, 5);
    this.ripples = Array.from({ length: 6 }, () => ({ life: 0 }));
    this.drops = Array.from({ length: 28 }, () => ({ life: 0 }));
    this.sparkles = Array.from({ length: 14 }, () => ({ life: 0 }));
  }

  setWaterline(y) {
    this.waterline = y;
  }

  setLocation(index) {
    this.sources = this.plantsFor(index).map(p => ({ x: (p.left + p.right) / 2, y: p.root - 5 }));
  }

  plantsFor(index) { return PLANTS[index] || PLANTS[0]; }

  plantDisplacement(x, y, plants) {
    if (this.reduced) return 0;
    let bend = 0;
    for (const p of plants) {
      if (x <= p.left || x >= p.right || y <= p.top || y >= p.root) continue;
      const height = p.root - p.top;
      const rootWeight = (p.root - y) / height;
      const topFade = Math.min(1, (y - p.top) / 18);
      const across = Math.sin((x - p.left) / (p.right - p.left) * Math.PI);
      const rhythm = Math.sin(this.t * p.speed + p.phase) + 0.32 * Math.sin(this.t * p.speed * 0.61 + p.phase * 2);
      bend += rhythm * p.amp * rootWeight * rootWeight * topFade * across;
    }
    return bend;
  }

  surfaceDisplacement(y) {
    if (this.reduced || y <= 300 || y >= 420) return 0;
    const envelope = Math.sin((y - 300) / 120 * Math.PI) ** 2;
    return envelope * (Math.sin(this.t * 0.43 + y * 0.035) * 1.4
      + Math.sin(this.t * 0.27 - y * 0.022) * 0.6);
  }

  resetBubble(b, source = null) {
    const spot = source || this.sources[Math.floor(Math.random() * this.sources.length)];
    const r = rand(1.5, 3.8);
    Object.assign(b, { x: spot.x + rand(-14, 14), y: spot.y + rand(-3, 3),
      originY: spot.y, r, speed: rand(12, 21), age: 0,
      wobble: rand(0, TAU), wobbleAmp: rand(2, 5), depth: rand(0.3, 0.9),
      delay: source ? 0 : rand(1, 9) });
  }

  // Emit only into an inactive slot: a fish breath must never teleport a visible bubble.
  bubbleAt(x, y, r = 2.5) {
    const slot = this.bubbles.find(b => b.delay > 0);
    if (!slot) return;
    this.resetBubble(slot, { x, y });
    slot.x = x; slot.y = y; slot.r = r;
  }

  readabilityAt(x, y, fish) {
    let visibility = 1;
    for (const f of fish) {
      if (f.gone) continue;
      const d = Math.hypot((x - f.x) / (f.w * 0.75), (y - f.y) / (f.h * 0.75));
      visibility = Math.min(visibility, Math.max(0, Math.min(1, (d - 0.8) / 0.6)));
    }
    return visibility;
  }

  ripple(x, y, size = 1) {
    const r = this.ripples.find((p) => p.life <= 0) || this.ripples[0];
    Object.assign(r, { x, y, size, life: 1 });
  }

  splash(x, y, big = false) {
    const n = this.reduced ? 4 : big ? 16 : 8;
    const reaction = this.reactions.find(r => r.life <= 0) || this.reactions[0];
    Object.assign(reaction, { x, age: 0, life: 1, strength: big ? 1 : 0.6 });
    let used = 0;
    for (const d of this.drops) {
      if (d.life > 0 || used >= n) continue;
      used += 1;
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const v = big ? rand(220, 420) : rand(120, 240);
      Object.assign(d, { x: x + rand(-14, 14), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: big ? rand(3, 7) : rand(2, 4.5), life: 1, decay: big ? 1.2 : 1.8 });
    }
    this.bubbleAt(x, y + 22, 2);
    this.ripple(x, y, big ? 1.8 : 1);
    if (big) this.ripple(x + 20, y, 1.2);
  }

  clearTransient() {
    for (const pool of [this.ripples, this.drops, this.sparkles]) {
      for (const particle of pool) particle.life = 0;
    }
    this.dipBubbles = [];
    for (const r of this.reactions) r.life = 0;
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
    const motion = this.reduced ? 0.2 : 1;
    this.sourceIn -= dt;
    if (this.sourceIn <= 0) {
      const source = this.sources[Math.floor(Math.random() * this.sources.length)];
      let count = this.reduced ? 1 : 2;
      for (const b of this.bubbles) {
        if (b.delay <= 0 || count <= 0) continue;
        this.resetBubble(b, source);
        b.delay = (count - 1) * 0.28;
        count--;
      }
      this.sourceIn = rand(4, 8);
    }
    for (const b of this.bubbles) {
      if (b.delay > 0) { b.delay -= dt * motion; continue; }
      b.age += dt;
      b.speed = Math.min(34, b.speed + dt * 0.7);
      b.y -= b.speed * dt * motion;
      b.wobble += dt * (0.65 + b.depth * 0.3);
      b.x += Math.cos(b.wobble) * b.wobbleAmp * dt * motion;
      if (b.y < this.waterline + 5) this.resetBubble(b);
    }
    for (const s of this.motes) {
      s.phase += dt * 0.21;
      s.x += (s.vx + Math.sin(s.phase) * 1.2) * dt * motion;
      s.y -= s.vy * dt * motion;
      if (s.y < this.waterline + 16) { s.y = SEABED_Y + 8; s.x = rand(0, STAGE_W); }
      if (s.x < -10) s.x = STAGE_W + 10;
      if (s.x > STAGE_W + 10) s.x = -10;
    }
    for (const r of this.reactions) {
      if (r.life <= 0) continue;
      r.age += dt; r.life = Math.max(0, 1 - r.age / 1.8);
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

  drawLightWash(ctx, offsetX) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const light of this.lights) {
      const t = this.reduced ? 0 : this.t;
      const phase = t * light.speed + light.phase;
      const x = light.x + Math.sin(phase) * 95 + offsetX * 0.2;
      const y = this.waterline + 100 + Math.cos(phase * 0.71) * 35;
      const gradient = ctx.createRadialGradient(x, y, 20, x, y, 470);
      gradient.addColorStop(0, `rgba(125, 210, 235, ${0.025 + Math.sin(phase * 0.83) * 0.008})`);
      gradient.addColorStop(1, 'rgba(125, 210, 235, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, this.waterline, STAGE_W, STAGE_H - this.waterline);
      // Broad, very faint pools on the painted sand, without tiled white patterns.
      ctx.save();
      ctx.translate(x, SEABED_Y + 48);
      ctx.scale(1, 0.2);
      const pool = ctx.createRadialGradient(0, 0, 5, 0, 0, 300);
      pool.addColorStop(0, 'rgba(120, 225, 225, 0.055)');
      pool.addColorStop(1, 'rgba(120, 225, 225, 0)');
      ctx.fillStyle = pool;
      ctx.fillRect(-300, -300, 600, 600);
      ctx.restore();
    }
    ctx.restore();
  }

  drawWater(ctx, offsetX = 0, fish = []) {
    const top = this.waterline + 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, STAGE_W, STAGE_H - top);
    ctx.clip();
    this.drawLightWash(ctx, offsetX);
    for (const s of this.motes) {
      const x = s.x + offsetX * s.depth;
      const edgeFade = Math.min(1, Math.max(0, (s.y - top) / 40), Math.max(0, (SEABED_Y + 12 - s.y) / 40));
      ctx.fillStyle = `rgba(170, 215, 230, ${s.a * edgeFade * this.readabilityAt(x, s.y, fish)})`;
      ctx.beginPath();
      ctx.arc(x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    for (const b of this.bubbles) {
      if (b.delay > 0) continue;
      const x = b.x + offsetX * b.depth;
      const fade = Math.max(0, Math.min(1, b.age * 2, (b.y - this.waterline - 5) / 35))
        * this.readabilityAt(x, b.y, fish);
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

  drawSurface(ctx, raftX) {
    ctx.save();
    ctx.lineCap = 'round';
    // Small highlights close to the raft, with separate periods and no full-width overlay.
    for (let i = 0; i < 3; i++) {
      const t = this.reduced ? 0 : this.t;
      const phase = t * (0.37 + i * 0.053) + i * 2.1;
      const x = raftX - 140 + i * 155 + Math.sin(phase) * 9;
      ctx.strokeStyle = `rgba(225,250,255,${0.07 + 0.035 * Math.sin(phase)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, this.waterline + 4 + this.raftResponse(x) * 0.6, 34 + Math.cos(phase) * 5, 3, 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  raftResponse(x) {
    if (this.reduced) return 0;
    let displacement = 0;
    for (const r of this.reactions) {
      if (r.life <= 0 || r.age < 0.12) continue;
      const proximity = Math.max(0, 1 - Math.abs(x - r.x) / 370);
      const t = r.age - 0.12;
      displacement += Math.sin(t * 8) * Math.exp(-t * 3) * 1.4 * proximity * r.strength;
    }
    return displacement;
  }

  // Tint only the immersed raft contact, fading all the way to transparent.
  // Popo's submerged body already has its own waterline clipping.
  drawDepthVeil(ctx, popo) {
    const p = popo.placement('fishing', 'idle');
    const y = this.waterline;
    const g = ctx.createLinearGradient(0, y, 0, y + 30);
    g.addColorStop(0, 'rgba(55, 160, 220, 0.24)');
    g.addColorStop(1, 'rgba(55, 160, 220, 0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse((p.raftLeftX + p.raftRightX) / 2, y, (p.raftRightX - p.raftLeftX) / 2 + 8, 26, 0, 0, Math.PI);
    ctx.fill();
    ctx.restore();
  }

}

Object.assign(PopoGame, { Effects });
})(window.PopoGame = window.PopoGame || {});
