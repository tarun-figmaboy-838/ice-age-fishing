(function (PopoGame) {
'use strict';
const { assets } = PopoGame;

const TAU = Math.PI * 2;
const POPO_SCALE = 1.0;

// Frame picks per sheet (row, col). The frames hold only the character and his rod or paddle;
// the raft is the shared prop below, so it never changes size. Every pose sits Popo on his seat
// point; the scales make him the same size in both sheets (from the measured body area).
const ROWING = { row0: [0, 0], row1: [0, 1], row2: [0, 2], row3: [1, 0], row4: [1, 1], row5: [1, 2], row6: [2, 0], row7: [2, 1], row8: [2, 2] };
const SHEETS = {
  fishing: { scale: 0.63, frames: { idle: [0, 1] } },
  casting: { scale: 0.63, frames: { lift: [0, 2], up: [0, 2], back: [1, 0], swing: [1, 1], follow: [1, 2], hold: [2, 2], reel: [2, 0], reel2: [2, 1] } },
  rowing: { scale: 0.56, frames: ROWING },
};

// The raft prop (cell 0 of popo-props) is registered like the idle frame it was cut from:
// cell point (186, 383) sits on the anchor at scale 0.93. Frames register their own raft's
// bottom-right corner onto the prop's, which is the steadiest reference in the artwork.
const PROP = { scale: 0.93, mid: 186, bottom: 383, left: 5, right: 367, bucket: { x: 78, y: 290 } };
const PROP_RIGHT_DX = (PROP.right - PROP.mid) * PROP.scale;
// Where Popo sits: the back of the raft's deck, clear of the bucket, so he sits on the boat
// rather than at the water's edge.
const SEAT = { dx: (196 - PROP.mid) * PROP.scale, dy: (338 - PROP.bottom) * PROP.scale };
// The wrong-answer reaction was registered on the earlier seat (178, 373); this moves it here.
const SEAT_SHIFT = { x: 196 - 178, y: 338 - 373 };

// Manually inspected pose extents, torso registrations and attachment landmarks.
// One atlas-wide scale preserves the generated character's proportions in every pose.
const MISHAP_SCALE = 0.49;
const { MISHAP_POSES } = PopoGame;

// Where caught fish sit in the bucket, in raft-cell pixels: x, y (the fish's middle) and tilt.
// The rim is centred at (76, 283); everything below it is inside the bucket and hidden.
const BUCKET_RIM = { x: 76, y: 284 };
const PILE = [[76, 272, -0.5], [63, 270, 0.7], [89, 268, -1.0], [71, 255, 0.35], [85, 250, -0.45],
  [66, 241, 1.0], [79, 232, -0.2], [90, 236, 0.8]];

function frameData(sheet, name) {
  const [row, col] = SHEETS[sheet].frames[name];
  return assets.sheets[sheet].data.frames[row * 3 + col];
}

let rowTintCache = null;

class Popo {
  constructor() {
    this.anchor = { x: 238, y: 400 };
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.fadeMs = 120;
    this.anim = null;
    this.bobT = Math.random() * TAU;
    this.tilt = 0;
    this.dip = 0;
    this.lean = 0;
    this.travelShift = 0;
    this.line = { visible: true, mode: 'dangle', hook: { x: 0, y: 0 }, arc: 0, tension: 0, length: 150 };
    this.swayT = 0;
    this.mishap = null;
    this.rowing = null;
    this.waterResponse = 0;
    this.waveY = 0;
    this.waveAngle = 0;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setAnchor(x, y) {
    this.anchor.x = x;
    this.anchor.y = y;
  }

  // fadeMs 0 is a hard cut, used inside an animation so frames never double-expose.
  setPose(sheet, frame, fadeMs = 120) {
    if (this.pose.sheet === sheet && this.pose.frame === frame) return;
    this.prevPose = fadeMs > 0 ? this.pose : null;
    this.pose = { sheet, frame };
    this.fade = fadeMs > 0 ? 0 : 1;
    this.fadeMs = Math.max(1, fadeMs);
  }

  playFrames(sheet, frames, frameMs, loop = false) {
    this.anim = { sheet, frames, frameMs, loop, t: 0, index: 0 };
    this.setPose(sheet, frames[0], 80);
  }

  stopFrames() {
    this.rowing = null;
    this.anim = null;
  }

  idle() {
    this.rowing = null;
    this.anim = null;
    this.setPose('fishing', 'idle', 140);
  }

  update(dt) {
    if (this.bucketBump && (this.bucketBump.t += dt) > 1.4) this.bucketBump = null;
    if (this.mishap) {
      this.bobT += dt * 1.1;
      this.swayT += dt * 1.6;
      return;
    }
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
          this.setPose(a.sheet, a.frames[a.index], 0);
        } else if (a.loop) {
          a.index = 0;
          this.setPose(a.sheet, a.frames[0], 0);
        } else {
          this.anim = null;
        }
      }
    }
  }

  // waveY and waveAngle come from the animated water surface under the raft (see game.js).
  get bob() {
    return this.waveY + Math.sin(this.bobT * 1.07 + 0.8) * 0.6 * (this.reduced ? 0.2 : 1) + this.dip + this.waterResponse;
  }

  placement(sheet, name) {
    const f = frameData(sheet, name);
    const s = SHEETS[sheet].scale * POPO_SCALE;
    const [bx0, by0, bx1, by1] = f.box;
    const rightX = this.anchor.x + PROP_RIGHT_DX;
    // every pose lands its seat point on the raft's seat
    const [rx, ry] = f.seat;
    const ox = this.anchor.x + SEAT.dx;
    const oy = this.anchor.y + SEAT.dy;
    return {
      img: assets.sheets[sheet].img,
      sx: bx0, sy: by0, sw: bx1 - bx0, sh: by1 - by0,
      dx: ox + (bx0 - rx) * s,
      dy: oy + (by0 - ry) * s,
      dw: (bx1 - bx0) * s,
      dh: (by1 - by0) * s,
      raftRightX: rightX,
      raftLeftX: this.anchor.x + (PROP.left - PROP.mid) * PROP.scale,
      raftHeight: 80 * PROP.scale,
      tip: f.rodTip ? { x: ox + (f.rodTip[0] - rx) * s, y: oy + (f.rodTip[1] - ry) * s } : null,
    };
  }

  drawPileOnProp(ctx) {
    const k = PROP.scale;
    ctx.save();
    ctx.translate(this.anchor.x - PROP.mid * k, this.anchor.y - PROP.bottom * k);
    ctx.scale(k, k);
    this.drawBucketPile(ctx);
    ctx.restore();
  }

  // Every fish caught so far peeks out of the bucket; the pile wobbles when one lands.
  drawBucketPile(ctx) {
    const caught = PopoGame.state.collected;
    if (!caught.length || !assets.fish) return;
    const b = this.bucketBump;
    const wobble = b ? Math.sin(b.t * 22) * 0.18 * Math.exp(-b.t * 3.5) : 0;
    const hop = b ? Math.max(0, Math.sin(b.t * 14)) * 6 * Math.exp(-b.t * 5) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 80, 160, BUCKET_RIM.y - 80); // above the rim only
    ctx.clip();
    ctx.translate(BUCKET_RIM.x, BUCKET_RIM.y);
    ctx.rotate(wobble);
    ctx.translate(-BUCKET_RIM.x, -BUCKET_RIM.y - hop);
    caught.slice(-PILE.length).forEach((key, i) => {
      const shape = PopoGame.getShape(key);
      const box = shape && assets.fish.boxes[shape.atlas];
      if (!box) return;
      const [x0, y0, x1, y1] = box;
      const w = x1 - x0, h = y1 - y0, s = 34 / Math.max(w, h);
      const [x, y, tilt] = PILE[i];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.scale(i % 2 ? -s : s, s);
      ctx.drawImage(assets.fish.img, x0, y0, w, h, -w / 2, -h / 2, w, h);
      ctx.restore();
    });
    ctx.restore();
  }

  drawRaftProp(ctx) {
    const k = PROP.scale;
    ctx.drawImage(assets.props, 0, 0, 418, 418, this.anchor.x - PROP.mid * k, this.anchor.y - PROP.bottom * k, 418 * k, 418 * k);
  }

  // Tilt pivots on the raft's right end at the waterline, so a lean looks like the raft dipping.
  pivot() {
    const p = this.placement(this.pose.sheet, this.pose.frame);
    return { x: p.raftRightX, y: this.anchor.y, angle: this.tilt + this.waveAngle + Math.sin(this.bobT * 0.71 + 1.3) * 0.001 * (this.reduced ? 0.2 : 1) };
  }

  applyTransform(ctx) {
    const { x, y, angle } = this.pivot();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(-x, -y);
    ctx.translate(this.travelShift + this.lean, this.bob);
    // squash and stretch about the raft's middle at the waterline (comic stops and bounces)
    if (this.squash) {
      ctx.translate(this.anchor.x, this.anchor.y);
      ctx.scale(1 + this.squash * 0.6, 1 - this.squash);
      ctx.translate(-this.anchor.x, -this.anchor.y);
    }
  }

  transformPoint(x, y) {
    const pv = this.pivot();
    const lx = x + this.travelShift + this.lean - pv.x;
    const ly = y + this.bob - pv.y;
    return { x: pv.x + lx * Math.cos(pv.angle) - ly * Math.sin(pv.angle), y: pv.y + lx * Math.sin(pv.angle) + ly * Math.cos(pv.angle) };
  }

  // the top of Popo's head in the idle pose (measured from the art: 25, -268 from the seat)
  headTop() {
    const s = SHEETS.fishing.scale * POPO_SCALE;
    return this.transformPoint(this.anchor.x + SEAT.dx + 25 * s, this.anchor.y + SEAT.dy - 268 * s);
  }

  rodTip() {
    if (this.rowing) return null;
    if (this.mishap) return this.mishapRodPoint(1139, 70);
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
    return this.transformPoint(this.anchor.x + (PROP.bucket.x - PROP.mid) * PROP.scale, this.anchor.y + (PROP.bucket.y - PROP.bottom) * PROP.scale);
  }

  raftRight() {
    return this.transformPoint(this.placement(this.pose.sheet, this.pose.frame).raftRightX, this.anchor.y);
  }

  draw(ctx) {
    if (this.mishap) { this.drawMishap(ctx); return; }
    if (this.rowing) { this.drawRowing(ctx); return; }
    ctx.save();
    this.applyTransform(ctx);
    this.drawRaftProp(ctx);
    this.drawPileOnProp(ctx);
    if (this.fade < 1 && this.prevPose) {
      this.drawPose(ctx, this.prevPose, 1 - this.fade);
      this.drawPose(ctx, this.pose, this.fade);
    } else {
      this.drawPose(ctx, this.pose, 1);
    }
    ctx.restore();
  }

  startRowing(cycleMs = 2100) {
    this.stopFrames();
    this.setPose('fishing', 'idle', 0);
    this.rowRig = this.rowRig || new PopoGame.PaddleRig(null, null, PopoGame.ROWING_RIG);
    this.rowing = { time: 0, cycleMs };
  }

  // The paddling cycle is pre-rendered (tools/build-rowing-cycle.py). Below the waterline the
  // blade is seen through the water: a tinted copy of the frames, made once.
  rowTint() {
    if (rowTintCache) return rowTintCache;
    const img = assets.rowCycle;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.filter = 'sepia(.25) hue-rotate(140deg) saturate(1.15)';
    g.drawImage(img, 0, 0);
    rowTintCache = c;
    return c;
  }

  setRowingTime(time) {
    if (this.rowing) this.rowing.time = time;
  }

  paddleTip() {
    if (!this.rowing) return null;
    const d = PopoGame.ROWING_RIG;
    const tip = this.rowRig.bladePoint(this.rowing.time, this.rowing.cycleMs);
    return this.transformPoint(this.anchor.x + SEAT.dx + (tip.x-d.seat[0])*d.worldScale,
      this.anchor.y + SEAT.dy + (tip.y-d.seat[1])*d.worldScale);
  }

  drawRowing(ctx) {
    const d = PopoGame.ROWING_RIG, c = PopoGame.ROWING_CYCLE, r = this.rowing;
    // crossfade the two frames either side of this moment in the stroke
    const at = (((r.time / r.cycleMs) % 1 + 1) % 1) * c.frames;
    const i = Math.floor(at) % c.frames, j = (i + 1) % c.frames, mix = at - Math.floor(at);
    const k = d.worldScale / c.scale;
    const x = this.anchor.x + SEAT.dx - c.seat[0] * k, y = this.anchor.y + SEAT.dy - c.seat[1] * k;
    const drawFigure = (img) => {
      ctx.save();this.applyTransform(ctx);
      for (const [f, alpha] of [[i, 1], [j, mix]]) {
        if (alpha <= 0.01) continue;
        ctx.globalAlpha *= alpha;
        ctx.drawImage(img, (f % c.columns) * c.width, Math.floor(f / c.columns) * c.height, c.width, c.height,
          x, y, c.width * k, c.height * k);
        ctx.globalAlpha /= alpha;
      }
      ctx.restore();
    };
    const waterline = this.anchor.y-12;
    // Actual world waterline clipping: the blade enters water without losing length.
    ctx.save();ctx.beginPath();ctx.rect(0,waterline,PopoGame.STAGE_W,PopoGame.STAGE_H);ctx.clip();
    ctx.globalAlpha=.54;drawFigure(this.rowTint());ctx.restore();
    ctx.save();this.applyTransform(ctx);this.drawRaftProp(ctx);this.drawPileOnProp(ctx);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(0,0,PopoGame.STAGE_W,waterline);ctx.clip();drawFigure(assets.rowCycle);ctx.restore();
  }

  drawPose(ctx, pose, alpha) {
    const p = this.placement(pose.sheet, pose.frame);
    ctx.globalAlpha = alpha;
    ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    ctx.globalAlpha = 1;
  }

  // The idle body and rod are complementary masks of the ORIGINAL fishing frame.
  // Both layers retain the original registration; the hidden handle is continued below.
  prepareMishapArt() {
    if (this.mishapArt) return;
    const make = () => { const c = document.createElement('canvas'); c.width = 620; c.height = 435; return c; };
    const body = make(), rod = make();
    const g = body.getContext('2d');
    g.drawImage(assets.sheets.fishing.img, 620, 0, 620, 435, 0, 0, 620, 435);
    // The separator follows the rod's underside and the two gripping paws.
    const outline = [[0,0],[335,0],[335,215],[310,230],[300,241],[302,252],[319,251],
      [336,265],[340,280],[333,299],[313,315],[370,320],[400,435],[0,435]];
    const mask = make(), mg = mask.getContext('2d');
    mg.beginPath(); outline.forEach(([x,y],i) => i ? mg.lineTo(x,y) : mg.moveTo(x,y));
    mg.closePath(); mg.fill();
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask,0,0);
    const r = rod.getContext('2d');
    r.drawImage(assets.sheets.fishing.img,620,0,620,435,0,0,620,435);
    r.globalCompositeOperation = 'destination-out'; r.drawImage(mask,0,0);
    // Rebuild the handle hidden behind the gripping paws, so the rod is whole once Popo lets
    // go: the visible rod's width (28px) and shading, from the lower ring down to a round butt.
    r.globalCompositeOperation = 'destination-over';
    const [hx, hy, bx, by] = [327, 226, 281, 342];
    const len = Math.hypot(bx - hx, by - hy);
    r.translate(hx, hy); r.rotate(Math.atan2(by - hy, bx - hx));
    const shade = r.createLinearGradient(0, 14, 0, -14);
    shade.addColorStop(0, '#f6b25a'); shade.addColorStop(0.3, '#df7f22');
    shade.addColorStop(0.75, '#a9480f'); shade.addColorStop(1, '#6f2b06');
    r.beginPath(); r.moveTo(0, -14); r.lineTo(len - 13, -14); r.arc(len - 13, 0, 14, -Math.PI / 2, Math.PI / 2);
    r.lineTo(0, 14); r.closePath();
    r.fillStyle = shade; r.fill();
    r.strokeStyle = '#5a2306'; r.lineWidth = 2.5; r.stroke();
    this.mishapArt = { body, rod };
  }

  beginMishap(waterline) {
    this.prepareMishapArt();
    this.stopFrames();
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.mishap = {
      x: 0, y: 0, angle: 0, raftAngle: 0, rodBend: 0,
      waterline, bob: this.bob, rod: null, pose: 'idle', nextPose: 'idle', mix: 0,
      time: 0, deckOcclusion: false, impactTime: null,
    };
  }

  sourcePoint(x, y) {
    return { x: this.anchor.x + (x - 186) * .93,
      y: this.anchor.y + (y - 383) * .93 + this.bob };
  }

  mishapBodyPoint(x, y) {
    const m = this.mishap;
    // the reaction's body frame sits on the same seat as the normal poses (see SEAT)
    const pivot = this.sourcePoint(178 + SEAT_SHIFT.x, 300 + SEAT_SHIFT.y);
    const dx = (x - 178) * .93, dy = (y - 300) * .93;
    return { x: pivot.x + m.x + dx * Math.cos(m.angle) - dy * Math.sin(m.angle),
      y: pivot.y + m.y + dx * Math.sin(m.angle) + dy * Math.cos(m.angle) };
  }

  poseLocalPoint(pose, name) {
    if (pose === 'idle') {
      const points = { head: [888,172], top: [840,112], hand: [940,276],
        contact: [955,400], pivot: [840,275] };
      const [x,y] = points[name];
      return { x: (x-840)*.63, y: (y-383)*.63 + 67.89 };
    }
    const f = MISHAP_POSES[pose];
    return { x: (f[name][0] - f.head[0]) * MISHAP_SCALE + 30.24,
      y: (f[name][1] - f.head[1]) * MISHAP_SCALE - 65.04 };
  }

  bodyLandmark(name) {
    const m = this.mishap;
    const a = this.poseLocalPoint(m.pose,name), b = this.poseLocalPoint(m.nextPose,name);
    const x = a.x + (b.x-a.x)*m.mix, y = a.y + (b.y-a.y)*m.mix;
    const origin = this.mishapBodyPoint(178,300);
    return { x: origin.x + x*Math.cos(m.angle)-y*Math.sin(m.angle),
      y: origin.y + x*Math.sin(m.angle)+y*Math.cos(m.angle) };
  }

  blendMishapPose(from, to, t) {
    this.mishap.pose = from;
    this.mishap.nextPose = to;
    this.mishap.mix = t;
  }

  drawMishapPose(ctx, pose) {
    if (pose === 'idle') {
      ctx.drawImage(this.mishapArt.body, -220*.63, -383*.63+67.89, 620*.63,435*.63);
    } else {
      const f = MISHAP_POSES[pose];
      const [x0,y0,x1,y1] = f.box;
      ctx.drawImage(assets.mishapPoses,x0,y0,x1-x0,y1-y0,
        (x0-f.head[0])*MISHAP_SCALE+30.24,(y0-f.head[1])*MISHAP_SCALE-65.04,
        (x1-x0)*MISHAP_SCALE,(y1-y0)*MISHAP_SCALE);
    }
  }

  drawMishapBody(ctx) {
    const m = this.mishap;
    const origin = this.mishapBodyPoint(178,300);
    ctx.save();
    ctx.translate(origin.x,origin.y); ctx.rotate(m.angle);
    // squash (positive) and stretch (negative) about the body's base
    if (m.squash) {
      const base = this.poseLocalPoint(m.pose, 'contact').y;
      ctx.translate(0, base); ctx.scale(1 + m.squash * .5, 1 - m.squash); ctx.translate(0, -base);
    }
    // Short registered pose blends preserve head position while the lower body
    // settles. World translation and rotation are independent of the sprite atlas.
    if (m.pose === m.nextPose || m.mix === 0 || m.mix === 1) {
      this.drawMishapPose(ctx, m.mix === 1 ? m.nextPose : m.pose);
    } else {
      if (!this.poseBlend) {
        this.poseBlend = document.createElement('canvas');
        this.poseBlend.width = 360; this.poseBlend.height = 340;
      }
      const cacheKey = `${m.pose}:${m.nextPose}:${m.mix}`;
      if (this.poseBlendKey !== cacheKey) {
        this.poseBlendKey = cacheKey;
        const g = this.poseBlend.getContext('2d');
        g.clearRect(0,0,360,340);
        if (!this.poseTextures) this.poseTextures = new Map();
        const texture = pose => {
          if (!this.poseTextures.has(pose)) {
            const c = document.createElement('canvas'); c.width=360;c.height=340;
            const cctx=c.getContext('2d');cctx.translate(180,190);this.drawMishapPose(cctx,pose);
            this.poseTextures.set(pose,c);
          }
          return this.poseTextures.get(pose);
        };
        // Contiguous source/destination bands avoid antialiased clip seams. Head
        // registration is invariant; only the lower body settles between drawn poses.
        const bands = pose => [-190, -112, -65.04, -12,
          Math.max(40, this.poseLocalPoint(pose,'contact').y), 150];
        const a=bands(m.pose), b=bands(m.nextPose);
        const target=a.map((y,i)=>y+(b[i]-y)*m.mix);
        for (const [pose, points, opacity] of [[m.pose,a,1-m.mix],[m.nextPose,b,m.mix]]) {
          g.save();g.globalCompositeOperation='lighter';g.globalAlpha=opacity;
          const img=texture(pose);
          for(let j=0;j<points.length-1;j++) {
            g.drawImage(img,0,points[j]+190,360,points[j+1]-points[j],
              0,target[j]+190,360,target[j+1]-target[j]);
          }
          g.restore();
        }
      }
      ctx.drawImage(this.poseBlend,-180,-190);
    }
    ctx.restore();
  }

  mishapRod() {
    const m = this.mishap;
    return m.rod || { ...this.bodyLandmark('hand'), angle: m.angle + m.rodBend };
  }

  mishapRodPoint(x, y) {
    const r = this.mishapRod();
    const dx = (x-940)*.63, dy = (y-276)*.63;
    return { x:r.x+dx*Math.cos(r.angle)-dy*Math.sin(r.angle),
      y:r.y+dx*Math.sin(r.angle)+dy*Math.cos(r.angle) };
  }

  drawMishapLayer(ctx, index, pivot, origin, angle) {
    ctx.save(); ctx.translate(origin.x,origin.y); ctx.rotate(angle);
    ctx.drawImage(assets.props,index*418,0,418,418,-pivot.x*.93,-pivot.y*.93,418*.93,418*.93);
    ctx.restore();
  }

  drawMishap(ctx) {
    const m = this.mishap;
    const drawBody = () => this.drawMishapBody(ctx);
    ctx.save(); ctx.beginPath(); ctx.rect(0,m.waterline,PopoGame.STAGE_W,PopoGame.STAGE_H);ctx.clip();
    ctx.globalAlpha=.43; ctx.filter='sepia(0.35) hue-rotate(145deg) saturate(1.3)';
    drawBody();ctx.restore();
    const raft = this.sourcePoint(186,383);
    this.drawMishapLayer(ctx,0,{x:186,y:383},raft,m.raftAngle);
    ctx.save(); ctx.translate(raft.x, raft.y); ctx.rotate(m.raftAngle);
    ctx.translate(-186 * .93, -383 * .93); ctx.scale(.93, .93); this.drawBucketPile(ctx); ctx.restore();
    const rod = this.mishapRod();
    ctx.save();ctx.translate(rod.x,rod.y);ctx.rotate(rod.angle);
    ctx.drawImage(this.mishapArt.rod,-320*.63,-276*.63,620*.63,435*.63);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(0,0,PopoGame.STAGE_W,m.waterline);ctx.clip();
    drawBody();ctx.restore();
    // Only the existing front rail occludes the climbing belly/feet. The paws stay above it.
    if (m.deckOcclusion) {
      ctx.save();ctx.beginPath();ctx.rect(0,this.anchor.y-18+this.bob,PopoGame.STAGE_W,40);ctx.clip();
      this.drawMishapLayer(ctx,0,{x:186,y:383},raft,m.raftAngle);ctx.restore();
    }
  }

  endMishap() {
    this.mishap = null;
    this.rowing = null;
    this.tilt = this.lean = this.dip = this.squash = 0;
    this.pose = { sheet: 'fishing', frame: 'idle' };
    this.prevPose = null;
    this.fade = 1;
    this.anim = null;
    this.line.mode = 'dangle';
    this.line.arc = this.line.tension = 0;
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

  // part: 'line', 'hook' or both. A hooked fish is drawn between the two, so the line runs
  // over it to its lips and the hook sits inside the mouth.
  drawLine(ctx, part = 'both') {
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
    // a taut line twangs; the harder the pull, the more it shakes
    const jitter = this.line.tension > 1 ? Math.sin(this.swayT * 40) * Math.min(5, 1.5 + (this.line.tension - 1.4) * 4) : 0;

    ctx.save();
    if (part !== 'hook') {
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
    }
    if (part === 'line') {
      ctx.restore();
      return;
    }

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
