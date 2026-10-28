import * as THREE from 'three';

let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// tileable value noise
function makeNoise(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
    const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
    out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}

function fbm(size, seed, octaves = 5, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = makeNoise(size, base << o, seed + o * 77);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function toTexture(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function normalFromHeight(h, size, strength) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    img.data[i] = (nx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

const cache = {};

// Asphalt: u spans road width, v repeats along the track
export function asphalt(lineFrac = 0.014, S = 1024) {
  const key = 'asphalt' + lineFrac + '_' + S;
  if (cache[key]) return cache[key];
  const r = rng(11);
  const n = fbm(S, 3, 6, 4);
  const grain = new Float32Array(S * S).map(() => r());
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const g = grain[i];
    let v = 64 + n[i] * 26 + (g - 0.5) * 34;
    if (g > 0.985) v += 40;
    if (g < 0.02) v -= 25;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v + 1; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255;
    h[i] = g * 0.6 + n[i] * 0.4;
  }
  ctx.putImageData(img, 0, 0);
  // slight cracks / repairs
  ctx.globalAlpha = 0.25;
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = k % 2 ? '#2b2c2f' : '#55565a';
    const x = r() * S, y = r() * S;
    ctx.fillRect(x, y, 40 + r() * 140, 80 + r() * 300);
  }
  ctx.globalAlpha = 1;
  // edge lines
  const lw = Math.max(6, Math.round(S * lineFrac));
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(4, 0, lw, S);
  ctx.fillRect(S - 4 - lw, 0, lw, S);
  const rough = canvas(S, S), rctx = rough.getContext('2d');
  const rimg = rctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 190 + (grain[i] - 0.5) * 70 + n[i] * 30;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);
  rctx.fillStyle = '#a0a0a0';
  rctx.fillRect(4, 0, lw, S); rctx.fillRect(S - 4 - lw, 0, lw, S);
  return (cache[key] = { map: toTexture(c), normal: normalFromHeight(h, S, 2.2), rough: toTexture(rough, { srgb: false }) });
}

export function runoffAsphalt() {
  if (cache.runoff) return cache.runoff;
  const S = 512, r = rng(5), n = fbm(S, 9, 5, 4);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 92 + n[i] * 30 + (r() - 0.5) * 30;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v + 2; img.data[i * 4 + 2] = v + 5; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.runoff = toTexture(c));
}

export function kerb(colA = '#d01b1b', colB = '#f2f2f2') {
  const key = 'kerb' + colA + colB;
  if (cache[key]) return cache[key];
  const W = 128, H = 256;
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = colA; ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = colB; ctx.fillRect(0, H / 2, W, H / 2);
  // wear
  const r = rng(3);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
    ctx.fillRect(r() * W, r() * H, 2 + r() * 4, 2 + r() * 4);
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.15, 'rgba(0,0,0,0)');
  g.addColorStop(0.85, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return (cache[key] = toTexture(c));
}

export function grass() {
  if (cache.grass) return cache.grass;
  const S = 512, r = rng(21), n = fbm(S, 31, 6, 2), m = fbm(S, 44, 3, 8);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const g = r();
    const k = n[i] * 0.7 + m[i] * 0.3;
    img.data[i * 4] = 52 + k * 40 + g * 18;
    img.data[i * 4 + 1] = 92 + k * 52 + g * 26;
    img.data[i * 4 + 2] = 34 + k * 18 + g * 10;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.grass = toTexture(c));
}

export function mowedGrass() {
  if (cache.mowed) return cache.mowed;
  const S = 512, r = rng(23), n = fbm(S, 37, 5, 4);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const stripe = (Math.floor(y / (S / 4)) % 2) ? 1.08 : 0.92;
    const g = r();
    img.data[i * 4] = (48 + n[i] * 30 + g * 14) * stripe;
    img.data[i * 4 + 1] = (104 + n[i] * 40 + g * 22) * stripe;
    img.data[i * 4 + 2] = (36 + n[i] * 14 + g * 8) * stripe;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.mowed = toTexture(c));
}

export function gravel() {
  if (cache.gravel) return cache.gravel;
  const S = 512, r = rng(7), n = fbm(S, 8, 4, 8);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const g = r();
    const v = 150 + n[i] * 50 + (g - 0.5) * 90;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.93; img.data[i * 4 + 2] = v * 0.8; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.gravel = toTexture(c));
}

export function pavement() {
  if (cache.pavement) return cache.pavement;
  const S = 512, r = rng(9), n = fbm(S, 12, 5, 4);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const joint = (x % 64 < 2 || y % 64 < 2) ? 0.7 : 1;
    const v = (150 + n[i] * 40 + (r() - 0.5) * 30) * joint;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.97; img.data[i * 4 + 2] = v * 0.92; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.pavement = toTexture(c));
}

const BRANDS = [
  ['VELOCITA', '#e10600', '#ffffff'], ['APEX OIL', '#0a2240', '#ffd400'], ['NEON ENERGY', '#111111', '#39ff14'],
  ['TURBO-X', '#ffffff', '#e10600'], ['GRAND PRIX', '#e10600', '#ffffff'], ['CHRONOS WATCHES', '#0b3d2e', '#d4af37'],
  ['SKYLINE AIR', '#c8102e', '#ffffff'], ['PIRELLO', '#ffd100', '#111111'], ['DATAWAVE', '#1b2b6b', '#ffffff'],
  ['HELIX TELECOM', '#ffffff', '#003da5'],
];

export function wallAds(style) {
  const key = 'wall' + style;
  if (cache[key]) return cache[key];
  const W = 2048, H = 128;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const r = rng(style === 'street' ? 99 : 98);
  const n = BRANDS.length;
  const bw = W / 8;
  for (let i = 0; i < 8; i++) {
    const [txt, bg, fg] = BRANDS[(i * 3 + (style === 'street' ? 1 : 0)) % n];
    if (i === 0 || i === 5) { ctx.drawImage(techkeyBoard(512, 256).image, i * bw, 0, bw, H); continue; }
    if (style === 'park' && i % 2 === 1) {
      // plain armco/concrete
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#c9ccce'); g.addColorStop(0.5, '#9a9ea2'); g.addColorStop(1, '#6d7175');
      ctx.fillStyle = g; ctx.fillRect(i * bw, 0, bw, H);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(i * bw, H * 0.32, bw, 3); ctx.fillRect(i * bw, H * 0.66, bw, 3);
      continue;
    }
    ctx.fillStyle = bg; ctx.fillRect(i * bw, 0, bw, H);
    ctx.fillStyle = fg;
    ctx.font = `italic 900 ${H * 0.5}px "Titillium Web", Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = H * 0.5;
    while (ctx.measureText(txt).width > bw * 0.88 && size > 10) { size -= 2; ctx.font = `italic 900 ${size}px "Titillium Web", Arial Black, sans-serif`; }
    ctx.fillText(txt, i * bw + bw / 2, H * 0.53);
  }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    ctx.fillRect(r() * W, r() * H, 3, 3);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, H - 8, W, 8);
  return (cache[key] = toTexture(c));
}

export function concrete() {
  if (cache.concrete) return cache.concrete;
  const S = 256, r = rng(13), n = fbm(S, 17, 5, 4);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 160 + n[i] * 50 + (r() - 0.5) * 20;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v * 0.97; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.concrete = toTexture(c));
}

export function fence() {
  if (cache.fence) return cache.fence;
  const S = 128;
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(200,205,210,1)';
  ctx.lineWidth = 2.5;
  const step = S / 8;
  for (let i = -8; i < 16; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step + S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * step + S, 0); ctx.lineTo(i * step, S); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(170,175,180,1)';
  ctx.fillRect(0, 0, S, 4); ctx.fillRect(0, S / 2 - 2, S, 4);
  const t = toTexture(c);
  return (cache.fence = t);
}

export function crowd() {
  if (cache.crowd) return cache.crowd;
  const W = 512, H = 256, r = rng(31);
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2d33'; ctx.fillRect(0, 0, W, H);
  const cols = ['#e10600', '#ffffff', '#ffd400', '#1e41ff', '#ff8700', '#00d2be', '#222', '#c30000', '#f596c8', '#9aa', '#6b4', '#f2c'];
  const rows = 16;
  for (let row = 0; row < rows; row++) {
    const y = row * H / rows;
    ctx.fillStyle = '#4b4f57'; ctx.fillRect(0, y + H / rows - 3, W, 3);
    for (let x = 0; x < W; x += 6 + r() * 2) {
      if (r() < 0.12) continue;
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.fillRect(x, y + 4, 5, H / rows - 8);
      ctx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#ffdbac'][Math.floor(r() * 4)];
      ctx.fillRect(x + 1, y + 1, 3, 4);
    }
  }
  return (cache.crowd = toTexture(c));
}

// Neutral (near-white) facades; buildings are painted via vertex colours.
// variant: 0 shutters, 1 balconies, 2 classic stone, 3 modern glass, 4 arches/shops
export function facade(variant) {
  const key = 'facade' + variant;
  if (cache[key]) return cache[key];
  const S = 512, r = rng(41 + variant * 7);
  const c = canvas(S, S), ctx = c.getContext('2d');
  // plaster with subtle noise
  ctx.fillStyle = variant === 3 ? '#cfd8e2' : '#f3efe8'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.05})`; ctx.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3); }
  const shutterCols = ['#3f6b45', '#2f5f7a', '#7a4b2f', '#5d6e3a'];
  const shutter = shutterCols[variant % shutterCols.length];
  if (variant === 3) {
    // glass curtain wall
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const g = ctx.createLinearGradient(0, y * 64, 64, y * 64 + 64);
      const b = 0.6 + r() * 0.4;
      g.addColorStop(0, `rgb(${70 * b},${110 * b},${150 * b})`); g.addColorStop(1, `rgb(${150 * b},${185 * b},${210 * b})`);
      ctx.fillStyle = g; ctx.fillRect(x * 64 + 3, y * 64 + 3, 58, 58);
    }
  } else {
    const nx = variant === 2 ? 4 : 5, ny = 6;
    const cw = S / nx, ch = S / ny;
    for (let y = 0; y < ny; y++) {
      // cornice line per floor
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(0, y * ch + ch - 6, S, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(0, y * ch + ch - 9, S, 3);
      for (let x = 0; x < nx; x++) {
        const wx = x * cw + cw * 0.28, wy = y * ch + ch * 0.2, ww = cw * 0.44, wh = ch * 0.6;
        const ground = variant === 4 && y === ny - 1;
        if (ground) {
          // shop front with awning
          ctx.fillStyle = '#2c3a46'; ctx.fillRect(x * cw + cw * 0.1, y * ch + ch * 0.3, cw * 0.8, ch * 0.66);
          ctx.fillStyle = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d'][x % 4];
          for (let k = 0; k < 6; k++) { ctx.globalAlpha = k % 2 ? 1 : 0.75; ctx.fillRect(x * cw + cw * 0.08 + k * cw * 0.14, y * ch + ch * 0.18, cw * 0.14, ch * 0.14); }
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        const lit = r();
        const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, lit > 0.85 ? '#7b8fa3' : '#273441'); g.addColorStop(1, lit > 0.85 ? '#b9c7d3' : '#4c5f70');
        ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = '#f7f4ee'; ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh); ctx.fillRect(wx, wy + wh * 0.4, ww, 3);
        if (variant === 0 || (variant === 4 && r() > 0.3)) {
          // painted shutters
          ctx.fillStyle = shutter;
          ctx.fillRect(wx - ww * 0.42, wy, ww * 0.38, wh); ctx.fillRect(wx + ww * 1.04, wy, ww * 0.38, wh);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          for (let k = 0; k < 8; k++) { ctx.fillRect(wx - ww * 0.42, wy + k * wh / 8, ww * 0.38, 2); ctx.fillRect(wx + ww * 1.04, wy + k * wh / 8, ww * 0.38, 2); }
        }
        if (variant === 1 && y < ny - 1) {
          // wrought-iron balcony
          ctx.fillStyle = '#26282b'; ctx.fillRect(wx - 10, wy + wh - 4, ww + 20, 4); ctx.fillRect(wx - 10, wy + wh * 0.62, ww + 20, 3);
          for (let k = 0; k <= 10; k++) ctx.fillRect(wx - 10 + k * (ww + 20) / 10, wy + wh * 0.62, 2, wh * 0.38);
        }
        if (variant === 2) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(wx - 6, wy - 12, ww + 12, 8); }
      }
    }
  }
  // pure white block used for roofs / plain painted areas (uv ~ 0.01)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, S - 12, 12, 12);
  return (cache[key] = toTexture(c));
}

// "Made by TechKey Crew" billboard
export function techkeyBoard(w = 1024, h = 256) {
  const key = 'techkey' + w + 'x' + h;
  if (cache[key]) return cache[key];
  const c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#07070c'); g.addColorStop(0.6, '#15151f'); g.addColorStop(1, '#2a0606');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // racing slashes
  ctx.fillStyle = '#e10600';
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(w * 0.04 + k * h * 0.16, h); ctx.lineTo(w * 0.04 + k * h * 0.16 + h * 0.3, 0); ctx.lineTo(w * 0.04 + k * h * 0.16 + h * 0.38, 0); ctx.lineTo(w * 0.04 + k * h * 0.16 + h * 0.08, h); ctx.fill(); }
  // key icon
  const kx = w * 0.04 + h * 0.75, ky = h * 0.5, kr = h * 0.16;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = h * 0.05;
  ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(kx + kr, ky - h * 0.025, h * 0.32, h * 0.05);
  ctx.fillRect(kx + kr + h * 0.2, ky, h * 0.04, h * 0.1); ctx.fillRect(kx + kr + h * 0.28, ky, h * 0.04, h * 0.07);
  const tx = kx + kr + h * 0.45;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#bbbbc8';
  ctx.font = `600 ${h * 0.17}px "Titillium Web", Arial, sans-serif`;
  ctx.fillText('MADE BY', tx, h * 0.27);
  let size = h * 0.42;
  ctx.font = `italic 900 ${size}px "Titillium Web", Arial Black, sans-serif`;
  while (ctx.measureText('TECHKEY CREW').width > w - tx - w * 0.03 && size > 10) { size -= 3; ctx.font = `italic 900 ${size}px "Titillium Web", Arial Black, sans-serif`; }
  ctx.fillStyle = '#ffffff';
  ctx.fillText('TECHKEY', tx, h * 0.64);
  const tw = ctx.measureText('TECHKEY ').width;
  ctx.fillStyle = '#e10600';
  ctx.fillText('CREW', tx + tw, h * 0.64);
  ctx.fillStyle = '#e10600'; ctx.fillRect(0, h - h * 0.04, w, h * 0.04);
  return (cache[key] = toTexture(c, { repeat: false }));
}

export function carbon() {
  if (cache.carbon) return cache.carbon;
  const S = 256;
  const c = canvas(S, S), ctx = c.getContext('2d');
  const cell = 8;
  for (let y = 0; y < S / cell; y++) for (let x = 0; x < S / cell; x++) {
    const a = ((x + y) % 4) < 2;
    const g = ctx.createLinearGradient(x * cell, y * cell, x * cell + (a ? cell : 0), y * cell + (a ? 0 : cell));
    g.addColorStop(0, '#141516'); g.addColorStop(0.5, '#2c2e31'); g.addColorStop(1, '#141516');
    ctx.fillStyle = g; ctx.fillRect(x * cell, y * cell, cell, cell);
  }
  const t = toTexture(c);
  t.repeat.set(6, 6);
  return (cache.carbon = t);
}

// Sidewall + wheel rim in one disc texture (rim occupies the inner 62%)
export function tyreWall(compound, blur = false) {
  const key = 'tyre' + compound + blur;
  if (cache[key]) return cache[key];
  const S = blur ? 256 : 1024;
  const c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#151515'; ctx.fillRect(0, 0, S, S);
  // rubber sidewall grain + moulded rings (HD)
  for (let i = 0; i < (blur ? 300 : 5000); i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  for (const r of [0.47, 0.455, 0.35]) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = S * 0.003; ctx.beginPath(); ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2); ctx.stroke(); }
  const cx = S / 2, cy = S / 2;
  // rim
  const rr = S * 0.31;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
  rg.addColorStop(0, '#2c2e33'); rg.addColorStop(0.75, '#141518'); rg.addColorStop(1, '#0b0b0d');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
  if (!blur) {
    ctx.strokeStyle = '#3d4046'; ctx.lineWidth = S * 0.018;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rr * 0.25, cy + Math.sin(a) * rr * 0.25);
      ctx.lineTo(cx + Math.cos(a + 0.2) * rr * 0.95, cy + Math.sin(a + 0.2) * rr * 0.95); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(70,74,80,0.55)'; ctx.lineWidth = rr * 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#9a9ea6'; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = compound; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#55585e'; ctx.lineWidth = S * 0.012; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  if (blur) {
    ctx.strokeStyle = compound; ctx.lineWidth = S * 0.035; ctx.beginPath(); ctx.arc(cx, cy, S * 0.43, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,180,180,0.35)'; ctx.lineWidth = S * 0.05; ctx.beginPath(); ctx.arc(cx, cy, S * 0.38, 0, Math.PI * 2); ctx.stroke();
    return (cache[key] = toTexture(c, { repeat: false }));
  }
  // compound stripe ring
  ctx.strokeStyle = compound; ctx.lineWidth = S * 0.035;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.43, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, S * 0.33, 0, Math.PI * 2); ctx.stroke();
  // lettering around the ring
  const drawArc = (txt, start, col, size) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let a = start;
    for (const ch of txt) {
      const w = ctx.measureText(ch).width;
      const da = w / (S * 0.38);
      ctx.save();
      ctx.translate(cx + Math.cos(a + da / 2) * S * 0.38, cy + Math.sin(a + da / 2) * S * 0.38);
      ctx.rotate(a + da / 2 + Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a += da * 1.15;
    }
  };
  for (let k = 0; k < 2; k++) {
    drawArc('P ZERO', -Math.PI * 0.85 + k * Math.PI, '#e8e8e8', 40 * S / 512);
    drawArc('PIRELLI', -Math.PI * 0.35 + k * Math.PI, compound, 36 * S / 512);
  }
  return (cache[key] = toTexture(c, { repeat: false }));
}

export function textDecal(text, { color = '#fff', bg = null, w = 1024, h = 256, italic = true, weight = 900, stroke = null, font = '"Titillium Web", Arial Black, sans-serif', align = 'center' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  let size = h * 0.78;
  const set = () => { ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`; };
  set();
  while (ctx.measureText(text).width > w * 0.94 && size > 8) { size -= 4; set(); }
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  const x = align === 'center' ? w / 2 : w * 0.03;
  if (stroke) { ctx.lineWidth = size * 0.08; ctx.strokeStyle = stroke; ctx.strokeText(text, x, h * 0.54); }
  ctx.fillStyle = color;
  ctx.fillText(text, x, h * 0.54);
  return toTexture(c, { repeat: false });
}

export function radialBlob() {
  if (cache.blob) return cache.blob;
  const S = 128;
  const c = canvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return (cache.blob = toTexture(c, { repeat: false }));
}

export function smokeSprite() {
  if (cache.smoke) return cache.smoke;
  const S = 128, n = fbm(S, 71, 4, 4);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const a = Math.max(0, 1 - d) ** 1.5 * (0.6 + n[y * S + x] * 0.8);
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 235;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return (cache.smoke = toTexture(c, { repeat: false }));
}

export function helmet(colA, colB) {
  const W = 256, H = 128;
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = colA; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = colB;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.55); ctx.bezierCurveTo(W * 0.3, H * 0.35, W * 0.7, H * 0.75, W, H * 0.5);
  ctx.lineTo(W, H * 0.7); ctx.bezierCurveTo(W * 0.7, H * 0.95, W * 0.3, H * 0.55, 0, H * 0.75);
  ctx.fill();
  ctx.fillRect(0, 0, W, H * 0.12);
  return toTexture(c);
}

export function startGrid() {
  if (cache.grid) return cache.grid;
  const W = 256, H = 64;
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, 0, 10, H * 0.6); ctx.fillRect(W - 10, 0, 10, H * 0.6);
  return (cache.grid = toTexture(c, { repeat: false }));
}

export function checker() {
  if (cache.checker) return cache.checker;
  const W = 512, H = 64;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const s = 16;
  for (let y = 0; y < H / s; y++) for (let x = 0; x < W / s; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(x * s, y * s, s, s);
  }
  return (cache.checker = toTexture(c, { repeat: false }));
}

export function treeLeaves() {
  if (cache.leaves) return cache.leaves;
  const S = 256, r = rng(55), n = fbm(S, 61, 4, 8);
  const c = canvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const k = n[i] * 0.8 + r() * 0.4;
    img.data[i * 4] = 40 + k * 50;
    img.data[i * 4 + 1] = 70 + k * 70;
    img.data[i * 4 + 2] = 30 + k * 30;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.leaves = toTexture(c));
}
