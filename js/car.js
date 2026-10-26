import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { sponsorTexture, TEAM_SPONSORS } from './sponsors.js';

// Car local frame: +z forward, +y up, +x = car's left. Units: metres. 2018-spec dimensions.
const Z_MIN = -2.85, Z_MAX = 2.95, Y_MAX = 1.05;
export const FRONT_AXLE = 1.65, REAR_AXLE = -1.95;
export const WHEEL_R = 0.33;
const FW = { x: 0.85, w: 0.305 }, RW = { x: 0.80, w: 0.405 };

// ---------- geometry helpers ----------
function projUV(geo) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getZ(i) - Z_MIN) / (Z_MAX - Z_MIN);
    uv[i * 2 + 1] = p.getY(i) / Y_MAX;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function carbonUV(geo) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getZ(i) + p.getX(i)) * 0.6;
    uv[i * 2 + 1] = (p.getY(i) + p.getX(i) * 0.5) * 0.6;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function prep(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}

function flipWinding(g) {
  g = prep(g);
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name], s = a.itemSize, arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let c = 0; c < s; c++) {
        const i1 = (t + 1) * s + c, i2 = (t + 2) * s + c;
        const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
      }
    }
  }
  return g;
}

function mirrorX(geo) {
  const g = prep(geo).clone();
  g.scale(-1, 1, 1);
  return flipWinding(g);
}

// Superellipse loft along z. sections: {z, cx, hw, top, bot, n}
function loft(sections, seg = 32) {
  const ring = seg;
  const pos = [];
  for (const s of sections) {
    const n = s.n || 3, cx = s.cx || 0;
    const yc = (s.top + s.bot) / 2, ht = s.top - yc, hb = yc - s.bot;
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = cx + s.hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const y = yc + (sn > 0 ? ht : hb) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      pos.push(x, y, s.z);
    }
  }
  const idx = [];
  for (let j = 0; j < sections.length - 1; j++) {
    for (let k = 0; k < ring; k++) {
      const a = j * ring + k, b = j * ring + (k + 1) % ring, c = (j + 1) * ring + k, d = (j + 1) * ring + (k + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // ensure outward normals
  const s0 = sections[Math.floor(sections.length / 2)];
  const testI = Math.floor(sections.length / 2) * ring;
  const nx = geo.attributes.normal.getX(testI);
  const px = geo.attributes.position.getX(testI) - (s0.cx || 0);
  if (nx * px < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.setIndex(idx); geo.computeVertexNormals();
  }
  const cap = (s, front) => {
    const n = s.n || 3, cx = s.cx || 0, yc = (s.top + s.bot) / 2, ht = s.top - yc, hb = yc - s.bot;
    const p = [cx, yc, s.z];
    for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      p.push(cx + s.hw * 0.98 * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), yc + (sn > 0 ? ht : hb) * 0.98 * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n), s.z);
    }
    const ix = [];
    for (let k = 1; k <= ring; k++) front ? ix.push(0, k, k + 1) : ix.push(0, k + 1, k);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix); g.computeVertexNormals();
    if (g.attributes.normal.getZ(0) * (front ? 1 : -1) < 0) { for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.setIndex(ix); g.computeVertexNormals(); }
    return g;
  };
  return { body: geo, capFront: cap(sections[0], true), capBack: cap(sections[sections.length - 1], false) };
}

// Airfoil swept along x. stations: {x, y, z (leading edge), chord, aoa, t}
function airfoilWing(stations, nProf = 14) {
  const prof = [];
  for (let i = 0; i <= nProf; i++) prof.push((1 - Math.cos(i / nProf * Math.PI)) / 2);
  const loop = [];
  for (let i = 0; i <= nProf; i++) loop.push([prof[i], 1]);
  for (let i = nProf - 1; i >= 1; i--) loop.push([prof[i], -1]);
  const pos = [];
  for (const st of stations) {
    const ca = Math.cos(st.aoa), sa = Math.sin(st.aoa);
    for (const [c, side] of loop) {
      const yt = 5 * (st.t || 0.12) * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
      const yc = -0.05 * Math.sin(Math.PI * c);
      const lc = c * st.chord, lt = (yc + side * yt) * st.chord;
      // chord runs backwards (-z), rotated by aoa (positive = trailing edge up)
      pos.push(st.x, st.y + lc * sa + lt * ca, st.z - lc * ca + lt * sa);
    }
  }
  const ring = loop.length, idx = [];
  for (let j = 0; j < stations.length - 1; j++) for (let k = 0; k < ring; k++) {
    const a = j * ring + k, b = j * ring + (k + 1) % ring, c = (j + 1) * ring + k, d = (j + 1) * ring + (k + 1) % ring;
    idx.push(a, b, c, b, d, c);
  }
  // end caps
  for (const j of [0, stations.length - 1]) {
    for (let k = 1; k < ring - 1; k++) j === 0 ? idx.push(j * ring, j * ring + k + 1, j * ring + k) : idx.push(j * ring, j * ring + k, j * ring + k + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // upper surface mid-chord normal must point up
  const probe = Math.floor(nProf / 2);
  if (geo.attributes.normal.getY(probe) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.setIndex(idx); geo.computeVertexNormals();
  }
  return geo;
}

// flat plate in the z-y plane, thickness along x, positioned at x0
function plate(pts, thick, x0) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> -x
  g.translate(x0 + thick / 2, 0, 0);
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function rod(a, b, r = 0.014, flat = 2.2) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  g.scale(flat, 1, 1 / flat * 1.6);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  const m = A.clone().add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// ---------- livery painting ----------
const zx = (z, W) => (z - Z_MIN) / (Z_MAX - Z_MIN) * W;
const yy = (y, H) => (1 - y / Y_MAX) * H;

function poly(ctx, W, H, pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach(([z, y], i) => (i ? ctx.lineTo(zx(z, W), yy(y, H)) : ctx.moveTo(zx(z, W), yy(y, H))));
  ctx.closePath(); ctx.fill();
}
function band(ctx, W, H, pts, width, color) {
  ctx.strokeStyle = color; ctx.lineWidth = width * H / Y_MAX; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([z, y], i) => (i ? ctx.lineTo(zx(z, W), yy(y, H)) : ctx.moveTo(zx(z, W), yy(y, H))));
  ctx.stroke();
}

function paintLivery(team) {
  const L = team.livery;
  const W = 2048, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = L.base; ctx.fillRect(0, 0, W, H);
  const id = team.id;
  if (id === 'mercedes') {
    const g = ctx.createLinearGradient(zx(1.2, W), 0, zx(-2.8, W), 0);
    g.addColorStop(0, L.base); g.addColorStop(1, '#9fa6ad');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    poly(ctx, W, H, [[0.9, 0], [0.1, 0.22], [-1.2, 0.5], [-2.9, 0.8], [-2.9, 0]], L.dark);
    band(ctx, W, H, [[2.6, 0.27], [1.5, 0.33], [0.6, 0.18], [-0.2, 0.3], [-1.3, 0.56], [-2.9, 0.86]], 0.025, L.accent);
    band(ctx, W, H, [[0.5, 0.15], [-0.4, 0.33], [-1.5, 0.62], [-2.9, 0.92]], 0.012, L.accent2);
  } else if (id === 'ferrari') {
    poly(ctx, W, H, [[1.2, 0], [1.2, 0.12], [-2.9, 0.18], [-2.9, 0]], L.dark);
    band(ctx, W, H, [[0.55, 0.53], [-0.4, 0.5], [-1.6, 0.38]], 0.018, L.accent);
    band(ctx, W, H, [[2.9, 0.2], [2.0, 0.24]], 0.02, L.accent);
  } else if (id === 'redbull') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#24315c'); g.addColorStop(1, L.dark);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    poly(ctx, W, H, [[-0.9, 0.5], [-2.9, 0.38], [-2.9, 0.62], [-1.2, 0.82]], L.accent);
    poly(ctx, W, H, [[2.95, 0], [2.45, 0], [2.45, 1], [2.95, 1]], L.accent2);
    poly(ctx, W, H, [[2.45, 0], [2.3, 0], [2.3, 1], [2.45, 1]], L.accent);
  } else if (id === 'forceindia') {
    poly(ctx, W, H, [[1.4, 0], [0.8, 0.26], [-1.2, 0.3], [-2.9, 0.25], [-2.9, 0]], L.accent2);
    poly(ctx, W, H, [[1.2, 0], [-2.9, 0], [-2.9, 0.09], [1.2, 0.1]], L.dark);
    band(ctx, W, H, [[1.4, 0.3], [0.8, 0.3], [-1.2, 0.34], [-2.9, 0.29]], 0.02, L.accent);
  } else if (id === 'williams') {
    poly(ctx, W, H, [[2.9, 0], [2.9, 0.18], [0.6, 0.2], [-2.9, 0.3], [-2.9, 0]], L.dark);
    const stripes = [[L.accent, 0.5], [L.accent3, 0.46], [L.accent2, 0.42]];
    for (const [col, y] of stripes) band(ctx, W, H, [[2.7, y - 0.2], [1.2, y + 0.02], [0.4, y], [-1.6, y - 0.05], [-2.9, y + 0.1]], 0.03, col);
  } else if (id === 'renault') {
    poly(ctx, W, H, [[0.2, 0], [-0.6, 0.52], [-1.0, 1.1], [-2.9, 1.1], [-2.9, 0]], L.dark);
    band(ctx, W, H, [[0.25, -0.02], [-0.57, 0.53], [-0.98, 1.12]], 0.015, L.accent2);
    poly(ctx, W, H, [[2.95, 0], [2.6, 0], [2.6, 0.17], [2.95, 0.17]], L.dark);
  } else if (id === 'tororosso') {
    const g = ctx.createLinearGradient(zx(-0.2, W), 0, zx(-1.6, W), 0);
    g.addColorStop(0, L.base); g.addColorStop(1, L.accent);
    ctx.fillStyle = g; ctx.fillRect(zx(-2.9, W), 0, zx(-0.2, W) - zx(-2.9, W), H);
    ctx.fillStyle = L.accent; ctx.fillRect(0, 0, zx(-1.6, W), H);
    band(ctx, W, H, [[1.0, 0.2], [-0.5, 0.3], [-2.0, 0.5]], 0.02, L.accent2);
  } else if (id === 'haas') {
    poly(ctx, W, H, [[2.9, 0], [2.9, 0.2], [0.5, 0.25], [-2.9, 0.45], [-2.9, 0]], L.dark);
    band(ctx, W, H, [[2.9, 0.23], [0.5, 0.28], [-2.9, 0.49]], 0.025, L.accent);
    band(ctx, W, H, [[0.3, 0.58], [-0.8, 0.86]], 0.02, L.accent2);
  } else if (id === 'mclaren') {
    poly(ctx, W, H, [[-0.4, 0], [-0.9, 0.26], [-2.9, 0.3], [-2.9, 0]], L.accent);
    band(ctx, W, H, [[-0.35, 0.02], [-0.85, 0.29], [-2.9, 0.33]], 0.012, L.accent2);
    poly(ctx, W, H, [[1.6, 0], [1.6, 0.1], [-2.9, 0.12], [-2.9, 0]], L.dark);
  } else if (id === 'sauber') {
    poly(ctx, W, H, [[0.6, 0], [-0.4, 0.45], [-1.2, 1.1], [-2.9, 1.1], [-2.9, 0]], L.dark);
    band(ctx, W, H, [[0.65, -0.02], [-0.35, 0.47], [-1.15, 1.12]], 0.02, L.accent);
    band(ctx, W, H, [[2.9, 0.18], [1.5, 0.22], [0.8, 0.12]], 0.02, L.accent);
  }
  // subtle panel lines & weathering
  ctx.globalAlpha = 0.18; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  for (const z of [1.25, 0.55, -0.35, -1.4]) { ctx.beginPath(); ctx.moveTo(zx(z, W), 0); ctx.lineTo(zx(z, W), H); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- shared materials ----------
let shared = null;
function sharedMats() {
  if (shared) return shared;
  const carbonTex = TX.carbon();
  shared = {
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x9a9a9a, map: carbonTex, roughness: 0.38, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.25, metalness: 0.95 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x111418, roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x2266ff, emissiveIntensity: 0.6 }),
    rain: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0 }),
    tcamBlack: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
    tcamYellow: new THREE.MeshStandardMaterial({ color: 0xe8ff00, roughness: 0.4, emissive: 0x303800 }),
  };
  return shared;
}

const COMPOUNDS = { soft: '#e8202a', medium: '#ffd200', hard: '#f0f0f0', ultrasoft: '#a0168c', supersoft: '#e8202a' };

const sponsorMats = {};
function sponsorMat(id) {
  if (!sponsorMats[id]) sponsorMats[id] = new THREE.MeshStandardMaterial({ map: sponsorTexture(id), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.35, metalness: 0.05 });
  return sponsorMats[id];
}

// ---------- team template (geometry built once per team) ----------
const templates = new Map();

function buildTemplate(team) {
  if (templates.has(team.id)) return templates.get(team.id);
  const L = team.livery;
  const M = sharedMats();
  const livery = paintLivery(team);
  const paint = new THREE.MeshPhysicalMaterial({ map: livery, roughness: L.rough, metalness: L.metal, clearcoat: L.rough > 0.5 ? 0.15 : 1.0, clearcoatRoughness: 0.08 });
  const wing = new THREE.MeshPhysicalMaterial({ color: L.wing, roughness: Math.min(0.6, L.rough + 0.05), metalness: 0.15, clearcoat: 0.6 });
  const wingAccent = new THREE.MeshPhysicalMaterial({ color: L.wingAccent, roughness: 0.35, metalness: 0.15, clearcoat: 0.6 });
  const halo = new THREE.MeshPhysicalMaterial({ color: L.halo, roughness: L.rough, metalness: L.metal * 0.6, clearcoat: 0.8 });
  const logoTex = TX.textDecal(L.logo, { color: L.text === '#ffffff' || L.textOn === 'dark' ? '#ffffff' : L.text });
  const logoMat = new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });

  const parts = { paint: [], carbon: [], wing: [], wingAccent: [], black: [], halo: [], metal: [], logo: [], screen: [] };
  const both = (key, g, uvFn) => { if (uvFn) uvFn(g); parts[key].push(prep(g)); parts[key].push(mirrorX(g)); };

  // monocoque + nose
  const tub = loft([
    { z: 2.62, hw: 0.07, top: 0.27, bot: 0.17, n: 2.2 },
    { z: 2.45, hw: 0.11, top: 0.34, bot: 0.17, n: 2.4 },
    { z: 2.15, hw: 0.14, top: 0.43, bot: 0.2, n: 2.6 },
    { z: 1.7, hw: 0.19, top: 0.54, bot: 0.22, n: 2.8 },
    { z: 1.25, hw: 0.25, top: 0.6, bot: 0.12, n: 3.2 },
    { z: 0.7, hw: 0.33, top: 0.64, bot: 0.06, n: 3.6 },
    { z: 0.2, hw: 0.38, top: 0.6, bot: 0.05, n: 3.8 },
    { z: -0.35, hw: 0.39, top: 0.62, bot: 0.05, n: 3.8 },
    { z: -0.9, hw: 0.34, top: 0.56, bot: 0.05, n: 3.4 },
    { z: -1.6, hw: 0.22, top: 0.46, bot: 0.1, n: 3 },
    { z: -2.25, hw: 0.11, top: 0.42, bot: 0.2, n: 2.6 },
    { z: -2.6, hw: 0.06, top: 0.38, bot: 0.25, n: 2.4 },
  ], 36);
  parts.paint.push(prep(projUV(tub.body)), prep(projUV(tub.capFront)));
  parts.black.push(prep(tub.capBack));

  // engine cover + airbox
  const cover = loft([
    { z: -0.22, hw: 0.11, top: 0.99, bot: 0.74, n: 2.6 },
    { z: -0.32, hw: 0.14, top: 1.0, bot: 0.6, n: 2.8 },
    { z: -0.7, hw: 0.18, top: 0.98, bot: 0.35, n: 3 },
    { z: -1.2, hw: 0.21, top: 0.82, bot: 0.25, n: 3 },
    { z: -1.8, hw: 0.15, top: 0.62, bot: 0.22, n: 2.8 },
    { z: -2.35, hw: 0.07, top: 0.47, bot: 0.26, n: 2.4 },
  ], 28);
  parts.paint.push(prep(projUV(cover.body)), prep(projUV(cover.capBack)));
  parts.black.push(prep(cover.capFront));

  // sidepods
  const pod = loft([
    { z: 0.62, cx: 0.6, hw: 0.17, top: 0.55, bot: 0.16, n: 3.2 },
    { z: 0.45, cx: 0.61, hw: 0.2, top: 0.57, bot: 0.1, n: 3.4 },
    { z: 0.0, cx: 0.6, hw: 0.21, top: 0.56, bot: 0.07, n: 3.4 },
    { z: -0.6, cx: 0.55, hw: 0.2, top: 0.5, bot: 0.06, n: 3.2 },
    { z: -1.2, cx: 0.42, hw: 0.14, top: 0.38, bot: 0.06, n: 3 },
    { z: -1.75, cx: 0.27, hw: 0.08, top: 0.3, bot: 0.08, n: 2.6 },
  ], 28);
  both('paint', pod.body, projUV);
  both('black', pod.capFront);
  both('black', pod.capBack);

  // shark fin
  parts.paint.push(prep(projUV(plate([[-0.75, 0.95], [-2.3, 0.94], [-2.38, 0.62], [-1.6, 0.66], [-0.75, 0.9]], 0.012, -0.006))));

  // cockpit opening & rim
  const hole = new THREE.CircleGeometry(1, 28); hole.rotateX(-Math.PI / 2); hole.scale(0.25, 1, 0.48); hole.translate(0, 0.625, 0.05);
  parts.black.push(prep(hole));
  const rim = new THREE.TorusGeometry(1, 0.035, 8, 32); rim.rotateX(Math.PI / 2); rim.scale(0.27, 1, 0.5); rim.translate(0, 0.63, 0.05);
  parts.black.push(prep(rim));

  // halo
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.33, 0.6, -0.3), new THREE.Vector3(0.32, 0.8, -0.18), new THREE.Vector3(0.27, 0.86, 0.12),
    new THREE.Vector3(0.12, 0.88, 0.36), new THREE.Vector3(0, 0.885, 0.41), new THREE.Vector3(-0.12, 0.88, 0.36),
    new THREE.Vector3(-0.27, 0.86, 0.12), new THREE.Vector3(-0.32, 0.8, -0.18), new THREE.Vector3(-0.33, 0.6, -0.3),
  ]);
  const haloG = new THREE.TubeGeometry(haloCurve, 40, 0.032, 10, false);
  parts.halo.push(prep(haloG));
  parts.halo.push(prep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.88, 0.4), new THREE.Vector3(0, 0.8, 0.6), new THREE.Vector3(0, 0.63, 0.78)]), 10, 0.03, 8, false)));

  // floor
  const floorShape = new THREE.Shape([
    [0.35, 1.05], [0.62, 0.95], [0.82, 0.55], [0.84, -1.3], [0.68, -1.6], [0.6, -1.95], [0.5, -2.05], [-0.5, -2.05], [-0.6, -1.95], [-0.68, -1.6], [-0.84, -1.3], [-0.82, 0.55], [-0.62, 0.95], [-0.35, 1.05],
  ].map(([x, z]) => new THREE.Vector2(x, -z)));
  const floor = new THREE.ExtrudeGeometry(floorShape, { depth: 0.025, bevelEnabled: false });
  floor.rotateX(-Math.PI / 2); floor.translate(0, 0.03, 0);
  parts.carbon.push(prep(carbonUV(floor)));
  // diffuser
  parts.carbon.push(prep(carbonUV(box(1.0, 0.015, 0.7, 0, 0.17, -2.33, -0.42))));
  for (const x of [-0.3, 0, 0.3]) parts.carbon.push(prep(carbonUV(box(0.012, 0.28, 0.6, x, 0.18, -2.33))));
  for (const s of [1, -1]) parts.carbon.push(prep(carbonUV(box(0.015, 0.3, 0.62, s * 0.5, 0.18, -2.33))));

  // bargeboards & turning vanes
  const bb = plate([[1.05, 0.06], [0.55, 0.06], [0.55, 0.3], [0.8, 0.38], [1.05, 0.3]], 0.012, 0.62);
  both('carbon', carbonUV(bb));
  both('carbon', carbonUV(plate([[0.95, 0.08], [0.7, 0.08], [0.72, 0.27], [0.95, 0.22]], 0.01, 0.72)));
  both('carbon', carbonUV(plate([[1.2, 0.2], [0.95, 0.16], [0.95, 0.32], [1.2, 0.3]], 0.01, 0.3)));
  // sidepod airflow conditioner (2018 "wing" on top of pods)
  both('carbon', carbonUV(plate([[0.75, 0.55], [0.35, 0.58], [0.35, 0.7], [0.7, 0.66]], 0.01, 0.84)));

  // front wing
  const fwStations = (x0, x1, base) => {
    const st = [];
    const nS = 6;
    for (let i = 0; i <= nS; i++) {
      const t = i / nS, x = x0 + (x1 - x0) * t;
      st.push(base(x, t));
    }
    return st;
  };
  const els = [
    { c: 0.32, z: 2.92, y: 0.075, a: 0.06, t: 0.07 },
    { c: 0.17, z: 2.66, y: 0.105, a: 0.42, t: 0.09 },
    { c: 0.14, z: 2.55, y: 0.15, a: 0.68, t: 0.09 },
    { c: 0.12, z: 2.46, y: 0.2, a: 0.9, t: 0.1 },
  ];
  // centre neutral section
  parts.wing.push(prep(airfoilWing([
    { x: -0.26, y: 0.075, z: 2.9, chord: 0.3, aoa: 0.04, t: 0.07 },
    { x: 0.26, y: 0.075, z: 2.9, chord: 0.3, aoa: 0.04, t: 0.07 },
  ])));
  els.forEach((e, ei) => {
    const g = airfoilWing(fwStations(0.25, 0.9, (x, t) => {
      const rise = ei === 0 ? 0 : Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) * 0.05 * ei - (t > 0.8 ? (t - 0.8) * 0.25 * ei : 0);
      return { x, y: e.y + rise, z: e.z - t * 0.05 * ei, chord: e.c * (ei === 0 ? 1 - t * 0.15 : 1 - t * 0.1), aoa: e.a + (ei > 0 ? t * 0.25 : 0), t: e.t };
    }));
    const key = ei === 3 ? 'wingAccent' : 'wing';
    parts[key].push(prep(g));
    parts[key].push(mirrorX(g));
  });
  // endplates + footplates + pylons
  const ep = plate([[2.98, 0.04], [2.2, 0.04], [2.2, 0.26], [2.45, 0.34], [2.8, 0.3], [2.98, 0.2]], 0.014, 0.9);
  both('wingAccent', ep);
  both('wing', box(0.08, 0.012, 0.75, 0.88, 0.045, 2.6));
  both('carbon', carbonUV(plate([[2.7, 0.12], [2.35, 0.13], [2.32, 0.3], [2.62, 0.27]], 0.015, 0.11)));

  // rear wing (static parts)
  const rep = plate([[-2.22, 0.36], [-2.85, 0.36], [-2.86, 1.0], [-2.3, 1.0], [-2.22, 0.8]], 0.016, 0.5);
  both('wing', rep);
  // louvres on endplates
  for (let k = 0; k < 5; k++) both('black', box(0.004, 0.01, 0.18, 0.517, 0.5 + k * 0.05, -2.4));
  parts.wing.push(prep(airfoilWing([
    { x: -0.5, y: 0.8, z: -2.38, chord: 0.33, aoa: 0.12, t: 0.12 },
    { x: 0.5, y: 0.8, z: -2.38, chord: 0.33, aoa: 0.12, t: 0.12 },
  ])));
  // beam wing & monkey seat
  parts.wing.push(prep(airfoilWing([
    { x: -0.42, y: 0.36, z: -2.42, chord: 0.18, aoa: 0.25, t: 0.12 },
    { x: 0.42, y: 0.36, z: -2.42, chord: 0.18, aoa: 0.25, t: 0.12 },
  ])));
  parts.carbon.push(prep(carbonUV(plate([[-2.3, 0.4], [-2.55, 0.4], [-2.62, 0.82], [-2.45, 0.82]], 0.03, 0))));
  // ---- sponsor stickers, positioned like the real 2018 cars ----
  const SP = TEAM_SPONSORS[team.id] || {};
  const decals = new Map();
  const addDecal = (id, g) => { if (!id) return; if (!decals.has(id)) decals.set(id, []); decals.get(id).push(prep(g)); };
  const side = (id, x, y, z, w, h, yaw = 0) => {
    for (const s of [1, -1]) {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(s * Math.PI / 2 + s * yaw);
      g.translate(s * x, y, z);
      addDecal(id, g);
    }
  };
  const noseTopY = z => z > 2.15 ? 0.43 - (z - 2.15) * 0.3 : 0.54 - (z - 1.7) * 0.244;
  const noseHW = z => z > 2.15 ? 0.14 - (z - 2.15) * 0.1 : z > 1.7 ? 0.19 - (z - 1.7) * 0.11 : 0.19 + (1.7 - z) * 0.13;
  const top = (id, z, w, h) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2); g.rotateX(0.27);
    g.translate(0, noseTopY(z) + 0.006, z);
    addDecal(id, g);
  };
  side(SP.sidepod || 'team', 0.826, 0.32, -0.25, 0.8, 0.2, 0.06);
  side(SP.sidepodTop, 0.802, 0.47, 0.2, 0.44, 0.11);
  side(SP.cover, 0.216, 0.71, -1.1, 0.5, 0.125, 0.03);
  side('pirelli', 0.914, 0.19, 2.6, 0.4, 0.1);
  (SP.rearEnd || ['team', null, 'pirelli']).forEach((id, k) => side(id, 0.512, [0.89, 0.73, 0.53][k], -2.54, 0.5, 0.115));
  if (SP.noseTop) top(SP.noseTop, 1.55, 0.3, 0.075);
  (SP.nose || []).forEach((id, k) => {
    const z = 2.1 + k * 0.1;
    const w = noseHW(z) * 1.45;
    top(id, z, w, w / 4);
  });
  if (!SP.flap) SP.flap = 'team';

  // suspension (front + rear wishbones, push/pull rods)
  const fz = FRONT_AXLE, rz = REAR_AXLE;
  const susp = [
    [[0.17, 0.42, fz + 0.15], [0.74, 0.42, fz]], [[0.17, 0.4, fz - 0.25], [0.74, 0.42, fz]],
    [[0.15, 0.25, fz + 0.2], [0.74, 0.22, fz]], [[0.15, 0.25, fz - 0.3], [0.74, 0.22, fz]],
    [[0.19, 0.5, fz - 0.1], [0.72, 0.2, fz + 0.02]], [[0.15, 0.33, fz + 0.05], [0.72, 0.3, fz + 0.12]],
    [[0.2, 0.4, rz + 0.3], [0.68, 0.42, rz]], [[0.12, 0.42, rz - 0.25], [0.68, 0.42, rz]],
    [[0.18, 0.2, rz + 0.35], [0.68, 0.2, rz]], [[0.12, 0.22, rz - 0.3], [0.68, 0.2, rz]],
    [[0.15, 0.24, rz - 0.15], [0.66, 0.4, rz - 0.05]],
  ];
  for (const [a, b] of susp) both('carbon', carbonUV(rod(a, b, 0.016)));
  // brake ducts / uprights
  both('carbon', carbonUV(box(0.08, 0.28, 0.3, 0.7, WHEEL_R, fz)));
  both('carbon', carbonUV(box(0.1, 0.3, 0.34, 0.6, WHEEL_R, rz)));

  // mirrors
  for (const s of [1, -1]) {
    const m = loft([
      { z: 0.52, cx: s * 0.5, hw: 0.08, top: 0.72, bot: 0.66, n: 3 },
      { z: 0.44, cx: s * 0.5, hw: 0.085, top: 0.73, bot: 0.65, n: 3 },
    ], 12);
    parts.paint.push(prep(projUV(m.body)), prep(projUV(m.capFront)));
    parts.metal.push(prep(m.capBack));
    parts.carbon.push(prep(carbonUV(rod([s * 0.3, 0.58, 0.55], [s * 0.48, 0.68, 0.49], 0.01))));
  }
  // exhaust + wastegate
  const ex = new THREE.CylinderGeometry(0.055, 0.06, 0.25, 14, 1, true); ex.rotateX(Math.PI / 2); ex.translate(0, 0.47, -2.5);
  parts.metal.push(prep(ex));
  // cockpit padding (headrest wings + rear pad) and steering column bulkhead
  for (const s of [1, -1]) parts.black.push(prep(box(0.07, 0.07, 0.36, s * 0.2, 0.655, -0.14, 0, s * 0.08)));
  parts.black.push(prep(box(0.36, 0.08, 0.08, 0, 0.66, -0.36)));
  parts.carbon.push(prep(carbonUV(box(0.2, 0.06, 0.08, 0, 0.62, 0.5))));
  // camera pods on nose
  both('black', box(0.04, 0.04, 0.12, 0.13, 0.52, 1.75));

  const merged = {};
  for (const k of Object.keys(parts)) if (parts[k].length) merged[k] = mergeGeometries(parts[k], false);

  // DRS flap (separate group)
  const flapG = airfoilWing([
    { x: -0.5, y: 0, z: 0, chord: 0.23, aoa: 0.0, t: 0.12 },
    { x: 0.5, y: 0, z: 0, chord: 0.23, aoa: 0.0, t: 0.12 },
  ]);
  const flapLogo = new THREE.PlaneGeometry(0.85, 0.18);
  flapLogo.rotateX(-Math.PI / 2); flapLogo.rotateY(Math.PI);
  flapLogo.translate(0, 0.016, -0.12);

  // wheels
  const tyreGeo = (w) => {
    const hw = w / 2, pts = [
      [0.2, -hw], [0.28, -hw], [0.315, -hw * 0.93], [0.329, -hw * 0.78], [0.332, -hw * 0.4], [0.332, hw * 0.4], [0.329, hw * 0.78], [0.315, hw * 0.93], [0.28, hw], [0.2, hw],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 48);
    g.rotateZ(Math.PI / 2);
    return g;
  };
  const discGeo = (w) => {
    const a = new THREE.CircleGeometry(0.322, 40); a.rotateY(Math.PI / 2); a.translate(w / 2 + 0.002, 0, 0);
    const b = new THREE.CircleGeometry(0.322, 40); b.rotateY(-Math.PI / 2); b.translate(-w / 2 - 0.002, 0, 0);
    return mergeGeometries([prep(a), prep(b)]);
  };
  const decalMeshes = [...decals.entries()].map(([id, geos]) => ({ geo: mergeGeometries(geos), mat: id === 'team' ? logoMat : sponsorMat(id) }));
  const tpl = {
    team, merged, paint, wing, wingAccent, halo, logoMat, flapG, flapLogo, decalMeshes,
    flapMat: SP.flap === 'team' ? logoMat : sponsorMat(SP.flap),
    mats: { paint, carbon: M.carbon, wing, wingAccent, black: M.black, halo, metal: M.metal, logo: logoMat, screen: M.screen },
    tyreF: tyreGeo(FW.w), tyreR: tyreGeo(RW.w), discF: discGeo(FW.w), discR: discGeo(RW.w),
    suitMat: new THREE.MeshStandardMaterial({ color: L.dark === '#141414' || L.dark === '#1A1A1A' ? L.base : L.dark, roughness: 0.85 }),
    gloveMat: new THREE.MeshStandardMaterial({ color: L.base, roughness: 0.8 }),
  };
  templates.set(team.id, tpl);
  return tpl;
}

const wallMats = {};
function wallMat(compound, blur) {
  const k = compound + blur;
  if (!wallMats[k]) wallMats[k] = new THREE.MeshStandardMaterial({ map: TX.tyreWall(compound, blur), roughness: 0.6, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 });
  return wallMats[k];
}

function makeWheel(tpl, front, compound) {
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(front ? tpl.tyreF : tpl.tyreR, sharedMats().tyre);
  tyre.castShadow = true; tyre.receiveShadow = true;
  spin.add(tyre);
  const disc = new THREE.Mesh(front ? tpl.discF : tpl.discR, wallMat(compound, false));
  spin.add(disc);
  const steer = new THREE.Group();
  steer.add(spin);
  return { steer, spin, disc, compound };
}

// ---------- F1 steering wheel ----------
let swGeo = null;
function steeringGeometry() {
  if (swGeo) return swGeo;
  const outline = [[-0.1, 0.058], [0.1, 0.058], [0.118, 0.045], [0.118, -0.035], [0.085, -0.062], [-0.085, -0.062], [-0.118, -0.035], [-0.118, 0.045]];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
  body.translate(0, 0, -0.011);
  const grip = new THREE.CapsuleGeometry(0.023, 0.085, 4, 12);
  const btn = new THREE.CylinderGeometry(0.0072, 0.0072, 0.006, 14); btn.rotateX(Math.PI / 2);
  const knob = new THREE.CylinderGeometry(0.0095, 0.0105, 0.013, 16); knob.rotateX(Math.PI / 2);
  const marker = new THREE.BoxGeometry(0.002, 0.007, 0.002);
  const hub = new THREE.CylinderGeometry(0.028, 0.032, 0.05, 16); hub.rotateX(Math.PI / 2);
  const column = new THREE.CylinderGeometry(0.014, 0.016, 0.22, 10); column.rotateX(Math.PI / 2);
  const paddle = new THREE.BoxGeometry(0.075, 0.034, 0.004); paddle.translate(0.0375, 0, 0);
  const display = new THREE.PlaneGeometry(0.15, 0.072); display.rotateY(Math.PI);
  const glove = new THREE.SphereGeometry(0.03, 14, 10); glove.scale(1.05, 1.5, 1.15);
  const arm = new THREE.CapsuleGeometry(0.032, 0.2, 4, 10);
  swGeo = { body, grip, btn, knob, marker, hub, column, paddle, display, glove, arm };
  return swGeo;
}

const BTN_COLORS = ['#e10600', '#ffd200', '#1e8cff', '#00d26a', '#ff8c00', '#ffffff'];
const btnMats = {};
function btnMat(col) {
  if (!btnMats[col]) btnMats[col] = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.15, roughness: 0.35 });
  return btnMats[col];
}
let staticDash = null;
function makeDashCanvas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 246;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, ctx: c.getContext('2d'), t };
}
// draws LEDs + display. info: {rpm, gear, speed, ers, drs, drsAvail, ersOn, delta, lap, pos, bias}
function drawDash(d, info) {
  const { ctx, c } = d, W = c.width, H = c.height;
  ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, W, H);
  const lit = Math.round(Math.max(0, Math.min(1, (info.rpm - 0.72) / 0.25)) * 15);
  const flash = info.rpm > 0.975 && Math.floor(performance.now() / 70) % 2 === 0;
  for (let k = 0; k < 15; k++) {
    const x = 26 + k * 32.5, y = 22;
    let col = '#1b1b20';
    if (flash) col = '#3a6bff';
    else if (k < lit) col = k < 5 ? '#00e05a' : k < 10 ? '#ff2020' : '#3a6bff';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
  }
  // screen
  ctx.fillStyle = '#0d1016'; ctx.fillRect(14, 44, W - 28, H - 56);
  ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 3; ctx.strokeRect(14, 44, W - 28, H - 56);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = 'bold 128px "Titillium Web", Arial, sans-serif';
  ctx.fillText(info.gear, W / 2, 132);
  ctx.textAlign = 'left'; ctx.font = 'bold 52px "Titillium Web", Arial, sans-serif';
  ctx.fillText(String(info.speed), 30, 100);
  ctx.font = '600 20px "Titillium Web", Arial, sans-serif'; ctx.fillStyle = '#8a93a6';
  ctx.fillText('KPH', 30, 138);
  ctx.fillText('P' + info.pos + '  L' + info.lap, 30, 168);
  ctx.textAlign = 'right';
  ctx.fillText('DELTA', W - 30, 72);
  ctx.font = 'bold 40px "Titillium Web", Arial, sans-serif';
  ctx.fillStyle = info.delta == null ? '#8a93a6' : info.delta < 0 ? '#00e05a' : '#ff3b3b';
  ctx.fillText(info.delta == null ? '--' : (info.delta < 0 ? '-' : '+') + Math.abs(info.delta).toFixed(2), W - 30, 106);
  ctx.font = '600 20px "Titillium Web", Arial, sans-serif'; ctx.fillStyle = '#8a93a6';
  ctx.fillText('BBAL ' + info.bias + '%', W - 30, 140);
  // ERS bar + DRS
  ctx.fillStyle = '#222'; ctx.fillRect(30, 196, 300, 18);
  ctx.fillStyle = info.ersOn ? '#3ad1ff' : '#ffd200'; ctx.fillRect(30, 196, 300 * info.ers, 18);
  ctx.fillStyle = '#8a93a6'; ctx.textAlign = 'left'; ctx.font = '600 16px "Titillium Web", Arial, sans-serif';
  ctx.fillText(info.ersOn ? 'ERS OVERTAKE' : 'ERS', 338, 205);
  ctx.fillStyle = info.drs ? '#00e05a' : '#0d1016'; ctx.strokeStyle = info.drsAvail || info.drs ? '#00e05a' : '#333';
  ctx.fillRect(W - 110, 190, 80, 30); ctx.lineWidth = 3; ctx.strokeRect(W - 110, 190, 80, 30);
  ctx.fillStyle = info.drs ? '#000' : info.drsAvail ? '#00e05a' : '#444'; ctx.textAlign = 'center'; ctx.font = 'bold 22px "Titillium Web", Arial, sans-serif';
  ctx.fillText('DRS', W - 70, 206);
  d.t.needsUpdate = true;
}

function buildSteeringWheel(tpl, driverIndex, detailedHands = false) {
  const G = steeringGeometry(), M = sharedMats();
  const assembly = new THREE.Group();
  assembly.position.set(0, 0.675, 0.36);
  assembly.rotation.x = 0.3;
  const column = new THREE.Mesh(G.column, M.carbon); column.position.z = 0.14; assembly.add(column);
  const spin = new THREE.Group(); assembly.add(spin);
  spin.add(new THREE.Mesh(G.body, M.carbon));
  const hub = new THREE.Mesh(G.hub, M.metal); hub.position.z = 0.03; spin.add(hub);
  for (const s of [1, -1]) {
    const g = new THREE.Mesh(G.grip, M.rubber || (M.rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 })));
    g.position.set(s * 0.128, -0.004, 0.004); g.rotation.z = -s * 0.2; spin.add(g);
  }
  const dash = driverIndex === 'player' ? makeDashCanvas() : null;
  if (!dash && !staticDash) {
    staticDash = makeDashCanvas();
    drawDash(staticDash, { rpm: 0.85, gear: '6', speed: 247, ers: 0.7, drs: false, drsAvail: false, ersOn: false, delta: -0.12, lap: 3, pos: 5, bias: 57 });
  }
  const dispMat = new THREE.MeshBasicMaterial({ map: (dash || staticDash).t, toneMapped: false });
  const display = new THREE.Mesh(G.display, dispMat); display.position.set(0, 0.012, -0.0162); spin.add(display);
  const btns = {};
  const layout = [[-0.088, 0.03, 0], [-0.094, 0.0, 4], [-0.088, -0.03, 2], [0.088, 0.03, 3], [0.094, 0.0, 1], [0.088, -0.03, 5]];
  for (const [x, y, ci] of layout) {
    const col = BTN_COLORS[ci];
    const mat = ci === 3 || ci === 4 ? btnMat(col).clone() : btnMat(col);
    const b = new THREE.Mesh(G.btn, mat); b.position.set(x, y, -0.0165); spin.add(b);
    if (ci === 3) btns.drs = mat;
    if (ci === 4) btns.ers = mat;
  }
  for (let k = 0; k < 4; k++) {
    const kn = new THREE.Mesh(G.knob, M.metal); kn.position.set(-0.045 + k * 0.03, -0.044, -0.017); kn.rotation.z = k * 0.7; spin.add(kn);
    const mk = new THREE.Mesh(G.marker, btnMat('#ffffff')); mk.position.set(0, 0.006, -0.0075); kn.add(mk);
  }
  const paddles = [];
  for (const s of [1, -1]) {
    const pv = new THREE.Group(); pv.position.set(s * 0.06, 0.005, 0.022);
    const p = new THREE.Mesh(G.paddle, M.carbon); p.scale.x = s; pv.add(p);
    spin.add(pv); paddles.push(pv);
  }
  // driver's hands
  const hands = [];
  for (const s of [1, -1]) {
    const frame = new THREE.Group();
    frame.position.set(s * 0.128, -0.004, 0.004);
    frame.rotation.z = -s * 0.2;
    spin.add(frame);
    if (!detailedHands) {
      const gl = new THREE.Mesh(G.glove, tpl.gloveMat); gl.position.set(s * 0.004, 0, -0.01); frame.add(gl);
      hands.push({ s, frame, simple: true });
      continue;
    }
    hands.push(buildHand(s, frame, tpl));
  }
  return { assembly, spin, paddles, btns, dash, display, hands };
}

// Gloved hand: four curled fingers wrapped around the grip, palm on the outside, thumb on the wheel face.
let handGeo = null;
function buildHand(s, frame, tpl) {
  if (!handGeo) {
    const finger = new THREE.TorusGeometry(0.0318, 0.0102, 8, 16, 4.0);
    finger.rotateX(Math.PI / 2); // wrap around the vertical grip axis
    const tip = new THREE.SphereGeometry(0.0104, 8, 6);
    handGeo = {
      finger, tip,
      palm: (() => { const g = new THREE.CapsuleGeometry(0.03, 0.04, 4, 12); g.scale(0.62, 1, 1.15); return g; })(),
      back: (() => { const g = new THREE.BoxGeometry(0.012, 0.05, 0.05); return g; })(),
      cuff: (() => { const g = new THREE.CylinderGeometry(0.035, 0.032, 0.07, 14); g.rotateX(Math.PI / 2 - 0.55); return g; })(),
      thumb: (() => { const g = new THREE.CapsuleGeometry(0.0105, 0.034, 4, 8); g.rotateZ(Math.PI / 2); g.translate(-0.022, 0, 0); return g; })(),
    };
  }
  const glove = tpl.gloveMat2 || (tpl.gloveMat2 = new THREE.MeshStandardMaterial({ color: 0x1e1f24, roughness: 0.85, side: THREE.DoubleSide }));
  const accent = tpl.gloveAccent || (tpl.gloveAccent = new THREE.MeshStandardMaterial({ color: tpl.team.color === '#FFFFFF' ? '#0A2E6E' : tpl.team.color, roughness: 0.7 }));
  const palm = new THREE.Mesh(handGeo.palm, glove); palm.position.set(s * 0.036, 0, -0.002); frame.add(palm);
  const strap = new THREE.Mesh(handGeo.back, accent); strap.position.set(s * 0.054, -0.012, -0.004); frame.add(strap);
  const cuff = new THREE.Mesh(handGeo.cuff, accent); cuff.position.set(s * 0.042, -0.04, -0.05); frame.add(cuff);
  const wrist = new THREE.Object3D(); wrist.position.set(s * 0.03, -0.06, -0.075); frame.add(wrist);
  const fingers = [];
  [0.026, 0.006, -0.014, -0.032].forEach((y, fi) => {
    const f = new THREE.Group();
    f.position.set(0, y, 0.002);
    if (s < 0) f.scale.x = -1; // mirror for the right hand
    const ring = new THREE.Mesh(handGeo.finger, glove);
    f.add(ring);
    const t = new THREE.Mesh(handGeo.tip, glove);
    t.position.set(Math.cos(4.0) * 0.0318, 0, Math.sin(4.0) * 0.0318);
    f.add(t);
    if (fi === 3) f.scale.multiplyScalar(0.92);
    frame.add(f);
    fingers.push(f);
  });
  const thumb = new THREE.Group(); thumb.position.set(s * 0.018, 0.024, -0.03); frame.add(thumb);
  const tm = new THREE.Mesh(handGeo.thumb, glove); if (s < 0) tm.scale.x = -1; thumb.add(tm);
  const hand = { s, frame, fingers, thumb, wrist };
  poseHand(hand, 0, 0, 0, 0);
  return hand;
}

// grip: squeeze 0..1, pull: index-finger paddle pull 0..1, press: thumb button press 0..1
function poseHand(h, grip, pull, press, jitter) {
  if (h.simple) return;
  const s = h.s;
  h.fingers.forEach((f, fi) => {
    const idx = fi === 0;
    f.rotation.y = s * (0.15 - grip * 0.08 + (idx ? 0.25 - pull * 0.55 : 0));
    f.position.z = 0.002 - (idx ? pull * 0.008 : 0);
  });
  h.thumb.rotation.z = s * (0.35 - press * 0.15);
  h.thumb.rotation.y = s * (-0.2 + press * 0.35);
  h.thumb.position.z = -0.03 + press * 0.005;
  h.frame.position.y = -0.004 + jitter * (Math.random() - 0.5) * 0.004;
}

// two-bone IK arm (upper arm + forearm) from a fixed shoulder to the moving wrist
function buildArms(tpl, body) {
  const upper = new THREE.CapsuleGeometry(0.036, 0.24, 4, 10);
  const fore = new THREE.CapsuleGeometry(0.029, 0.23, 4, 10);
  const arms = [];
  for (const s of [1, -1]) {
    const u = new THREE.Mesh(upper, tpl.suitMat), f = new THREE.Mesh(fore, tpl.suitMat);
    u.castShadow = f.castShadow = true;
    body.add(u, f);
    arms.push({ s, u, f, shoulder: new THREE.Vector3(s * 0.175, 0.56, -0.2), a: 0.29, b: 0.285 });
  }
  return arms;
}
const _w = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Vector3();
function placeBone(mesh, a, b) {
  _m.subVectors(b, a);
  const len = _m.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, _m.normalize());
  const P = mesh.geometry.parameters;
  mesh.scale.set(1, (len + P.radius * 1.2) / (P.length + P.radius * 2), 1);
}
function solveArm(arm, wristWorld, body) {
  _w.copy(wristWorld); body.worldToLocal(_w);
  const S = arm.shoulder, { a, b } = arm;
  _d.subVectors(_w, S);
  const dist = Math.min(Math.max(_d.length(), Math.abs(a - b) + 0.01), a + b - 0.001);
  _d.normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.set(arm.s * 0.3, -0.85, -0.42).normalize();
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  _e.copy(S).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA);
  _v.copy(S).addScaledVector(_d, dist);
  placeBone(arm.u, S, _e);
  placeBone(arm.f, _e, _v);
}

export function compoundColor(name) { return COMPOUNDS[name] || COMPOUNDS.soft; }

// Build a full car for a driver. Returns { group, update(state), ... }.
export function buildCar(team, driverIndex = 0, { compound = 'soft', ghost = false, player = false, hands = false } = {}) {
  const tpl = buildTemplate(team);
  const driver = team.drivers[driverIndex];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const detail = new THREE.Group(); // small parts hidden at distance
  body.add(detail);
  for (const [k, geo] of Object.entries(tpl.merged)) {
    const m = new THREE.Mesh(geo, tpl.mats[k]);
    m.castShadow = k !== 'logo' && k !== 'screen';
    m.receiveShadow = true;
    (k === 'logo' ? detail : body).add(m);
  }
  // DRS flap
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, 0.905, -2.5);
  const flap = new THREE.Mesh(tpl.flapG, tpl.wing);
  flap.castShadow = true;
  flap.rotation.x = 0.62;
  flapPivot.add(flap);
  const flapLogo = new THREE.Mesh(tpl.flapLogo, tpl.flapMat);
  flap.add(flapLogo);
  body.add(flapPivot);
  for (const d of tpl.decalMeshes) detail.add(new THREE.Mesh(d.geo, d.mat));

  // numbers
  const numTex = TX.textDecal(String(driver.num), { color: team.livery.textOn === 'dark' ? '#ffffff' : team.livery.text, w: 256, h: 256, italic: true });
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4 });
  const nose = new THREE.PlaneGeometry(0.2, 0.2);
  nose.rotateX(-Math.PI / 2); nose.rotateX(0.26); nose.translate(0, 0.49, 1.95);
  const fins = [];
  for (const s of [1, -1]) {
    const g = new THREE.PlaneGeometry(0.26, 0.26); g.rotateY(s * Math.PI / 2); g.translate(s * 0.008, 0.8, -1.95); fins.push(prep(g));
  }
  const numMesh = new THREE.Mesh(mergeGeometries([prep(nose), ...fins]), numMat);
  detail.add(numMesh);

  // driver helmet
  const helmetMat = new THREE.MeshPhysicalMaterial({ map: TX.helmet(driver.helmet[0], driver.helmet[1]), roughness: 0.2, clearcoat: 1 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 16), helmetMat);
  helmet.scale.set(1, 1.05, 1.15);
  helmet.position.set(0, 0.73, -0.04);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.128, 20, 8, Math.PI / 2 - 0.85, 1.7, 1.2, 0.48), sharedMats().visor);
  visor.position.copy(helmet.position); visor.scale.copy(helmet.scale);
  helmet.add(visor); visor.position.set(0, 0, 0); visor.scale.set(1, 1, 1);
  body.add(helmet);
  // T-cam: black for car 1, yellow for car 2
  const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.09), driverIndex === 0 ? sharedMats().tcamBlack : sharedMats().tcamYellow);
  tcam.position.set(0, 1.03, -0.36);
  detail.add(tcam);
  // rain light
  const rainMat = sharedMats().rain.clone();
  const rain = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.03), rainMat);
  rain.position.set(0, 0.3, -2.62);
  body.add(rain);

  // steering wheel (live dash for the player's car)
  const detailed = (player || hands) && !ghost;
  const sw = buildSteeringWheel(tpl, player ? 'player' : driverIndex, detailed);
  detail.add(sw.assembly);
  const arms = detailed ? buildArms(tpl, detail) : null;

  // rear-view mirror glass (driver-facing)
  const mirrors = [];
  const mirrorDefault = sharedMats().mirror || (sharedMats().mirror = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 1, roughness: 0.08 }));
  for (const s of [1, -1]) {
    const g = new THREE.PlaneGeometry(0.15, 0.056);
    g.rotateY(Math.PI);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setX(i, s === 1 ? 1 - 0.5 * u : 0.5 - 0.5 * u);
    }
    g.translate(s * 0.5, 0.69, 0.436);
    const m = new THREE.Mesh(g, mirrorDefault);
    detail.add(m); mirrors.push(m);
  }

  // wheels
  const wheels = [];
  const wpos = [[FW.x, FRONT_AXLE, true], [-FW.x, FRONT_AXLE, true], [RW.x, REAR_AXLE, false], [-RW.x, REAR_AXLE, false]];
  for (const [x, z, front] of wpos) {
    const w = makeWheel(tpl, front, compoundColor(compound));
    w.steer.position.set(x, WHEEL_R, z);
    group.add(w.steer);
    wheels.push({ ...w, front });
  }

  if (ghost) {
    group.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true; o.material.opacity = 0.28; o.material.depthWrite = false;
        o.castShadow = false;
      }
    });
  }

  let blurred = false, wheelAngle = 0, rainT = 0, detailOn = true;
  const paddleT = [0, 0];
  let drsPressT = 0, lastDrs = false;
  const tmpW = new THREE.Vector3();
  let compoundNow = compound;
  const api = {
    group, body, wheels, helmet, flapPivot, driver, team, mirrors, steering: sw,
    setDRS(open) { flap.rotation.x += ((open ? 0.05 : 0.62) - flap.rotation.x) * 0.35; },
    setDetail(on) {
      if (on === detailOn) return;
      detailOn = on; detail.visible = on;
      for (const w of wheels) w.disc.visible = on;
    },
    paddle(up) { paddleT[up ? 1 : 0] = 0.14; },
    drawDash(info) { if (sw.dash) drawDash(sw.dash, info); },
    update(dt, s) {
      wheelAngle += (s.speed / WHEEL_R) * dt;
      for (const w of wheels) {
        w.spin.rotation.x = wheelAngle * (s.locked && w.front ? 0 : 1);
        if (w.front) w.steer.rotation.y = s.steer;
      }
      const wantBlur = Math.abs(s.speed) > 22;
      if (wantBlur !== blurred && !ghost) {
        blurred = wantBlur;
        for (const w of wheels) w.disc.material = wallMat(compoundColor(compoundNow), blurred);
      }
      body.rotation.x = s.pitch || 0;
      body.rotation.z = s.roll || 0;
      body.position.y = s.heave || 0;
      api.setDRS(s.drs);
      rainT += dt;
      rainMat.emissiveIntensity = s.rainBlink ? (Math.sin(rainT * 25) > 0 ? 6 : 0.2) : 0.2;
      if (detailOn) {
        // steering wheel turns with the front wheels; paddles flick on shifts
        sw.spin.rotation.z = -(s.wheel !== undefined ? s.wheel : Math.max(-1.9, Math.min(1.9, s.steer * 5.5)));
        for (let k = 0; k < 2; k++) {
          paddleT[k] = Math.max(0, paddleT[k] - dt);
          const side = k === 1 ? -1 : 1; // upshift = right paddle (driver's right is -x)
          sw.paddles[k].rotation.y = side * (paddleT[k] > 0 ? 0.35 : 0);
        }
        if (sw.btns.drs) sw.btns.drs.emissiveIntensity = s.drs ? 3 : 0.15;
        if (sw.btns.ers) sw.btns.ers.emissiveIntensity = s.ers ? 3 : 0.15;
        if (detailed) {
          if (s.drs !== lastDrs) { drsPressT = 0.22; lastDrs = s.drs; }
          drsPressT = Math.max(0, drsPressT - dt);
          const grip = Math.min(1, (s.brake || 0) * 0.8 + Math.abs(s.wheel || 0) * 0.2);
          const bump = s.bump || 0;
          for (const h of sw.hands) {
            const left = h.s === 1;
            const pull = Math.min(1, paddleT[left ? 0 : 1] / 0.07);
            const press = left ? Math.min(1, drsPressT / 0.1) : (s.ers ? 1 : 0);
            poseHand(h, grip, pull, press, bump);
          }
          if (bump > 0.3) sw.spin.rotation.z += (Math.random() - 0.5) * 0.03 * bump;
          group.updateMatrixWorld(true);
          for (const a of arms) {
            const h = sw.hands.find(x => x.s === a.s);
            solveArm(a, h.wrist.getWorldPosition(tmpW), detail);
          }
        }
      }
    },
    setCompound(c) { compoundNow = c; for (const w of wheels) w.disc.material = wallMat(compoundColor(c), blurred); },
    dispose() { numTex.dispose(); numMat.dispose(); helmetMat.dispose(); },
  };
  return api;
}
