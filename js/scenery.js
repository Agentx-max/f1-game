import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { KERB_W } from './track.js';

// ---------- noise for terrain ----------
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, z, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// generic strip along the track. colFn(i, c) -> [d, dy, u]
function strip(track, ncols, colFn, { vScale = 1 / 8, include = null, swapUV = false, flipU = false, colors = null } = {}) {
  const N = track.n;
  const pos = [], uv = [], col = [], idx = [];
  for (let r = 0; r <= N; r++) {
    const i = r % N;
    const s = r * track.ds;
    for (let c = 0; c < ncols; c++) {
      const [d, dy, u] = colFn(i, c);
      pos.push(track.px[i] + track.nx[i] * d, track.py[i] + dy, track.pz[i] + track.nz[i] * d);
      const v = s * vScale * (flipU ? -1 : 1);
      if (swapUV) uv.push(v, u); else uv.push(u, v);
      if (colors) { const k = colors(i, c, d); col.push(k[0], k[1], k[2]); }
    }
  }
  for (let r = 0; r < N; r++) {
    const i = r % N, j = (r + 1) % N;
    if (include && !(include(i) && include(j))) continue;
    for (let c = 0; c < ncols - 1; c++) {
      const a = r * ncols + c, b = a + 1, cc = a + ncols, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fixUp(g) {
  // make sure horizontal strips face upwards
  const n = g.attributes.normal;
  let sum = 0;
  for (let i = 0; i < Math.min(n.count, 200); i++) sum += n.getY(i);
  if (sum < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

export function buildScenery(track, quality, sunDir) {
  const group = new THREE.Group();
  const meta = track.meta, N = track.n, hw = track.hw;
  const street = track.style === 'street';
  const high = quality === 'high', low = quality === 'low';

  // ---------- road ----------
  const as = TX.asphalt(0.16 / meta.width, high ? 1024 : 512);
  const roadCols = 13;
  const roadGeo = fixUp(strip(track, roadCols, (i, c) => {
    const d = -hw + (2 * hw) * (c / (roadCols - 1));
    return [d, 0, 1 - c / (roadCols - 1)];
  }, {
    vScale: 1 / 14,
    colors: (i, c, d) => {
      const rl = track.rlOffset[i];
      const k = 1 - 0.32 * Math.exp(-(((d - rl) / 1.6) ** 2)) - 0.08 * Math.exp(-((d / hw) ** 2) * 3);
      return [k, k, k];
    },
  }));
  const roadMat = new THREE.MeshStandardMaterial({ map: as.map, normalMap: as.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: as.rough, roughness: 0.95, metalness: 0.0, vertexColors: true });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);

  // ---------- kerbs ----------
  const kerbProfile = [[-0.03, 0.012], [0.35, 0.055], [KERB_W - 0.2, 0.05], [KERB_W, 0.015]];
  const kerbMat = new THREE.MeshStandardMaterial({ map: TX.kerb(), roughness: 0.55 });
  for (const side of [1, -1]) {
    const arr = side === 1 ? track.kerbL : track.kerbR;
    const g = fixUp(strip(track, kerbProfile.length, (i, c) => {
      const [e, dy] = kerbProfile[c];
      return [side * (hw + e), dy, c / (kerbProfile.length - 1)];
    }, { vScale: 1 / 2.2, include: i => arr[i] === 1 }));
    const m = new THREE.Mesh(g, kerbMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------- verges ----------
  const runoffMat = new THREE.MeshStandardMaterial({ map: street ? TX.pavement() : TX.runoffAsphalt(), roughness: 0.95, color: street ? 0xbfbfbf : 0xffffff });
  const grassMat = new THREE.MeshStandardMaterial({ map: TX.mowedGrass(), roughness: 1 });
  const gravelMat = new THREE.MeshStandardMaterial({ map: TX.gravel(), roughness: 1 });
  for (const side of [1, -1]) {
    const wall = side === 1 ? track.wallL : track.wallR;
    const stripEnd = i => street ? wall[i] : Math.min(wall[i], hw + KERB_W + 2.5);
    const g1 = fixUp(strip(track, 2, (i, c) => {
      const e = c === 0 ? hw - 0.05 : stripEnd(i);
      return [side * e, -0.012, side * e / 6];
    }, { vScale: 1 / 6 }));
    const m1 = new THREE.Mesh(g1, runoffMat); m1.receiveShadow = true; group.add(m1);
    if (!street) {
      const grav = side === 1 ? track.gravelL : track.gravelR;
      for (const [mat, want] of [[grassMat, 0], [gravelMat, 1]]) {
        const g2 = fixUp(strip(track, 3, (i, c) => {
          const a = stripEnd(i), b = wall[i] + 1.5;
          const e = c === 0 ? a - 0.1 : c === 1 ? (a + b) / 2 : b;
          return [side * e, -0.02 - (c === 1 && want ? 0.04 : 0), side * e / 8];
        }, { vScale: 1 / 8, include: i => grav[i] === want }));
        const m2 = new THREE.Mesh(g2, mat); m2.receiveShadow = true; group.add(m2);
      }
    }
  }

  // ---------- pit complex layout (follows the track's curve and elevation) ----------
  const P = track.pit;
  const pitMods = [];
  if (P) {
    const len = Math.max(120, Math.min(320, P.wallEnd - P.wallStart));
    const centre = (P.wallStart + P.wallEnd) / 2;
    const sp = (len - 10) / 20;
    for (let k = 0; k < 20; k++) {
      const s = centre - len / 2 + 5 + sp * (k + 0.5);
      const i = track.indexAtS(s);
      pitMods.push({ k, s, i, sp, w0: P.wall0[i] });
    }
    const s0 = pitMods[0].s - sp * 0.6, s1 = pitMods[19].s + sp * 0.6;
    for (let s = s0; s <= s1; s += track.ds * 0.5) P.hideOuter[track.indexAtS(s)] = 1;
    P.boxes = pitMods.map(m => ({ s: m.s, d: P.side * (m.w0 + 9.5) }));
  }
  const hideWall = (side, i) => (P && side === P.side && P.hideOuter[i] === 1 ? 0 : 1);

  // ---------- barriers ----------
  const wallH = street ? 1.15 : 1.0;
  const adsTex = TX.wallAds(street ? 'street' : 'park');
  const wallMat = new THREE.MeshStandardMaterial({ map: adsTex, roughness: 0.7, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ map: TX.concrete(), color: street ? 0xd8d8d8 : 0x8a8f94, roughness: 0.9, side: THREE.DoubleSide });
  const fenceTex = TX.fence();
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, alphaTest: 0.45, transparent: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 });
  const postGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 6);
  const posts = [];
  for (const side of [1, -1]) {
    const wall = side === 1 ? track.wallL : track.wallR;
    const face = strip(track, 2, (i, c) => [side * wall[i], c * wallH * hideWall(side, i), c], { vScale: 1 / 64, swapUV: true, flipU: side === -1 });
    const m = new THREE.Mesh(face, wallMat); m.castShadow = !low; m.receiveShadow = true; group.add(m);
    const cap = strip(track, 4, (i, c) => {
      const e = wall[i] + (c >= 2 ? 0.45 : 0);
      return [side * e, (c === 0 || c === 3 ? (c === 0 ? wallH : 0) : wallH) * hideWall(side, i), c / 3];
    }, { vScale: 1 / 4 });
    const cm = new THREE.Mesh(cap, capMat); cm.receiveShadow = true; group.add(cm);
    // retaining wall below the barrier: visible wherever the road is raised above the ground
    const skirt = strip(track, 2, (i, c) => [side * (wall[i] + 0.45), c === 0 ? -9 : 0.02, c], { vScale: 1 / 4, swapUV: true });
    const sm = new THREE.Mesh(skirt, capMat); sm.receiveShadow = true; group.add(sm);
    const fenceH = street ? 3.2 : 2.6;
    const fence = strip(track, 2, (i, c) => [side * (wall[i] + 0.3), (wallH + c * fenceH) * hideWall(side, i), c * fenceH / 1.2], { vScale: 1 / 1.2, swapUV: true });
    const fm = new THREE.Mesh(fence, fenceMat); group.add(fm);
    for (let i = 0; i < N; i += Math.round(5 / track.ds)) {
      if (!hideWall(side, i)) continue;
      const e = wall[i] + 0.32;
      posts.push([track.px[i] + track.nx[i] * side * e, track.py[i] + wallH, track.pz[i] + track.nz[i] * side * e, fenceH + 0.3, side]);
    }
  }
  {
    const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x7c8187, metalness: 0.6, roughness: 0.4 }), posts.length);
    const mtx = new THREE.Matrix4();
    posts.forEach(([x, y, z, h], k) => { mtx.makeScale(1, h, 1); mtx.setPosition(x, y + h / 2, z); pm.setMatrixAt(k, mtx); });
    group.add(pm);
  }

  // ---------- pit lane surface + pit wall ----------
  if (P) {
    const side = P.side;
    const wallArr = side === 1 ? track.wallL : track.wallR;
    const laneGeo = fixUp(strip(track, 3, (i, c) => {
      const e = c === 0 ? hw + 0.04 : c === 1 ? P.wall0[i] + 0.5 : wallArr[i] + 0.2;
      return [side * e, -0.004, side * e / 6];
    }, { vScale: 1 / 6, include: i => P.inPit[i] === 1 }));
    const laneMat = new THREE.MeshStandardMaterial({ map: TX.runoffAsphalt(), color: 0x9a9a9a, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 });
    const lane = new THREE.Mesh(laneGeo, laneMat); lane.receiveShadow = true; group.add(lane);
    // white pit-lane boundary + blue speed-limit line
    const lineGeo = (off, w, vInc) => fixUp(strip(track, 2, (i, c) => [side * (P.wall0[i] + off + c * w), 0.004, c], { vScale: 1, include: vInc }));
    group.add(new THREE.Mesh(lineGeo(13.2, 0.18, i => P.wallMask[i] === 1), new THREE.MeshBasicMaterial({ color: 0xe8e8e8 })));
    group.add(new THREE.Mesh(lineGeo(0.6, 0.15, i => P.inPit[i] === 1), new THREE.MeshBasicMaterial({ color: 0xe8e8e8 })));
    // pit wall (solid concrete + debris fence)
    const pw = 1.1, pt = 0.5;
    const inc = i => P.wallMask[i] === 1;
    for (const off of [0, pt]) {
      const f = strip(track, 2, (i, c) => [side * (P.wall0[i] + off), c * pw, c], { vScale: 1 / 64, swapUV: true, flipU: side === -1, include: inc });
      const m = new THREE.Mesh(f, wallMat); m.castShadow = !low; m.receiveShadow = true; group.add(m);
    }
    const pcap = strip(track, 2, (i, c) => [side * (P.wall0[i] + c * pt), pw, c], { vScale: 1 / 4, include: inc });
    group.add(new THREE.Mesh(pcap, capMat));
    const pf = strip(track, 2, (i, c) => [side * (P.wall0[i] + 0.25), pw + c * 2.2, c * 2.2 / 1.2], { vScale: 1 / 1.2, swapUV: true, include: inc });
    group.add(new THREE.Mesh(pf, fenceMat));
  }


  // ---------- terrain ----------
  const bb = track.bbox, margin = street ? 900 : 1400;
  const minx = bb.minx - margin, maxx = bb.maxx + margin, minz = bb.minz - margin, maxz = bb.maxz + margin;
  const RES = high ? 300 : low ? 150 : 220;
  const sx = (maxx - minx) / RES, sz = (maxz - minz) / RES;
  const W1 = RES + 1;
  const H = new Float32Array(W1 * W1);
  const D = new Float32Array(W1 * W1).fill(1e9);
  const NI = new Int32Array(W1 * W1).fill(-1);
  const hills = meta.hills;
  // nearest-centreline field via chamfer propagation
  {
    const dist = (k, i) => { const x = minx + (k % W1) * sx, z = minz + Math.floor(k / W1) * sz; return Math.hypot(track.px[i] - x, track.pz[i] - z); };
    for (let i = 0; i < N; i++) {
      const cx = Math.round((track.px[i] - minx) / sx), cz = Math.round((track.pz[i] - minz) / sz);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const xx = cx + a, zz = cz + b;
        if (xx < 0 || zz < 0 || xx > RES || zz > RES) continue;
        const k = zz * W1 + xx, d = dist(k, i);
        if (d < D[k]) { D[k] = d; NI[k] = i; }
      }
    }
    const relax = (k, kn) => { const i = NI[kn]; if (i < 0) return; const d = dist(k, i); if (d < D[k]) { D[k] = d; NI[k] = i; } };
    for (let pass = 0; pass < 2; pass++) {
      for (let zz = 0; zz <= RES; zz++) for (let xx = 0; xx <= RES; xx++) {
        const k = zz * W1 + xx;
        if (xx > 0) relax(k, k - 1);
        if (zz > 0) { relax(k, k - W1); if (xx > 0) relax(k, k - W1 - 1); if (xx < RES) relax(k, k - W1 + 1); }
      }
      for (let zz = RES; zz >= 0; zz--) for (let xx = RES; xx >= 0; xx--) {
        const k = zz * W1 + xx;
        if (xx < RES) relax(k, k + 1);
        if (zz < RES) { relax(k, k + W1); if (xx < RES) relax(k, k + W1 + 1); if (xx > 0) relax(k, k + W1 - 1); }
      }
    }
  }
  // approximate nearest sample for arbitrary points (grid assisted)
  const nearH = (x, z) => {
    const xi = Math.max(0, Math.min(RES - 1, Math.floor((x - minx) / sx))), zi = Math.max(0, Math.min(RES - 1, Math.floor((z - minz) / sz)));
    let best = Infinity, bi = -1;
    for (const k of [zi * W1 + xi, zi * W1 + xi + 1, (zi + 1) * W1 + xi, (zi + 1) * W1 + xi + 1]) {
      const i = NI[k]; if (i < 0) continue;
      for (let o = -3; o <= 3; o++) {
        const j = (i + o + N) % N;
        const d = (track.px[j] - x) ** 2 + (track.pz[j] - z) ** 2;
        if (d < best) { best = d; bi = j; }
      }
    }
    return bi < 0 ? null : { d: Math.sqrt(best), i: bi };
  };
  const nearExact = (x, z) => {
    let best = Infinity, bi = -1;
    track.near(x, z, 70, i => {
      const d = (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    return bi < 0 ? nearH(x, z) : { d: Math.sqrt(best), i: bi };
  };
  let avgH = 0;
  for (let i = 0; i < N; i++) avgH += track.py[i];
  avgH /= N;
  for (let zi = 0; zi <= RES; zi++) for (let xi = 0; xi <= RES; xi++) {
    const x = minx + xi * sx, z = minz + zi * sz;
    const k = zi * W1 + xi;
    const ni = NI[k], nd = D[k];
    const far = (fbm2(x / 420, z / 420) - 0.45) * hills * 2 + avgH;
    const mountains = smooth(250, 1200, ni >= 0 ? nd : 2000) * hills * 2.2 * fbm2(x / 900 + 7, z / 900 + 3, 4);
    let h = far + mountains;
    if (ni >= 0) {
      const wall = Math.max(track.wallL[ni], track.wallR[ni]);
      const t = smooth(wall + 8, wall + 130, nd);
      h = (track.py[ni] - 0.5) * (1 - t) + h * t;
      if (nd < wall + 8) h = track.py[ni] - 0.5;
    }
    // never let the ground rise above ANY road section nearby (stops the terrain mesh
    // from slicing across lower parts of the circuit on hilly street tracks)
    if (ni >= 0 && nd < 60) {
      let lo = Infinity;
      track.near(x, z, 60, j => {
        const dd = (track.px[j] - x) ** 2 + (track.pz[j] - z) ** 2;
        if (dd < 3600 && track.py[j] < lo) lo = track.py[j];
      });
      if (lo < Infinity) h = Math.min(h, lo - 0.6);
    }
    H[k] = h;
  }
  const heightAt = (x, z) => {
    const fx = (x - minx) / sx, fz = (z - minz) / sz;
    const xi = Math.max(0, Math.min(RES - 1, Math.floor(fx))), zi = Math.max(0, Math.min(RES - 1, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - xi)), tz = Math.min(1, Math.max(0, fz - zi));
    const a = H[zi * (RES + 1) + xi], b = H[zi * (RES + 1) + xi + 1], c = H[(zi + 1) * (RES + 1) + xi], d = H[(zi + 1) * (RES + 1) + xi + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  {
    const g = new THREE.PlaneGeometry(maxx - minx, maxz - minz, RES, RES);
    g.rotateX(-Math.PI / 2);
    g.translate((minx + maxx) / 2, 0, (minz + maxz) / 2);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k);
      const xi = Math.round((x - minx) / sx), zi = Math.round((z - minz) / sz);
      const h = H[zi * (RES + 1) + xi];
      p.setY(k, h);
      uv.setXY(k, x / 18, z / 18);
      const n = fbm2(x / 140, z / 140, 3);
      let r, gg, b;
      if (street) { const v = 0.75 + n * 0.3; r = v; gg = v * 0.98; b = v * 0.94; }
      else {
        const dry = smooth(0.45, 0.75, n);
        r = 0.8 + dry * 0.35; gg = 0.9 + dry * 0.1; b = 0.75;
        const dd = D[zi * (RES + 1) + xi];
        if (dd < 60) { r *= 0.95; gg *= 1.05; }
      }
      colors[k * 3] = r; colors[k * 3 + 1] = gg; colors[k * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const tex = street ? TX.pavement() : TX.grass();
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, color: street ? 0x9a9a98 : 0xffffff });
    const terrain = new THREE.Mesh(g, mat);
    terrain.receiveShadow = true;
    group.add(terrain);
  }

  // ---------- trees (chunked instancing so frustum culling works) ----------
  const rand = (() => { let s = 12345; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 | 0) >>> 0) / 4294967296; })();
  {
    const conifer = meta.key === 'spa' || meta.key === 'austria';
    const leaves = TX.treeLeaves();
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 6);
    trunk.translate(0, 2, 0);
    const tc = new Float32Array(trunk.attributes.position.count * 3).fill(0.32); for (let i = 0; i < tc.length; i += 3) { tc[i] = 0.36; tc[i + 1] = 0.26; tc[i + 2] = 0.18; }
    trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    parts.push(trunk);
    if (conifer) {
      for (let k = 0; k < 4; k++) {
        const c = new THREE.ConeGeometry(2.6 - k * 0.55, 3.6, 9);
        c.translate(0, 3.2 + k * 2.1, 0);
        parts.push(c);
      }
    } else {
      for (const [x, y, z, r] of [[0, 5.6, 0, 2.8], [1.3, 4.6, 0.5, 2.0], [-1.2, 4.9, -0.4, 2.2], [0.2, 6.9, 0.3, 1.8]]) {
        const s = new THREE.IcosahedronGeometry(r, 1);
        const p = s.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const f = 1 + (hash2(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50 + p.getZ(i) * 30)) - 0.5) * 0.35;
          p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f);
        }
        s.translate(x, y, z);
        parts.push(s);
      }
    }
    for (let k = 1; k < parts.length; k++) {
      const c = new Float32Array(parts[k].attributes.position.count * 3);
      for (let i = 0; i < c.length; i += 3) { c[i] = 0.75; c[i + 1] = 0.85; c[i + 2] = 0.7; }
      parts[k].setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const treeGeo = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
    treeGeo.computeVertexNormals();
    const treeMat = new THREE.MeshStandardMaterial({ map: leaves, vertexColors: true, roughness: 0.95 });
    const count = Math.round((low ? 1400 : high ? 7000 : 3600) * meta.treeDensity);
    const chunk = 350;
    const buckets = new Map();
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 8) {
      tries++;
      const x = minx + margin * 0.4 + rand() * (maxx - minx - margin * 0.8);
      const z = minz + margin * 0.4 + rand() * (maxz - minz - margin * 0.8);
      const nh = nearH(x, z);
      const minD = street ? 30 : 26;
      if (nh) {
        const wall = Math.max(track.wallL[nh.i], track.wallR[nh.i]);
        if (nh.d < wall + (street ? 6 : 10) || nh.d < minD) continue;
      }
      // clumping
      if (fbm2(x / 160, z / 160, 3) < (street ? 0.55 : 0.42) && rand() > 0.15) continue;
      const key = Math.floor(x / chunk) + ',' + Math.floor(z / chunk);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push([x, heightAt(x, z) - 0.2, z, 0.8 + rand() * 0.8, rand() * Math.PI * 2, rand()]);
      placed++;
    }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const col = new THREE.Color();
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(treeGeo, treeMat, list.length);
      list.forEach(([x, y, z, s, rot, c], k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        sc.set(s, s * (0.9 + c * 0.4), s);
        ps.set(x, y, z);
        mtx.compose(ps, q, sc);
        im.setMatrixAt(k, mtx);
        col.setHSL(0.22 + c * 0.08, 0.35 + c * 0.2, 0.32 + c * 0.12);
        im.setColorAt(k, col.multiplyScalar(2.2));
      });
      im.castShadow = high;
      im.receiveShadow = !low;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // ---------- "Made by TechKey Crew" billboards ----------
  const buildingBoxes = [];
  if (P) {
    for (const m of pitMods) { const p = track.pointAt(m.s, P.side * (m.w0 + P.laneW + 8)); buildingBoxes.push([p.x, p.z, Math.max(m.sp, 16) + 10]); }
    for (let s2 = P.sEntry; s2 <= P.sExit; s2 += 12) { const i = track.indexAtS(s2); const p = track.pointAt(s2, P.side * (P.wall0[i] + 7)); buildingBoxes.push([p.x, p.z, 22]); }
  }
  {
    const tk = TX.techkeyBoard();
    const boardMat = new THREE.MeshStandardMaterial({ map: tk, emissive: 0xffffff, emissiveMap: tk, emissiveIntensity: 0.25, roughness: 0.45 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.5, metalness: 0.6 });
    const panelGeo = new THREE.PlaneGeometry(14, 3.5);
    const frameGeo = new THREE.BoxGeometry(14.5, 4, 0.3);
    const postGeo2 = new THREE.BoxGeometry(0.35, 1, 0.35);
    const placeBillboard = (i, side) => {
      const wall = side === 1 ? track.wallL[i] : track.wallR[i];
      const off = wall + (street ? 6 : 10);
      const cx = track.px[i] + track.nx[i] * side * off, cz = track.pz[i] + track.nz[i] * side * off;
      for (const a of [0, 7, -7]) {
        const nh = nearExact(cx + track.tx[i] * a, cz + track.tz[i] * a);
        if (nh && nh.d < off - 3) return false;
      }
      for (const bx of buildingBoxes) if (Math.hypot(bx[0] - cx, bx[1] - cz) < (bx[2] + 15) * 0.5) return false;
      buildingBoxes.push([cx, cz, 15]);
      const b = new THREE.Group();
      const lift = street ? 3.2 : 2.6;
      const panel = new THREE.Mesh(panelGeo, boardMat); panel.position.set(0, lift + 1.75, 0.16);
      const back = new THREE.Mesh(panelGeo, boardMat); back.position.set(0, lift + 1.75, -0.16); back.rotation.y = Math.PI;
      const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.set(0, lift + 1.75, 0); frame.castShadow = !low;
      b.add(panel, back, frame);
      for (const x of [-5, 5]) { const p = new THREE.Mesh(postGeo2, frameMat); p.scale.y = lift + 1; p.position.set(x, (lift + 1) / 2 - 0.5, 0); b.add(p); }
      b.position.set(cx, track.py[i] - 0.5, cz);
      b.rotation.y = Math.atan2(track.tx[i], track.tz[i]) + (side === 1 ? -Math.PI / 2 : Math.PI / 2);
      group.add(b);
      return true;
    };
    const nBoards = low ? 6 : 10;
    for (let k = 0; k < nBoards; k++) {
      const i = track.indexAtS(track.length * (k + 0.3) / nBoards);
      const side = track.curvWide[i] > 0 ? -1 : 1;
      if (!placeBillboard(i, side)) placeBillboard(i, -side);
    }
    // overhead bridge on the longest straight away from the start line
    let bestI = -1, bestScore = -1;
    for (let i = 0; i < N; i += 5) {
      const s = track.s[i];
      if (s < 500 || s > track.length - 500) continue;
      let ok = 0;
      for (let o = -60; o <= 60; o += 5) if (Math.abs(track.curvWide[(i + o + N) % N]) < 1 / 900) ok++;
      const score = ok - Math.abs(track.py[i]) * 0.01;
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    if (bestI >= 0) {
      const i = bestI;
      const gl = track.wallL[i] + 1.2, gr = track.wallR[i] + 1.2, span = gl + gr;
      const br = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1, 2.8, 1.2), frameMat);
      beam.position.set((gl - gr) / 2, 7.6, 0); beam.castShadow = true;
      br.add(beam);
      const bw = Math.min(span - 1, 28);
      for (const f of [1, -1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 4 > 2.6 ? 2.6 : bw / 4), boardMat);
        p.scale.x = 1; p.position.set((gl - gr) / 2, 7.6, f * 0.62);
        if (f === -1) p.rotation.y = Math.PI;
        br.add(p);
      }
      for (const x of [gl, -gr]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), frameMat); pl.position.set(x, 4.5, 0); pl.castShadow = !low; br.add(pl); }
      br.position.set(track.px[i], track.py[i], track.pz[i]);
      br.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
      group.add(br);
    }
  }

  // ---------- buildings (street circuits), painted in local colours ----------
  if (street) {
    const variants = [0, 1, 2, 3, 4];
    const geos = variants.map(() => []);
    const palette = (meta.key === 'monaco'
      ? ['#f2b39a', '#f6d7a2', '#e8978a', '#f3e2c4', '#d9825f', '#f8e7b0', '#ebc3d3', '#bcd3e0', '#fff8ee', '#f4c98f', '#e3b5a4']
      : ['#e8d3a6', '#dcc08c', '#f0e1bf', '#d0b484', '#f3e8d2', '#c8a274', '#fff6e6', '#e2c7a0']).map(c => new THREE.Color(c));
    const roofCols = [new THREE.Color('#a94f36'), new THREE.Color('#4a4d52'), new THREE.Color('#8b8f94'), new THREE.Color('#b8653f')];
    const tryPlace = (cx, cz, w, d, h, rot) => {
      const corners = [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2], [0, 0]];
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [a, b] of corners) {
        const x = cx + a * c + b * s, z = cz - a * s + b * c;
        const nh = nearExact(x, z);
        if (nh) {
          const wall = Math.max(track.wallL[nh.i], track.wallR[nh.i]);
          if (nh.d < wall + 4.5) return false;
        }
      }
      for (const bx of buildingBoxes) if (Math.hypot(bx[0] - cx, bx[1] - cz) < (bx[2] + Math.max(w, d)) * 0.5) return false;
      buildingBoxes.push([cx, cz, Math.max(w, d)]);
      const y0 = heightAt(cx, cz) - 1;
      const v = h > 38 && rand() < 0.6 ? 3 : Math.floor(rand() * variants.length);
      const paint = v === 3 ? new THREE.Color(0xe8f0f8) : palette[Math.floor(rand() * palette.length)];
      const roof = roofCols[Math.floor(rand() * (meta.key === 'monaco' ? 4 : 3))];
      geos[v].push(buildingGeo(w, h, d, cx, y0, cz, rot, paint, roof));
      return true;
    };
    const step = Math.round(22 / track.ds);
    for (let i = 0; i < N; i += step) {
      for (const side of [1, -1]) {
        const wall = side === 1 ? track.wallL[i] : track.wallR[i];
        for (let row = 0; row < (low ? 1 : 3); row++) {
          const w = 14 + rand() * 18, d = 12 + rand() * 14;
          const h = (meta.key === 'monaco' ? 14 : 10) + rand() * (meta.key === 'monaco' ? 40 : 30) + row * 6;
          const off = wall + 7 + d / 2 + row * 32 + rand() * 6;
          const cx = track.px[i] + track.nx[i] * side * off, cz = track.pz[i] + track.nz[i] * side * off;
          const rot = Math.atan2(track.tx[i], track.tz[i]);
          tryPlace(cx, cz, w, d, h, rot);
        }
      }
    }
    // filler blocks
    for (let k = 0; k < (low ? 150 : 450); k++) {
      const x = minx + margin * 0.6 + rand() * (maxx - minx - margin * 1.2);
      const z = minz + margin * 0.6 + rand() * (maxz - minz - margin * 1.2);
      tryPlace(x, z, 18 + rand() * 20, 16 + rand() * 20, 12 + rand() * 45, rand() * Math.PI);
    }
    variants.forEach((v, k) => {
      if (!geos[k].length) return;
      const g = mergeGeometries(geos[k]);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.facade(v), vertexColors: true, roughness: 0.8 }));
      m.castShadow = !low; m.receiveShadow = true;
      group.add(m);
    });
  }

  // ---------- grandstands / pit building ----------
  const crowdTex = TX.crowd();
  const standMat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 });
  const structMat = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.6, metalness: 0.3 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.5, metalness: 0.4 });
  const placeStand = (i, side, length) => {
    const wall = side === 1 ? track.wallL[i] : track.wallR[i];
    const off = wall + 4 + 7;
    const cx = track.px[i] + track.nx[i] * side * off, cz = track.pz[i] + track.nz[i] * side * off;
    // keep away from other parts
    for (const [a, b] of [[0, 0], [length / 2, 0], [-length / 2, 0]]) {
      const x = cx + track.tx[i] * a, z = cz + track.tz[i] * a;
      const nh = nearExact(x, z);
      if (nh && nh.d < off - 3 - Math.abs(a) * 0.1) return;
      void b;
    }
    const st = new THREE.Group();
    const seats = new THREE.Mesh(new THREE.PlaneGeometry(length, 15.5), standMat);
    seats.material.map.repeat.set(length / 40, 1);
    seats.rotation.x = -0.72;
    seats.position.set(0, 6, 0);
    seats.receiveShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(length, 12, 0.4), structMat);
    back.position.set(0, 6, -6);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.4, 15), roofMat);
    roof.position.set(0, 15, -0.5); roof.rotation.x = -0.08;
    roof.castShadow = true;
    st.add(seats, back, roof);
    for (let x = -length / 2; x <= length / 2; x += 12) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 15, 0.4), structMat);
      col.position.set(x, 7.5, 5.5);
      st.add(col);
    }
    const heading = Math.atan2(track.tx[i], track.tz[i]);
    st.position.set(cx, track.py[i] - 0.5, cz);
    // stands face the track: local +z towards track
    st.rotation.y = heading + (side === 1 ? -Math.PI / 2 : Math.PI / 2);
    group.add(st);
  };
  const pitSide = P ? P.side : (track.wallL[0] > track.wallR[0] ? 1 : -1);
  // main straight grandstands
  for (const ds of [-260, -170, -80, 60]) placeStand(track.indexAtS(ds), -pitSide, 80);
  // corner grandstands at the tightest corners
  const corners = [];
  for (let i = 0; i < N; i++) {
    const k = Math.abs(track.curvWide[i]);
    if (k > 1 / 90 && (i === 0 || Math.abs(track.curvWide[i - 1]) <= k) && Math.abs(track.curvWide[(i + 1) % N]) <= k) corners.push([k, i]);
  }
  corners.sort((a, b) => b[0] - a[0]);
  const used = [];
  for (const [, i] of corners) {
    if (used.length >= (low ? 2 : 5)) break;
    if (used.some(j => Math.abs(track.s[j] - track.s[i]) < 400)) continue;
    used.push(i);
    const side = track.curvWide[i] > 0 ? -1 : 1; // outside of corner
    placeStand((i + Math.round(30 / track.ds)) % N, side, 70);
  }
  // pit garages: one module per team bay, each aligned with the local track direction
  let pitInfo = null;
  if (P) {
    const side = P.side;
    const tkMat = new THREE.MeshStandardMaterial({ map: TX.techkeyBoard(), emissive: 0xffffff, emissiveMap: TX.techkeyBoard(), emissiveIntensity: 0.25, roughness: 0.5 });
    const teamsCols = ['#00D2BE', '#DC0000', '#1E41FF', '#F596C8', '#ffffff', '#FFF500', '#469BFF', '#BD9E57', '#FF8700', '#9B0000'];
    const bodies = [], glassG = [], doors = teamsCols.map(() => []), banners = [];
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const m of pitMods) {
      const front = m.w0 + P.laneW;
      const pt = track.pointAt(m.s, side * (front + 8));
      const rot = pt.heading + (side === 1 ? -Math.PI / 2 : Math.PI / 2); // local +z faces the track
      q.setFromAxisAngle(Y, rot);
      mtx.compose(new THREE.Vector3(pt.x, pt.y - 0.5, pt.z), q, one);
      const b = new THREE.BoxGeometry(m.sp + 0.15, 9.5, 16); b.translate(0, 4.75, 0); b.applyMatrix4(mtx); bodies.push(b);
      const gl = new THREE.BoxGeometry(m.sp + 0.15, 3.2, 0.2); gl.translate(0, 6.9, 8.05); gl.applyMatrix4(mtx); glassG.push(gl);
      const d = new THREE.PlaneGeometry(m.sp * 0.84, 4.4); d.translate(0, 2.7, 8.02); d.applyMatrix4(mtx); doors[Math.floor(m.k / 2)].push(d);
      if (m.k % 5 === 2) { const bn = new THREE.PlaneGeometry(Math.min(22, m.sp * 2.4), 5.5); bn.translate(0, 12.6, 8.1); bn.applyMatrix4(mtx); banners.push(bn); }
    }
    const add = (geos, mat, shadow) => { const mesh = new THREE.Mesh(mergeGeometries(geos.map(g => g.toNonIndexed())), mat); mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh); };
    add(bodies, new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5, metalness: 0.2 }), true);
    add(glassG, new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.8 }), false);
    doors.forEach((g, k) => { if (g.length) add(g, new THREE.MeshStandardMaterial({ color: teamsCols[k], roughness: 0.6, emissive: teamsCols[k], emissiveIntensity: 0.1 }), false); });
    if (banners.length) add(banners, tkMat, false);
    pitInfo = { side, boxes: P.boxes };
  }

  // ---------- start/finish line, grid boxes, gantry ----------
  const lineMat = new THREE.MeshStandardMaterial({ map: TX.checker(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const sf = track.pointAt(0, 0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(meta.width, 1.2), lineMat);
  line.rotation.x = -Math.PI / 2; line.rotation.z = sf.heading;
  line.position.set(sf.x, sf.y + 0.012, sf.z);
  line.receiveShadow = true;
  group.add(line);
  const gridMat = new THREE.MeshStandardMaterial({ map: TX.startGrid(), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  for (let k = 0; k < 22; k++) {
    const g = gridSlot(track, k);
    const pt = track.pointAt(g.s + 3.2, g.d);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), gridMat);
    m.rotation.order = 'YXZ';
    m.rotation.y = pt.heading + Math.PI; m.rotation.x = -Math.PI / 2;
    m.position.set(pt.x, pt.y + 0.012, pt.z);
    group.add(m);
  }
  // gantry with start lights
  const gantry = new THREE.Group();
  const gi = track.indexAtS(6);
  const gl = P && P.side === 1 ? P.wall0[gi] + 0.25 : track.wallL[gi] + 0.8, gr = P && P.side === -1 ? P.wall0[gi] + 0.25 : track.wallR[gi] + 0.8;
  const span = gl + gr;
  const gMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.4, metalness: 0.7 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 0.8), gMat);
  beam.position.set((gl - gr) / 2, 7.4, 0);
  beam.castShadow = true;
  gantry.add(beam);
  for (const x of [gl, -gr]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8.2, 0.6), gMat);
    pillar.position.set(x, 4.1, 0);
    pillar.castShadow = true;
    gantry.add(pillar);
  }
  const lightMats = [];
  const bulbGeo = new THREE.CircleGeometry(0.17, 16);
  for (let k = 0; k < 5; k++) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.5 }));
    const x = (k - 2) * 0.85;
    housing.position.set(x, 7.4, -0.5);
    gantry.add(housing);
    const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
    lightMats.push(mat);
    for (const y of [7.65, 7.15]) {
      const b = new THREE.Mesh(bulbGeo, mat);
      b.position.set(x, y, -0.66);
      b.rotation.y = Math.PI;
      gantry.add(b);
    }
  }
  const gp = track.pointAt(6, 0);
  gantry.position.set(gp.x, gp.y, gp.z);
  gantry.rotation.y = gp.heading;
  // banner on gantry
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(span - 2, 18), 1.2), new THREE.MeshStandardMaterial({ map: TX.textDecal((meta.gp || '').toUpperCase(), { color: '#ffffff', bg: '#e10600' }), roughness: 0.6 }));
  ban.position.set(0, 7.4, -0.42); ban.rotation.y = Math.PI;
  gantry.add(ban);
  group.add(gantry);

  // ---------- braking boards before heavy stops ----------
  {
    const boardTex = [100, 200, 300].map(n => TX.textDecal(String(n), { color: '#111', bg: '#ffffff', w: 256, h: 256, italic: false }));
    const prof = track.speedProfile({ mass: 800, ClA: 4.7, CdA: 1.25, mu: 1.75, power: 580000 }, 1);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (prof[i] > 70 && prof[j] < prof[i] - 0.05 && prof[(i + N - 1) % N] <= prof[i] + 0.001 && prof[(i + 60) % N] < prof[i] - 18) {
        const side = track.curvWide[(i + 60) % N] > 0 ? -1 : 1;
        [100, 200, 300].forEach((dist, k) => {
          const pt = track.indexAtS(track.s[i] + 120 - dist);
          if (P && P.inPit[pt]) return;
          const wall = side === 1 ? track.wallL[pt] : track.wallR[pt];
          if (wall > 30) return;
          const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: boardTex[k], roughness: 0.6, side: THREE.DoubleSide }));
          const off = wall - 0.4;
          b.position.set(track.px[pt] + track.nx[pt] * side * off, track.py[pt] + wallH + 0.7, track.pz[pt] + track.nz[pt] * side * off);
          b.rotation.y = Math.atan2(track.tx[pt], track.tz[pt]) + Math.PI;
          group.add(b);
        });
      }
    }
  }

  // ---------- racing line assist ----------
  const rlCount = N + 1;
  const rlPos = new Float32Array(rlCount * 2 * 3);
  const rlCol = new Float32Array(rlCount * 2 * 4);
  const rlIdx = [];
  for (let r = 0; r < rlCount; r++) {
    const i = r % N;
    for (let c = 0; c < 2; c++) {
      const d = track.rlOffset[i] + (c ? 0.35 : -0.35);
      rlPos.set([track.px[i] + track.nx[i] * d, track.py[i] + 0.025, track.pz[i] + track.nz[i] * d], (r * 2 + c) * 3);
    }
    if (r < rlCount - 1) { const a = r * 2; rlIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const rlGeo = new THREE.BufferGeometry();
  rlGeo.setAttribute('position', new THREE.BufferAttribute(rlPos, 3));
  rlGeo.setAttribute('color', new THREE.BufferAttribute(rlCol, 4));
  rlGeo.setIndex(rlIdx);
  const rlMesh = new THREE.Mesh(rlGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
  rlMesh.frustumCulled = false;
  rlMesh.visible = false;
  group.add(rlMesh);
  let lastRl = [];
  const updateRacingLine = (i0, speed, profile) => {
    const col = rlGeo.attributes.color;
    for (const r of lastRl) col.array[r * 4 + 3] = 0;
    lastRl = [];
    const ahead = Math.round(260 / track.ds);
    for (let k = 2; k < ahead; k++) {
      const i = (i0 + k) % N;
      const diff = speed - profile[i];
      let r, g, b;
      if (diff > 4) { r = 1; g = 0.12; b = 0.1; } else if (diff > -4) { r = 1; g = 0.8; b = 0.1; } else { r = 0.1; g = 0.95; b = 0.3; }
      const a = 0.75 * Math.min(1, k / 8) * Math.min(1, (ahead - k) / 30);
      for (const rr of i === 0 ? [0, N] : [i]) {
        for (let c = 0; c < 2; c++) {
          const v = rr * 2 + c;
          col.array.set([r, g, b, a], v * 4);
          lastRl.push(v);
        }
      }
    }
    col.needsUpdate = true;
  };

  return {
    group, heightAt, rlMesh, updateRacingLine, pit: pitInfo,
    // backlit billboards / pit banners glow at night
    setNight(on) { group.traverse(o => { const m = o.material; if (m && m.emissiveMap) m.emissiveIntensity = on ? 1.15 : 0.25; }); },
    setLights(n) { lightMats.forEach((m, k) => { m.emissiveIntensity = k < n ? 8 : 0; m.color.set(k < n ? 0xff2020 : 0x220000); }); },
  };
}

export function gridSlot(track, k) {
  const s = -10 - k * 8;
  const d = (k % 2 === 0 ? 1 : -1) * Math.min(2.4, track.hw * 0.4);
  return { s, d };
}

function buildingGeo(w, h, d, cx, y0, cz, rot, paint, roof) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  const fl = 3.4;
  const c = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (ny > 0.5) {
      uv.setXY(i, 0.01, 0.01);
      c[i * 3] = roof.r; c[i * 3 + 1] = roof.g; c[i * 3 + 2] = roof.b;
      continue;
    }
    const along = nx > 0.5 ? d : w;
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(along / 12)), uv.getY(i) * Math.max(1, Math.round(h / (fl * 6))));
    c[i * 3] = paint.r; c[i * 3 + 1] = paint.g; c[i * 3 + 2] = paint.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.translate(0, h / 2, 0);
  g.rotateY(rot);
  g.translate(cx, y0, cz);
  return g.toNonIndexed();
}
