(function (PopoGame) {
'use strict';
const { assets } = PopoGame;

const TAU = Math.PI * 2;
const POPO_SCALE = 1.0;

// Frame picks per sheet (row, col). Each sheet's scale makes Popo the same size everywhere
// (derived from the body area measured by tools/build-assets.py). The casting frame at
// row 1 col 2 has its raft clipped by the cell edge and is not used.
const SHEETS = {
  fishing: { scale: 0.93, frames: { idle: [0, 1], blink: [1, 1] } },
  casting: { scale: 1.0, frames: { lift: [0, 1], up: [0, 2], back: [1, 0], swing: [1, 1], hold: [2, 0], reel: [2, 1], reel2: [2, 2] } },
  rowing: { scale: 0.895, frames: { reach: [0, 0], dip: [0, 1], deep: [0, 2], pull: [1, 1], lift: [1, 2], raise: [2, 1] } },
};

// Manually inspected pose extents, torso registrations and attachment landmarks.
// One atlas-wide scale preserves the generated character's proportions in every pose.
const MISHAP_SCALE = 0.414;
const MISHAP_POSES = {
  ready: { box: [55, 24, 486, 487], pivot: [280, 390], hand: [401, 331], head: [335, 90], top: [300, 42], contact: [270, 481] },
  surprise: { box: [554, 24, 985, 487], pivot: [792, 390], hand: [906, 332], head: [852, 95], top: [817, 47], contact: [775, 480] },
  slip: { box: [1050, 24, 1520, 453], pivot: [1265, 335], hand: [1450, 280], head: [1390, 90], top: [1350, 43], contact: [1270, 426] },
  surface: { box: [95, 487, 435, 1005], pivot: [260, 869], hand: [326, 738], head: [309, 550], top: [274, 490], contact: [280, 982] },
  climb: { box: [520, 515, 1015, 985], pivot: [845, 847], hand: [574, 700], head: [728, 588], top: [757, 530], contact: [943, 960] },
  wet: { box: [1058, 515, 1500, 992], pivot: [1280, 887], hand: [1387, 812], head: [1342, 590], top: [1298, 531], contact: [1255, 968] },
};

function frameData(sheet, name) {
  const [row, col] = SHEETS[sheet].frames[name];
  return assets.sheets[sheet].data.frames[row * 3 + col];
}

class Popo {
  constructor() {
    this.anchor = { x: 238, y: 400 };
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.fadeMs = 120;
    this.anim = null;
    this.bobT = Math.random() * TAU;
    this.blinkIn = 2.5;
    this.blinkLeft = 0;
    this.tilt = 0;
    this.dip = 0;
    this.lean = 0;
    this.travelShift = 0;
    this.line = { visible: true, mode: 'dangle', hook: { x: 0, y: 0 }, arc: 0, tension: 0, length: 150 };
    this.swayT = 0;
    this.mishap = null;
  }

  setAnchor(x, y) {
    this.anchor.x = x;
    this.anchor.y = y;
  }

  setPose(sheet, frame, fadeMs = 120) {
    if (this.pose.sheet === sheet && this.pose.frame === frame) return;
    this.prevPose = this.pose;
    this.pose = { sheet, frame };
    this.fade = 0;
    this.fadeMs = Math.max(1, fadeMs);
  }

  playFrames(sheet, frames, frameMs, loop = false) {
    this.anim = { sheet, frames, frameMs, loop, t: 0, index: 0 };
    this.setPose(sheet, frames[0], 80);
  }

  stopFrames() {
    this.anim = null;
  }

  idle() {
    this.anim = null;
    this.setPose('fishing', 'idle', 140);
  }

  update(dt) {
    if (this.mishap) { this.swayT += dt * 1.6; return; }
    this.bobT += dt * 1.1;
    this.swayT += dt * 1.6;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + (dt * 1000) / this.fadeMs);

    if (this.anim) {
      const a = this.anim;
      a.t += dt * 1000;
      if (a.t >= a.frameMs) {
        a.t -= a.frameMs;
        if (a.index < a.frames.length - 1) {
          a.index += 1;
          this.setPose(a.sheet, a.frames[a.index], 70);
        } else if (a.loop) {
          a.index = 0;
          this.setPose(a.sheet, a.frames[0], 70);
        } else {
          this.anim = null;
        }
      }
    } else if (this.pose.sheet === 'fishing') {
      // Calm idle: an occasional blink, nothing else loops.
      if (this.blinkLeft > 0) {
        this.blinkLeft -= dt;
        if (this.blinkLeft <= 0) this.setPose('fishing', 'idle', 50);
      } else {
        this.blinkIn -= dt;
        if (this.blinkIn <= 0) {
          this.blinkIn = 2.8 + Math.random() * 3;
          this.blinkLeft = 0.14;
          this.setPose('fishing', 'blink', 40);
        }
      }
    }
  }

  get bob() {
    return Math.sin(this.bobT) * 3 + this.dip;
  }

  placement(sheet, name) {
    const f = frameData(sheet, name);
    const s = SHEETS[sheet].scale * POPO_SCALE;
    const raftMid = (f.raftLeft + f.raftRight) / 2;
    const [bx0, by0, bx1, by1] = f.box;
    return {
      img: assets.sheets[sheet].img,
      sx: bx0, sy: by0, sw: bx1 - bx0, sh: by1 - by0,
      dx: this.anchor.x + (bx0 - raftMid) * s,
      dy: this.anchor.y + (by0 - f.raftBottom) * s,
      dw: (bx1 - bx0) * s,
      dh: (by1 - by0) * s,
      raftRightX: this.anchor.x + (f.raftRight - raftMid) * s,
      raftLeftX: this.anchor.x + (f.raftLeft - raftMid) * s,
      raftHeight: 80 * s,
      tip: f.rodTip ? { x: this.anchor.x + (f.rodTip[0] - raftMid) * s, y: this.anchor.y + (f.rodTip[1] - f.raftBottom) * s } : null,
    };
  }

  // Tilt pivots on the raft's right end at the waterline, so a lean looks like the raft dipping.
  pivot() {
    const p = this.placement(this.pose.sheet, this.pose.frame);
    return { x: p.raftRightX, y: this.anchor.y, angle: this.tilt + Math.sin(this.bobT * 0.7) * 0.004 };
  }

  applyTransform(ctx) {
    const { x, y, angle } = this.pivot();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(-x, -y);
    ctx.translate(this.travelShift + this.lean, this.bob);
  }

  transformPoint(x, y) {
    const pv = this.pivot();
    const lx = x + this.travelShift + this.lean - pv.x;
    const ly = y + this.bob - pv.y;
    return { x: pv.x + lx * Math.cos(pv.angle) - ly * Math.sin(pv.angle), y: pv.y + lx * Math.sin(pv.angle) + ly * Math.cos(pv.angle) };
  }

  rodTip() {
    if (this.mishap) return this.mishapRodPoint(357, 130);
    const cur = this.placement(this.pose.sheet, this.pose.frame).tip;
    let tip = cur;
    if (this.fade < 1 && this.prevPose) {
      const prev = this.placement(this.prevPose.sheet, this.prevPose.frame).tip;
      if (prev && cur) tip = { x: prev.x + (cur.x - prev.x) * this.fade, y: prev.y + (cur.y - prev.y) * this.fade };
      else tip = cur || prev;
    }
    if (!tip) return null;
    return this.transformPoint(tip.x, tip.y);
  }

  bucketPoint() {
    const p = this.placement(this.pose.sheet, this.pose.frame);
    return this.transformPoint(p.raftLeftX + 62 * SHEETS[this.pose.sheet].scale, this.anchor.y - 92 * SHEETS[this.pose.sheet].scale);
  }

  raftRight() {
    return this.transformPoint(this.placement(this.pose.sheet, this.pose.frame).raftRightX, this.anchor.y);
  }

  draw(ctx) {
    if (this.mishap) { this.drawMishap(ctx); return; }
    ctx.save();
    this.applyTransform(ctx);
    if (this.fade < 1 && this.prevPose) {
      this.drawPose(ctx, this.prevPose, 1 - this.fade);
      this.drawPose(ctx, this.pose, this.fade);
    } else {
      this.drawPose(ctx, this.pose, 1);
    }
    ctx.restore();
  }

  drawPose(ctx, pose, alpha) {
    const p = this.placement(pose.sheet, pose.frame);
    ctx.globalAlpha = alpha;
    ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    ctx.globalAlpha = 1;
  }

  // All three parts retain the source cell and its seat registration. No per-part scaling.
  beginMishap(waterline) {
    this.stopFrames();
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.mishap = {
      x: 0, y: 0, angle: 0, raftAngle: 0, rodBend: 0,
      waterline, bob: this.bob, rod: null, pose: 'surprise',
    };
  }

  sourcePoint(x, y) {
    return { x: this.anchor.x + (x - 186) * 0.93,
      y: this.anchor.y + (y - 383) * 0.93 + this.mishap.bob };
  }

  mishapBodyPoint(x, y) {
    const m = this.mishap;
    const pivot = this.sourcePoint(178, 300);
    const dx = (x - 178) * 0.93, dy = (y - 300) * 0.93;
    return { x: pivot.x + m.x + dx * Math.cos(m.angle) - dy * Math.sin(m.angle),
      y: pivot.y + m.y + dx * Math.sin(m.angle) + dy * Math.cos(m.angle) };
  }

  bodyLandmark(name) {
    const m = this.mishap;
    const f = MISHAP_POSES[m.pose];
    const [x, y] = f[name];
    const origin = this.mishapBodyPoint(178, 300);
    const dx = (x - f.pivot[0]) * MISHAP_SCALE;
    const dy = (y - f.pivot[1]) * MISHAP_SCALE;
    return { x: origin.x + dx * Math.cos(m.angle) - dy * Math.sin(m.angle),
      y: origin.y + dx * Math.sin(m.angle) + dy * Math.cos(m.angle) };
  }

  setMishapPose(pose, align = null) {
    const before = align ? this.bodyLandmark(align) : null;
    this.mishap.pose = pose;
    if (before) {
      const after = this.bodyLandmark(align);
      this.mishap.x += before.x - after.x;
      this.mishap.y += before.y - after.y;
    }
  }

  drawMishapBody(ctx) {
    const m = this.mishap;
    const f = MISHAP_POSES[m.pose];
    const [x0, y0, x1, y1] = f.box;
    const origin = this.mishapBodyPoint(178, 300);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.rotate(m.angle);
    ctx.drawImage(assets.mishapPoses, x0, y0, x1 - x0, y1 - y0,
      (x0 - f.pivot[0]) * MISHAP_SCALE, (y0 - f.pivot[1]) * MISHAP_SCALE,
      (x1 - x0) * MISHAP_SCALE, (y1 - y0) * MISHAP_SCALE);
    ctx.restore();
  }

  mishapRod() {
    const m = this.mishap;
    return m.rod || { ...this.bodyLandmark('hand'), angle: m.angle + m.rodBend };
  }

  mishapRodPoint(x, y) {
    const r = this.mishapRod();
    const dx = (x - 229) * 0.93, dy = (y - 268) * 0.93;
    return { x: r.x + dx * Math.cos(r.angle) - dy * Math.sin(r.angle),
      y: r.y + dx * Math.sin(r.angle) + dy * Math.cos(r.angle) };
  }

  drawMishapLayer(ctx, index, pivot, origin, angle) {
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.rotate(angle);
    ctx.drawImage(assets.props, index * 418, 0, 418, 418,
      -pivot.x * 0.93, -pivot.y * 0.93, 418 * 0.93, 418 * 0.93);
    ctx.restore();
  }

  drawMishap(ctx) {
    const m = this.mishap;
    const drawBody = () => this.drawMishapBody(ctx);
    // Clip to the scene surface, not to a rectangular patch from a pose sheet.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, m.waterline, PopoGame.STAGE_W, PopoGame.STAGE_H);
    ctx.clip();
    ctx.globalAlpha = 0.32;
    ctx.filter = 'sepia(0.5) hue-rotate(145deg) saturate(1.5)';
    drawBody();
    ctx.restore();
    this.drawMishapLayer(ctx, 0, { x: 186, y: 383 },
      this.sourcePoint(186, 383), m.raftAngle);
    const rod = this.mishapRod();
    this.drawMishapLayer(ctx, 1, { x: 229, y: 268 }, rod, rod.angle);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PopoGame.STAGE_W, m.waterline);
    ctx.clip();
    drawBody();
    ctx.restore();
  }

  endMishap() {
    this.mishap = null;
    this.tilt = this.lean = this.dip = 0;
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.anim = null;
    this.line.mode = 'dangle';
    this.line.arc = this.line.tension = 0;
    this.blinkIn = 0.15;
  }

  // The hook hangs from the rod when idle; sequences take over the hook position otherwise.
  hookPosition() {
    const tip = this.rodTip();
    if (!tip) return null;
    if (this.line.mode === 'dangle') {
      const sway = Math.sin(this.swayT) * 7;
      return { x: tip.x + sway, y: tip.y + this.line.length + Math.cos(this.swayT) * 1.5 };
    }
    return this.line.hook;
  }

  drawLine(ctx) {
    if (!this.line.visible) return;
    const tip = this.rodTip();
    const hook = this.hookPosition();
    if (!tip || !hook) return;
    const dx = hook.x - tip.x;
    const dy = hook.y - tip.y;
    const dist = Math.hypot(dx, dy) || 1;
    // control point: arcs upward in flight, sags when slack, straight when taut
    const nx = -dy / dist;
    const ny = dx / dist;
    const bend = this.line.arc * dist * 0.22;
    const cx = (tip.x + hook.x) / 2 + nx * bend;
    const cy = (tip.y + hook.y) / 2 + ny * bend + (this.line.mode === 'dangle' ? 0 : (1 - Math.min(1, this.line.tension)) * 12);
    const jitter = this.line.tension > 1 ? Math.sin(this.swayT * 40) * 1.5 : 0;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(20, 60, 110, 0.35)';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.quadraticCurveTo(cx + jitter, cy, hook.x, hook.y);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(245, 250, 255, 0.95)';
    ctx.stroke();

    // hook: a small J hanging from the line end
    const ang = Math.atan2(hook.y - cy, hook.x - cx);
    ctx.translate(hook.x, hook.y);
    ctx.rotate(ang - Math.PI / 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#6d7a8c';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 10);
    ctx.arc(-5, 10, 5, 0, Math.PI, false);
    ctx.lineTo(-10, 6);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#dde6f2';
    ctx.beginPath();
    ctx.moveTo(-1, 1);
    ctx.lineTo(-1, 9);
    ctx.stroke();
    ctx.restore();
  }
}

Object.assign(PopoGame, { Popo });
})(window.PopoGame = window.PopoGame || {});
