(function (PopoGame) {
'use strict';
const { STAGE_W, STAGE_H, SEABED_Y } = PopoGame;

// Draws the painted background through a per-pixel water pass: rolling waves on the painted
// surface, refraction that grows with depth, seaweed bending above its roots and moving light
// on the sand. Everything is sampled per pixel from the painting, so there are no strips and
// no seams at any screen density. During a row it also slides the current and next paintings
// with depth parallax and blends their seam.

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // clip-space top maps to the first image row, so uv is y-down like the stage
  vUv = vec2(aPos.x * 0.5 + 0.5, (1.0 - aPos.y) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The rolling surface waves, shared by the shader and surfaceWave() so the raft rides them.
// [amplitude px, spatial frequency, speed]; the first is a long swell the raft visibly rides.
const WAVES = [[4.2, 0.0042, 0.95], [3.9, 0.013, 1.25], [2.5, 0.029, -0.9], [1.3, 0.051, 2.0]];
const WAVE_GLSL = WAVES.map(([a, k, s]) => `${a.toFixed(3)} * sin(p.x * ${k.toFixed(4)} + t * ${s.toFixed(3)})`).join(' + ');
// During a row the two paintings pan rigidly together, overlapping by this much, with a soft
// crossfade across the overlap. Both are sampled mirror-repeated, so nothing ever ends abruptly.
const OVERLAP = 620;

// Vertical displacement the shader applies to the surface band at x. The painting is sampled
// at p + d, so the visible surface moves by -d.
function surfaceWave(x, t) {
  let d = 0;
  for (const [a, k, s] of WAVES) d += a * Math.sin(x * k + t * s);
  return d;
}

const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uStage;
uniform float uTime;
uniform float uWater;
uniform float uSeabed;
uniform float uMix;
uniform float uAmp;
uniform float uSurface;
uniform vec4 uPlants[8];

vec2 displace(vec2 p) {
  float t = uTime;
  vec2 d = vec2(0.0);
  // rolling waves across the painted surface band
  float s = uSurface * smoothstep(uWater - 75.0, uWater - 25.0, p.y) * (1.0 - smoothstep(uWater + 8.0, uWater + 40.0, p.y));
  d.y += s * (${WAVE_GLSL});
  d.x += s * (4.5 * sin(t * 0.33) + 1.8 * sin(p.x * 0.02 - t * 0.7));
  // refraction below the surface, stronger with depth
  float u = smoothstep(uWater + 6.0, uWater + 150.0, p.y);
  float depth = clamp((p.y - uWater) / (uStage.y - uWater), 0.0, 1.0);
  d.x += u * (2.4 + 3.4 * depth) * (0.6 * sin(p.y * 0.045 + t * 0.8) + 0.4 * sin(p.x * 0.012 + p.y * 0.03 - t * 0.55));
  d.y += u * (1.2 + 2.0 * depth) * sin(p.x * 0.02 + p.y * 0.01 + t * 0.7);
  // seaweed bends above its roots; rocks and sand around it stay put
  for (int i = 0; i < 8; i++) {
    vec4 pl = uPlants[i];
    if (pl.y <= pl.x) continue;
    float inside = smoothstep(pl.x - 6.0, pl.x + 10.0, p.x) * (1.0 - smoothstep(pl.y - 10.0, pl.y + 6.0, p.x));
    float h = clamp((pl.w - p.y) / max(1.0, pl.w - pl.z), 0.0, 1.0);
    float bend = h * h * (7.0 * sin(t * 0.9 + pl.x * 0.013) + 2.6 * sin(t * 1.7 + p.y * 0.05 + pl.x));
    d.x += inside * bend;
  }
  return d * uAmp;
}

vec3 painting(sampler2D tex, vec2 q) {
  vec2 uv = q / uStage;
  uv.x = 1.0 - abs(1.0 - mod(uv.x, 2.0));
  return texture2D(tex, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 p = vUv * uStage;
  vec2 q = p + displace(p);
  vec3 color;
  if (uMix <= 0.0) {
    color = painting(uFrom, q);
  } else {
    float pan = uStage.x - ${OVERLAP.toFixed(1)};
    float oxFrom = -uMix * pan;
    float oxTo = oxFrom + pan;
    vec3 from = painting(uFrom, q - vec2(oxFrom, 0.0));
    vec3 to = painting(uTo, q - vec2(oxTo, 0.0));
    float across = smoothstep(oxTo, oxTo + ${OVERLAP.toFixed(1)}, q.x);
    float w = mix(across * smoothstep(0.0, 0.07, uMix), 1.0, smoothstep(0.93, 1.0, uMix));
    color = mix(from, to, w);
  }
  // light: a caustic net on the sand (faint through the water), soft shafts from the surface,
  // a slow shimmer, and glints on the wave crests
  float t = uTime;
  float under = smoothstep(uWater + 6.0, uWater + 150.0, p.y);
  float depth = clamp((p.y - uWater) / (uStage.y - uWater), 0.0, 1.0);
  vec2 cp = p * 0.016;
  float n = sin(cp.x * 1.3 + t * 0.7 + sin(cp.y * 1.7 + t * 0.5) * 1.6) + sin(cp.y * 2.1 - t * 0.6 + sin(cp.x * 1.1 - t * 0.4) * 1.6);
  float net = pow(max(0.0, 1.0 - abs(n) * 0.75), 5.0);
  float sand = smoothstep(uSeabed - 25.0, uSeabed + 35.0, p.y);
  float caustic = net * (sand * 0.24 + under * (1.0 - sand) * 0.05);
  float rays = pow(max(0.0, sin(p.x * 0.010 + p.y * 0.0040 - t * 0.22)), 12.0)
    + 0.7 * pow(max(0.0, sin(p.x * 0.0063 - p.y * 0.0026 + t * 0.17 + 1.7)), 14.0);
  rays *= under * (1.0 - depth * 0.85) * 0.10;
  float shimmer = under * 0.03 * sin(p.x * 0.006 + t * 0.4 + p.y * 0.004);
  float ss = uSurface * smoothstep(uWater - 60.0, uWater - 20.0, p.y) * (1.0 - smoothstep(uWater + 4.0, uWater + 30.0, p.y));
  float glint = max(0.0, sin(p.x * 0.013 + t * 1.25)) * max(0.0, sin(p.x * 0.051 + t * 2.0));
  float sparkle = ss * 0.22 * glint * glint;
  color = color * (1.0 + shimmer * uAmp) + vec3(0.75, 0.93, 1.0) * (caustic + rays + sparkle) * uAmp;
  gl_FragColor = vec4(color, 1.0);
}`;

class WaterScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.visible = null;
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
    this.gl = gl;
    this.ok = Boolean(gl);
    if (!gl) return;
    this.setup();
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.setup(); this.ok = true; });
  }

  setup() {
    const gl = this.gl;
    this.program = this.link(VERTEX, FRAGMENT);
    gl.useProgram(this.program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const name of ['uFrom', 'uTo', 'uStage', 'uTime', 'uWater', 'uSeabed', 'uMix', 'uAmp', 'uSurface', 'uPlants']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    gl.uniform1i(this.u.uFrom, 0);
    gl.uniform1i(this.u.uTo, 1);
    gl.uniform2f(this.u.uStage, STAGE_W, STAGE_H);
    gl.uniform1f(this.u.uSeabed, SEABED_Y);
    this.textures = new Map();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  link(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  // Returns null when the browser refuses the image (Chrome treats file:// images as
  // cross-origin); the caller then falls back to plain 2D drawing.
  texture(img) {
    const gl = this.gl;
    let tex = this.textures.get(img);
    if (tex) return tex;
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      gl.deleteTexture(tex);
      this.ok = false;
      return null;
    }
    this.textures.set(img, tex);
    return tex;
  }

  resize(width, height, cssWidth, cssHeight) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.ok) this.gl.viewport(0, 0, width, height);
    }
    this.canvas.style.width = cssWidth;
    this.canvas.style.height = cssHeight;
  }

  show(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.canvas.style.visibility = visible ? 'visible' : 'hidden';
  }

  // from/to are background images; mix is the row progress (0 when not travelling).
  // surface 0 keeps the band around the waterline still (for art with things on the surface).
  render({ from, to, mix, time, waterline, plants, amplitude, surface = 1, seabed = SEABED_Y }) {
    const gl = this.gl;
    const fromTex = this.texture(from);
    const toTex = fromTex && this.texture(to || from);
    if (!fromTex || !toTex) return false;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fromTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, toTex);
    gl.uniform1f(this.u.uTime, time);
    gl.uniform1f(this.u.uWater, waterline);
    gl.uniform1f(this.u.uMix, mix);
    gl.uniform1f(this.u.uAmp, amplitude);
    gl.uniform1f(this.u.uSurface, surface);
    gl.uniform1f(this.u.uSeabed, seabed);
    const data = new Float32Array(32);
    plants.slice(0, 8).forEach((p, i) => data.set([p.left, p.right, p.top, p.root], i * 4));
    gl.uniform4fv(this.u.uPlants, data);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}

Object.assign(PopoGame, { WaterScene, surfaceWave, PAN_OVERLAP: OVERLAP });
})(window.PopoGame = window.PopoGame || {});
