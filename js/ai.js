// AI driver: pure-pursuit steering on the racing line, speed-profile throttle/brake,
// simple overtaking/defending lateral offsets, DRS + ERS usage, difficulty-dependent pace,
// human mistakes (late braking, lock-ups, slides), retiring after a crash, and pit stops.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const PIT_V = 21.4; // ~77 km/h, just under the 80 km/h limit

export class AIDriver {
  constructor(car, track, skill, { mistakes = true } = {}) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    // 0 = rookie ... 1 = legend
    const d = clamp((skill - 0.84) / (0.985 - 0.84), 0, 1);
    this.level = d;
    this.gripScale = 0.79 + 0.195 * d;   // how close to the grip limit it corners and brakes
    this.powerCap = 0.86 + 0.14 * d;     // throttle on the straights
    // only some drivers are mistake-prone, and far fewer at the higher levels
    this.wild = mistakes && Math.random() < 0.55 - 0.47 * d;
    this.errRate = !mistakes ? 0 : this.wild ? 0.1 - 0.08 * d : 0.02 - 0.017 * d; // chance per braking zone
    this.offset = 0;
    this.targetOffset = 0;
    this.profile = track.speedProfile(car.phys.spec, this.gripScale, 1);
    this.reaction = 0.15 + Math.random() * 0.35 + (1 - d) * 0.25;
    this.stuckT = 0;
    this.mistake = null;
    this.brakeZone = false;
    this.cool = 5 + Math.random() * 10;
    this.ersLap = Math.random() < 0.5;
    this.pit = null;
    this.retiring = false;
  }

  refreshProfile() { this.profile = this.track.speedProfile(this.car.phys.spec, this.gripScale, 1); }

  // ---- pit stops: main.js plans the stop, the driver takes the pit lane on the next pass
  planPit(box) { if (!this.pit && this.track.pit) this.pit = { state: 'plan', box, t: 0 }; }
  // position relative to the pit entry, wrapped to (-L/2, L/2]
  pitX(s) { const L = this.track.length; let x = (s - this.track.pit.sEntry) % L; if (x < 0) x += L; return x > L / 2 ? x - L : x; }
  pitGeom() {
    const P = this.track.pit, L = this.track.length, pp = this.pit;
    if (!pp.g) {
      let xb = (pp.box.s - P.sEntry) % L; if (xb < 0) xb += L;
      pp.g = { ws: P.wallStart - P.sEntry, we: P.wallEnd - P.sEntry, ex: P.sExit - P.sEntry, box: xb };
    }
    return pp.g;
  }
  // lateral target (signed track offset) at pit-relative position x
  pitLat(x, i) {
    const tr = this.track, P = tr.pit, g = this.pitGeom(), side = P.side;
    const w0 = P.wall0[i], fast = side * (P.wall0[tr.indexAtS(P.sEntry + Math.max(g.ws, Math.min(g.we, x)))] + 4.2);
    const edge = side * (tr.hw - 1.6);
    if (x < 0) return edge;
    if (x < g.ws) return edge + (fast - edge) * sm(4, g.ws, x);
    if (x < g.we) {
      const box = side * (w0 + 9.5);
      const toBox = this.pit.state === 'in' ? sm(g.box - 30, g.box - 7, x) : sm(g.box + 26, g.box + 4, x) * (x > g.box - 2 ? 1 : 0);
      return fast + (box - fast) * toBox;
    }
    if (x < g.ex) return fast + (tr.rlOffset[i] - fast) * sm(g.we, g.ex, x);
    return tr.rlOffset[i];
  }

  control(dt, cars, race) {
    const car = this.car, p = car.phys, tr = this.track;
    const i = car.proj.i, N = tr.n;
    const u = p.u;
    const ctl = { throttle: 0, brake: 0, steerAngle: 0, ers: false, tc: true, abs: true, autoGear: true };
    if (!race.started || race.time < race.startTime + this.reaction) {
      ctl.brake = 1; ctl.throttle = race.lightsOn ? 0.4 : 0;
      return ctl;
    }
    const pit = this.pit && tr.pit ? this.pit : null;
    let px = 0, pitting = false;
    if (pit) {
      pit.t += dt;
      px = this.pitX(car.proj.s);
      if (pit.state === 'plan' && px < 0 && px > -380 && !this.retiring) pit.state = 'in';
      pitting = pit.state === 'in' || pit.state === 'stopped' || pit.state === 'out';
      const g = this.pitGeom();
      if (pit.state === 'out' && px > g.ex + 5) this.pit = null;
      if (pit.state === 'in' && (px > g.box + 15 || pit.t > 150)) this.pit = null; // missed the box: give up
      if (!this.pit) pitting = false;
      if (pit.state === 'stopped') { ctl.brake = 1; return ctl; }
    }

    // --- traffic awareness
    let wantOffset = 0, speedCap = Infinity;
    const myD = car.proj.d;
    for (const o of cars) {
      if (o === car || o.retired) continue;
      let gap = o.proj.s - car.proj.s;
      if (gap > tr.length / 2) gap -= tr.length;
      if (gap < -tr.length / 2) gap += tr.length;
      const lat = o.proj.d - myD;
      if (gap > 0 && gap < 45) {
        const closing = u - o.phys.u;
        const rlHere = tr.rlOffset[o.proj.i];
        // the car ahead is on our line?
        if (Math.abs(o.proj.d - (rlHere + this.offset)) < 2.3) {
          if (closing > 1.5 || gap < 14) {
            const roomL = tr.hw - 1.1 - o.proj.d, roomR = o.proj.d + tr.hw - 1.1;
            const side = roomL > roomR ? 1 : -1;
            const room = Math.max(roomL, roomR);
            if (room > 2.2) wantOffset = (o.proj.d + side * 2.5) - tr.rlOffset[(i + 10) % N];
            else if (gap < 16) speedCap = Math.min(speedCap, o.phys.u - 0.5 + gap * 0.15);
          }
        }
        if (gap < 9 && Math.abs(lat) < 2.1) speedCap = Math.min(speedCap, o.phys.u - 1 + gap * 0.2);
      } else if (gap > -6 && gap <= 0 && Math.abs(lat) < 2.4) {
        // alongside: give room
        wantOffset = this.offset + (lat > 0 ? -1.2 : 1.2);
      }
    }
    const lim = tr.hw - 1.15;
    this.targetOffset = pitting ? 0 : wantOffset;
    const rate = 2.2 * dt;
    this.offset += Math.max(-rate, Math.min(rate, this.targetOffset - this.offset));

    // --- mistakes: arm one when entering a braking zone, play it out over the next second or so
    this.cool -= dt;
    const kb = (i + Math.round(Math.max(20, u * 1.2) / tr.ds)) % N;
    const braking = this.profile[kb] < u - 6;
    if (braking && !this.brakeZone && !this.mistake && !pitting && !this.retiring && this.cool <= 0 && Math.random() < this.errRate) {
      const r = Math.random();
      const kind = r < 0.4 ? 'late' : r < 0.65 ? 'lock' : 'slide';
      this.mistake = { kind, t: 0, dur: kind === 'late' ? 0.35 + Math.random() * 0.45 : kind === 'lock' ? 0.5 + Math.random() * 0.5 : 0.8 + Math.random() * 0.7, armed: kind === 'slide', sev: Math.random() };
      this.cool = this.wild ? 9 + Math.random() * 14 : 25 + Math.random() * 30;
    }
    this.brakeZone = braking;
    const M = this.mistake;
    if (M) {
      // a slide starts on the way out of the corner (too much throttle too early)
      if (M.armed && !braking && Math.abs(tr.curv[i]) > 1 / 120 && this.profile[(i + 8) % N] > u + 1) M.armed = false;
      if (!M.armed) { M.t += dt; if (M.t > M.dur) this.mistake = null; }
      else if (M.t === 0 && this.cool < 0) this.mistake = null;
    }
    const act = M && !M.armed ? M.kind : null;

    // --- steering: pure pursuit
    const look = Math.min(48, Math.max(9, 7 + Math.abs(u) * 0.42));
    const j = (i + Math.round(look / tr.ds)) % N;
    let off;
    if (pitting) off = this.pitLat(this.pitX(car.proj.s + look), j);
    else if (this.retiring) off = Math.sign(car.proj.d || 1) * (tr.hw + 4.5);
    else off = Math.max(-lim, Math.min(lim, tr.rlOffset[j] + this.offset));
    const tx = tr.px[j] + tr.nx[j] * off, tz = tr.pz[j] + tr.nz[j] * off;
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
    const rx = tx - p.x, rz = tz - p.z;
    const fwd = rx * sh + rz * ch, left = rx * ch - rz * sh;
    const alpha = Math.atan2(left, fwd);
    const Ld = Math.hypot(rx, rz);
    let delta = Math.atan(2 * 3.6 * Math.sin(alpha) / Ld);
    // yaw damping to stop oscillation, counter-steer on slides (weak during a slide mistake = proper moment)
    const desiredR = u * 2 * Math.sin(alpha) / Ld;
    delta += (desiredR - p.r) * (act === 'slide' ? 0.01 : 0.04);
    const cs = act === 'slide' ? 0.15 + 0.35 * (1 - M.sev) : 0.9;
    if (Math.abs(p.slipR) > 0.07) delta += (p.slipR - Math.sign(p.slipR) * 0.07) * cs;
    ctl.steerAngle = Math.max(-0.38, Math.min(0.38, delta));

    // --- speed
    const k = (i + Math.round(Math.max(3, u * 0.12) / tr.ds)) % N;
    let vt = this.profile[k] * (this.speedScale || 1); // speedScale < 1 on a wet track / worn tyres
    vt = Math.min(vt, speedCap);
    const offTrack = Math.abs(car.proj.d) > tr.hw + 0.5 && !pitting;
    if (offTrack) vt = Math.min(vt, 45);
    let stopping = false;
    if (pitting) {
      const g = this.pitGeom(), x = px;
      if (x < g.we) vt = Math.min(vt, Math.sqrt(PIT_V * PIT_V + 2 * 15 * Math.max(0, g.ws - x)));
      if (pit.state === 'in') {
        vt = Math.min(vt, Math.sqrt(2 * 4.5 * Math.max(0, g.box - x)) + 0.3);
        if (x > g.box - 1.4 && Math.abs(u) < 2) { pit.state = 'stopped'; ctl.brake = 1; return ctl; }
        stopping = x > g.box - 8;
        if (x > g.box - 0.4) vt = 0;
      }
    }
    if (this.retiring) vt = Math.min(vt, 14);
    const err = vt - u;
    if (err > 0) {
      ctl.throttle = Math.min(this.powerCap, 0.35 + err * 0.35);
      // ease throttle if sliding
      if (Math.abs(p.slipR) > 0.1) ctl.throttle *= 0.6;
    } else {
      ctl.throttle = err > -1.2 ? 0.25 : 0;
      ctl.brake = Math.min(1, Math.max(0, (-err - 0.6) * 0.3));
    }
    if (stopping) { ctl.throttle = err > 0.5 ? Math.min(0.3, ctl.throttle) : 0; ctl.brake = err < 0 ? Math.min(1, -err * 0.7 + 0.1) : 0; }
    // the mistake itself
    if (act === 'late') { ctl.brake = Math.min(ctl.brake, 0.12); ctl.throttle = 0; }
    else if (act === 'lock') { ctl.brake = Math.max(ctl.brake, 0.6 + 0.4 * M.sev); ctl.throttle = 0; ctl.abs = false; }
    else if (act === 'slide') { ctl.throttle = 1; ctl.brake = 0; ctl.tc = false; }

    // DRS & ERS
    car.drsOpen = !pitting && car.drsAllowed && tr.inDRSZone(car.proj.s) && ctl.throttle > 0.85;
    const straight = Math.abs(tr.curvWide[i]) < 1 / 600;
    ctl.ers = !pitting && straight && u > 35 && ctl.throttle > 0.85 && p.ers > 0.6e6 && (car.gapAhead < 1.2 || this.ersLap);

    // stuck / wrong way recovery (a crashed car that is stuck simply retires)
    const along = sh * tr.tx[i] + ch * tr.tz[i];
    if ((Math.abs(u) < 3 || along < -0.3) && race.started && !pitting) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.retiring) {
      // park it off the racing surface first; if it cannot get there, it limps back into the race
      if (Math.abs(car.proj.d) > tr.hw + 1.2 && (Math.abs(u) < 2 || this.stuckT > 1.5)) { race.retire?.(car); return ctl; }
      if (this.stuckT > 4) { this.retiring = false; race.respawn(car); this.stuckT = 0; }
    } else if (this.stuckT > 2.5) { race.respawn(car); this.stuckT = 0; this.mistake = null; }
    return ctl;
  }

  onNewLap() { this.ersLap = Math.random() < 0.45; }
}
