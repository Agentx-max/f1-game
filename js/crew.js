import * as THREE from 'three';
import { solveTwoBone, setWorldQuat, dirToLocal, smooth } from './ik.js';

// Skinned, rigged humanoids (~1.8 m) for marshals and pit crew: one SkinnedMesh per person with a
// 19-bone skeleton, blended joint weights (smooth elbows/knees), painted fire suits, helmets + visors,
// gloves and boots. Poses combine FK (walking/running) with two-bone IK so hands and feet can be
// placed exactly on tyres, wheel guns, jacks and the ground. Person faces +z, +x is their left.

const ATLAS = 512;
const REG = {
  torso: [0, 0, 256, 256], arm: [256, 0, 128, 256], leg: [384, 0, 128, 256],
  helmet: [0, 256, 256, 128], face: [256, 256, 128, 128],
  glove: [384, 256, 64, 64], cuff: [448, 256, 64, 64], boot: [384, 320, 64, 64], sole: [448, 320, 64, 64],
};
const TY0 = 0.8, TY1 = 1.62; // torso texture height range
const A_TILT = 0.16; // bind pose arm abduction (A-pose)
const HEAD_C = new THREE.Vector3(0, 1.664, 0.014);
const UPPER = 0.285, FORE = 0.255, THIGH = 0.43, SHIN = 0.415, ANKLE_H = 0.055;

// bone indices (creation order)
const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4;
const ARM = { 1: [5, 6, 7, 8], [-1]: [9, 10, 11, 12] };
const LEG = { 1: [13, 14, 15], [-1]: [16, 17, 18] };

function makeBones() {
  const bones = [];
  const mk = (x, y, z, parent) => { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
  const hips = mk(0, 0.95, 0);
  const spine = mk(0, 0.08, 0, hips);
  const chest = mk(0, 0.24, 0.005, spine);
  const neck = mk(0, 0.25, -0.01, chest);
  const head = mk(0, 0.075, 0.012, neck);
  const arm = s => {
    const sh = mk(s * 0.182, 0.2, -0.004, chest); sh.rotation.z = s * A_TILT;
    const el = mk(0, -UPPER, 0, sh), wr = mk(0, -FORE, 0, el), fg = mk(0, -0.088, 0, wr);
    return { sh, el, wr, fg };
  };
  const La = arm(1), Ra = arm(-1);
  const leg = s => { const hip = mk(s * 0.094, -0.05, 0, hips); const kn = mk(0, -THIGH, 0, hip); const an = mk(0, -SHIN, 0, kn); return { hip, kn, an }; };
  const Ll = leg(1), Rl = leg(-1);
  return { bones, hips, spine, chest, neck, head, L: { s: 1, ...La, ...Ll }, R: { s: -1, ...Ra, ...Rl } };
}

// ---------------------------------------------------------------- geometry helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

function seamNormals(g, rings, cols) {
  const n = g.attributes.normal;
  for (let j = 0; j < rings; j++) {
    const a = j * cols, b = a + cols - 1;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
}

// torso: superellipse rings stacked along y. section = [y, rx, zFront, zBack, zCentre, n]
function torsoGeo(sections, seg = 28) {
  const rows = [];
  for (let j = 0; j < sections.length - 1; j++) for (let k = 0; k < 3; k++) {
    const a = sections[j], b = sections[j + 1], t = k / 3, e = t * t * (3 - 2 * t);
    rows.push(a.map((v, i) => i === 0 ? v + (b[0] - v) * t : v + (b[i] - v) * e));
  }
  rows.push(sections[sections.length - 1]);
  const pos = [], uv = [], idx = [], C = seg + 1;
  for (const [y, rx, zf, zb, zc, n] of rows) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2 - Math.PI, sa = Math.sin(a), ca = Math.cos(a);
      pos.push(rx * spow(sa, 2 / n), y, zc + (ca > 0 ? zf : zb) * spow(ca, 2 / n));
      uv.push(k / seg, (y - TY0) / (TY1 - TY0));
    }
  }
  for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < seg; k++) {
    const a = j * C + k, b = a + C, c = a + 1, d = b + 1;
    idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); seamNormals(g, rows.length, C);
  return g;
}

// limb tube from A along dir with radius profile r(t) and rounded caps
function tubeGeo(A, dir, len, rFn, { seg = 14, step = 0.028, sx = 1, sz = 1 } = {}) {
  const rings = [];
  const r0 = rFn(0), r1 = rFn(len);
  for (let k = 0; k < 4; k++) { const th = (k / 4) * Math.PI / 2; rings.push([-r0 * Math.cos(th) * 0.75, r0 * Math.sin(th)]); }
  const nS = Math.max(2, Math.round(len / step));
  for (let k = 0; k <= nS; k++) { const t = (k / nS) * len; rings.push([t, rFn(t)]); }
  for (let k = 1; k <= 4; k++) { const th = (k / 4) * Math.PI / 2; rings.push([len + r1 * Math.sin(th) * 0.75, r1 * Math.cos(th) + (k === 4 ? 0 : 0)]); }
  const Z = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
  const X = new THREE.Vector3().crossVectors(Z, dir);
  const t0 = rings[0][0], t1 = rings[rings.length - 1][0];
  const pos = [], uv = [], idx = [], C = seg + 1;
  for (const [t, r] of rings) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2 - Math.PI, sa = Math.sin(a) * r * sx, ca = Math.cos(a) * r * sz;
      pos.push(A.x + dir.x * t + X.x * sa + Z.x * ca, A.y + dir.y * t + X.y * sa + Z.y * ca, A.z + dir.z * t + X.z * sa + Z.z * ca);
      uv.push(k / seg, 1 - (t - t0) / (t1 - t0));
    }
  }
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < seg; k++) {
    const a = j * C + k, b = a + C, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); seamNormals(g, rings.length, C);
  return g;
}

// box with exactly rounded edges (analytic normals)
function roundedBox(w, h, d, r, seg = 3) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd));
    v.sub(c).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// boot: superellipse sections along z. [z, halfWidth, top, bottom]
function bootGeo(sections, seg = 16) {
  const pos = [], idx = [], C = seg + 1;
  for (const [z, hw, top, bot] of sections) {
    const yc = (top + bot) / 2, ht = (top - bot) / 2;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(hw * spow(c, 0.7), yc + ht * spow(s, 0.6), z);
    }
  }
  for (let j = 0; j < sections.length - 1; j++) for (let k = 0; k < seg; k++) {
    const a = j * C + k, b = a + C, c = a + 1, d = b + 1;
    idx.push(a, c, b, c, d, b);
  }
  // end caps
  const capOf = (j, flip) => {
    const ci = pos.length / 3, [z, , top, bot] = sections[j];
    pos.push(0, (top + bot) / 2, z);
    for (let k = 0; k < seg; k++) { const a = j * C + k; flip ? idx.push(ci, a + 1, a) : idx.push(ci, a, a + 1); }
  };
  capOf(0, true); capOf(sections.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals(); seamNormals(g, sections.length, C);
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = clamp((p.getZ(i) + 0.08) / 0.3, 0, 1); uv[i * 2 + 1] = clamp((p.getY(i) + 0.06) / 0.18, 0, 1); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function dropTriangles(geo, test) {
  const p = geo.attributes.position, idx = geo.index.array, keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    a.add(b).add(c).multiplyScalar(1 / 3);
    if (!test(a)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  geo.setIndex(keep);
  return geo;
}

// ---------------------------------------------------------------- body geometry (shared by every person with the same helmet type)
const TORSO = [
  [0.795, 0.06, 0.05, 0.05, 0, 2.2],
  [0.835, 0.13, 0.082, 0.094, 0, 2.3],
  [0.905, 0.163, 0.096, 0.118, -0.004, 2.4],
  [0.985, 0.161, 0.093, 0.108, 0, 2.4],
  [1.07, 0.149, 0.091, 0.093, 0.004, 2.4],
  [1.16, 0.156, 0.099, 0.092, 0.008, 2.5],
  [1.26, 0.176, 0.113, 0.097, 0.01, 2.6],
  [1.35, 0.192, 0.114, 0.103, 0.008, 2.7],
  [1.42, 0.197, 0.103, 0.101, 0.004, 2.7],
  [1.468, 0.178, 0.089, 0.091, 0, 2.6],
  [1.503, 0.126, 0.077, 0.079, 0, 2.4],
  [1.535, 0.071, 0.065, 0.065, 0.004, 2.2],
  [1.61, 0.057, 0.057, 0.055, 0.01, 2.0],
];
const TORSO_KNOTS = [[0, HIPS], [0.975, HIPS], [1.09, SPINE], [1.18, SPINE], [1.3, CHEST], [1.495, CHEST], [1.548, NECK]];
function chainWeight(y, knots) {
  if (y <= knots[0][0]) return [[knots[0][1], 1]];
  for (let k = 0; k < knots.length - 1; k++) {
    const [y0, b0] = knots[k], [y1, b1] = knots[k + 1];
    if (y <= y1) { if (b0 === b1) return [[b0, 1]]; const t = smooth(y0, y1, y); return [[b0, 1 - t], [b1, t]]; }
  }
  return [[knots[knots.length - 1][1], 1]];
}

class Builder {
  constructor(n) { this.G = Array.from({ length: n }, () => ({ pos: [], nor: [], uv: [], si: [], sw: [], idx: [] })); this.v = new THREE.Vector3(); this.n = new THREE.Vector3(); }
  add(group, geo, { region, mat = null, w, mirrorU = false, uv = null }) {
    const G = this.G[group], p = geo.attributes.position, nn = geo.attributes.normal, t = geo.attributes.uv;
    const nm = mat ? new THREE.Matrix3().getNormalMatrix(mat) : null;
    const base = G.pos.length / 3, v = this.v, n = this.n;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); n.fromBufferAttribute(nn, i);
      if (mat) { v.applyMatrix4(mat); n.applyMatrix3(nm).normalize(); }
      G.pos.push(v.x, v.y, v.z); G.nor.push(n.x, n.y, n.z);
      let u = t ? t.getX(i) : 0.5, vv = t ? t.getY(i) : 0.5;
      if (uv) [u, vv] = uv(v, u, vv);
      if (mirrorU) u = 1 - u;
      G.uv.push((region[0] + clamp(u, 0.002, 0.998) * region[2]) / ATLAS, 1 - (region[1] + (1 - clamp(vv, 0.002, 0.998)) * region[3]) / ATLAS);
      const ws = typeof w === 'number' ? [[w, 1]] : w(v);
      let sum = 0; for (const x of ws) sum += x[1];
      for (let k = 0; k < 4; k++) { G.si.push(ws[k] ? ws[k][0] : 0); G.sw.push(ws[k] ? ws[k][1] / sum : 0); }
    }
    if (geo.index) for (const i of geo.index.array) G.idx.push(base + i);
    else for (let i = 0; i < p.count; i++) G.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry(), all = { pos: [], nor: [], uv: [], si: [], sw: [], idx: [] };
    let start = 0;
    this.G.forEach((G, gi) => {
      const off = all.pos.length / 3;
      for (const k of ['pos', 'nor', 'uv', 'si', 'sw']) for (const x of G[k]) all[k].push(x);
      for (const i of G.idx) all.idx.push(off + i);
      g.addGroup(start, G.idx.length, gi); start += G.idx.length;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all.sw, 4));
    g.setIndex(all.idx);
    return g;
  }
}

const bodyCache = {};
function bodyGeometry(helmetType) {
  if (bodyCache[helmetType]) return bodyCache[helmetType];
  const sk = makeBones();
  sk.hips.updateMatrixWorld(true);
  const wp = b => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  const B = new Builder(3);
  // torso + neck
  B.add(0, torsoGeo(TORSO), { region: REG.torso, w: v => chainWeight(v.y, TORSO_KNOTS) });
  for (const s of [1, -1]) {
    const side = s === 1 ? sk.L : sk.R, [shI, elI, wrI, fgI] = ARM[s], [hipI, knI, anI] = LEG[s];
    // arm: one continuous sleeve from shoulder to wrist, blended at the shoulder and elbow
    const A = wp(side.sh), dir = wp(side.wr).sub(A).normalize();
    const armR = t => t < 0.09 ? 0.061 - t * 0.04 : t < UPPER ? 0.0574 - (t - 0.09) * 0.07 : t < UPPER + 0.06 ? 0.0438 + (t - UPPER) * 0.03 : 0.0456 - (t - UPPER - 0.06) * 0.06;
    B.add(0, tubeGeo(A, dir, UPPER + FORE + 0.004, armR, { seg: 14, sx: 0.95, sz: 1.05 }), {
      region: REG.arm, mirrorU: s < 0,
      w: v => { const t = v.clone().sub(A).dot(dir), ws = smooth(-0.06, 0.05, t), we = smooth(UPPER - 0.035, UPPER + 0.035, t); return [[CHEST, 1 - ws], [shI, ws * (1 - we)], [elI, ws * we]]; },
    });
    // leg: hip to ankle
    const H = wp(side.hip), ldir = new THREE.Vector3(0, -1, 0);
    const legR = t => t < 0 ? 0.093 : t < 0.14 ? 0.094 - t * 0.04 : t < THIGH ? 0.0884 - (t - 0.14) * 0.098 : t < THIGH + 0.11 ? 0.06 + Math.sin((t - THIGH) / 0.11 * Math.PI / 2) * 0.004 : 0.064 - (t - THIGH - 0.11) * 0.075;
    B.add(0, tubeGeo(H.clone().add(new THREE.Vector3(s * 0.008, 0.02, 0)), ldir, THIGH + SHIN - 0.03, legR, { seg: 14, sz: 1.06 }), {
      region: REG.leg, mirrorU: s < 0,
      w: v => { const t = H.y - v.y, wh = smooth(-0.1, 0.06, t), wk = smooth(THIGH - 0.04, THIGH + 0.04, t); return [[HIPS, 1 - wh], [hipI, wh * (1 - wk)], [knI, wh * wk]]; },
    });
    // gloved hand (wrist space): palm, cuff, thumb and fingers
    const M = side.wr.matrixWorld, MF = side.fg.matrixWorld;
    const palm = roundedBox(0.031, 0.094, 0.08, 0.013, 2); palm.translate(-s * 0.002, -0.05, 0.004);
    B.add(0, palm, { region: REG.glove, mat: M, w: wrI });
    const cuff = new THREE.CylinderGeometry(0.041, 0.037, 0.055, 14, 1, true); cuff.translate(0, 0.004, 0.002);
    B.add(0, cuff, { region: REG.cuff, mat: M, w: v => [[wrI, 0.8], [elI, 0.2]] });
    const thumb = new THREE.CapsuleGeometry(0.0118, 0.036, 3, 8);
    thumb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-s * 0.32, -0.72, 0.6).normalize()));
    thumb.translate(-s * 0.012, -0.045, 0.045);
    B.add(0, thumb, { region: REG.glove, mat: M, w: wrI });
    [[0.028, 0.06], [0.0095, 0.064], [-0.009, 0.06], [-0.026, 0.05]].forEach(([z, L]) => {
      const p1 = new THREE.CapsuleGeometry(0.0108, L * 0.5, 3, 8); p1.translate(0, -L * 0.28, z);
      B.add(0, p1, { region: REG.glove, mat: MF, w: fgI });
      const p2 = new THREE.CapsuleGeometry(0.0098, L * 0.38, 3, 8);
      p2.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * 0.5));
      p2.translate(-s * 0.012, -L * 0.74, z);
      B.add(0, p2, { region: REG.glove, mat: MF, w: fgI });
    });
    // boot (ankle space): shaft + toe, plus a darker sole
    const MA = side.an.matrixWorld;
    const boot = bootGeo([[-0.075, 0.03, 0.02, -0.05], [-0.06, 0.046, 0.11, -0.054], [-0.01, 0.052, 0.125, -0.054], [0.05, 0.053, 0.05, -0.054], [0.12, 0.05, 0.025, -0.054], [0.175, 0.044, 0.012, -0.054], [0.205, 0.022, -0.012, -0.05]]);
    B.add(0, boot, { region: REG.boot, mat: MA, w: anI });
    const sole = roundedBox(0.104, 0.022, 0.29, 0.009, 2); sole.translate(0, -0.044, 0.064);
    B.add(0, sole, { region: REG.sole, mat: MA, w: anI });
  }
  // head (face shows through open helmets) with a small nose
  const head = new THREE.SphereGeometry(0.098, 22, 16, -Math.PI / 2); head.scale(0.9, 1.1, 1.0); head.translate(HEAD_C.x, HEAD_C.y, HEAD_C.z);
  B.add(0, head, { region: REG.face, w: HEAD });
  const nose = new THREE.SphereGeometry(0.018, 8, 6); nose.scale(0.75, 1.15, 1); nose.translate(HEAD_C.x, HEAD_C.y - 0.012, HEAD_C.z + 0.094);
  B.add(0, nose, { region: REG.face, w: HEAD, uv: () => [0.5, 0.42] });
  // helmet shell
  const hc = HEAD_C.clone().add(new THREE.Vector3(0, 0.014, -0.008));
  const shell = new THREE.SphereGeometry(0.139, 28, 20, -Math.PI / 2); shell.scale(1, 1.02, 1.1); shell.translate(hc.x, hc.y, hc.z);
  const full = helmetType === 'full';
  dropTriangles(shell, c => {
    const x = c.x - hc.x, y = c.y - hc.y, z = c.z - hc.z, ang = Math.abs(Math.atan2(x, z));
    if (y < -0.066 && z < 0.02) return true; // neck opening
    if (!full && ang < 0.82 && y < 0.046) return true; // open face
    if (full && ang < 0.86 && y > -0.032 && y < 0.054) return true; // visor window
    return y < -0.118;
  });
  B.add(1, shell, { region: REG.helmet, w: HEAD });
  if (full) {
    const r = 0.1435, vis = new THREE.SphereGeometry(r, 20, 6, Math.PI / 2 - 0.97, 1.94, Math.acos(0.058 / (r * 1.02)), Math.acos(-0.036 / (r * 1.02)) - Math.acos(0.058 / (r * 1.02)));
    vis.scale(1, 1.02, 1.1); vis.translate(hc.x, hc.y, hc.z);
    B.add(2, vis, { region: REG.helmet, w: HEAD });
  } else {
    // peak above the face opening
    const peak = new THREE.SphereGeometry(0.145, 16, 3, Math.PI / 2 - 0.85, 1.7, Math.acos(0.07 / 0.148), 0.16); peak.scale(1, 1.02, 1.12); peak.translate(hc.x, hc.y, hc.z);
    B.add(1, peak, { region: REG.helmet, w: HEAD, uv: () => [0.5, 0.95] });
  }
  return (bodyCache[helmetType] = B.build());
}

// ---------------------------------------------------------------- costumes (painted texture atlas)
export const MARSHAL_FLAG = { kind: 'flag', base: '#ff6a12', trim: '#d9dee4', helmet: '#2445a8', badge: '#2445a8' };
export const MARSHAL_TRACK = { kind: 'track', base: '#2a4fb6', trim: '#ff7a1c', helmet: '#2445a8' };
const lum = hex => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
export function crewCostume(team) {
  const L = team.livery;
  let upper = lum(team.color) < 0.06 ? L.base : team.color;
  if (team.id === 'williams' || team.id === 'mercedes') upper = '#f1f2f3';
  let band = [L.accent, L.accent2, '#e10600'].find(c => c && Math.abs(lum(c) - lum(upper)) > 0.12) || '#e10600';
  if (team.id === 'mercedes') band = '#00d2be';
  const lower = lum(L.dark) < 0.12 ? L.dark : '#17181c';
  return { kind: 'crew', upper, band, lower, logo: band, name: team.name.toUpperCase(), helmet: lum(upper) > 0.7 ? '#1c1d22' : lower, stripe: band, visor: '#f2c21b' };
}
const SKINS = ['#e2b391', '#c48d63', '#8d5a3b', '#f0c8a8'];
const texCache = {};
function costumeTexture(c, skinIdx) {
  const key = JSON.stringify(c) + skinIdx;
  if (texCache[key]) return texCache[key];
  const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS;
  const x = cv.getContext('2d');
  const R = (r, col) => { x.fillStyle = col; x.fillRect(r[0], r[1], r[2], r[3]); };
  const rect = (r, u0, v0, u1, v1, col) => { x.fillStyle = col; x.fillRect(r[0] + u0 * r[2], r[1] + (1 - v1) * r[3], (u1 - u0) * r[2], (v1 - v0) * r[3]); };
  const ty = y => (y - TY0) / (TY1 - TY0); // torso v
  const refl = (r, u0, v0, u1, v1) => {
    const g = x.createLinearGradient(0, r[1] + (1 - v1) * r[3], 0, r[1] + (1 - v0) * r[3]);
    g.addColorStop(0, '#9aa3ab'); g.addColorStop(0.5, '#f3f6f8'); g.addColorStop(1, '#9aa3ab');
    rect(r, u0, v0, u1, v1, g);
  };
  const T = REG.torso, AR = REG.arm, LG = REG.leg;
  // wraps a rectangle across the u=0/1 seam (back of the body)
  const back = (r, du, v0, v1, col) => { rect(r, 0, v0, du, v1, col); rect(r, 1 - du, v0, 1, v1, col); };
  const backText = (txt, v, col, size) => {
    x.save(); x.beginPath(); x.rect(T[0], T[1], T[2], T[3]); x.clip();
    x.fillStyle = col; x.font = `900 ${size}px "Titillium Web", Arial Black, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const py = T[1] + (1 - v) * T[3];
    x.fillText(txt, T[0], py, 120); x.fillText(txt, T[0] + T[2], py, 120);
    x.restore();
  };
  if (c.kind === 'crew') {
    R(T, c.lower);
    rect(T, 0, ty(1.335), 1, 1, c.upper);
    rect(T, 0, ty(1.285), 1, ty(1.335), c.band);
    rect(T, 0.06, ty(1.45), 0.13, 1, c.band); rect(T, 0.87, ty(1.45), 0.94, 1, c.band); // shoulder piping (back)
    rect(T, 0.37, ty(1.47), 0.4, 1, c.band); rect(T, 0.6, ty(1.47), 0.63, 1, c.band); // shoulder piping (front)
    rect(T, 0.497, ty(1.0), 0.503, ty(1.5), 'rgba(0,0,0,0.25)'); // zip
    // team logo on the left chest, sponsor patch on the right
    const lx = T[0] + 0.585 * T[2], ly = T[1] + (1 - ty(1.395)) * T[3];
    x.fillStyle = c.logo; x.beginPath(); x.ellipse(lx, ly, 13, 8, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(lx, ly, 8, 4, -0.3, 0, Math.PI * 2); x.fill();
    rect(T, 0.39, ty(1.37), 0.45, ty(1.41), '#ffffff'); rect(T, 0.395, ty(1.378), 0.445, ty(1.402), c.band);
    backText(c.name, ty(1.4), lum(c.upper) > 0.5 ? '#111' : '#fff', 15);
    rect(T, 0, ty(0.96), 1, ty(0.985), 'rgba(0,0,0,0.35)'); // belt line
    R(AR, c.upper);
    rect(AR, 0.72, 0.1, 0.78, 1, c.band); // outer sleeve stripe
    rect(AR, 0, 0.0, 1, 0.07, c.band); // cuff
    rect(AR, 0, 0, 1, 0.38, lum(c.upper) > 0.7 ? c.upper : c.lower);
    rect(AR, 0, 0.0, 1, 0.07, c.band);
    R(LG, c.lower);
    rect(LG, 0.72, 0.05, 0.78, 0.98, c.band);
    rect(LG, 0.38, 0.42, 0.62, 0.58, 'rgba(255,255,255,0.07)'); // knee pads
  } else {
    const flag = c.kind === 'flag';
    R(T, c.base);
    if (flag) {
      refl(T, 0, ty(1.06), 1, ty(1.105)); // waist band
      for (const u of [0.405, 0.595]) refl(T, u - 0.022, ty(1.06), u + 0.022, ty(1.52));
      for (const u of [0.09, 0.91]) refl(T, u - 0.022, ty(1.06), u + 0.022, ty(1.52));
      refl(T, 0.4, ty(1.37), 0.6, ty(1.405));
      rect(T, 0.55, ty(1.27), 0.585, ty(1.33), '#ffffff'); rect(T, 0.555, ty(1.278), 0.58, ty(1.322), c.badge);
      backText('MARSHAL', ty(1.25), '#16181c', 17);
    } else {
      rect(T, 0.4, ty(1.13), 0.6, ty(1.47), c.trim);
      rect(T, 0.418, ty(1.15), 0.582, ty(1.45), '#5a7fd8');
      rect(T, 0.465, ty(1.29), 0.535, ty(1.35), c.trim);
      rect(T, 0, ty(1.05), 1, ty(1.1), c.trim);
      back(T, 0.1, ty(1.13), ty(1.47), c.trim); back(T, 0.082, ty(1.15), ty(1.45), '#5a7fd8');
      backText('MARSHAL', ty(1.31), '#ffffff', 16);
    }
    rect(T, 0.497, ty(1.1), 0.503, ty(1.52), 'rgba(0,0,0,0.25)');
    R(AR, c.base);
    if (!flag) rect(AR, 0.72, 0.08, 0.78, 1, c.trim);
    else refl(AR, 0, 0.12, 1, 0.17);
    R(LG, c.base);
    if (!flag) rect(LG, 0.72, 0.05, 0.78, 0.98, c.trim);
    else refl(LG, 0, 0.2, 1, 0.25);
  }
  // fabric grain + soft side shading
  for (const r of [T, AR, LG]) {
    for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; x.fillRect(r[0] + Math.random() * r[2], r[1] + Math.random() * r[3], 2, 2); }
    const g = x.createLinearGradient(r[0], 0, r[0] + r[2], 0);
    g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    x.fillStyle = g; x.fillRect(r[0], r[1], r[2], r[3]);
  }
  // helmet
  const H = REG.helmet;
  R(H, c.helmet);
  if (c.kind === 'crew') { rect(H, 0.47, 0.25, 0.53, 1, c.stripe); rect(H, 0, 0.2, 1, 0.25, c.stripe); }
  else { rect(H, 0, 0.3, 1, 0.34, '#ffffff'); rect(H, 0.49, 0.34, 0.51, 1, '#ffffff'); }
  const hg = x.createLinearGradient(0, H[1], 0, H[1] + H[3]); hg.addColorStop(0, 'rgba(255,255,255,0.18)'); hg.addColorStop(0.6, 'rgba(255,255,255,0)'); hg.addColorStop(1, 'rgba(0,0,0,0.3)');
  x.fillStyle = hg; x.fillRect(H[0], H[1], H[2], H[3]);
  // face
  const F = REG.face, skin = SKINS[skinIdx % SKINS.length];
  R(F, skin);
  const fx = u => F[0] + u * F[2], fy = v => F[1] + (1 - v) * F[3];
  const sh = x.createRadialGradient(fx(0.5), fy(0.5), 4, fx(0.5), fy(0.5), 60); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,30,20,0.35)');
  x.fillStyle = sh; x.fillRect(F[0], F[1], F[2], F[3]);
  for (const s of [-1, 1]) {
    x.fillStyle = '#f4f1ec'; x.beginPath(); x.ellipse(fx(0.5 + s * 0.058), fy(0.555), 4.2, 2.4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2b1d14'; x.beginPath(); x.arc(fx(0.5 + s * 0.058), fy(0.555), 1.8, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(40,25,15,0.85)'; x.fillRect(fx(0.5 + s * 0.058) - 5, fy(0.615), 10, 1.8);
  }
  x.fillStyle = 'rgba(90,40,30,0.55)'; x.fillRect(fx(0.5) - 5, fy(0.335), 10, 1.6);
  x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(fx(0.5) - 1, fy(0.5), 2, 10);
  // gloves, cuffs, boots, soles
  R(REG.glove, '#1a1b1f');
  for (let i = 0; i < 80; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; x.fillRect(REG.glove[0] + Math.random() * 64, REG.glove[1] + Math.random() * 64, 2, 2); }
  R(REG.cuff, c.kind === 'crew' ? c.band : c.kind === 'flag' ? '#1a1b1f' : c.trim);
  R(REG.boot, '#18191c');
  if (c.kind === 'crew') rect(REG.boot, 0, 0.0, 1, 0.22, c.band);
  rect(REG.boot, 0, 0.62, 1, 0.68, 'rgba(255,255,255,0.1)');
  R(REG.sole, '#2a2b2e');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (texCache[key] = tex);
}
const matCache = {};
function costumeMaterials(c, skinIdx) {
  const key = JSON.stringify(c) + skinIdx;
  if (matCache[key]) return matCache[key];
  const map = costumeTexture(c, skinIdx);
  const mats = [
    new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0 }),
    new THREE.MeshStandardMaterial({ map, roughness: 0.22, metalness: 0.15, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: c.visor || '#101215', roughness: 0.06, metalness: 0.65, emissive: c.visor || '#000000', emissiveIntensity: c.visor ? 0.06 : 0 }),
  ];
  return (matCache[key] = mats);
}

// ---------------------------------------------------------------- props
const pmats = {};
function pm(col, rough = 0.5, metal = 0) { const k = col + rough + metal; return pmats[k] || (pmats[k] = new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal })); }
function mesh(geo, m, parent, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.userData.own = true; parent.add(o); return o; }

// waving flag: pole + fluttering cloth. Origin = where the hand holds the pole.
export function makeFlag(color = '#ffd400') {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.011, 0.013, 1.05, 8), pm('#cfd3d8', 0.35, 0.7), g, 0, 0.36, 0);
  const cloth = new THREE.PlaneGeometry(0.66, 0.46, 12, 5);
  cloth.translate(0.33, 0, 0);
  const base = Float32Array.from(cloth.attributes.position.array);
  const m = mesh(cloth, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.75 }), g, 0, 0.64, 0);
  g.userData.cloth = m;
  g.userData.update = (t, amp = 1) => {
    const p = cloth.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const cx = base[i * 3], cy = base[i * 3 + 1];
      p.setZ(i, (Math.sin(cx * 9 - t * 14 + cy * 3) * 0.075 * (cx / 0.66) + Math.sin(t * 5 + cy * 2) * 0.025 * cx) * amp);
    }
    p.needsUpdate = true; cloth.computeVertexNormals();
  };
  return g;
}

// pneumatic wheel gun. Gun-local: socket tip at the origin, the gun points along -z (into the wheel nut).
export function makeWheelGun(accent = '#e10600') {
  const g = new THREE.Group();
  const metal = pm('#b8bec6', 0.25, 0.9), dark = pm('#2a2c31', 0.45, 0.4), black = pm('#111214', 0.7);
  const cyl = (r1, r2, len, m, z) => { const geo = new THREE.CylinderGeometry(r1, r2, len, 16); geo.rotateX(Math.PI / 2); return mesh(geo, m, g, 0, 0, z + len / 2); };
  const socket = new THREE.Group(); g.add(socket);
  const sg = new THREE.CylinderGeometry(0.026, 0.028, 0.055, 6); sg.rotateX(Math.PI / 2); mesh(sg, metal, socket, 0, 0, 0.0275);
  cyl(0.033, 0.036, 0.035, metal, 0.055);
  cyl(0.043, 0.043, 0.2, dark, 0.09);
  cyl(0.0445, 0.0445, 0.03, pm(accent, 0.4), 0.13);
  cyl(0.04, 0.034, 0.035, black, 0.29);
  const grip = mesh(new THREE.BoxGeometry(0.032, 0.12, 0.046), black, g, 0, -0.075, 0.25); grip.rotation.x = 0.28;
  mesh(new THREE.BoxGeometry(0.008, 0.03, 0.02), metal, g, 0, -0.035, 0.215);
  const hb = new THREE.CylinderGeometry(0.015, 0.015, 0.1, 10); mesh(hb, black, g, 0, 0.085, 0.13);
  mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), dark, g, 0, 0.045, 0.13);
  const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.01, 0.32), new THREE.Vector3(0, -0.06, 0.45), new THREE.Vector3(0, -0.3, 0.55), new THREE.Vector3(0.05, -0.62, 0.62)]), 16, 0.012, 6);
  mesh(hose, black, g);
  g.userData.socket = socket;
  g.userData.rear = new THREE.Vector3(0, -0.078, 0.265); // pistol grip (wrist target)
  g.userData.front = new THREE.Vector3(0, 0.09, 0.13);  // top handle
  return g;
}

// lever jack: cradle under the car, long lever to a T-handle. Driven by setPose(cradle, handle) in world space.
export function makeJack(accent = '#e10600') {
  const g = new THREE.Group();
  const metal = pm('#9aa1aa', 0.35, 0.8), dark = pm('#25272c', 0.5, 0.3);
  const lever = mesh(new THREE.CylinderGeometry(0.024, 0.024, 1, 10), pm(accent, 0.45, 0.2), g);
  const tbar = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10), dark, g);
  const cradle = new THREE.Group(); g.add(cradle);
  mesh(new THREE.BoxGeometry(0.34, 0.035, 0.12), dark, cradle);
  for (const s of [1, -1]) mesh(new THREE.BoxGeometry(0.03, 0.07, 0.12), dark, cradle, s * 0.16, 0.03, 0);
  const frame = mesh(new THREE.BoxGeometry(0.3, 0.05, 0.26), metal, g);
  const strut = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), metal, g);
  const wheels = [0, 1].map(() => { const wg = new THREE.CylinderGeometry(0.05, 0.05, 0.035, 14); wg.rotateZ(Math.PI / 2); return mesh(wg, pm('#111', 0.8), g); });
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), side = new THREE.Vector3(), tmp = new THREE.Vector3();
  g.userData.grip = [new THREE.Vector3(), new THREE.Vector3()];
  // C = cradle (under the car), Hd = T-handle, heading = yaw of the jack (its long axis points away from the car)
  g.userData.setPose = (C, Hd, heading) => {
    d.subVectors(Hd, C); const len = d.length(); d.normalize();
    lever.position.copy(C).addScaledVector(d, len / 2); lever.quaternion.setFromUnitVectors(up, d); lever.scale.set(1, len, 1);
    side.set(Math.cos(heading), 0, -Math.sin(heading));
    tbar.position.copy(Hd); tbar.quaternion.setFromUnitVectors(up, side);
    cradle.position.copy(C); cradle.rotation.set(0, heading, 0);
    // wheeled base on the ground just behind the cradle, strut up to the cradle
    frame.position.copy(C).addScaledVector(d, 0.18); frame.position.y = 0.075; frame.rotation.set(0, heading, 0);
    tmp.subVectors(C, frame.position); const sl = tmp.length(); tmp.normalize();
    strut.position.copy(frame.position).addScaledVector(tmp, sl / 2); strut.quaternion.setFromUnitVectors(up, tmp); strut.scale.set(1, sl, 1);
    wheels.forEach((w, k) => { w.position.copy(frame.position).addScaledVector(side, k ? -0.17 : 0.17); w.position.y = 0.05; w.rotation.set(0, heading, 0); });
    g.userData.grip[0].copy(Hd).addScaledVector(side, 0.16);
    g.userData.grip[1].copy(Hd).addScaledVector(side, -0.16);
  };
  return g;
}

export function makeExtinguisher() {
  const g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.4, 16), pm('#c8141c', 0.35, 0.2), g, 0, 0.2, 0);
  mesh(new THREE.SphereGeometry(0.068, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), pm('#c8141c', 0.35, 0.2), g, 0, 0.4, 0);
  mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.06, 10), pm('#202124', 0.5, 0.5), g, 0, 0.48, 0);
  mesh(new THREE.BoxGeometry(0.11, 0.015, 0.025), pm('#202124', 0.5, 0.5), g, 0.02, 0.52, 0);
  mesh(new THREE.BoxGeometry(0.135, 0.11, 0.004), pm('#f2f2f2', 0.6), g, 0, 0.22, 0.068);
  const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.49, 0), new THREE.Vector3(-0.06, 0.45, 0.04), new THREE.Vector3(-0.085, 0.25, 0.05), new THREE.Vector3(-0.08, 0.12, 0.06)]), 10, 0.009, 6);
  mesh(hose, pm('#111', 0.7), g);
  g.userData.handle = new THREE.Vector3(0.02, 0.53, 0);
  return g;
}

// ---------------------------------------------------------------- person
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export class Person {
  constructor({ costume = MARSHAL_FLAG, scale = 1, skin = Math.floor(Math.random() * SKINS.length) } = {}) {
    const helmet = costume.kind === 'crew' ? 'full' : 'open';
    const geo = bodyGeometry(helmet);
    const sk = makeBones();
    const m = new THREE.SkinnedMesh(geo, costumeMaterials(costume, skin));
    m.add(sk.hips);
    m.updateMatrixWorld(true);
    m.bind(new THREE.Skeleton(sk.bones));
    m.castShadow = true; m.receiveShadow = true;
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.root = new THREE.Group();
    this.root.add(m);
    this.root.scale.setScalar(scale * (0.97 + Math.random() * 0.05));
    this.mesh = m;
    Object.assign(this, sk);
    this.torso = sk.spine;
    this.phase = Math.random() * 6;
    this.seed = Math.random() * 100;
    this.flag = null;
    this.props = [];
  }

  // ---- low level ---------------------------------------------------------
  reset() {
    this.hips.position.set(0, 0.95, 0); this.hips.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0); this.chest.rotation.set(0, 0, 0); this.neck.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    for (const a of [this.L, this.R]) {
      a.sh.rotation.set(0.02, 0, a.s * 0.1); a.el.rotation.set(-0.16, 0, 0); a.wr.rotation.set(0, 0, 0); a.fg.rotation.set(0, 0, -a.s * 0.4);
      a.hip.rotation.set(0, 0, 0); a.kn.rotation.set(0, 0, 0); a.an.rotation.set(0, 0, 0);
    }
  }
  // upper body: hip height, forward lean (rad), twist (yaw), roll; head turns are relative to the chest
  body({ y = 0.95, x = 0, z = 0, lean = 0, twist = 0, roll = 0, hipPitch = null, headPitch = 0, headYaw = 0 } = {}) {
    this.hips.position.set(x, y, z);
    const hp = hipPitch === null ? lean * 0.45 : hipPitch;
    this.hips.rotation.set(hp, twist * 0.35, roll * 0.4);
    const rest = lean - hp;
    this.spine.rotation.set(rest * 0.5, twist * 0.3, roll * 0.3);
    this.chest.rotation.set(rest * 0.5, twist * 0.35, roll * 0.3);
    this.neck.rotation.set(-lean * 0.45 + headPitch * 0.5, headYaw * 0.5, 0);
    this.head.rotation.set(-lean * 0.25 + headPitch * 0.5, headYaw * 0.5, -roll * 0.3);
  }
  update() { this.root.updateMatrixWorld(true); }
  // root-local point -> world
  world(x, y, z, out = _p) { return this.root.localToWorld(out.set(x, y, z)); }
  // foot planted at root-local (x, z) (ankle above it); pitch tilts the foot (toes down > 0)
  foot(a, x, z, { lift = 0, pitch = 0, yaw = 0, knee = 0.15 } = {}) {
    this.world(x, ANKLE_H + lift, z, _v);
    this.hips.worldToLocal(_v);
    this.root.getWorldQuaternion(_q2);
    const pole = dirToLocal(this.hips, _v2.set(a.s * knee, 0, 1).applyQuaternion(_q2), _v3);
    solveTwoBone(a.hip, a.kn, SHIN, _v, pole, 1);
    a.hip.updateMatrixWorld(true);
    _q.setFromEuler(_e.set(pitch, yaw, 0)).premultiply(_q2);
    setWorldQuat(a.an, _q);
  }
  // wrist to a world position; pole = world direction the elbow should point (default: out and back)
  hand(a, target, pole = null) {
    _v.copy(target); this.chest.worldToLocal(_v);
    const pl = pole ? dirToLocal(this.chest, pole, _v2) : _v2.set(a.s * 0.7, -0.6, -0.5);
    solveTwoBone(a.sh, a.el, FORE, _v, pl, -1);
    a.sh.updateMatrixWorld(true);
  }
  // hand orientation from a world quaternion
  handQuat(a, q) { setWorldQuat(a.wr, q); }
  grip(a, k) { a.fg.rotation.set(0, 0, -a.s * (0.25 + k * 1.15)); }
  lookAt(world, k = 1) {
    _v.copy(world); this.chest.worldToLocal(_v);
    const yaw = clamp(Math.atan2(_v.x, _v.z), -1.1, 1.1) * k, pitch = clamp(-Math.atan2(_v.y - 0.35, Math.hypot(_v.x, _v.z)), -0.6, 0.7) * k;
    this.neck.rotation.y += yaw * 0.45; this.head.rotation.y += yaw * 0.55;
    this.neck.rotation.x += pitch * 0.4; this.head.rotation.x += pitch * 0.5;
  }
  arm(a, shX, shZ, el, wr = 0) { a.sh.rotation.set(shX, 0, a.s * shZ); a.el.rotation.set(-el, 0, 0); a.wr.rotation.set(wr, 0, 0); }
  stance(feet, opts = {}) { this.foot(this.L, feet[0], feet[1], opts.L || {}); this.foot(this.R, feet[2], feet[3], opts.R || {}); }

  // ---- whole-body poses --------------------------------------------------
  idle(t, { weight = 0, arms = true } = {}) {
    this.reset();
    const w = Math.sin(t * 0.5 + this.seed) * 0.5 + weight, b = Math.sin(t * 1.6 + this.seed) * 0.008;
    this.body({ y: 0.935 + b * 0.3, x: w * 0.02, roll: -w * 0.03, lean: 0.03 + b, headYaw: Math.sin(t * 0.31 + this.seed) * 0.4, headPitch: 0.05 });
    this.update();
    this.stance([0.12, 0.02, -0.12, -0.01], { L: { yaw: 0.15 }, R: { yaw: -0.15 } });
    if (arms) { this.arm(this.L, 0.05 + b * 3, 0.12, 0.22); this.arm(this.R, 0.04 - b * 3, 0.12, 0.25); this.grip(this.L, 0.2); this.grip(this.R, 0.2); }
  }
  // athletic ready stance (crew waiting for the car)
  ready(t, depth = 0.5, lean = 0.35) {
    this.reset();
    const b = Math.sin(t * 2.2 + this.seed) * 0.006;
    this.body({ y: 0.95 - depth * 0.3 + b, lean: lean + b, headPitch: -0.1 });
    this.update();
    this.stance([0.17, 0.06, -0.17, -0.06], { L: { yaw: 0.2 }, R: { yaw: -0.2 } });
  }
  // FK walk / run. speed in m/s
  gait(dt, speed, { lean = 0, arms = true } = {}) {
    this.reset();
    const run = speed > 2.7, stride = Math.min(1, speed / (run ? 5.5 : 1.6));
    const freq = run ? 1.45 + speed * 0.11 : 0.85 + speed * 0.5;
    this.phase += dt * freq * Math.PI * 2;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = (run ? 0.8 : 0.42) * stride;
    const L = this.L, R = this.R;
    L.hip.rotation.x = -s * amp - (run ? 0.12 : 0) * stride; R.hip.rotation.x = s * amp - (run ? 0.12 : 0) * stride;
    L.kn.rotation.x = (Math.max(0, c) * (run ? 1.5 : 0.65) + (run ? 0.25 : 0.06)) * stride + 0.04;
    R.kn.rotation.x = (Math.max(0, -c) * (run ? 1.5 : 0.65) + (run ? 0.25 : 0.06)) * stride + 0.04;
    L.an.rotation.x = -L.kn.rotation.x * 0.35 + Math.max(0, -s) * 0.3 * stride;
    R.an.rotation.x = -R.kn.rotation.x * 0.35 + Math.max(0, s) * 0.3 * stride;
    const bob = Math.abs(c) * (run ? 0.055 : 0.022) * stride;
    this.body({ y: 0.95 - (run ? 0.07 : 0.02) * stride + bob, lean: lean + (run ? 0.2 : 0.04) * stride, twist: -s * 0.18 * stride, hipPitch: 0.02 });
    this.hips.rotation.y = s * 0.1 * stride;
    if (arms) {
      this.arm(L, s * amp * 0.85, 0.1, run ? 1.45 : 0.3 + Math.max(0, s) * 0.2);
      this.arm(R, -s * amp * 0.85, 0.1, run ? 1.45 : 0.3 + Math.max(0, -s) * 0.2);
      this.grip(L, run ? 0.7 : 0.25); this.grip(R, run ? 0.7 : 0.25);
    }
  }
  // flag marshal waving at oncoming cars: figure-of-eight right arm, body swaying into it
  attachFlag(color) {
    this.flag = makeFlag(color);
    this.flag.rotation.set(0.15, 0, -0.15);
    this.flag.position.set(0, -0.07, 0.01);
    this.R.wr.add(this.flag);
    return this.flag;
  }
  waveFlag(t, amp = 1) {
    this.reset();
    const w = t * 7.2;
    this.body({ y: 0.94 + Math.abs(Math.sin(w)) * 0.01 * amp, lean: 0.05, twist: Math.sin(w * 0.5) * 0.14 * amp, roll: -Math.sin(w * 0.5) * 0.06 * amp, headYaw: -Math.sin(w * 0.5) * 0.12 });
    this.update();
    this.stance([0.15, 0.06, -0.15, -0.05], { L: { yaw: 0.2 }, R: { yaw: -0.25 } });
    const R = this.R, L = this.L;
    R.sh.rotation.set(-2.5 + Math.sin(w) * 0.42 * amp, 0, -(0.32 + Math.sin(w * 0.5) * 0.5 * amp));
    R.el.rotation.set(-0.25 - Math.max(0, Math.sin(w)) * 0.35 * amp, 0, 0);
    R.wr.rotation.set(0, 0, Math.sin(w * 0.5 + 0.6) * 0.45 * amp);
    this.grip(R, 1);
    this.arm(L, -0.3 + Math.sin(w * 0.5) * 0.1, 0.22, 0.95);
    this.grip(L, 0.4);
    if (this.flag) this.flag.userData.update(t, amp);
  }
  holdFlag(t) {
    this.idle(t);
    const R = this.R;
    R.sh.rotation.set(-0.35, 0, -0.18); R.el.rotation.set(-0.9, 0, 0); R.wr.rotation.set(0.9, 0, 0.1);
    this.grip(R, 1);
    if (this.flag) this.flag.userData.update(t, 0.15);
  }
  // raise one arm (done / release signal)
  signal(a, t) { a.sh.rotation.set(-2.85, 0, a.s * 0.18); a.el.rotation.set(-0.15, 0, 0); a.wr.rotation.set(0, 0, Math.sin(t * 9) * 0.25); this.grip(a, 0.15); }
}

export function makePerson(opts) { return new Person(opts); }
export function lerpAngle(a, b, t) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; }
export const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
