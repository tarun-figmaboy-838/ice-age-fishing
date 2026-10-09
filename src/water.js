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

float parallax(float y) {
  float d = clamp(y / uStage.y, 0.0, 1.0);
  return 1120.0 + 296.0 * d * d * (3.0 - 2.0 * d);
}

vec2 displace(vec2 p) {
  float t = uTime;
  vec2 d = vec2(0.0);
  // rolling waves across the painted surface band
  float s = uSurface * smoothstep(uWater - 75.0, uWater - 25.0, p.y) * (1.0 - smoothstep(uWater + 8.0, uWater + 40.0, p.y));
  d.y += s * (2.6 * sin(p.x * 0.013 + t * 1.25) + 1.7 * sin(p.x * 0.029 - t * 0.9) + 0.9 * sin(p.x * 0.051 + t * 2.0));
  d.x += s * (3.5 * sin(t * 0.33) + 1.4 * sin(p.x * 0.02 - t * 0.7));
  // refraction below the surface, stronger with depth
  float u = smoothstep(uWater + 6.0, uWater + 150.0, p.y);
  float depth = clamp((p.y - uWater) / (uStage.y - uWater), 0.0, 1.0);
  d.x += u * (1.8 + 2.6 * depth) * (0.6 * sin(p.y * 0.045 + t * 0.8) + 0.4 * sin(p.x * 0.012 + p.y * 0.03 - t * 0.55));
  d.y += u * (0.9 + 1.6 * depth) * sin(p.x * 0.02 + p.y * 0.01 + t * 0.7);
  // seaweed bends above its roots; rocks and sand around it stay put
  for (int i = 0; i < 8; i++) {
    vec4 pl = uPlants[i];
    if (pl.y <= pl.x) continue;
    float inside = smoothstep(pl.x - 6.0, pl.x + 10.0, p.x) * (1.0 - smoothstep(pl.y - 10.0, pl.y + 6.0, p.x));
    float h = clamp((pl.w - p.y) / max(1.0, pl.w - pl.z), 0.0, 1.0);
    float bend = h * h * (6.0 * sin(t * 0.9 + pl.x * 0.013) + 2.2 * sin(t * 1.7 + p.y * 0.05 + pl.x));
    d.x += inside * bend;
  }
  return d * uAmp;
}

vec4 scene(sampler2D tex, vec2 q) {
  vec2 uv = q / uStage;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0);
  return vec4(texture2D(tex, clamp(uv, 0.0, 1.0)).rgb, inside);
}

void main() {
  vec2 p = vUv * uStage;
  vec2 q = p + displace(p);
  vec3 color;
  if (uMix <= 0.0) {
    color = scene(uFrom, q).rgb;
  } else {
    float dist = parallax(p.y);
    float oxFrom = -uMix * dist;
    float oxTo = (1.0 - uMix) * dist;
    vec4 from = scene(uFrom, q - vec2(oxFrom, 0.0));
    vec4 to = scene(uTo, q - vec2(oxTo, 0.0));
    float feather = (uStage.x - dist) * 0.9;
    float blend = smoothstep(0.0, feather, q.x - oxTo) * min(1.0, uMix * 8.0);
    blend = max(blend, 1.0 - from.a);
    blend = max(blend, smoothstep(0.82, 1.0, uMix));
    color = mix(from.rgb, to.rgb, blend * to.a);
  }
  // light: moving caustics on the sand, a soft shimmer through the water, sparkle on the waves
  float t = uTime;
  float sand = smoothstep(uSeabed - 25.0, uSeabed + 35.0, p.y);
  float caustic = sand * 0.08 * (sin(p.x * 0.021 + t * 0.9) * sin(p.y * 0.05 - t * 0.6) + 0.6 * sin(p.x * 0.033 - t * 0.5 + p.y * 0.02));
  float under = smoothstep(uWater + 6.0, uWater + 150.0, p.y);
  float shimmer = under * 0.035 * sin(p.x * 0.006 + t * 0.4 + p.y * 0.004);
  float s = uSurface * smoothstep(uWater - 60.0, uWater - 20.0, p.y) * (1.0 - smoothstep(uWater + 4.0, uWater + 30.0, p.y));
  float sparkle = s * 0.07 * max(0.0, sin(p.x * 0.013 + t * 1.25)) * max(0.0, sin(p.x * 0.051 + t * 2.0));
  color *= 1.0 + (caustic + shimmer + sparkle) * uAmp;
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

Object.assign(PopoGame, { WaterScene });
})(window.PopoGame = window.PopoGame || {});
