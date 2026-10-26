// Time of day + weather: DAY (original look), NIGHT (floodlit track, moon, stars) and RAIN
// (wet glossy asphalt with puddles, falling rain, spray behind cars, drops on the cockpit view, lightning).
import * as THREE from 'three';

export const CONDITIONS = [
  ['day', 'DAY', 'Sunny afternoon, the original look.'],
  ['night', 'NIGHT', 'Floodlit circuit under the moon and stars.'],
  ['rain', 'RAIN', 'Wet track, spray and thunder. Less grip, so brake earlier!'],
];
export const RAIN_GRIP = 0.84; // tyre grip multiplier on a wet track

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function mistTexture() {
  return canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  });
}
function moonTexture() {
  const r = rng(77);
  return canvasTex(256, 256, (ctx) => {
    const glow = ctx.createRadialGradient(128, 128, 30, 128, 128, 128);
    glow.addColorStop(0, 'rgba(220,230,255,0.55)'); glow.addColorStop(0.45, 'rgba(160,180,255,0.12)'); glow.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#f4f1e6'; ctx.beginPath(); ctx.arc(128, 128, 46, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(128, 128, 46, 0, Math.PI * 2); ctx.clip();
    for (let k = 0; k < 22; k++) { ctx.fillStyle = `rgba(150,150,140,${0.12 + r() * 0.2})`; ctx.beginPath(); ctx.arc(90 + r() * 80, 90 + r() * 80, 3 + r() * 12, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  });
}
function lampGlowTexture() {
  return canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,245,220,0.8)'); g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  });
}
// ------------------------------------------------------------------ night sky: gradient dome, stars, moon
function buildNightSky(moonDir) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moon: { value: moonDir.clone() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 moon; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, -0.1, 1.0);
        vec3 zen = vec3(0.025, 0.04, 0.11), hor = vec3(0.12, 0.15, 0.26), glow = vec3(0.30, 0.22, 0.20);
        vec3 c = mix(hor, zen, pow(max(h, 0.0), 0.55));
        c += glow * pow(1.0 - abs(h), 10.0) * 0.6; // city glow on the horizon
        float m = max(dot(vD, moon), 0.0);
        c += vec3(0.35, 0.4, 0.55) * pow(m, 40.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  g.add(dome);
  const r = rng(321), n = 1600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const y = 0.08 + r() * 0.92, a = r() * Math.PI * 2, s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * s * 6500, y * 6500, Math.sin(a) * s * 6500], k * 3);
    const t = r(); col.set(t < 0.15 ? [1, 0.85, 0.7] : t < 0.3 ? [0.75, 0.85, 1] : [1, 1, 1], k * 3);
    size[k] = 1 + Math.pow(r(), 6) * 3.5;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: { time: { value: 0 }, pr: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vT; uniform float time; uniform float pr;
      void main(){ vC = color; vT = 0.75 + 0.25 * sin(time * 2.0 + position.x * 0.01 + position.z * 0.013);
        gl_PointSize = size * 1.8 * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; varying float vT;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vT; gl_FragColor = vec4(vC, a); }`,
  }));
  stars.frustumCulled = false;
  g.add(stars);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), depthWrite: false, fog: false, transparent: true }));
  moon.position.copy(moonDir).multiplyScalar(6000);
  moon.scale.setScalar(900);
  g.add(moon);
  return { group: g, stars };
}

// ------------------------------------------------------------------ floodlights along the circuit
// Poles beside the barriers with glowing lamp heads, plus a small pool of real spotlights that
// follow the player (hundreds of real lights would be far too slow on phones).
function buildFloodlights(track, quality) {
  const group = new THREE.Group();
  const step = 55;
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.24, 14, 6); poleGeo.translate(0, 7, 0);
  const headGeo = new THREE.BoxGeometry(2.6, 0.5, 0.9);
  const poles = [], heads = [];
  for (let s = 0, k = 0; s < track.length; s += step, k++) {
    const i = track.indexAtS(s);
    const side = k % 2 ? 1 : -1;
    const wall = side === 1 ? track.wallL[i] : track.wallR[i];
    const off = Math.max(wall + 1.6, track.hw + 4);
    const x = track.px[i] + track.nx[i] * side * off, z = track.pz[i] + track.nz[i] * side * off, y = track.py[i];
    poles.push(new THREE.Matrix4().makeTranslation(x, y, z));
    const hx = track.px[i] + track.nx[i] * side * (off - 1.6), hz = track.pz[i] + track.nz[i] * side * (off - 1.6);
    const rot = new THREE.Matrix4().makeRotationY(Math.atan2(track.tx[i], track.tz[i]));
    heads.push({ m: new THREE.Matrix4().makeTranslation(hx, y + 14.2, hz).multiply(rot), x: hx, y: y + 13.8, z: hz, i });
  }
  const pm = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x51565c, roughness: 0.5, metalness: 0.6 }), poles.length);
  poles.forEach((m, k) => pm.setMatrixAt(k, m));
  const hm = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2d8, emissiveIntensity: 3.2, roughness: 0.4 }), heads.length);
  heads.forEach((h, k) => hm.setMatrixAt(k, h.m));
  group.add(pm, hm);
  const pos = new Float32Array(heads.length * 3);
  heads.forEach((h, k) => pos.set([h.x, h.y - 0.3, h.z], k * 3));
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const halos = new THREE.Points(gg, new THREE.PointsMaterial({ map: lampGlowTexture(), size: 9, color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  group.add(halos);
  const nSpots = quality === 'low' ? 3 : quality === 'medium' ? 5 : 7;
  const spots = [];
  for (let k = 0; k < nSpots; k++) {
    const sp = new THREE.SpotLight(0xfff1dc, 520, 95, 1.05, 0.65, 1.3);
    group.add(sp, sp.target);
    spots.push(sp);
  }
  let last = -1;
  const update = (px, pz, i0) => {
    if (i0 === last) return; // only re-pick when the player moved to a new track sample
    last = i0;
    const near = heads.map(h => [h, (h.x - px) ** 2 + (h.z - pz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, nSpots);
    near.forEach(([h], k) => {
      const sp = spots[k];
      sp.position.set(h.x, h.y, h.z);
      sp.target.position.set(track.px[h.i], track.py[h.i], track.pz[h.i]);
      sp.target.updateMatrixWorld();
    });
  };
  return { group, update };
}
// ------------------------------------------------------------------ falling rain (instanced streaks around the camera)
// Falling rain, animated 100% on the GPU: the geometry never changes, the vertex shader moves every
// drop (fall + wrap around the camera) and stretches it along its motion relative to the car,
// so it slants towards you at speed. Thin, faint streaks with normal blending = no white wash-out.
function buildRain(quality) {
  const n = quality === 'low' ? 2500 : quality === 'medium' ? 5000 : 9000;
  const R = 34, H = 26;
  const off = new Float32Array(n * 4 * 4), corner = new Float32Array(n * 4 * 2), idx = new Uint32Array(n * 6);
  for (let k = 0; k < n; k++) {
    const x = (Math.random() - 0.5) * 2 * R, y = Math.random() * H, z = (Math.random() - 0.5) * 2 * R, seed = Math.random();
    for (let v = 0; v < 4; v++) {
      off.set([x, y, z, seed], (k * 4 + v) * 4);
      corner.set([v & 1 ? 1 : -1, v < 2 ? 0 : 1], (k * 4 + v) * 2);
    }
    const b = k * 4;
    idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], k * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3)); // unused, required by three
  geo.setAttribute('aOff', new THREE.BufferAttribute(off, 4));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, vel: { value: new THREE.Vector3() }, amount: { value: 1 }, flash: { value: 0 } },
    vertexShader: `
      attribute vec4 aOff; attribute vec2 aCorner;
      uniform float time; uniform vec3 cam; uniform vec3 vel; uniform float amount;
      varying float vA; varying float vT;
      const float R = ${R.toFixed(1)}; const float H = ${H.toFixed(1)};
      void main(){
        float fall = 9.0 + aOff.w * 3.0;                           // real drops fall ~9 m/s
        vec3 p;
        p.y = cam.y - H * 0.35 + mod(aOff.y - time * fall, H);
        p.x = cam.x + mod(aOff.x - cam.x + R, 2.0 * R) - R;
        p.z = cam.z + mod(aOff.z - cam.z + R, 2.0 * R) - R;
        vec3 rel = vec3(-vel.x, -fall, -vel.z);                    // drop motion seen from the moving car
        vec3 dir = normalize(rel);
        float len = clamp(length(rel) * 0.045, 0.35, 2.2);         // motion-blur length
        vec3 toCam = normalize(cam - p);
        vec3 side = normalize(cross(dir, toCam)) * 0.012;
        p += side * aCorner.x - dir * len * aCorner.y;
        float d = distance(p, cam);
        vA = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(R * 0.55, R, d)) * step(aOff.w, amount);
        vT = aCorner.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float flash; varying float vA; varying float vT;
      void main(){
        float a = vA * (0.10 + 0.22 * vT) * (1.0 + flash * 1.5);  // head brighter than the tail
        gl_FragColor = vec4(vec3(0.78, 0.83, 0.9), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const update = (dt, cam, carVx, carVz) => {
    const u = mat.uniforms;
    u.time.value += dt; u.cam.value.copy(cam); u.vel.value.set(carVx, 0, carVz);
  };
  return { mesh, update, max: n };
}
// ------------------------------------------------------------------ spray: rooster tails of mist behind cars + wheel splashes
class Spray {
  constructor(max) {
    this.max = max; this.next = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max); this.grow = new Float32Array(max); this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: mistTexture() }, scale: { value: 600 }, tint: { value: new THREE.Color(0xc8d0da) } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(tint, t.a * vA); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, life, size, grow) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
  }
  update(dt) {
    const k = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - 1.2 * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = Math.min(1, (1 - t) * 8) * t * 0.42;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.size.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ water drops on the "lens" (cockpit / nose / T-cam)
class LensDrops {
  constructor() {
    const el = document.createElement('canvas');
    el.id = 'lens-drops'; el.className = 'lens-drops';
    document.body.appendChild(el);
    this.el = el; this.ctx = el.getContext('2d');
    this.drops = []; this.on = false; this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() { const s = Math.min(1, 900 / Math.max(innerWidth, 1)); this.el.width = Math.round(innerWidth * s); this.el.height = Math.round(innerHeight * s); this.k = this.el.width / innerWidth; }
  setVisible(on) { if (on !== this.on) { this.on = on; this.el.style.display = on ? 'block' : 'none'; if (!on) this.drops.length = 0; } }
  // spray = how much water hits the screen this frame (rain + cars ahead)
  update(dt, speed, spray) {
    if (!this.on) return;
    const W = this.el.width, H = this.el.height, ctx = this.ctx;
    const rate = (6 + spray * 70) * dt * (speed > 3 ? 1 : 0.4);
    for (let n = Math.floor(rate + Math.random()); n > 0 && this.drops.length < 55; n--) {
      this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.85, r: (2 + Math.random() * Math.random() * 9) * this.k * 1.6, life: 0.6 + Math.random() * 1.6, t: 0, vy: 0 });
    }
    ctx.clearRect(0, 0, W, H);
    const wind = Math.min(1, speed / 60);
    for (let k = this.drops.length - 1; k >= 0; k--) {
      const d = this.drops[k];
      d.t += dt;
      // at speed the airflow blows drops outwards and down the screen
      d.vy += (40 + wind * 900) * dt * this.k;
      d.y += d.vy * dt; d.x += (d.x - W / 2) * wind * 1.6 * dt;
      const a = Math.min(1, d.t * 8) * Math.max(0, 1 - d.t / d.life);
      if (a <= 0 || d.y > H + 20) { this.drops.splice(k, 1); continue; }
      const len = d.r * (1 + Math.min(4, d.vy / (300 * this.k)));
      const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r * 1.2);
      g.addColorStop(0, `rgba(255,255,255,${0.55 * a})`); g.addColorStop(0.5, `rgba(190,205,225,${0.18 * a})`); g.addColorStop(1, `rgba(40,50,70,${0.28 * a})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(d.x, d.y - (len - d.r) / 2, d.r, len, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  dispose() { this.el.remove(); }
}
// ------------------------------------------------------------------ storm sky: moving dark cloud layer (replaces the sunny sky)
function buildStormSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, flash: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float time; uniform float flash; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        float y = max(vD.y, 0.0);
        vec2 uv = vD.xz / (y + 0.18) * 1.6 + vec2(time * 0.012, time * 0.004);
        float c = fbm(uv) * 0.65 + fbm(uv * 2.7 - time * 0.02) * 0.35;
        vec3 dark = vec3(0.20, 0.22, 0.25), light = vec3(0.50, 0.53, 0.57), hor = vec3(0.55, 0.58, 0.62);
        vec3 col = mix(dark, light, smoothstep(0.35, 0.8, c));
        col = mix(hor, col, smoothstep(0.0, 0.35, y));            // misty horizon blends into fog
        col += vec3(0.75, 0.8, 1.0) * flash * (0.35 + c * 0.65); // lightning lights the clouds from inside
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), mat);
  dome.renderOrder = -1;
  return dome;
}

// ------------------------------------------------------------------ public API
// Applied after the normal day environment was built; adjusts lights/sky/fog and adds the extras.
export class Weather {
  constructor({ scene, track, sky, sun, hemi, renderer, quality, condition, scenery }) {
    this.cond = condition; this.scene = scene; this.sun = sun; this.hemi = hemi; this.sky = sky; this.renderer = renderer; this.scenery = scenery;
    this.t = 0; this.flash = 0; this.nextBolt = 6 + Math.random() * 8; this.onThunder = null;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.baseExposure = 0.9;
    if (condition === 'night') this.setupNight(track, quality);
    this.track = track; this.quality = quality;
    this.wetness = condition === 'rain' ? 1 : 0;
    if (condition === 'rain') this.setupRain(track, quality);
    this.gripBase = this.gripNow();
    this.apply();
  }

  // 0 = dry, 1 = full rain. Rain parts are created on demand (a shower can start mid-race).
  setWetness(w) {
    w = Math.max(0, Math.min(1, w));
    if (Math.abs(w - this.wetness) < 0.01) return;
    this.wetness = w;
    if (w > 0 && !this.rain) this.addRainParts(this.track, this.quality);
    if (!this.rain) return;
    this.rain.mesh.material.uniforms.amount.value = w; // fraction of drops drawn
    this.rain.mesh.visible = w > 0.02;
  }
  gripNow() { return 1 - (1 - RAIN_GRIP) * this.wetness; }
  get gripMul() { return this.gripNow(); }

  addRainParts(track, quality) {
    // only falling rain + light spray behind cars (no water on the track: cleaner look, much faster)
    this.rain = buildRain(quality);
    this.group.add(this.rain.mesh);
    this.spray = new Spray(quality === 'low' ? 250 : 500);
    this.spray.points.material.uniforms.scale.value = this.scaleH ? this.scaleH * 0.6 : 600;
    this.group.add(this.spray.points);
    this.lens = new LensDrops();
    if (!this.bolt) {
      this.bolt = new THREE.DirectionalLight(0xdfe6ff, 0); // lightning
      this.bolt.position.set(200, 600, -100);
      this.group.add(this.bolt);
    }
    if (!this.fogColor) this.fogColor = this.scene.fog ? this.scene.fog.color.clone() : new THREE.Color(0x9aa3ad);
  }

  setupNight(track, quality) {
    this.sky.visible = false;
    const moonDir = new THREE.Vector3(-0.45, 0.42, 0.62).normalize();
    this.night = buildNightSky(moonDir);
    this.group.add(this.night.group);
    // moonlight keeps shadows + shape; ambient is generous so the track is never pitch black
    this.sun.color.set(0xa9bce8); this.sun.intensity = 0.9;
    this.sun.userData.dir = moonDir.clone();
    this.hemi.color.set(0x5d6f9c); this.hemi.groundColor.set(0x2a2622); this.hemi.intensity = 1.05;
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.Fog(0x0e1426, 220, 3600);
    this.baseExposure = 1.05;
    this.lights = buildFloodlights(track, quality);
    this.group.add(this.lights.group);
  }

  setupRain(track, quality) {
    // storm: dark moving clouds instead of the sunny sky, flat soft light, thick spray-mist in the distance
    this.sky.visible = false;
    this.storm = buildStormSky();
    this.group.add(this.storm);
    this.sun.color.set(0xc4ccd8); this.sun.intensity = 1.0;
    this.hemi.color.set(0xb4bfcd); this.hemi.groundColor.set(0x3a3d42); this.hemi.intensity = 1.2;
    this.scene.environmentIntensity = 0.8;
    this.fogColor = new THREE.Color(0x8a929c);
    this.scene.fog = new THREE.Fog(this.fogColor.clone(), 120, 1800); // grey and moody, not a white wall
    this.baseExposure = 0.9;
    this.addRainParts(track, quality);
  }

  setScale(h) {
    this.scaleH = h;
    if (this.spray) this.spray.points.material.uniforms.scale.value = h * 0.6;
    if (this.night) this.night.stars.material.uniforms.pr.value = Math.max(1, h / 700);
  }

  // rooster tail of spray from the rear tyres: more with speed
  carSpray(c, camPos) {
    const p = c.phys, speed = Math.abs(p.u);
    if (speed < 6 || c.retired) return;
    const dx = p.x - camPos.x, dz = p.z - camPos.z;
    if (dx * dx + dz * dz > 220 * 220) return;
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
    const amount = Math.min(1, speed / 55);
    const n = Math.random() < amount * 1.6 ? (speed > 40 ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) {
      const side = Math.random() < 0.5 ? 0.75 : -0.75, back = -1.9 - Math.random() * 0.4;
      this.spray.emit(p.x + sh * back + ch * side, c.proj.y + 0.25, p.z + ch * back - sh * side,
        p.vx * 0.55 + (Math.random() - 0.5) * 2.5, 1.4 + Math.random() * 2.2 * amount, p.vz * 0.55 + (Math.random() - 0.5) * 2.5,
        0.8 + Math.random() * 0.9 * amount, 0.9 + amount * 0.6, 3.6 + amount * 5);
    }
  }

  // how much water hits the cockpit view: rain + spray from cars just ahead
  spraySeen(pl, cars, L) {
    let s = 0.35;
    for (const o of cars) {
      if (o === pl) continue;
      let gap = o.proj.s - pl.proj.s; if (gap < -L / 2) gap += L; if (gap > L / 2) gap -= L;
      if (gap > 2 && gap < 45 && Math.abs(o.proj.d - pl.proj.d) < 3) s += (1 - gap / 45) * Math.min(1, Math.abs(o.phys.u) / 40) * 1.6;
    }
    return Math.min(2, s);
  }
  update(dt, { camera, player, cars, track, cockpit }) {
    this.t += dt;
    const camPos = camera.position;
    if (this.night) {
      this.night.group.position.copy(camPos);
      this.night.stars.material.uniforms.time.value = this.t;
      this.lights.update(player.phys.x, player.phys.z, player.proj.i);
    }
    const w = this.wetness;
    if (this.storm) { this.storm.position.copy(camPos); this.storm.material.uniforms.time.value = this.t; this.storm.material.uniforms.flash.value = this.flash; }
    if (this.rain && w > 0.02) {
      this.rain.update(dt, camPos, player.phys.vx, player.phys.vz);
      this.rain.mesh.material.uniforms.flash.value = this.flash;
      for (const c of cars) if (Math.random() < w * 0.5) this.carSpray(c, camPos);
      // lightning (proper rain only): a flicker of 2-3 flashes, thunder follows later the further away it struck
      this.nextBolt -= w > 0.6 ? dt : 0;
      if (this.nextBolt <= 0) {
        this.nextBolt = 9 + Math.random() * 16;
        const dist = 0.3 + Math.random() * 0.7;
        this.flashes = [[0, 1.4 / dist], [0.09 + Math.random() * 0.08, 0.7 / dist], [0.25 + Math.random() * 0.15, 1 / dist]];
        this.boltT = 0;
        if (this.onThunder) setTimeout(() => this.onThunder(dist), 500 + dist * 2600);
      }
      if (this.flashes) {
        this.boltT += dt;
        let f = 0;
        for (const [t0, a] of this.flashes) { const d = this.boltT - t0; if (d >= 0 && d < 0.12) f = Math.max(f, a * (1 - d / 0.12)); }
        this.flash = Math.min(2.2, f);
        if (this.boltT > 0.6) this.flashes = null;
      } else this.flash = 0;
      this.bolt.intensity = this.flash * 4;
      this.renderer.toneMappingExposure = this.baseExposure + this.flash * 0.35;
      this.scene.fog.color.copy(this.fogColor).offsetHSL(0, 0, this.flash * 0.18);
    }
    if (this.spray) this.spray.update(dt);
    if (this.lens) {
      this.lens.setVisible(cockpit && w > 0.05);
      this.lens.update(dt, Math.abs(player.phys.u), this.spraySeen(player, cars, track.length) * w);
    }
  }

  apply() { this.renderer.toneMappingExposure = this.baseExposure; }
  hideLens() { if (this.lens) this.lens.setVisible(false); }
  dispose() {
    this.sky.visible = true;
    this.scene.remove(this.group);
    if (this.lens) this.lens.dispose();
    this.renderer.toneMappingExposure = 0.9;
  }
}
