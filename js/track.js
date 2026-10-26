import * as THREE from 'three';

export const KERB_W = 1.25;
const STEP = 2; // metres between samples

function smoothArray(a, radius, passes = 1) {
  const n = a.length;
  let src = a;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(n);
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[(k + n) % n];
    for (let i = 0; i < n; i++) {
      out[i] = sum / (2 * radius + 1);
      sum += src[(i + radius + 1) % n] - src[(i - radius + n) % n];
    }
    src = out;
  }
  return src;
}

function minFilter(a, radius) {
  const n = a.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = -radius; k <= radius; k++) m = Math.min(m, a[(i + k + n) % n]);
    out[i] = m;
  }
  return out;
}

export class Track {
  constructor(meta, data) {
    this.meta = meta;
    this.name = meta.name;
    this.style = meta.style;
    const pts = data.points.map(p => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const approxLen = curve.getLength();
    const n = Math.round(approxLen / STEP);
    const sp = curve.getSpacedPoints(n);
    sp.pop();
    this.n = n;
    this.length = approxLen;
    this.ds = approxLen / n;
    const N = n;
    this.px = new Float32Array(N); this.pz = new Float32Array(N); this.py = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); this.nz = new Float32Array(N);
    this.s = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.px[i] = sp[i].x; this.pz[i] = sp[i].z;
      this.s[i] = i * this.ds;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.nx[i] = dz; this.nz[i] = -dx; // left normal
    }
    // signed curvature, + = left turn
    const k = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const dtx = this.tx[b] - this.tx[a], dtz = this.tz[b] - this.tz[a];
      k[i] = (dtx * this.nx[i] + dtz * this.nz[i]) / (4 * this.ds);
    }
    this.curv = smoothArray(k, 3, 2);
    this.curvWide = smoothArray(this.curv, 25, 2);

    // elevation
    const prof = meta.elevation;
    for (let i = 0; i < N; i++) {
      const f = this.s[i] / this.length;
      let j = 0;
      while (j < prof.length - 2 && prof[j + 1][0] < f) j++;
      const [f0, h0] = prof[j], [f1, h1] = prof[j + 1];
      const t = Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
      this.py[i] = h0 + (h1 - h0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
    this.py = smoothArray(this.py, 25, 3);

    this.hw = meta.width / 2;
    this._buildSpatialHash();
    this._computeWalls();
    this._computeKerbs();
    this._setupPit();
    this.computeRacingLine();
    this.bbox = this._bbox();
  }

  _bbox() {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minx = Math.min(minx, this.px[i]); maxx = Math.max(maxx, this.px[i]);
      minz = Math.min(minz, this.pz[i]); maxz = Math.max(maxz, this.pz[i]);
    }
    return { minx, maxx, minz, maxz };
  }

  _buildSpatialHash() {
    this.cell = 30;
    this.hash = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor(this.px[i] / this.cell) + ',' + Math.floor(this.pz[i] / this.cell);
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, arr = []);
      arr.push(i);
    }
  }

  // iterate sample indices near (x,z) within radius
  near(x, z, radius, fn) {
    const c = this.cell, r = Math.ceil(radius / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const arr = this.hash.get((cx + a) + ',' + (cz + b));
      if (arr) for (const i of arr) fn(i);
    }
  }

  // distance to nearest centreline sample
  distanceToTrack(x, z, radius = 120) {
    let best = radius * radius;
    this.near(x, z, radius, i => {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < best) best = d;
    });
    return Math.sqrt(best);
  }

  nearestIndex(x, z, radius = 120) {
    let best = Infinity, bi = -1;
    this.near(x, z, radius, i => {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    return bi;
  }

  _computeWalls() {
    const N = this.n, hw = this.hw, meta = this.meta;
    const street = this.style === 'street';
    const wl = new Float32Array(N), wr = new Float32Array(N);
    const sepS = 160;
    for (let i = 0; i < N; i++) {
      for (const side of [1, -1]) {
        const cw = this.curvWide[i] * side; // >0 : corner turns towards this side (inside)
        let base;
        if (street) base = hw + meta.runoff + (cw < 0 ? Math.min(3, -cw * 300) : 0);
        else {
          const sev = Math.min(1, Math.abs(this.curvWide[i]) * 70);
          base = hw + (cw < 0 ? meta.runoff * (0.55 + 0.9 * sev) : meta.runoff * 0.55);
        }
        // keep clear of other parts of the circuit
        let clear = Infinity;
        const nx = this.nx[i] * side, nz = this.nz[i] * side;
        this.near(this.px[i], this.pz[i], base * 2 + 40, j => {
          let dsij = Math.abs(this.s[j] - this.s[i]);
          dsij = Math.min(dsij, this.length - dsij);
          if (dsij < sepS) return;
          const rx = this.px[j] - this.px[i], rz = this.pz[j] - this.pz[i];
          const along = rx * nx + rz * nz;
          const lat = Math.abs(rx * this.tx[i] + rz * this.tz[i]);
          if (along > 0 && lat < along * 0.9 + hw) clear = Math.min(clear, along);
        });
        let off = base;
        if (clear < Infinity) off = Math.min(off, Math.max(hw + 1.2, clear * 0.5));
        // inside of tight corners: avoid self-intersection
        const kc = this.curv[i] * side;
        if (kc > 0) off = Math.min(off, Math.max(hw + 0.8, 0.85 / kc));
        if (side === 1) wl[i] = off; else wr[i] = off;
      }
    }
    this.wallL = smoothArray(minFilter(wl, 6), 4, 2);
    this.wallR = smoothArray(minFilter(wr, 6), 4, 2);
    // gravel on the outside of corners (permanent circuits)
    this.gravelL = new Uint8Array(N); this.gravelR = new Uint8Array(N);
    if (!street) {
      for (let i = 0; i < N; i++) {
        const c = this.curvWide[i];
        if (Math.abs(c) > 1 / 220) {
          if (c > 0) this.gravelR[i] = 1; else this.gravelL[i] = 1;
        }
      }
    }
  }

  _computeKerbs() {
    const N = this.n;
    const kl = new Uint8Array(N), kr = new Uint8Array(N);
    const thr = 1 / 300;
    const ext = 12;
    for (let i = 0; i < N; i++) {
      if (Math.abs(this.curv[i]) > thr) {
        for (let k = -ext; k <= ext; k++) {
          const j = (i + k + N) % N;
          kl[j] = 1; kr[j] = 1;
        }
      }
    }
    // keep kerbs inside walls
    for (let i = 0; i < N; i++) {
      if (this.wallL[i] < this.hw + KERB_W + 0.3) kl[i] = 0;
      if (this.wallR[i] < this.hw + KERB_W + 0.3) kr[i] = 0;
    }
    this.kerbL = kl; this.kerbR = kr;
  }

  // Drivable pit lane alongside the start/finish straight: the barrier on the pit side is
  // moved out by the lane width, and a separate pit wall divides lane and track.
  _setupPit() {
    const N = this.n;
    const side = this.wallL[0] > this.wallR[0] ? 1 : -1;
    const straight = s => Math.abs(this.curvWide[this.indexAtS(s)]) < 1 / 220;
    let a = 0; while (a > -700 && straight(a - 10)) a -= 10;
    let b = 0; while (b < 400 && straight(b + 10)) b += 10;
    const sEntry = Math.max(a + 10, -470), sExit = Math.min(b - 10, 170);
    this.pit = null;
    if (sExit - sEntry < 300) return;
    const taper = 60, laneW = 14;
    const wall = side === 1 ? this.wallL : this.wallR;
    const kerb = side === 1 ? this.kerbL : this.kerbR;
    const wall0 = Float32Array.from(wall);
    const inPit = new Uint8Array(N), wallMask = new Uint8Array(N), hideOuter = new Uint8Array(N);
    const wallStart = sEntry + taper + 15, wallEnd = sExit - taper - 15;
    for (let s = sEntry; s <= sExit; s += this.ds * 0.5) {
      const i = this.indexAtS(s);
      const k = Math.max(0, Math.min(1, (s - sEntry) / taper, (sExit - s) / taper));
      wall[i] = Math.max(wall[i], wall0[i] + laneW * k * k * (3 - 2 * k));
      inPit[i] = 1; kerb[i] = 0;
      if (s >= wallStart && s <= wallEnd) wallMask[i] = 1;
    }
    this.pit = { side, sEntry, sExit, wallStart, wallEnd, laneW, wall0, inPit, wallMask, hideOuter, boxes: [] };
  }

  inPitCorridor(i, d) {
    const p = this.pit;
    return !!p && p.inPit[i] === 1 && Math.sign(d) === p.side && Math.abs(d) > this.hw + 0.3;
  }
  inPitLane(i, d) {
    const p = this.pit;
    return !!p && p.wallMask[i] === 1 && Math.sign(d) === p.side && Math.abs(d) > p.wall0[i] - 0.2;
  }

  // Minimum-curvature racing line: multi-scale biharmonic relaxation of lateral offsets
  computeRacingLine() {
    const N = this.n, lim = this.hw - 1.05;
    const o = new Float32Array(N);
    const x = new Float32Array(N), z = new Float32Array(N);
    const upd = () => { for (let i = 0; i < N; i++) { x[i] = this.px[i] + this.nx[i] * o[i]; z[i] = this.pz[i] + this.nz[i] * o[i]; } };
    const schedule = [[16, 260], [8, 300], [4, 300], [2, 200]];
    for (const [k, iters] of schedule) {
      for (let it = 0; it < iters; it++) {
        upd();
        for (let i = 0; i < N; i++) {
          const a2 = (i - 2 * k + 2 * N) % N, a = (i - k + N) % N, b = (i + k) % N, b2 = (i + 2 * k) % N;
          const tx = (-x[a2] + 4 * x[a] + 4 * x[b] - x[b2]) / 6, tz = (-z[a2] + 4 * z[a] + 4 * z[b] - z[b2]) / 6;
          const d = (tx - x[i]) * this.nx[i] + (tz - z[i]) * this.nz[i];
          o[i] = Math.max(-lim, Math.min(lim, o[i] + d * 0.5));
        }
      }
    }
    this.rlOffset = smoothArray(o, 3, 2);
    for (let i = 0; i < N; i++) this.rlOffset[i] = Math.max(-lim, Math.min(lim, this.rlOffset[i]));
    // racing line curvature
    const rx = new Float32Array(N), rz = new Float32Array(N);
    for (let i = 0; i < N; i++) { rx[i] = this.px[i] + this.nx[i] * this.rlOffset[i]; rz[i] = this.pz[i] + this.nz[i] * this.rlOffset[i]; }
    this.rlx = rx; this.rlz = rz;
    const kk = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 4 + N) % N, b = (i + 4) % N;
      const ax = rx[i] - rx[a], az = rz[i] - rz[a], bx = rx[b] - rx[i], bz = rz[b] - rz[i];
      const cross = ax * bz - az * bx;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(rx[b] - rx[a], rz[b] - rz[a]);
      kk[i] = Math.abs(2 * cross / (la * lb * lc + 1e-6));
    }
    this.rlCurv = smoothArray(kk, 2, 2);
    // distance along racing line between samples
    this.rlds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      this.rlds[i] = Math.hypot(rx[b] - rx[i], rz[b] - rz[i]);
    }
  }

  // Speed profile for a car spec (see physics.js) and grip scale
  speedProfile(spec, gripScale = 1, powerScale = 1) {
    const N = this.n, g = 9.81, rho = 1.225;
    const m = spec.mass, mu = spec.mu * gripScale;
    const kA = 0.5 * rho * spec.ClA / m;
    const kD = 0.5 * rho * spec.CdA / m;
    const v = new Float32Array(N);
    const vtop = 96;
    for (let i = 0; i < N; i++) {
      const k = this.rlCurv[i];
      const den = k - mu * kA;
      v[i] = den <= 1e-6 ? vtop : Math.min(vtop, Math.sqrt(mu * g / den));
    }
    // braking pass (backwards, twice around for wrap)
    for (let pass = 0; pass < 2; pass++) {
      for (let c = N - 1; c >= 0; c--) {
        const i = c, j = (c + 1) % N;
        const vj = v[j];
        const aTot = mu * (g + kA * vj * vj);
        const aLat = vj * vj * this.rlCurv[i];
        const aLong = Math.sqrt(Math.max(0, aTot * aTot - aLat * aLat)) * 0.92 + kD * vj * vj;
        const lim = Math.sqrt(vj * vj + 2 * aLong * this.rlds[i]);
        if (v[i] > lim) v[i] = lim;
      }
    }
    // acceleration pass
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < N; c++) {
        const i = c, j = (c + 1) % N;
        const vi = Math.max(v[i], 5);
        const aPow = spec.power * powerScale / (m * vi);
        const aTot = mu * (g * 0.55 + kA * 0.6 * vi * vi);
        const aLat = vi * vi * this.rlCurv[i];
        const aGrip = Math.sqrt(Math.max(0, aTot * aTot - aLat * aLat));
        const a = Math.min(aPow, aGrip) - kD * vi * vi;
        const lim = Math.sqrt(Math.max(0, vi * vi + 2 * a * this.rlds[i]));
        if (v[j] > lim) v[j] = lim;
      }
    }
    return v;
  }

  wrapS(s) { s %= this.length; return s < 0 ? s + this.length : s; }

  indexAtS(s) { return Math.floor(this.wrapS(s) / this.ds) % this.n; }

  // position on track at distance s with lateral offset d
  pointAt(s, d, out = {}) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t, nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t + nx * d;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t + nz * d;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.heading = Math.atan2(this.tx[i] + (this.tx[j] - this.tx[i]) * t, this.tz[i] + (this.tz[j] - this.tz[i]) * t);
    out.i = i;
    return out;
  }

  // Project world position onto the centreline. hint = previous index for local search.
  project(x, z, hint, out) {
    const N = this.n;
    let i = hint;
    if (i == null || i < 0) i = this.nearestIndex(x, z, 300);
    if (i < 0) i = 0;
    const d2 = k => (this.px[k] - x) ** 2 + (this.pz[k] - z) ** 2;
    let best = d2(i);
    for (let iter = 0; iter < 400; iter++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      const da = d2(a), db = d2(b);
      if (da < best) { best = da; i = a; } else if (db < best) { best = db; i = b; } else break;
    }
    if (best > 60 * 60) {
      const g = this.nearestIndex(x, z, 300);
      if (g >= 0) { i = g; best = d2(i); }
    }
    let rx = x - this.px[i], rz = z - this.pz[i];
    let along = rx * this.tx[i] + rz * this.tz[i];
    let j = i;
    if (along < 0) { j = (i - 1 + N) % N; rx = x - this.px[j]; rz = z - this.pz[j]; along = rx * this.tx[j] + rz * this.tz[j]; }
    const t = Math.max(0, Math.min(1, along / this.ds));
    const k = (j + 1) % N;
    out.i = i;
    out.s = this.s[j] + t * this.ds;
    out.d = rx * this.nx[j] + rz * this.nz[j];
    out.y = this.py[j] + (this.py[k] - this.py[j]) * t;
    out.grade = (this.py[k] - this.py[j]) / this.ds;
    return out;
  }

  surface(i, d) {
    const ad = Math.abs(d), hw = this.hw;
    if (ad <= hw) return SURF.road;
    if (this.pit && this.pit.inPit[i] && Math.sign(d) === this.pit.side) return SURF.pit;
    const left = d > 0;
    const e = ad - hw;
    const hasKerb = left ? this.kerbL[i] : this.kerbR[i];
    if (hasKerb && e < KERB_W) return SURF.kerb;
    if (this.style === 'street') return SURF.runoff;
    const edge = (hasKerb ? KERB_W : 0) + 2.5;
    if (e < edge) return SURF.runoff;
    const grav = left ? this.gravelL[i] : this.gravelR[i];
    return grav ? SURF.gravel : SURF.grass;
  }

  inDRSZone(s) {
    const f = this.wrapS(s) / this.length;
    for (const [a, b] of this.meta.drs) {
      if (a < b ? (f >= a && f <= b) : (f >= a || f <= b)) return true;
    }
    return false;
  }
}

export const SURF = {
  road: { name: 'road', grip: 1.0, drag: 0, bump: 0 },
  pit: { name: 'pit', grip: 0.97, drag: 0, bump: 0 },
  kerb: { name: 'kerb', grip: 0.93, drag: 0.02, bump: 1 },
  runoff: { name: 'runoff', grip: 0.86, drag: 0.03, bump: 0.15 },
  grass: { name: 'grass', grip: 0.55, drag: 0.12, bump: 0.6 },
  gravel: { name: 'gravel', grip: 0.45, drag: 0.55, bump: 1.4 },
};
