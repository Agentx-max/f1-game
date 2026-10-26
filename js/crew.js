import * as THREE from 'three';

// Procedural, jointed humanoid (≈1.8 m) used for track marshals and pit crew.
// Joint convention: rotation.x < 0 swings a limb forward (person faces +z).
const G = {};
function geos() {
  if (G.torso) return G;
  G.torso = new THREE.CapsuleGeometry(0.17, 0.36, 4, 12); G.torso.scale(1, 1, 0.68); G.torso.translate(0, 0.3, 0);
  G.pelvis = new THREE.CapsuleGeometry(0.15, 0.08, 4, 10); G.pelvis.scale(1.05, 1, 0.75);
  G.head = new THREE.SphereGeometry(0.115, 16, 12);
  G.helmet = new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  G.visor = new THREE.SphereGeometry(0.138, 14, 6, Math.PI / 2 - 0.9, 1.8, 1.05, 0.55);
  G.cap = new THREE.CylinderGeometry(0.12, 0.125, 0.07, 14);
  G.brim = new THREE.BoxGeometry(0.2, 0.012, 0.12);
  G.upperArm = new THREE.CapsuleGeometry(0.052, 0.22, 4, 8); G.upperArm.translate(0, -0.14, 0);
  G.foreArm = new THREE.CapsuleGeometry(0.045, 0.2, 4, 8); G.foreArm.translate(0, -0.13, 0);
  G.hand = new THREE.BoxGeometry(0.07, 0.1, 0.04); G.hand.translate(0, -0.05, 0);
  G.thigh = new THREE.CapsuleGeometry(0.075, 0.3, 4, 8); G.thigh.translate(0, -0.21, 0);
  G.shin = new THREE.CapsuleGeometry(0.06, 0.32, 4, 8); G.shin.translate(0, -0.21, 0);
  G.boot = new THREE.BoxGeometry(0.11, 0.08, 0.26); G.boot.translate(0, -0.04, 0.05);
  G.stripe = new THREE.TorusGeometry(0.155, 0.012, 6, 20); G.stripe.rotateX(Math.PI / 2); G.stripe.scale(1, 1, 0.7);
  return G;
}
const mats = {};
function mat(col, rough = 0.8, metal = 0) {
  const k = col + rough + metal;
  if (!mats[k]) mats[k] = new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal });
  return mats[k];
}

// ---- costumes: painted suit textures (torso = lathe UVs: u wraps around, u=0.5 is the back) ----
const costumeCache = {};
function costumeMats(c) {
  const key = JSON.stringify(c);
  if (costumeCache[key]) return costumeCache[key];
  const S = 256;
  const mk = (draw) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'); draw(ctx);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.82 });
  };
  const reflective = (ctx, y, h) => {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#9aa0a6'); g.addColorStop(0.5, '#f4f6f8'); g.addColorStop(1, '#9aa0a6');
    ctx.fillStyle = g; ctx.fillRect(0, y, S, h);
  };
  const fabric = (ctx) => { for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2); } };
  const torso = mk(ctx => {
    ctx.fillStyle = c.base; ctx.fillRect(0, 0, S, S);
    if (c.kind === 'marshal') {
      reflective(ctx, S * 0.3, S * 0.07); reflective(ctx, S * 0.62, S * 0.07);
      ctx.fillStyle = '#111'; ctx.font = `900 ${S * 0.09}px "Titillium Web", Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('MARSHAL', S * 0.5, S * 0.47);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(S * 0.06, S * 0.4, S * 0.08, S * 0.12); // chest ID badge
    } else {
      // team fire suit: dark side panels, accent piping, sponsor patches, team name on the back
      ctx.fillStyle = c.panel; ctx.fillRect(S * 0.2, 0, S * 0.1, S); ctx.fillRect(S * 0.7, 0, S * 0.1, S);
      ctx.fillStyle = c.accent; ctx.fillRect(S * 0.3, 0, S * 0.012, S); ctx.fillRect(S * 0.69, 0, S * 0.012, S);
      ctx.fillStyle = c.panel; ctx.fillRect(0, S * 0.84, S, S * 0.05);
      ctx.fillStyle = c.text; ctx.font = `italic 900 ${S * 0.085}px "Titillium Web", Arial Black, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.name, S * 0.5, S * 0.42);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(S * 0.04, S * 0.4, S * 0.1, S * 0.06); ctx.fillRect(S * 0.88, S * 0.4, S * 0.1, S * 0.06);
      ctx.fillStyle = c.accent; ctx.fillRect(S * 0.045, S * 0.41, S * 0.09, S * 0.04);
    }
    fabric(ctx);
  });
  const limb = mk(ctx => {
    ctx.fillStyle = c.base; ctx.fillRect(0, 0, S, S);
    if (c.kind === 'marshal') reflective(ctx, S * 0.42, S * 0.12);
    else { ctx.fillStyle = c.panel; ctx.fillRect(0, 0, S * 0.12, S); ctx.fillStyle = c.accent; ctx.fillRect(S * 0.12, 0, S * 0.02, S); }
    fabric(ctx);
  });
  return (costumeCache[key] = { torso, limb });
}

// waving flag prop (pole + fluttering cloth)
export function makeFlag(color = '#ffd400') {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6), mat('#d8d8d8', 0.4, 0.6));
  pole.position.y = -0.5; g.add(pole);
  const cloth = new THREE.PlaneGeometry(0.62, 0.44, 10, 4);
  cloth.translate(0.31, 0, 0);
  const base = Float32Array.from(cloth.attributes.position.array);
  const m = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.7 }));
  m.position.set(0, -0.76, 0);
  g.add(m);
  g.userData.update = (t) => {
    const p = cloth.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      p.setZ(i, Math.sin(x * 9 - t * 14 + y * 3) * 0.07 * (x / 0.62) + Math.sin(t * 5) * 0.02 * x);
    }
    p.needsUpdate = true; cloth.computeVertexNormals();
  };
  return g;
}

export function makePerson({ suit = '#ff7a00', trim = '#ffffff', helmet = null, skin = '#c99a76', boots = '#1a1a1a', cap = null, costume = null, gloves = '#202020' } = {}) {
  const g = geos();
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const add = (parent, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const cm = costume ? costumeMats(costume) : null;
  const suitM = cm ? cm.limb : mat(suit, 0.85), torsoM = cm ? cm.torso : suitM;
  const trimM = mat(trim, 0.6), skinM = mat(skin, 0.7), bootM = mat(boots, 0.6);
  add(hips, g.pelvis, suitM);
  const torso = new THREE.Group(); torso.position.y = 0.06; hips.add(torso);
  add(torso, g.torso, torsoM);
  if (!costume) { const band = add(torso, g.stripe, trimM, 0, 0.32, 0); band.scale.set(1.05, 1, 1.05); }
  const neck = new THREE.Group(); neck.position.y = 0.66; torso.add(neck);
  const head = add(neck, g.head, skinM, 0, 0.1, 0);
  if (helmet) {
    add(head, g.helmet, mat(helmet, 0.3, 0.2), 0, 0.01, 0);
    add(head, g.visor, mat('#0d1117', 0.05, 0.6), 0, 0.0, 0);
  } else if (cap) {
    add(head, g.cap, mat(cap, 0.7), 0, 0.08, 0);
    add(head, g.brim, mat(cap, 0.7), 0, 0.05, 0.1);
  }
  const limb = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.22, 0.56, 0); torso.add(sh);
    add(sh, g.upperArm, suitM);
    const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
    add(el, g.foreArm, suitM);
    const wr = new THREE.Group(); wr.position.y = -0.27; el.add(wr);
    add(wr, g.hand, mat(gloves, 0.8));
    const hip = new THREE.Group(); hip.position.set(side * 0.1, -0.04, 0); hips.add(hip);
    add(hip, g.thigh, suitM);
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn);
    add(kn, g.shin, suitM);
    const an = new THREE.Group(); an.position.y = -0.44; kn.add(an);
    add(an, g.boot, bootM);
    return { sh, el, wr, hip, kn, an };
  };
  const L = limb(1), R = limb(-1);
  const p = { root, hips, torso, neck, head, L, R, phase: Math.random() * 6, prop: null };

  // ---- poses -------------------------------------------------------------
  p.reset = () => {
    hips.position.y = 0.95; hips.rotation.set(0, 0, 0); torso.rotation.set(0, 0, 0); neck.rotation.set(0, 0, 0);
    for (const s of [L, R]) { s.sh.rotation.set(0, 0, 0); s.el.rotation.set(0, 0, 0); s.wr.rotation.set(0, 0, 0); s.hip.rotation.set(0, 0, 0); s.kn.rotation.set(0, 0, 0); s.an.rotation.set(0, 0, 0); }
  };
  // gait: speed in m/s (0 = idle). lean = forward torso lean in radians
  p.gait = (dt, speed, { lean = 0, armsForward = null } = {}) => {
    p.reset();
    const run = speed > 2.6;
    const stride = Math.min(1, speed / (run ? 5 : 1.6));
    const freq = run ? 1.55 + speed * 0.12 : 0.9 + speed * 0.55;
    p.phase += dt * freq * Math.PI * 2;
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    const amp = (run ? 0.85 : 0.45) * stride;
    L.hip.rotation.x = -s * amp; R.hip.rotation.x = s * amp;
    L.kn.rotation.x = Math.max(0, c) * (run ? 1.4 : 0.6) * stride + 0.05;
    R.kn.rotation.x = Math.max(0, -c) * (run ? 1.4 : 0.6) * stride + 0.05;
    L.an.rotation.x = -L.kn.rotation.x * 0.3; R.an.rotation.x = -R.kn.rotation.x * 0.3;
    hips.position.y = 0.95 - (run ? 0.06 : 0.02) * stride + Math.abs(c) * (run ? 0.06 : 0.025) * stride;
    hips.rotation.y = s * 0.08 * stride;
    torso.rotation.y = -s * 0.14 * stride;
    torso.rotation.x = lean + (run ? 0.18 : 0.03) * stride;
    neck.rotation.x = -torso.rotation.x * 0.7;
    if (armsForward == null) {
      L.sh.rotation.x = s * amp * 0.9; R.sh.rotation.x = -s * amp * 0.9;
      L.el.rotation.x = -(run ? 1.5 : 0.35); R.el.rotation.x = -(run ? 1.5 : 0.35);
      L.sh.rotation.z = 0.08; R.sh.rotation.z = -0.08;
    } else {
      for (const a of [L, R]) { a.sh.rotation.x = -armsForward; a.el.rotation.x = -0.25; a.wr.rotation.x = -0.6; }
      L.sh.rotation.z = -0.12; R.sh.rotation.z = 0.12;
    }
  };
  // leaning hard into the car, arms locked out, legs driving
  p.push = (dt, speed) => {
    p.gait(dt, Math.max(0.5, speed), { lean: 0.62, armsForward: 1.25 });
    hips.position.y -= 0.07;
    L.hip.rotation.x -= 0.25; R.hip.rotation.x -= 0.25;
  };
  p.kneel = (t = 0) => {
    p.reset();
    hips.position.y = 0.52;
    L.hip.rotation.x = -1.45; L.kn.rotation.x = 1.45;
    R.hip.rotation.x = 0.2; R.kn.rotation.x = 1.6; R.an.rotation.x = 0.5;
    torso.rotation.x = 0.35;
    for (const a of [L, R]) { a.sh.rotation.x = -1.1 - Math.sin(t * 30) * 0.03; a.el.rotation.x = -0.5; }
  };
  p.crouchHold = () => { p.reset(); hips.position.y = 0.72; L.hip.rotation.x = R.hip.rotation.x = -0.9; L.kn.rotation.x = R.kn.rotation.x = 1.5; L.an.rotation.x = R.an.rotation.x = -0.5; torso.rotation.x = 0.6; for (const a of [L, R]) { a.sh.rotation.x = -1.2; a.el.rotation.x = -0.3; } };
  p.carry = (dt, speed) => { p.gait(dt, speed, { lean: 0.1, armsForward: 0.95 }); for (const a of [L, R]) a.el.rotation.x = -0.9; };
  p.raiseArm = (t) => { p.reset(); R.sh.rotation.x = -2.9; R.el.rotation.x = -0.1; L.sh.rotation.z = 0.15; R.wr.rotation.z = Math.sin(t * 8) * 0.3; };
  p.jack = (k) => { p.reset(); torso.rotation.x = 0.25 - k * 0.35; hips.position.y = 0.93; L.hip.rotation.x = -0.3 + k * 0.4; R.hip.rotation.x = 0.35; R.kn.rotation.x = 0.2; for (const a of [L, R]) { a.sh.rotation.x = -0.9 + k * 0.4; a.el.rotation.x = -0.3; } };
  // waving a flag at oncoming traffic: big figure-of-eight arm motion, body leaning into it
  p.attachFlag = (color) => { p.flag = makeFlag(color); R.wr.add(p.flag); return p.flag; };
  p.waveFlag = (t) => {
    p.reset();
    const w = t * 7.5;
    R.sh.rotation.x = -2.55 + Math.sin(w) * 0.45;
    R.sh.rotation.z = -0.35 + Math.sin(w * 0.5) * 0.55;
    R.el.rotation.x = -0.25 - Math.max(0, Math.sin(w)) * 0.35;
    R.wr.rotation.z = Math.sin(w * 0.5 + 0.6) * 0.5;
    L.sh.rotation.x = -0.35 + Math.sin(w * 0.5) * 0.12; L.sh.rotation.z = 0.25; L.el.rotation.x = -0.9;
    torso.rotation.z = -Math.sin(w * 0.5) * 0.08; torso.rotation.y = Math.sin(w * 0.5) * 0.12; torso.rotation.x = 0.06;
    neck.rotation.y = -torso.rotation.y;
    hips.position.y = 0.94 + Math.abs(Math.sin(w)) * 0.012;
    L.hip.rotation.x = -0.12; R.hip.rotation.x = 0.1; L.kn.rotation.x = 0.12; R.kn.rotation.x = 0.06;
    if (p.flag) p.flag.userData.update(t);
  };
  p.idle = (t) => { p.reset(); torso.rotation.x = 0.04 + Math.sin(t * 1.5 + p.phase) * 0.015; L.sh.rotation.z = 0.06; R.sh.rotation.z = -0.06; L.el.rotation.x = R.el.rotation.x = -0.15; };
  return p;
}

// helpers
export function lerpAngle(a, b, t) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; }
export const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
