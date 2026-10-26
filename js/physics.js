// Vehicle dynamics: bicycle model with Pacejka-style tyres, aero downforce/drag,
// load transfer, friction circle, gearbox, ERS, DRS, walls and car-to-car contacts.
import { SURF } from './track.js';

export const BASE_SPEC = {
  mass: 800, Iz: 1150, a: 1.98, b: 1.62, cgH: 0.3,
  ClA: 5.0, CdA: 1.1, aeroBal: 0.44, mu: 1.85,
  power: 580000, ersPower: 120000, maxBrake: 56000, brakeBias: 0.58,
  gearTop: [92, 128, 160, 193, 228, 265, 305, 356].map(k => k / 3.6),
  revLimit: 12500, idle: 4200,
  Bf: 17, Br: 19, C: 1.45,
  length: 5.6, width: 1.95,
};

export function makeSpec(perf = { power: 1, aero: 1 }) {
  return { ...BASE_SPEC, power: BASE_SPEC.power * perf.power, ClA: BASE_SPEC.ClA * perf.aero, mu: BASE_SPEC.mu * (0.985 + 0.015 * perf.aero) };
}

const G = 9.81, RHO = 1.225;

function powerCurve(x) {
  if (x < 0.3) return 0.55;
  if (x < 0.93) return 0.55 + 0.45 * Math.sin((x - 0.3) / 0.63 * Math.PI / 2);
  return 1 - (x - 0.93) * 1.2;
}

export class CarPhysics {
  constructor(spec) {
    this.spec = spec;
    this.L = spec.a + spec.b;
    this.reset(0, 0, 0, 0);
  }

  reset(x, z, heading, speed = 0) {
    this.x = x; this.z = z; this.y = 0; this.heading = heading;
    this.u = speed; this.w = 0; this.r = 0;
    this.ax = 0; this.ay = 0; this.axF = 0;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftT = 0;
    this.steer = 0;
    this.throttle = 0; this.brake = 0;
    this.slipF = 0; this.slipR = 0; this.spin = 0; this.lock = 0;
    this.ers = this.spec.ersMax || 4.0e6; this.gripMul = 1; this.ersHarvest = 0; this.ersDeploying = false; this.harvesting = false;
    this.drs = false;
    this.surfF = SURF.road; this.surfR = SURF.road;
    this.dragMul = 1; this.downMul = 1;
    this.grade = 0;
    this.limiter = false;
    this.fzF = 0; this.fzR = 0;
  }

  get speed() { return Math.hypot(this.u, this.w); }

  // world-space velocity
  get vx() { return Math.sin(this.heading) * this.u + Math.cos(this.heading) * this.w; }
  get vz() { return Math.cos(this.heading) * this.u - Math.sin(this.heading) * this.w; }
  setWorldVel(vx, vz) {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    this.u = vx * s + vz * c;
    this.w = vx * c - vz * s;
  }

  tyre(alpha, B) {
    const C = this.spec.C;
    return Math.sin(C * Math.atan(B * alpha));
  }

  // controls: {throttle, brake, steerAngle, ers, tc, abs, autoGear, shiftUp, shiftDown}
  step(dt, ctl) {
    const S = this.spec, m = S.mass;
    const u = this.u, w = this.w, r = this.r;
    const absU = Math.abs(u);
    this.steer = ctl.steerAngle;
    this.throttle = ctl.throttle; this.brake = ctl.brake;

    // aero
    const q = 0.5 * RHO * u * u;
    const down = q * S.ClA * this.downMul * (this.drs ? 0.9 : 1);
    const drag = q * S.CdA * this.dragMul * (this.drs ? 0.8 : 1);

    // loads (with longitudinal load transfer)
    const dF = m * this.axF * S.cgH / this.L;
    let fzF = m * G * S.b / this.L + down * S.aeroBal - dF;
    let fzR = m * G * S.a / this.L + down * (1 - S.aeroBal) + dF;
    fzF = Math.max(fzF, 400); fzR = Math.max(fzR, 400);
    this.fzF = fzF; this.fzR = fzR;
    const muF = S.mu * this.surfF.grip * this.gripMul, muR = S.mu * this.surfR.grip * 1.03 * this.gripMul;
    const capF = muF * fzF, capR = muR * fzR;

    // tyre slip
    const d = ctl.steerAngle;
    const cd = Math.cos(d), sd = Math.sin(d);
    const vfLat0 = w + S.a * r;
    const vfLong = u * cd + vfLat0 * sd;
    const vfLat = vfLat0 * cd - u * sd;
    const minV = 3.5;
    const alphaF = Math.atan2(vfLat, Math.max(Math.abs(vfLong), minV));
    const vrLat = w - S.b * r;
    const alphaR = Math.atan2(vrLat, Math.max(absU, minV));
    let fyF = -capF * this.tyre(alphaF, S.Bf);
    let fyR = -capR * this.tyre(alphaR, S.Br);
    this.slipF = alphaF; this.slipR = alphaR;

    // gearbox & engine
    const gt = S.gearTop;
    if (this.shiftT > 0) this.shiftT -= dt;
    const rpmOf = g => (absU / gt[g - 1]) * S.revLimit;
    if (ctl.autoGear) {
      if (this.gear < 8 && rpmOf(this.gear) > S.revLimit * 0.965 && this.shiftT <= 0) { this.gear++; this.shiftT = 0.05; }
      else if (this.gear > 1 && rpmOf(this.gear - 1) < S.revLimit * 0.86 && rpmOf(this.gear) < S.revLimit * 0.68 && this.shiftT <= 0) { this.gear--; this.shiftT = 0.05; }
    } else {
      if (ctl.shiftUp && this.gear < 8) { this.gear++; this.shiftT = 0.05; }
      if (ctl.shiftDown && this.gear > 1 && rpmOf(this.gear - 1) < S.revLimit * 1.02) { this.gear--; this.shiftT = 0.05; }
    }
    let rpmWheel = rpmOf(this.gear);
    let rpm = Math.max(rpmWheel, S.idle);
    if (this.gear === 1 && absU < 12) rpm = Math.max(rpm, S.idle + ctl.throttle * 6800);
    this.limiter = rpmWheel >= S.revLimit;
    let power = S.power * powerCurve(Math.min(rpm, S.revLimit) / S.revLimit);
    // ERS
    this.ersDeploying = false;
    if (ctl.ers && this.ers > 0 && ctl.throttle > 0.5) {
      power += S.ersPower; this.ers -= S.ersPower * dt; this.ersDeploying = true;
    }
    const vEff = Math.max(absU, gt[this.gear - 1] * 0.3);
    let drive = ctl.throttle * power / vEff;
    if (this.limiter || this.shiftT > 0) drive *= this.limiter ? 0 : 0.3;
    // reverse when stopped and holding brake
    let reverse = false;
    if (ctl.brake > 0.5 && ctl.throttle < 0.1 && u < 0.8) { reverse = true; drive = -ctl.brake * 4000; }

    // brakes
    let brakeF = 0, brakeR = 0;
    if (!reverse) {
      const bf = ctl.brake * S.maxBrake;
      const sgn = absU > 0.3 ? Math.sign(u) : 0;
      brakeF = bf * S.brakeBias * sgn; brakeR = bf * (1 - S.brakeBias) * sgn;
      if (absU <= 0.3 && ctl.brake > 0.1) { this.u *= 0.8; }
    }
    // engine braking + harvest
    let engBrake = 0;
    if (ctl.throttle < 0.05 && absU > 1) engBrake = 900 + 1800 * (rpm / S.revLimit);
    this.harvesting = false;
    const ersMax = S.ersMax || 4.0e6;
    if (ctl.brake > 0.2 && absU > 15 && this.ers < ersMax) { this.ers += 80000 * ctl.brake * dt; this.harvesting = true; }
    if (ctl.throttle < 0.05 && absU > 30 && this.ers < ersMax) { this.ers += 20000 * dt; this.harvesting = true; }
    this.ers = Math.min(ersMax, Math.max(0, this.ers));

    // rear combined slip
    let fxR = drive - brakeR - engBrake * Math.sign(u);
    this.spin = 0;
    if (ctl.tc) {
      const allow = Math.sqrt(Math.max(capR * capR * 0.2, capR * capR - fyR * fyR)) * 0.98;
      if (fxR > allow) fxR = allow;
      const t = Math.hypot(fxR, fyR);
      if (t > capR) fyR *= Math.sqrt(Math.max(0, capR * capR - fxR * fxR)) / Math.abs(fyR || 1);
    } else {
      if (Math.abs(fxR) > capR) {
        this.spin = Math.min(1, (Math.abs(fxR) - capR) / capR + 0.3);
        fxR = Math.sign(fxR) * capR * 0.82;
        fyR *= 0.55;
      } else {
        const t = Math.hypot(fxR, fyR);
        if (t > capR) fyR = Math.sign(fyR) * Math.sqrt(Math.max(0, capR * capR - fxR * fxR));
      }
    }
    // front combined slip
    let fxF = -brakeF;
    this.lock = 0;
    if (ctl.abs) {
      const allow = Math.sqrt(Math.max(capF * capF * 0.3, capF * capF - fyF * fyF));
      if (Math.abs(fxF) > allow) fxF = Math.sign(fxF) * allow;
      const t = Math.hypot(fxF, fyF);
      if (t > capF) fyF *= Math.sqrt(Math.max(0, capF * capF - fxF * fxF)) / Math.abs(fyF || 1);
    } else if (Math.abs(fxF) > capF * 0.98) {
      this.lock = Math.min(1, (Math.abs(fxF) - capF) / capF + 0.4);
      fxF = Math.sign(fxF) * capF * 0.8;
      fyF *= 0.3;
    } else {
      const t = Math.hypot(fxF, fyF);
      if (t > capF) fyF = Math.sign(fyF) * Math.sqrt(Math.max(0, capF * capF - fxF * fxF));
    }

    // body forces
    const roll = (0.012 + (this.surfF.drag + this.surfR.drag) * 0.5) * (fzF + fzR) * Math.tanh(u * 2);
    const grav = -m * G * this.grade;
    const Fx = fxF * cd - fyF * sd + fxR - drag * Math.sign(u) - roll + grav;
    const Fy = fxF * sd + fyF * cd + fyR;
    const Mz = S.a * (fxF * sd + fyF * cd) - S.b * fyR - r * 260 * Math.min(absU, 60) / 60;

    const du = Fx / m + w * r;
    const dw = Fy / m - u * r;
    const dr = Mz / S.Iz;
    this.u += du * dt;
    this.w += dw * dt;
    this.r += dr * dt;
    // low speed stabilisation
    if (absU < 2) {
      const k = Math.exp(-dt * 6 * (2 - absU));
      this.w *= k; this.r *= k;
      if (ctl.throttle < 0.05 && !reverse && absU < 0.25) this.u *= Math.exp(-dt * 8);
    }
    this.ax = Fx / m; this.ay = Fy / m;
    this.axF += (this.ax - this.axF) * Math.min(1, dt * 12);

    this.heading += this.r * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // rpm (visual + audio): spin flares revs
    const target = Math.min(S.revLimit + 150, rpm * (1 + this.spin * 0.35));
    this.rpm += (target - this.rpm) * Math.min(1, dt * 30);
    if (this.limiter) this.rpm = S.revLimit - Math.random() * 300;
  }
}

// --- collisions ------------------------------------------------------------
const tmp = {};

// Walls: test 4 corners against per-sample barrier offsets.
export function collideWalls(car, track, onHit) {
  const p = car.phys;
  const s = Math.sin(p.heading), c = Math.cos(p.heading);
  const corners = [[0.95, 2.75], [-0.95, 2.75], [0.95, -2.6], [-0.95, -2.6], [1.0, 0], [-1.0, 0]];
  let hit = 0;
  const pit = track.pit;
  for (const [lx, lz] of corners) {
    const rx = s * lz + c * lx, rz = c * lz - s * lx;
    const wx = p.x + rx, wz = p.z + rz;
    track.project(wx, wz, car.proj.i, tmp);
    const i = tmp.i;
    const wall = tmp.d > 0 ? track.wallL[i] : track.wallR[i];
    let pen = Math.abs(tmp.d) - wall;
    let sg = tmp.d > 0 ? -1 : 1; // normal points back towards the track centre
    // pit wall between track and pit lane (solid from both sides)
    if (pen <= 0 && pit && pit.wallMask[i] && Math.sign(tmp.d) === pit.side) {
      const w0 = pit.wall0[i], ad = Math.abs(tmp.d);
      const centreOnTrack = Math.sign(car.proj.d) !== pit.side || Math.abs(car.proj.d) < w0 + 0.25;
      if (centreOnTrack && ad > w0) pen = ad - w0;
      else if (!centreOnTrack && ad < w0 + 0.5) { pen = w0 + 0.5 - ad; sg = -sg; }
    }
    if (pen <= 0) continue;
    const nx = track.nx[i] * sg, nz = track.nz[i] * sg;
    p.x += nx * pen; p.z += nz * pen;
    // velocity at contact point
    const vx = p.vx + p.r * rz, vz = p.vz - p.r * rx;
    const vn = vx * nx + vz * nz;
    if (vn >= 0) continue;
    const m = p.spec.mass, I = p.spec.Iz;
    const crossN = rz * nx - rx * nz;
    const e = 0.15;
    const jn = -(1 + e) * vn / (1 / m + crossN * crossN / I);
    // friction
    const tx = -nz, tz = nx;
    const vt = vx * tx + vz * tz;
    const crossT = rz * tx - rx * tz;
    let jt = -vt / (1 / m + crossT * crossT / I);
    const maxT = jn * 0.35;
    jt = Math.max(-maxT, Math.min(maxT, jt));
    const Jx = nx * jn + tx * jt, Jz = nz * jn + tz * jt;
    const nvx = p.vx + Jx / m, nvz = p.vz + Jz / m;
    p.r += (rz * Jx - rx * Jz) / I * 0.6;
    p.setWorldVel(nvx, nvz);
    hit = Math.max(hit, -vn);
    if (onHit) onHit(car, wx, wz, -vn);
  }
  return hit;
}

const CIRCLES = [-1.75, 0, 1.75];
const CR = 0.98;
export function collideCars(A, B, onHit) {
  const a = A.phys, b = B.phys;
  const dx0 = a.x - b.x, dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return;
  const sa = Math.sin(a.heading), ca = Math.cos(a.heading), sb = Math.sin(b.heading), cb = Math.cos(b.heading);
  let best = null;
  for (const la of CIRCLES) {
    const ax = a.x + sa * la, az = a.z + ca * la;
    for (const lb of CIRCLES) {
      const bx = b.x + sb * lb, bz = b.z + cb * lb;
      const dx = ax - bx, dz = az - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 < 4 * CR * CR) {
        const d = Math.sqrt(d2) || 0.001;
        const pen = 2 * CR - d;
        if (!best || pen > best.pen) best = { pen, nx: dx / d, nz: dz / d, ax, az, bx, bz };
      }
    }
  }
  if (!best) return;
  const { pen, nx, nz } = best;
  a.x += nx * pen * 0.5; a.z += nz * pen * 0.5;
  b.x -= nx * pen * 0.5; b.z -= nz * pen * 0.5;
  const cx = (best.ax + best.bx) / 2, cz = (best.az + best.bz) / 2;
  const rax = cx - a.x, raz = cz - a.z, rbx = cx - b.x, rbz = cz - b.z;
  const vax = a.vx + a.r * raz, vaz = a.vz - a.r * rax;
  const vbx = b.vx + b.r * rbz, vbz = b.vz - b.r * rbx;
  const rvn = (vax - vbx) * nx + (vaz - vbz) * nz;
  if (rvn >= 0) return;
  const m = a.spec.mass, I = a.spec.Iz;
  const ka = raz * nx - rax * nz, kb = rbz * nx - rbx * nz;
  const e = 0.25;
  const j = -(1 + e) * rvn / (2 / m + ka * ka / I + kb * kb / I);
  a.setWorldVel(a.vx + nx * j / m, a.vz + nz * j / m);
  b.setWorldVel(b.vx - nx * j / m, b.vz - nz * j / m);
  a.r += ka * j / I * 0.5;
  b.r -= kb * j / I * 0.5;
  if (onHit) onHit(A, B, cx, cz, -rvn);
}
