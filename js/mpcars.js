// Online race helpers: pack a car into a compact snapshot, and smoothly replay other players' cars
// (snapshot interpolation ~110 ms in the past, short extrapolation if packets are late).
import * as THREE from 'three';

export const SEND_HZ = 15;
const DELAY = 0.11; // seconds of interpolation buffer
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

// [t, x, z, heading, u, w, r, steer, rpm, gear, throttle, brake, totalDist, flags, lastLap, bestLap, y]
export function packCar(c) {
  const p = c.phys;
  const flags = (c.drsOpen ? 1 : 0) | (p.ersDeploying ? 2 : 0) | (p.lock > 0.5 ? 4 : 0) | (p.harvesting ? 8 : 0) | (c.frozen ? 16 : 0);
  return [Math.round(performance.now()), r2(p.x), r2(p.z), r3(p.heading), r2(p.u), r2(p.w), r3(p.r), r3(p.steer), Math.round(p.rpm), p.gear,
    r2(p.throttle), r2(p.brake), Math.round(c.totalDist * 10) / 10, flags, c.lastLap ? r3(c.lastLap) : 0, c.bestLap ? r3(c.bestLap) : 0, r2(c.proj.y)];
}

export function makeRemote() { return { buf: [], off: null, dist: 0, lastLap: null, bestLap: null, seen: 0 }; }

// called when a snapshot arrives for a remote car
export function pushSnapshot(rem, d) {
  if (!Array.isArray(d) || d.length < 16 || !d.every(Number.isFinite)) return;
  const now = performance.now();
  const sample = now - d[0];
  // new sender (e.g. host migrated) or clock jump: start over
  if (rem.off === null || Math.abs(sample - rem.off) > 1500) { rem.off = sample; rem.buf.length = 0; }
  else rem.off += (sample - rem.off) * (sample < rem.off ? 0.3 : 0.02); // track the fastest delivery
  const last = rem.buf[rem.buf.length - 1];
  if (last && d[0] <= last[0]) return; // out of order
  rem.buf.push(d);
  if (rem.buf.length > 30) rem.buf.splice(0, rem.buf.length - 30);
  rem.seen = now;
}

const lerp = (a, b, f) => a + (b - a) * f;
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

// write the interpolated state into the car (physics object is used only for display + collisions)
export function applyRemote(c) {
  const rem = c.remote, buf = rem.buf;
  if (!buf.length) return false;
  const t = performance.now() - rem.off - DELAY * 1000;
  let a = buf[0], b = null;
  for (let k = buf.length - 1; k >= 0; k--) if (buf[k][0] <= t) { a = buf[k]; b = buf[k + 1] || null; break; }
  const p = c.phys;
  let f = 0;
  if (b) f = Math.min(1, Math.max(0, (t - a[0]) / ((b[0] - a[0]) || 1)));
  // teleport (reset / pit / rescue): snap instead of sliding across the map
  const jump = b && Math.hypot(b[1] - a[1], b[2] - a[2]) > 40;
  if (b && !jump) {
    p.x = lerp(a[1], b[1], f); p.z = lerp(a[2], b[2], f); p.heading = lerpAngle(a[3], b[3], f);
    p.u = lerp(a[4], b[4], f); p.w = lerp(a[5], b[5], f); p.r = lerp(a[6], b[6], f); p.steer = lerp(a[7], b[7], f);
    rem.dist = lerp(a[12], b[12], f);
  } else {
    const s = jump ? (f > 0.5 ? b : a) : a;
    // late packets: extrapolate along the velocity for up to 0.3 s
    const ex = jump ? 0 : Math.min(0.3, Math.max(0, (t - s[0]) / 1000));
    const sh = Math.sin(s[3]), ch = Math.cos(s[3]);
    p.x = s[1] + (sh * s[4] + ch * s[5]) * ex; p.z = s[2] + (ch * s[4] - sh * s[5]) * ex;
    p.heading = s[3] + s[6] * ex; p.u = s[4]; p.w = s[5]; p.r = s[6]; p.steer = s[7];
    rem.dist = s[12] + s[4] * ex;
  }
  const s = b && f > 0.5 ? b : a;
  p.rpm = s[8]; p.gear = s[9]; p.throttle = s[10]; p.brake = s[11];
  c.drsOpen = !!(s[13] & 1); p.ersDeploying = !!(s[13] & 2); p.lock = s[13] & 4 ? 1 : 0; p.harvesting = !!(s[13] & 8);
  p.slipR = 0; p.spin = 0; p.axF = 0; p.ay = p.u * p.r;
  rem.lastLap = s[14] || null; rem.bestLap = s[15] || null;
  return true;
}

// floating name above other players' cars
export function makeNameTag(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '900 italic 34px "Titillium Web", "Segoe UI", Arial, sans-serif';
  const w = Math.min(244, ctx.measureText(text).width + 34);
  ctx.fillStyle = 'rgba(8,8,14,0.78)';
  ctx.fillRect((256 - w) / 2, 8, w, 48);
  ctx.fillStyle = color; ctx.fillRect((256 - w) / 2, 8, 7, 48);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128 + 3, 33, 230);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(2.6, 0.65, 1);
  sp.position.set(0, 1.75, 0);
  sp.renderOrder = 5;
  return sp;
}
