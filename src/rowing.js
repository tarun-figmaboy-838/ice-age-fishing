(function (PopoGame) {
'use strict';

const TAU = Math.PI * 2;
const smooth = t => t * t * (3 - 2 * t);

// One regenerated character texture, articulated around its seated hips, shoulders
// and two grips. One rigid paddle texture is shared by every rendered frame.
// tools/build-rowing-cycle.py renders the cycle with draw(); the game itself only uses the
// motion maths (sample, bladePoint), so it builds the rig without images.
class PaddleRig {
  constructor(body, paddle, data) {
    this.body = body;
    this.paddle = paddle;
    this.data = data;
    this.vertices = [];
    this.triangles = [];
    if (!body) return;
    this.face = document.createElement('canvas');
    this.face.width = body.width;
    this.face.height = body.height;
    this.faceCtx = this.face.getContext('2d');
    const columns = 32, rows = 40;
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        this.vertices.push({ x: body.width * x / columns, y: body.height * y / rows });
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const a = y * (columns + 1) + x, b = a + 1, c = a + columns + 1, d = c + 1;
        this.triangles.push([a, b, c], [b, d, c]);
      }
    }
  }

  sample(time, duration = 2100) {
    const phase = ((time / duration) % 1 + 1) % 1;
    const a = phase * TAU;
    // An ellipse, traversed clockwise: recover forward, catch, pull, lift.
    // The power half takes slightly longer than the aerial recovery.
    const angle = a + .12 * Math.sin(a);
    const reach = Math.sin(angle);
    const depth = -Math.cos(angle);
    const grip = this.data.grip;
    const paddleAngle = this.data.paddle.angle + .12 * Math.sin(angle - .4);
    const center = { x: grip[0] + 60 * reach, y: grip[1] + 70 * depth };
    const direction = { x: -Math.sin(paddleAngle), y: Math.cos(paddleAngle) };
    const hands = this.data.hands.map((p, i) => {
      const distance = this.data.handDistances[i];
      return { x: center.x + direction.x * distance, y: center.y + direction.y * distance };
    });
    const blinkDistance = Math.abs(phase - 2 / 3);
    const blink = blinkDistance < .035 ? Math.sin((1 - blinkDistance / .035) * Math.PI / 2) ** 2 : 0;
    const effort = Math.max(0, Math.sin((phase - .3) * TAU)) * .12;
    return { phase, center, paddleAngle, hands, lean: 13 * Math.sin(angle - .2),
      headAngle: .018 * Math.sin(angle - .45), blink: Math.max(blink, effort),
      power: Math.max(0, Math.sin((phase - .25) * TAU)) };
  }

  deform(p, motion) {
    const d = this.data;
    // Lower legs and seat stay fixed; the torso eases into the shoulder movement.
    const torso = smooth(Math.max(0, Math.min(1, (d.seat[1] - 80 - p.y) / 220)));
    let x = p.x + motion.lean * torso, y = p.y;
    const headWeight = smooth(Math.max(0, Math.min(1, (d.neck[1] + 35 - p.y) / 70)));
    if (headWeight > 0) {
      const dx = p.x - d.neck[0], dy = p.y - d.neck[1];
      x += (dx * Math.cos(motion.headAngle) - dy * Math.sin(motion.headAngle) - dx) * headWeight;
      y += (dx * Math.sin(motion.headAngle) + dy * Math.cos(motion.headAngle) - dy) * headWeight;
    }
    // Each forearm has its own influence region. Head and hind feet are excluded.
    const weights = d.hands.map(h => Math.exp(-((p.x-h[0])**2 / 115**2 + (p.y-h[1])**2 / 80**2) * 2));
    const armMask = smooth(Math.max(0, Math.min(1, (p.x-d.armLeft) / 100)))
      * smooth(Math.max(0, Math.min(1, (p.y-d.armTop) / 35)))
      * smooth(Math.max(0, Math.min(1, (d.seat[1]-70-p.y) / 60)));
    const total = weights[0] + weights[1];
    const strength = Math.min(1, total * 1.65) * armMask;
    if (total > .00001) {
      for (let i = 0; i < 2; i++) {
        const w = weights[i] / total * strength;
        x += (motion.hands[i].x - d.hands[i][0] - motion.lean * torso) * w;
        y += (motion.hands[i].y - d.hands[i][1]) * w;
      }
    }
    return { x, y };
  }

  texture(motion) {
    const g = this.faceCtx;
    g.clearRect(0, 0, this.face.width, this.face.height);
    g.drawImage(this.body, 0, 0);
    // Fur-textured lids cover only the eyes; the head silhouette and muzzle never change.
    if (motion.blink > .01) {
      for (const eye of this.data.eyes) {
        const [x,y,rx,ry] = eye;
        g.save();
        g.beginPath();g.ellipse(x,y,rx,ry,0,0,TAU);g.clip();
        const height = ry * 2 * motion.blink;
        const patch = this.data.furPatch;
        g.drawImage(this.body, ...patch, x-rx, y-ry, rx*2, height);
        if (motion.blink > .8) {
          g.strokeStyle = '#654836';g.lineWidth = 2;
          g.beginPath();g.moveTo(x-rx*.75,y+ry*.05);
          g.quadraticCurveTo(x,y+ry*.3,x+rx*.75,y+ry*.05);g.stroke();
        }
        g.restore();
      }
    }
    return this.face;
  }

  mesh(texture, transformed) {
    if (!this.meshCanvas) {
      this.meshCanvas = document.createElement('canvas');
      this.meshCanvas.width = this.meshCanvas.height = 1280;
      const gl = this.meshCanvas.getContext('webgl', { alpha:true, premultipliedAlpha:true, antialias:false });
      this.meshGL = gl;
      if (gl) {
        const shader = (type, source) => {
          const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);return sh;
        };
        const program=gl.createProgram();
        gl.attachShader(program,shader(gl.VERTEX_SHADER,
          'attribute vec2 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=vec4(p.x/640.0-1.0,1.0-p.y/640.0,0,1);v=uv;}'));
        gl.attachShader(program,shader(gl.FRAGMENT_SHADER,
          'precision mediump float;varying vec2 v;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,v);}'));
        gl.linkProgram(program);gl.useProgram(program);
        this.meshBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.meshBuffer);
        for(const [name,offset] of [['p',0],['uv',8]]) {
          const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc,2,gl.FLOAT,false,16,offset);
        }
        gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        this.meshData=new Float32Array(this.triangles.length*12);
      }
    }
    const gl=this.meshGL;
    if (!gl || gl.isContextLost()) return null;
    let n=0;
    for(const triangle of this.triangles) for(const i of triangle) {
      const p=transformed[i],uv=this.vertices[i];
      this.meshData[n++]=p.x;this.meshData[n++]=p.y;
      this.meshData[n++]=uv.x/texture.width;this.meshData[n++]=uv.y/texture.height;
    }
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER,this.meshData,gl.DYNAMIC_DRAW);
    try {
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,texture);
    } catch (error) {
      // Local file previews can have opaque origins; keep the Canvas fallback usable.
      if (error.name !== 'SecurityError') throw error;
      this.meshGL = null;
      return null;
    }
    // Shared edges are rasterized once: no independent antialiased clip seams.
    gl.drawArrays(gl.TRIANGLES,0,this.triangles.length*3);
    return this.meshCanvas;
  }

  triangle(ctx, texture, source, dest) {
    const [p,q,r] = source, [a,b,c] = dest;
    const det = (q.x-p.x)*(r.y-p.y)-(r.x-p.x)*(q.y-p.y);
    const aa = ((b.x-a.x)*(r.y-p.y)-(c.x-a.x)*(q.y-p.y))/det;
    const bb = ((b.y-a.y)*(r.y-p.y)-(c.y-a.y)*(q.y-p.y))/det;
    const cc = ((c.x-a.x)*(q.x-p.x)-(b.x-a.x)*(r.x-p.x))/det;
    const dd = ((c.y-a.y)*(q.x-p.x)-(b.y-a.y)*(r.x-p.x))/det;
    ctx.save();
    // Slightly expanded clips prevent hairline cracks between adjacent triangles.
    const mx=(a.x+b.x+c.x)/3, my=(a.y+b.y+c.y)/3;
    ctx.beginPath();
    for (const [i,v] of dest.entries()) {
      const length=Math.hypot(v.x-mx,v.y-my)||1;
      const x=v.x+(v.x-mx)/length*2, y=v.y+(v.y-my)/length*2;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();ctx.clip();
    ctx.transform(aa,bb,cc,dd,a.x-aa*p.x-cc*p.y,a.y-bb*p.x-dd*p.y);
    ctx.drawImage(texture,0,0);ctx.restore();
  }

  draw(ctx, time, duration = 2100) {
    const motion = this.sample(time, duration);
    const d = this.data;
    // Paddle behind the gripping paws, with a single rigid length and pivot.
    ctx.save();ctx.translate(motion.center.x,motion.center.y);ctx.rotate(motion.paddleAngle);
    ctx.drawImage(this.paddle,-d.paddle.pivot[0],-d.paddle.pivot[1]);ctx.restore();
    const texture = this.texture(motion);
    const transformed = this.vertices.map(p => this.deform(p,motion));
    const mesh=this.mesh(texture,transformed);
    if (mesh) ctx.drawImage(mesh,0,0);
    else for (const indices of this.triangles) {
      this.triangle(ctx,texture,indices.map(i=>this.vertices[i]),indices.map(i=>transformed[i]));
    }
    return motion;
  }

  bladePoint(time, duration = 2100) {
    const m=this.sample(time,duration), d=this.data.paddle;
    const x=d.tip[0]-d.pivot[0], y=d.tip[1]-d.pivot[1];
    return { x:m.center.x+x*Math.cos(m.paddleAngle)-y*Math.sin(m.paddleAngle),
      y:m.center.y+x*Math.sin(m.paddleAngle)+y*Math.cos(m.paddleAngle) };
  }
}

Object.assign(PopoGame,{PaddleRig});
})(window.PopoGame = window.PopoGame || {});
