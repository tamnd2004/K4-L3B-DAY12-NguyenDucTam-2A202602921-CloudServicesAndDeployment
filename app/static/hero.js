/* Hero: số "12" dạng metaball (SDF + smooth-min), ruột là mosaic vẽ bằng canvas 2D,
 * con trỏ để lại vệt dither làm mép khối rã thành chấm. WebGL1, không thư viện.
 * Nhận dữ liệu thật từ app.js qua event `agent:log` / `agent:status`. */
(() => {
  "use strict";

  const hero = document.querySelector(".hero");
  const canvas = hero && hero.querySelector(".hero-canvas");
  if (!canvas) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = canvas.getContext("webgl", {
    antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false,
  });
  if (!gl) { hero.classList.add("no-gl"); return; }

  // ── Tọa độ khối hình (đơn vị "unit", y hướng xuống) ─────────────
  const SHAPE_W = 620, SHAPE_H = 540;          // bbox cả cụm (số + vệ tinh)
  const MOSAIC = [-140, -185, 215, 215];       // vùng có ảnh bên trong khối: xmin, ymin, xmax, ymax
  const TRAIL = 24;
  const TRAIL_LIFE = 1.4;                      // giây

  // ── Shader ─────────────────────────────────────────────────────
  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define TRAIL ${TRAIL}
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uOffset;         // điểm của khối hình nằm ở tâm màn (units)
uniform float uTime;
uniform float uIntro;
uniform vec4 uMosaic;
uniform sampler2D uTex;
uniform vec4 uTrail[TRAIL];   // x, y (css px), strength, radius (css px)
uniform vec4 uVel[TRAIL];     // vx, vy (css px)

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, -s * p.x + c * p.y); }
vec2 wob(vec2 p, float k) { return p + 3.0 * vec2(sin(uTime * 0.6 + k), cos(uTime * 0.8 + k * 1.7)); }

float sdTwelve(vec2 p) {
  // "1": thân + cờ
  float one = sdCapsule(p, wob(vec2(-120.0, -150.0), 0.0), wob(vec2(-120.0, 185.0), 1.0), 46.0);
  one = smin(one, sdCapsule(p, wob(vec2(-120.0, -150.0), 0.0), wob(vec2(-205.0, -92.0), 2.0), 40.0), 30.0);
  // "2": vòm → chéo → đế
  float two = sdCapsule(p, wob(vec2(0.0, -118.0), 3.0), wob(vec2(70.0, -178.0), 4.0), 44.0);
  two = smin(two, sdCapsule(p, wob(vec2(70.0, -178.0), 4.0), wob(vec2(150.0, -150.0), 5.0), 44.0), 30.0);
  two = smin(two, sdCapsule(p, wob(vec2(150.0, -150.0), 5.0), wob(vec2(165.0, -70.0), 6.0), 44.0), 30.0);
  two = smin(two, sdCapsule(p, wob(vec2(165.0, -70.0), 6.0), wob(vec2(20.0, 168.0), 7.0), 46.0), 30.0);
  two = smin(two, sdCapsule(p, wob(vec2(20.0, 168.0), 7.0), wob(vec2(200.0, 168.0), 8.0), 42.0), 30.0);
  return smin(one, two, 42.0);
}

vec3 mainColor(vec2 p, float d) {
  float g = clamp(0.52 - p.x * 0.0017 - p.y * 0.0013, 0.0, 1.0);   // sáng dần về phía trên-trái
  vec3 col = mix(vec3(0.22), vec3(0.72), g);
  vec2 uv = (p - uMosaic.xy) / (uMosaic.zw - uMosaic.xy);
  vec3 tex = texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  col = mix(col, tex, inside);
  float rim = smoothstep(-34.0, 0.0, d);                              // viền tối mềm sát mép
  return mix(col, vec3(0.17), rim * 0.86);
}
vec3 satColor(vec2 l, vec2 r) {
  float g = clamp(0.5 + 0.55 * l.x / r.x - 0.3 * l.y / r.y, 0.0, 1.0);
  return mix(vec3(0.2), vec3(0.8), g * g);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;

  // Vệt con trỏ: độ mạnh + vector kéo lệch
  float tr = 0.0;
  vec2 disp = vec2(0.0);
  for (int i = 0; i < TRAIL; i++) {
    vec4 t = uTrail[i];
    if (t.z <= 0.001) continue;
    vec2 dl = px - t.xy;
    float g = exp(-dot(dl, dl) / (t.w * t.w));
    tr += t.z * g;
    disp += uVel[i].xy * t.z * g;
  }
  tr = clamp(tr, 0.0, 1.0);
  float dlen = length(disp);
  if (dlen > 56.0) disp *= 56.0 / dlen;

  vec2 p = (px - disp - uCenter) / uScale + uOffset;
  float aa = 1.1 / uScale;
  float spread = tr * 105.0;
  float dither = smoothstep(0.03, 0.2, tr);
  float n = hash(floor(px * 0.8) + floor(uTime * 24.0) * 1.37);

  // "12"
  float dM = sdTwelve(p);
  float mM = mix(1.0 - smoothstep(-aa, aa, dM),
                 step(n, 1.0 - smoothstep(-spread - aa, spread + aa, dM)), dither);
  // vệ tinh lớn (trên-phải) và nhỏ
  vec2 cA = vec2(255.0, -255.0) + 4.0 * vec2(sin(uTime * 0.5), cos(uTime * 0.4));
  vec2 rA = vec2(105.0, 52.0);
  vec2 lA = rot(p - cA, -0.32);
  float dA = sdEllipse(lA, rA);
  float mA = mix(1.0 - smoothstep(-9.0, 9.0, dA),
                 step(n, 1.0 - smoothstep(-9.0 - spread, 9.0 + spread, dA)), dither);
  vec2 cB = vec2(282.0, 8.0) + 3.0 * vec2(cos(uTime * 0.7), sin(uTime * 0.6));
  vec2 rB = vec2(40.0, 31.0);
  vec2 lB = rot(p - cB, 0.2);
  float dB = sdEllipse(lB, rB);
  float mB = mix(1.0 - smoothstep(-6.0, 6.0, dB),
                 step(n, 1.0 - smoothstep(-6.0 - spread, 6.0 + spread, dB)), dither);

  vec3 colM = mainColor(p, dM);
  vec3 colA = satColor(lA, rA);
  vec3 colB = satColor(lB, rB) * 0.8;
  float dark = 1.0 - uIntro;                                 // intro: khối đen rồi sáng dần
  colM = mix(colM, colM * 0.1, dark);
  colA = mix(colA, vec3(0.03), dark);
  colB = mix(colB, vec3(0.03), dark);

  vec3 col = vec3(1.0);
  col = mix(col, colA, mA);
  col = mix(col, colB, mB);
  col = mix(col, colM, mM);
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("hero shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = vs && fs && gl.createProgram();
  if (prog) {
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
  }
  if (!prog || !gl.getProgramParameter(prog, gl.LINK_STATUS)) { hero.classList.add("no-gl"); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ["uRes", "uDpr", "uCenter", "uScale", "uOffset", "uTime", "uIntro", "uMosaic", "uTex", "uTrail", "uVel"]
    .forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
  gl.uniform4f(U.uMosaic, MOSAIC[0], MOSAIC[1], MOSAIC[2], MOSAIC[3]);
  gl.uniform1i(U.uTex, 0);

  // ── Mosaic: canvas 2D → texture ─────────────────────────────────
  const S = 1024;
  const mosaic = document.createElement("canvas");
  mosaic.width = mosaic.height = S;
  const mc = mosaic.getContext("2d");

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  function noiseCanvas(size, cell) {
    const n = Math.ceil(size / cell);
    const small = document.createElement("canvas");
    small.width = small.height = n;
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = Math.random() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = true;
    cx.drawImage(small, 0, 0, size, size);
    return c;
  }
  const NOISE_L = noiseCanvas(512, 24);
  const NOISE_M = noiseCanvas(512, 5);
  const GRAIN = noiseCanvas(512, 1);

  function texture(c, x, y, w, h, src, alpha, mode) {
    c.save();
    c.globalAlpha = alpha;
    c.globalCompositeOperation = mode;
    c.drawImage(src, 0, 0, src.width, src.height, x, y, w, h);
    c.restore();
  }
  function vgrad(c, y0, y1, stops) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    return g;
  }

  // Ô (u0, v0, u1, v1) trong không gian mosaic
  const TILES = {
    fog: [0.00, 0.00, 0.22, 0.30],
    stone: [0.22, 0.00, 1.00, 0.18],
    concrete: [0.00, 0.30, 0.22, 0.62],
    stairs: [0.22, 0.18, 0.52, 0.60],
    log: [0.52, 0.18, 1.00, 0.44],
    crowd: [0.52, 0.44, 1.00, 0.66],
    field: [0.00, 0.60, 0.45, 1.00],
    status: [0.45, 0.60, 0.72, 1.00],
    sea: [0.72, 0.66, 1.00, 1.00],
  };
  const rect = (k) => { const [u0, v0, u1, v1] = TILES[k]; return [u0 * S, v0 * S, (u1 - u0) * S, (v1 - v0) * S]; };

  const painters = {
    fog(c, x, y, w, h, t) {
      c.fillStyle = vgrad(c, y, y + h, [[0, "#d6dad9"], [1, "#9aa09e"]]);
      c.fillRect(x, y, w, h);
      const drift = Math.sin(t * 0.35) * w * 0.04;
      c.fillStyle = "rgba(255,255,255,.55)";
      c.beginPath();
      c.moveTo(x + w * 0.1 + drift, y + h);
      c.lineTo(x + w * 1.05, y + h * 0.35);
      c.lineTo(x + w * 1.05, y + h);
      c.closePath();
      c.fill();
      texture(c, x, y, w, h, NOISE_L, 0.18, "overlay");
    },
    stone(c, x, y, w, h) {
      c.fillStyle = vgrad(c, y, y + h, [[0, "#eef0ef"], [1, "#d8dbd9"]]);
      c.fillRect(x, y, w, h);
      c.beginPath();
      c.moveTo(x, y + h);
      for (let i = 0; i <= 28; i++) {
        const edge = i < 3 || i > 25 ? h * 0.3 : 0;
        c.lineTo(x + (w * i) / 28, y + h * 0.3 + Math.sin(i * 0.8) * h * 0.06 + (rnd(i) - 0.5) * h * 0.14 + edge);
      }
      c.lineTo(x + w, y + h);
      c.closePath();
      c.fillStyle = vgrad(c, y + h * 0.25, y + h, [[0, "#9c8d78"], [1, "#5b5247"]]);
      c.fill();
      c.save();
      c.clip();
      texture(c, x, y, w, h, NOISE_M, 0.55, "multiply");
      texture(c, x, y, w, h, NOISE_L, 0.4, "overlay");
      c.restore();
    },
    concrete(c, x, y, w, h) {
      c.fillStyle = "#8f9593";
      c.fillRect(x, y, w, h);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = `rgba(255,255,255,${(rnd(i + 40) * 0.14).toFixed(3)})`;
        c.fillRect(x + (w * i) / 6, y, w / 6, h);
      }
      texture(c, x, y, w, h, NOISE_M, 0.35, "multiply");
      texture(c, x, y, w, h, GRAIN, 0.12, "overlay");
    },
    stairs(c, x, y, w, h) {
      c.fillStyle = "#b4b7b5";
      c.fillRect(x, y, w, h);
      let yy = y, step = h * 0.022;
      while (yy < y + h) {
        c.fillStyle = "rgba(255,255,255,.4)";
        c.fillRect(x, yy, w, Math.max(1, step * 0.35));
        c.fillStyle = "rgba(35,35,35,.3)";
        c.fillRect(x, yy + step * 0.35, w, Math.max(1, step * 0.18));
        yy += step;
        step *= 1.11;
      }
      const g = c.createLinearGradient(x, 0, x + w * 0.35, 0);
      g.addColorStop(0, "rgba(20,20,20,.55)");
      g.addColorStop(1, "rgba(20,20,20,0)");
      c.fillStyle = g;
      c.fillRect(x, y, w * 0.35, h);
      texture(c, x, y, w, h, NOISE_M, 0.25, "overlay");
    },
    log(c, x, y, w, h, t, now) {
      c.fillStyle = "#0c0e0d";
      c.fillRect(x, y, w, h);
      c.fillStyle = "rgba(255,255,255,.07)";
      c.fillRect(x, y, w, 30);
      c.font = '500 14px "JetBrains Mono", monospace';
      c.fillStyle = "rgba(255,255,255,.55)";
      c.fillText("stdout · day12-agent", x + 14, y + 20);
      const lh = 23;
      const rows = Math.floor((h - 40) / lh) + 1;
      const lines = state.log.slice(-rows);
      const k = Math.min(1, (now - state.logBump) / 280);
      const off = (1 - k) * lh;
      c.font = '400 15px "JetBrains Mono", monospace';
      lines.forEach((ln, i) => {
        const yy = y + h - 14 - (lines.length - 1 - i) * lh + off;
        if (yy < y + 42) return;
        c.fillStyle = i === lines.length - 1 ? "#ffffff" : "rgba(196,212,202,.7)";
        c.fillText(ln, x + 14, yy);
      });
      if (Math.floor(t * 2) % 2 === 0) { c.fillStyle = "#fff"; c.fillRect(x + 14, y + h - 10, 9, 3); }
    },
    crowd(c, x, y, w, h, t) {
      c.fillStyle = vgrad(c, y, y + h, [[0, "#c98b3c"], [0.55, "#7a4a22"], [1, "#1a120c"]]);
      c.fillRect(x, y, w, h);
      const glow = c.createRadialGradient(x + w * 0.34, y + h * 0.3, 0, x + w * 0.34, y + h * 0.3, w * 0.4);
      glow.addColorStop(0, "rgba(255,214,150,.6)");
      glow.addColorStop(1, "rgba(255,214,150,0)");
      c.fillStyle = glow;
      c.fillRect(x, y, w, h);
      c.fillStyle = "#0c0907";
      for (let i = 0; i < 9; i++) {
        const cx = x + (w * (i + 0.5)) / 9 + Math.sin(t * 0.9 + i * 1.3) * 2.5;
        const r = h * (0.075 + rnd(i) * 0.035);
        const hy = y + h * (0.5 + rnd(i + 9) * 0.12);
        c.beginPath();
        c.ellipse(cx, hy, r * 0.85, r, 0, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.ellipse(cx, hy + r * 2.6, r * 1.9, r * 2, 0, 0, Math.PI * 2);
        c.fill();
      }
      texture(c, x, y, w, h, GRAIN, 0.14, "overlay");
    },
    field(c, x, y, w, h, t) {
      const sky = h * 0.2, trees = h * 0.1, top = y + sky + trees;
      c.fillStyle = vgrad(c, y, y + sky, [[0, "#b9d0da"], [1, "#e4ecee"]]);
      c.fillRect(x, y, w, sky + 4);
      c.fillStyle = "#2d4430";
      c.beginPath();
      c.moveTo(x, top);
      for (let i = 0; i <= 70; i++) {
        const px = x + (w * i) / 70;
        c.lineTo(px, y + sky + trees * (i % 2 ? 0.25 : 0.55) - rnd(i + 3) * trees * 0.5);
      }
      c.lineTo(x + w, top);
      c.closePath();
      c.fill();
      c.fillStyle = vgrad(c, top, y + h, [[0, "#d8bd63"], [1, "#c39839"]]);
      c.fillRect(x, top, w, y + h - top);
      c.lineWidth = 1.2;
      for (let k = 0; k < 46; k++) {
        const sy = top + ((y + h - top) * (k + rnd(k) * 0.8)) / 46;
        const sway = Math.sin(t * 1.4 + k * 0.7) * 5;
        c.strokeStyle = k % 3 ? "rgba(120,86,28,.28)" : "rgba(255,240,196,.35)";
        c.beginPath();
        c.moveTo(x, sy);
        c.quadraticCurveTo(x + w * 0.5, sy + sway, x + w, sy - sway * 0.5);
        c.stroke();
      }
      texture(c, x, top, w, y + h - top, NOISE_M, 0.28, "overlay");
    },
    status(c, x, y, w, h) {
      c.fillStyle = "#e9e8e3";
      c.fillRect(x, y, w, h);
      const code = state.code == null ? "···" : state.code === 0 ? "ERR" : String(state.code);
      c.fillStyle = state.code === 200 ? "#0b0b0b" : state.code == null ? "#777" : "#b42318";
      c.font = `900 ${Math.round(h * 0.26)}px Jost, sans-serif`;
      c.fillText(code, x + 14, y + h * 0.5);
      c.fillStyle = "#3a3a3a";
      c.font = `600 ${Math.round(h * 0.07)}px "Barlow Condensed", sans-serif`;
      c.fillText("GET /HEALTH" + (state.ms != null ? ` · ${state.ms} MS` : ""), x + 16, y + h * 0.64);
      c.fillText("REDIS " + (state.redis === true ? "READY" : state.redis === false ? "DOWN" : "—"), x + 16, y + h * 0.74);
      texture(c, x, y, w, h, GRAIN, 0.1, "multiply");
    },
    sea(c, x, y, w, h, t) {
      c.fillStyle = vgrad(c, y, y + h, [[0, "#223549"], [1, "#0e1620"]]);
      c.fillRect(x, y, w, h);
      c.strokeStyle = "rgba(236,240,245,.85)";
      c.lineWidth = 1.6;
      c.beginPath();
      for (let i = 0; i <= 90; i++) {
        const px = x + w * 0.15 + (w * 0.8 * i) / 90;
        const py = y + h * 0.42 + Math.sin(i * 0.55 + t * 1.6) * h * 0.05 + i * h * 0.0035 + (rnd(i) - 0.5) * 6;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.stroke();
      texture(c, x, y, w, h, GRAIN, 0.12, "overlay");
    },
  };

  // Ô tĩnh vẽ một lần vào nền; ô động vẽ lại mỗi nhịp
  const base = document.createElement("canvas");
  base.width = base.height = S;
  const bc = base.getContext("2d");
  bc.fillStyle = "#8d918f";
  bc.fillRect(0, 0, S, S);
  ["stone", "concrete", "stairs"].forEach((k) => {
    const [x, y, w, h] = rect(k);
    bc.save(); bc.beginPath(); bc.rect(x, y, w, h); bc.clip();
    painters[k](bc, x, y, w, h, 0, 0);
    bc.restore();
  });
  const DYNAMIC = ["fog", "log", "crowd", "field", "status", "sea"];

  const state = {
    log: ['{"event":"ui_loaded","service":"day12-agent"}'],
    logBump: 0,
    code: null, ms: null, redis: null,
  };
  let mosaicDirty = true;
  window.addEventListener("agent:log", (e) => {
    state.log.push(String(e.detail));
    if (state.log.length > 40) state.log.shift();
    state.logBump = performance.now();
    mosaicDirty = true;
  });
  window.addEventListener("agent:status", (e) => {
    Object.assign(state, e.detail || {});
    mosaicDirty = true;
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { mosaicDirty = true; });

  function drawMosaic(now) {
    const t = reduceMotion ? 0 : now / 1000;
    mc.drawImage(base, 0, 0);
    DYNAMIC.forEach((k) => {
      const [x, y, w, h] = rect(k);
      mc.save(); mc.beginPath(); mc.rect(x, y, w, h); mc.clip();
      painters[k](mc, x, y, w, h, t, now);
      mc.restore();
    });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, mosaic);
  }

  // ── Vệt con trỏ ────────────────────────────────────────────────
  const trail = [];
  const trailBuf = new Float32Array(TRAIL * 4);
  const velBuf = new Float32Array(TRAIL * 4);

  function pushPoint(x, y, vx, vy, t) {
    trail.push({ x, y, vx, vy, t });
    while (trail.length > TRAIL) trail.shift();
  }
  window.addEventListener("pointermove", (e) => {
    if (reduceMotion || !running) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return;
    const now = performance.now();
    const last = trail[trail.length - 1];
    if (last) {
      const dx = x - last.x, dy = y - last.y, d = Math.hypot(dx, dy);
      if (d < 7) return;
      const m = Math.min(1, 28 / d);
      const steps = Math.min(3, Math.floor(d / 45));        // lấp khoảng khi chuột lướt nhanh
      for (let i = 1; i <= steps; i++) {
        const f = i / (steps + 1);
        pushPoint(last.x + dx * f, last.y + dy * f, dx * m, dy * m, now);
      }
      pushPoint(x, y, dx * m, dy * m, now);
    } else {
      pushPoint(x, y, 0, 0, now);
    }
  }, { passive: true });

  function fillTrail(now) {
    trailBuf.fill(0);
    velBuf.fill(0);
    const sizeK = Math.max(0.65, Math.min(1.25, scale));
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const age = (now - p.t) / 1000;
      if (age >= TRAIL_LIFE) continue;
      const s = Math.pow(1 - age / TRAIL_LIFE, 1.4);
      trailBuf[i * 4] = p.x;
      trailBuf[i * 4 + 1] = p.y;
      trailBuf[i * 4 + 2] = s;
      trailBuf[i * 4 + 3] = (50 + age * 60) * sizeK;
      velBuf[i * 4] = p.vx;
      velBuf[i * 4 + 1] = p.vy;
    }
  }

  // ── Kích thước, vòng lặp, tạm dừng khi khuất ────────────────────
  let W = 0, H = 0, dpr = 1, scale = 1, center = [0, 0], offset = [55, -47];
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const portrait = H > W * 1.15;
    if (portrait) {
      // Màn dọc: canh giữa riêng số "12" (rộng ~505 units), vệ tinh được phép tràn ra mép phải
      scale = Math.min((W * 0.9) / 505, (H * 0.6) / SHAPE_H);
      offset = [0, -40];
      center = [W / 2, H * 0.44];
    } else {
      scale = Math.min((W * 0.86) / SHAPE_W, (H * 0.7) / SHAPE_H);
      offset = [55, -47];
      center = [W / 2, H * 0.47];
    }
    requestDraw();
  }

  let running = true, rafId = 0, lastMosaic = 0, lastDraw = 0;
  let t0 = 0;   // đồng hồ intro tính từ frame đầu tiên thật sự vẽ ra, không phải lúc tải script

  function frame(now) {
    rafId = 0;
    if (!running) return;
    if (!t0) t0 = now;
    if (reduceMotion && now - lastDraw < 500 && !mosaicDirty) { rafId = requestAnimationFrame(frame); return; }
    lastDraw = now;
    if (mosaicDirty || (!reduceMotion && now - lastMosaic > 80)) {
      drawMosaic(now);
      lastMosaic = now;
      mosaicDirty = false;
    }
    const intro = reduceMotion ? 1 : Math.min(1, Math.max(0, (now - t0 - 450) / 1300));
    fillTrail(now);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform2f(U.uCenter, center[0], center[1]);
    gl.uniform1f(U.uScale, scale);
    gl.uniform2f(U.uOffset, offset[0], offset[1]);
    gl.uniform1f(U.uTime, reduceMotion ? 0 : (now - t0) / 1000);
    gl.uniform1f(U.uIntro, intro * intro * (3 - 2 * intro));
    gl.uniform4fv(U.uTrail, trailBuf);
    gl.uniform4fv(U.uVel, velBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    rafId = requestAnimationFrame(frame);
  }
  function requestDraw() { if (running && !rafId) rafId = requestAnimationFrame(frame); }

  let heroVisible = true;
  const setRunning = () => {
    running = heroVisible && !document.hidden;
    if (running) requestDraw();
  };
  new IntersectionObserver(([en]) => { heroVisible = en.isIntersecting; setRunning(); }).observe(hero);
  document.addEventListener("visibilitychange", setRunning);
  window.addEventListener("resize", resize);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    running = false;
    hero.classList.add("no-gl");
  });

  resize();
})();
