import * as THREE from 'three';
import { makePerson, lerpAngle, MARSHAL_FLAG, MARSHAL_TRACK, crewCostume, makeWheelGun, makeJack, makeExtinguisher } from './crew.js';
import { FRONT_AXLE, REAR_AXLE, WHEEL_R, makeWheelProp } from './car.js';
import { smooth, smoother } from './ik.js';

const clamp01 = t => Math.max(0, Math.min(1, t));
const sstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const ph = (t, r) => smoother(r[0], r[1], t);

// car-local (x = left, z = forward) -> world
function toWorld(x0, z0, h, lx, lz, out) {
  out.x = x0 + Math.cos(h) * lx + Math.sin(h) * lz;
  out.z = z0 - Math.sin(h) * lx + Math.cos(h) * lz;
  return out;
}

// ------------------------------------------------------------------ marshals push a beached car back onto the track
export class Rescue {
  constructor({ scene, track, car }) {
    this.scene = scene; this.track = track; this.car = car;
    this.t = 0; this.phase = 'run'; this.phaseT = 0; this.done = false; this.released = false;
    const tr = track, i = car.proj.i;
    this.side = car.proj.d >= 0 ? 1 : -1;
    const wall = this.side === 1 ? tr.wallL[i] : tr.wallR[i];
    this.target = tr.pointAt(car.proj.s + 16, this.side * Math.max(0, tr.hw - 2.6));
    // flag marshal stands upstream at the track edge, warning approaching cars
    const fp = tr.pointAt(car.proj.s - 32, this.side * (tr.hw + 1.4));
    this.flagPos = new THREE.Vector3(fp.x, fp.y, fp.z);
    this.flagFace = fp.heading + Math.PI;
    // pushers: car-local stand position + where their hands go (outer hand first)
    const slot = (lx, lz, outer, inner) => ({ lx, lz, hands: [outer, inner] });
    const mir = ([x, y, z]) => [-x, y, z];
    const rear = [[0.52, 0.8, -2.87], [0.22, 0.86, -2.64]], side = [[0.88, 0.63, -1.56], [0.72, 0.57, -0.64]];
    this.slots = [slot(0.42, -3.32, ...rear), slot(-0.42, -3.32, ...rear.map(mir)), slot(1.1, -1.05, ...side), slot(-1.1, -1.05, ...side.map(mir)), null];
    const costumes = [MARSHAL_FLAG, MARSHAL_TRACK, MARSHAL_TRACK, MARSHAL_FLAG, MARSHAL_FLAG];
    this.people = this.slots.map((sl, k) => {
      const person = makePerson({ costume: costumes[k] });
      const sp = tr.pointAt(car.proj.s - 10 + k * 5 - (sl ? 0 : 22), this.side * (wall + 1.6 + (k % 2) * 0.8));
      person.root.position.set(sp.x, sp.y - 0.5, sp.z);
      if (!sl) person.attachFlag('#ffd400');
      scene.add(person.root);
      return { person, slot: sl, flag: !sl, spawn: new THREE.Vector3(sp.x, sp.y - 0.5, sp.z), delay: sl ? k * 0.18 : 0, grab: 0 };
    });
    this.tmp = {}; this.proj = {}; this.hv = new THREE.Vector3();
  }

  groundY(x, z) {
    const pr = this.track.project(x, z, this.car.proj.i, this.proj);
    const wall = pr.d > 0 ? this.track.wallL[pr.i] : this.track.wallR[pr.i];
    const over = Math.abs(Math.abs(pr.d) - wall);
    const hop = Math.max(0, 1 - over / 0.9) * 1.05; // vault the barrier
    return pr.y + (Math.abs(pr.d) > wall + 0.3 ? -0.5 : -0.02) + hop;
  }

  // moves a person towards (x,z); returns true when there
  runTo(m, x, z, speed, dt) {
    const per = m.person, pos = per.root.position;
    const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    const v = Math.min(speed, 1.4 + d * 1.6);
    pos.x += dx / d * Math.min(d, v * dt); pos.z += dz / d * Math.min(d, v * dt);
    per.root.rotation.y = lerpAngle(per.root.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
    per.gait(dt, v);
    pos.y = this.groundY(pos.x, pos.z);
    return false;
  }

  updateFlag(m, dt) {
    const per = m.person;
    if (this.runTo(m, this.flagPos.x, this.flagPos.z, 5.6, dt)) {
      per.root.rotation.y = lerpAngle(per.root.rotation.y, this.flagFace, Math.min(1, dt * 6));
      per.root.position.y = this.groundY(per.root.position.x, per.root.position.z);
      per.root.updateMatrixWorld();
      per.waveFlag(this.t);
    } else if (per.flag) per.flag.userData.update(this.t);
  }

  // hands on the car body (car-local points)
  placeHands(m, k) {
    const per = m.person, p = this.car.phys, y0 = this.car.proj.y;
    const outer = m.slot.lx > 0 ? per.L : per.R, inner = outer === per.L ? per.R : per.L;
    [outer, inner].forEach((a, j) => {
      const [hx, hy, hz] = m.slot.hands[j];
      const w = toWorld(p.x, p.z, p.heading, hx, hz, this.tmp);
      const rest = per.world(a.s * 0.22, 0.95, 0.3, new THREE.Vector3());
      this.hv.set(w.x, y0 + hy, w.z).lerp(rest, 1 - k);
      per.hand(a, this.hv);
      per.grip(a, 0.3 + k * 0.4);
    });
  }

  update(dt) {
    this.t += dt; this.phaseT += dt;
    const p = this.car.phys;
    if (this.phase === 'run') {
      let all = true;
      for (const m of this.people) {
        if (m.flag) { this.updateFlag(m, dt); continue; }
        const per = m.person;
        if (this.t < m.delay) { per.idle(this.t); all = false; continue; }
        const W = toWorld(p.x, p.z, p.heading, m.slot.lx, m.slot.lz, this.tmp);
        if (!this.runTo(m, W.x, W.z, 5.4, dt)) { all = false; m.grab = 0; }
        else {
          per.root.rotation.y = lerpAngle(per.root.rotation.y, p.heading, Math.min(1, dt * 8));
          m.grab = Math.min(1, m.grab + dt * 3);
          this.crouch(m, sstep(m.grab));
        }
      }
      if (all || this.phaseT > 7) { this.phase = 'push'; this.phaseT = 0; }
    } else if (this.phase === 'push') {
      const tgt = this.target;
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
      let v = 0;
      const ramp = sstep(this.phaseT / 1.2);
      if (dist > 0.6 && this.phaseT < 16) {
        const want = Math.atan2(dx, dz);
        let diff = want - p.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.55 * ramp);
        v = Math.min(1.85 * ramp * (Math.abs(diff) < 0.7 ? 1 : 0.4), dist * 1.2 + 0.3);
        p.x += Math.sin(p.heading) * v * dt; p.z += Math.cos(p.heading) * v * dt;
      } else {
        const th = tgt.heading;
        p.heading = lerpAngle(p.heading, th, Math.min(1, dt * 2.2));
        let diff = th - p.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) < 0.04 || this.phaseT > 20) { p.heading = th; this.released = true; this.phase = 'leave'; this.phaseT = 0; }
      }
      p.u = v; p.w = 0; p.r = 0;
      for (const m of this.people) {
        if (m.flag) { this.updateFlag(m, dt); continue; }
        const per = m.person;
        const W = toWorld(p.x, p.z, p.heading, m.slot.lx, m.slot.lz, this.tmp);
        per.root.position.set(W.x, this.groundY(W.x, W.z), W.z);
        per.root.rotation.y = p.heading;
        if (this.phaseT < 0.5 || v < 0.15) this.crouch(m, 1);
        else {
          per.gait(dt, Math.max(0.7, v * 1.1), { lean: 0.55, arms: false });
          per.hips.position.y -= 0.08;
          per.update();
          this.placeHands(m, 1);
        }
      }
    } else if (this.phase === 'leave') {
      let all = true;
      for (const m of this.people) {
        const per = m.person;
        if (!per.root.visible) continue;
        // flag marshal keeps waving until the car has pulled away
        if (m.flag && this.phaseT < 2.5) { this.updateFlag(m, dt); all = false; continue; }
        if (!this.runTo(m, m.spawn.x, m.spawn.z, 4.6, dt) && this.phaseT < 9) all = false;
        else per.root.visible = false;
        if (per.flag) per.flag.userData.update(this.t);
      }
      if (all) this.finish();
    }
  }

  // braced against the car, hands on the bodywork
  crouch(m, k) {
    const per = m.person;
    per.reset();
    per.body({ y: 0.95 - 0.16 * k, lean: 0.15 + 0.45 * k, headPitch: -0.2 * k });
    per.root.updateMatrixWorld();
    per.update();
    per.stance([0.14, 0.12 - 0.1 * k, -0.14, -0.3 * k], { R: { pitch: 0.3 * k } });
    this.placeHands(m, k);
  }

  camPose(out) {
    if (this.phase === 'leave' || this.done) return null;
    const p = this.car.phys;
    const a = p.heading + this.side * (Math.PI / 2 + 0.5) + this.t * 0.06;
    out.pos.set(p.x + Math.sin(a) * 9, this.car.proj.y + 3.4, p.z + Math.cos(a) * 9);
    out.look.set(p.x, this.car.proj.y + 0.5, p.z);
    out.fov = 52;
    return out;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    for (const m of this.people) this.scene.remove(m.person.root);
  }
}

// ------------------------------------------------------------------ pit stop with a fully animated crew
// [x, z, tyre width, front] in car.model.wheels order
const WHEELS = [[0.85, FRONT_AXLE, 0.305, true], [-0.85, FRONT_AXLE, 0.305, true], [0.8, REAR_AXLE, 0.405, false], [-0.8, REAR_AXLE, 0.405, false]];
const LIFT = 0.07;

export class PitStop {
  // box: {x, y, z, heading, side}  side = which side of the car the garage is on (+1 = car's left)
  constructor({ scene, car, box, onMessage, ai = false }) {
    this.scene = scene; this.car = car; this.box = box; this.msg = onMessage || (() => {});
    this.ai = ai;
    this.state = 'waiting'; this.t = 0; this.wait = 0; this.releasedT = 0;
    this._compound = car.compound;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.wheelBase = car.model.wheels.map(w => w.steer.position.x);
    this.v = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.o = {};
    this.liftF = 0; this.liftR = 0;
    this.spawn();
    this.update(0);
  }

  get compound() { return this._compound; }
  set compound(c) { this._compound = c; for (const w of this.wheels || []) w.newT.userData.setCompound(c); }

  spawn() {
    const team = this.car.team, costume = crewCostume(team), accent = costume.band;
    const P = () => { const p = makePerson({ costume }); this.group.add(p.root); return p; };
    const mkJack = () => { const j = makeJack(accent); this.group.add(j); return j; };
    this.jackF = { per: P(), jack: mkJack() };
    this.jackR = { per: P(), jack: mkJack() };
    this.wheels = WHEELS.map(([x, z, w, front], i) => {
      const sx = Math.sign(x), fz = front ? 1 : -1;
      const gun = makeWheelGun(accent); this.group.add(gun);
      const oldT = makeWheelProp(team, front, this.car.compound); oldT.visible = false; this.group.add(oldT);
      const newT = makeWheelProp(team, front, this._compound); this.group.add(newT);
      return { i, x, z, w, front, sx, fz, xo: Math.abs(x) + w / 2, gunner: P(), off: P(), on: P(), gun, oldT, newT, spin: 0, last: new THREE.Vector3(), lastOn: new THREE.Vector3() };
    });
    this.stabs = [1, -1].map(sx => ({ sx, per: P() }));
    this.chief = P();
    this.ext = makeExtinguisher(); this.group.add(this.ext);
    const gs = this.box.side;
    this.place(this.ext, gs * 3.3, 0, -1.2, 0.4);
  }

  // box-local -> world helpers
  pt(lx, ly, lz, out = this.v) { const B = this.box; toWorld(B.x, B.z, B.heading, lx, lz, out); out.y = B.y + ly; return out; }
  place(obj, lx, ly, lz, yaw = 0) { this.pt(lx, ly, lz, obj.position); obj.rotation.set(0, this.box.heading + yaw, 0); }
  stand(per, lx, lz, yaw) { this.pt(lx, -0.02, lz, per.root.position); per.root.rotation.y = this.box.heading + yaw; per.root.updateMatrixWorld(); }

  service(precise) {
    if (this.state !== 'waiting') return;
    const p = this.car.phys;
    this.state = 'service'; this.t = 0; this.precise = precise;
    this.from = { x: p.x, z: p.z, h: p.heading };
    // per-wheel timing: tiny human variation, a slower crew when the car missed its marks,
    // and (rarely, AI only) a sticky wheel nut
    const k = precise ? 1 : 1.12;
    const bad = this.ai && Math.random() < 0.07 ? Math.floor(Math.random() * 4) : -1;
    let done = 0;
    for (const w of this.wheels) {
      const j = (Math.random() - 0.5) * 0.06, sc = r => [r[0] * k + j, r[1] * k + j];
      w.tGunIn = sc([0.04, 0.19]); w.tLoosen = sc([0.19, 0.42]); w.tGunBack = sc([0.42, 0.52]);
      w.tGrab = sc([0.14, 0.38]); w.tPull = sc([0.42, 0.72]); w.tAway = sc([0.72, 1.85]);
      w.tOnIn = sc([0.58, 0.95]); w.tOnPush = sc([0.95, 1.16]);
      w.tGunIn2 = sc([1.1, 1.22]);
      const extra = w.i === bad ? 0.8 + Math.random() * 1.8 : 0;
      w.tTight = [w.tGunIn2[1], w.tGunIn2[1] + 0.24 * k + extra];
      w.tGunOut2 = [w.tTight[1], w.tTight[1] + 0.12];
      w.done = w.tTight[1] + 0.05;
      done = Math.max(done, w.done);
    }
    this.tLiftF = [0.1, 0.3]; this.tLiftR = [0.24, 0.42];
    this.tDrop = [done + 0.06, done + 0.2];
    this.tGo = this.tDrop[1] + 0.16;
    this.tJackOut = [this.tDrop[1] - 0.02, this.tDrop[1] + 0.42];
    if (!this.ai) this.msg('PIT STOP', '', 1.6);
  }

  update(dt) {
    const car = this.car, p = car.phys, B = this.box, H = B.heading;
    this.wait += dt;
    let t = -1;
    if (this.state === 'service' || this.state === 'released') { this.t += dt; t = this.t; }
    const svc = this.state === 'service';
    if (t >= 0) {
      this.liftF = LIFT * (ph(t, this.tLiftF) - ph(t, this.tDrop));
      this.liftR = LIFT * (ph(t, this.tLiftR) - ph(t, this.tDrop));
    }
    if (svc) {
      // settle the car exactly on its marks, then up on the jacks
      const k = sstep(t / 0.22);
      const x = this.from.x + (B.x - this.from.x) * k, z = this.from.z + (B.z - this.from.z) * k;
      const h = lerpAngle(this.from.h, H, k);
      car.visual = { x, y: B.y + (this.liftF + this.liftR) / 2, z, heading: h, pitch: -(this.liftF - this.liftR) / 3.6 };
      p.x = x; p.z = z; p.heading = h; p.u = 0; p.w = 0; p.r = 0;
      car.model.wheels.forEach((w, i) => {
        const W = this.wheels[i];
        w.steer.position.x = this.wheelBase[i];
        w.steer.visible = t < W.tPull[0] || t >= W.tOnPush[1];
      });
      if (!this.swapped && this.wheels.some(W => t >= W.tOnPush[1])) { this.swapped = true; car.model.setCompound(this._compound); }
      if (t >= this.tGo) {
        this.state = 'released'; this.releasedT = t;
        car.visual = null;
        car.model.wheels.forEach((w, i) => { w.steer.position.x = this.wheelBase[i]; w.steer.visible = true; });
        this.stationary = this.tGo;
      }
    }
    const lift = (this.liftF + this.liftR) / 2;
    for (const W of this.wheels) this.animWheel(W, t, dt, W.front ? this.liftF : this.liftR);
    this.animJacks(t, dt);
    this.animStabs(t, lift);
    this.animChief(t, dt);
  }

  // one corner: wheel gunner, tyre-off and tyre-on man
  animWheel(W, t, dt, lift) {
    const H = this.box.heading, s = W.sx, R = WHEEL_R;
    const done = t >= 0 && this.state === 'released' ? t - this.releasedT : -1;
    // ---- gun: on the nut, back, on again, away
    let gap = 0.34;
    if (t >= 0) gap = 0.34 - 0.34 * ph(t, W.tGunIn) + 0.13 * ph(t, W.tGunBack) - 0.13 * ph(t, W.tGunIn2) + 0.32 * ph(t, W.tGunOut2);
    const spinning = t >= 0 && ((t > W.tLoosen[0] && t < W.tLoosen[1]) || (t > W.tTight[0] && t < W.tTight[1]));
    if (spinning) W.spin += dt * 70 * (t < W.tLoosen[1] ? -1 : 1);
    W.gun.userData.socket.rotation.z = W.spin;
    // gunner kneels outside the wheel; after the stop he stands and steps back
    const gn = W.gunner, up = done > 0 ? smoother(0.25, 1.0, done) : 0;
    this.stand(gn, s * (W.xo + 0.7 + up * 0.5), W.z + W.fz * 0.05, -s * Math.PI / 2);
    gn.reset();
    gn.body({ y: 0.5 + up * 0.43, lean: 0.5 - up * 0.42, headPitch: -0.3 + up * 0.3 });
    gn.update();
    gn.foot(gn.L, 0.17, 0.3 - up * 0.3, { yaw: 0.1 });
    gn.foot(gn.R, -0.15, -0.4 + up * 0.38, { lift: 0.07 * (1 - up), pitch: 1.2 * (1 - up) });
    // gun pose: at the nut while working, resting by the hip once he stands up
    const nut = this.pt(s * (W.xo + 0.004 + gap), R + lift, W.z, this.v2);
    if (up > 0) { const rest = gn.world(-0.2, 0.62, 0.22, this.v); nut.lerp(rest, up); }
    W.gun.position.copy(nut);
    W.gun.rotation.set(-up * 1.1, H + s * Math.PI / 2, 0, 'YXZ');
    W.gun.updateMatrixWorld();
    const rear = W.gun.localToWorld(this.v.copy(W.gun.userData.rear));
    gn.hand(gn.R, rear); gn.grip(gn.R, 1);
    const sig = done < 0 && t >= 0 ? smooth(W.done - 0.02, W.done + 0.18, t) : 0;
    if (sig > 0.5 || up > 0.3) { gn.signal(gn.L, t); if (up > 0.3) gn.arm(gn.L, 0.05, 0.12, 0.25); }
    else { const fr = W.gun.localToWorld(this.v.copy(W.gun.userData.front)); gn.hand(gn.L, fr); gn.grip(gn.L, 1); }
    gn.lookAt(nut, 0.6);

    // ---- old tyre: pulled off the hub and carried away
    const base = (t >= 0 ? 1 : 0);
    let ox = Math.abs(W.x), oy = R + lift, oz = W.z, carry = 0;
    if (t >= 0) {
      const pull = ph(t, W.tPull), away = ph(t, W.tAway);
      ox += pull * 0.6 + away * 1.15; oz += W.fz * away * 0.85; oy += away * 0.12;
      carry = away;
      W.oldT.visible = t >= W.tPull[0];
    }
    W.oldT.position.copy(this.pt(s * ox, oy, oz));
    W.oldT.rotation.set(0, H + carry * W.fz * s * 0.6, 0);
    // tyre-off man beside the wheel, hands on the tread
    const of = W.off, grab = t >= 0 ? ph(t, W.tGrab) : 0;
    const ofx = s * (ox + 0.4), ofz = oz + W.fz * 0.62;
    this.stand(of, ofx, ofz, Math.atan2(-s * 0.3, -W.fz) + carry * W.fz * s * 0.6);
    const pos = of.root.position, mv = W.last.distanceTo(pos) / Math.max(dt, 1e-3); W.last.copy(pos);
    if (mv > 0.35 && carry > 0.02 && carry < 0.98) { of.gait(dt, Math.min(2.2, mv), { lean: 0.35, arms: false }); of.hips.position.y -= 0.06; }
    else { of.reset(); of.body({ y: 0.95 - 0.25 * Math.max(grab, 0.4) + carry * 0.12, lean: 0.25 + 0.3 * grab - carry * 0.15, headPitch: -0.25 }); }
    of.update();
    if (!(mv > 0.35 && carry > 0.02 && carry < 0.98)) of.stance([0.17, 0.05, -0.17, -0.12], { R: { pitch: 0.15 } });
    this.tyreHands(of, W.oldT, s, W.fz, W.w, grab * (t >= W.tAway[1] + 2.5 ? 0 : 1) * base);
    // ---- new tyre: carried in, lined up with the hub and pushed on
    let nx = W.xo + 0.66, ny = R + 0.1, nz = W.z - W.fz * 0.36, held = 1;
    if (t >= 0) {
      const a = ph(t, W.tOnIn), b = ph(t, W.tOnPush);
      nx += (Math.abs(W.x) + 0.2 - nx) * a; ny += (R + lift - ny) * a; nz += (W.z - nz) * a;
      nx += (Math.abs(W.x) - (Math.abs(W.x) + 0.2)) * b;
      W.newT.visible = t < W.tOnPush[1];
      held = 1 - smooth(W.tOnPush[1], W.tOnPush[1] + 0.25, t);
    }
    W.newT.position.copy(this.pt(s * nx, ny, nz));
    W.newT.rotation.set(0, H, 0);
    const on = W.on, back = t >= 0 ? smoother(W.tOnPush[1], W.tOnPush[1] + 0.6, t) : 0;
    this.stand(on, s * (nx + 0.12 + back * 0.45), nz - W.fz * (0.64 + back * 0.2), Math.atan2(-s * 0.3, W.fz));
    const op = on.root.position, mv2 = W.lastOn.distanceTo(op) / Math.max(dt, 1e-3); W.lastOn.copy(op);
    if (mv2 > 0.5 && held > 0.5) { on.gait(dt, Math.min(2, mv2), { lean: 0.3, arms: false }); on.hips.position.y -= 0.08; }
    else { on.reset(); on.body({ y: 0.95 - 0.24 * held - 0.04, lean: 0.12 + 0.35 * held, headPitch: -0.2 * held }); }
    on.update();
    if (!(mv2 > 0.5 && held > 0.5)) on.stance([0.16, 0.08, -0.16, -0.1], { R: { pitch: 0.1 } });
    this.tyreHands(on, W.newT, s, -W.fz, W.w, held);
  }

  // both hands on the tread of a tyre prop (k = 0..1 blend from resting hands)
  tyreHands(per, tyre, s, fz, width, k) {
    const H = tyre.rotation.y, c = tyre.position;
    // outer and inner edge of the tread on the person's side of the tyre
    const pts = [[s * width * 0.38, 0.17, fz * 0.27], [-s * width * 0.3, 0.13, fz * 0.29]];
    const arms = fz * s > 0 ? [per.R, per.L] : [per.L, per.R];
    pts.forEach(([lx, ly, lz], j) => {
      const a = arms[j];
      toWorld(c.x, c.z, H, lx * 1.1, lz * 1.12, this.o);
      this.v.set(this.o.x, c.y + ly * 1.12, this.o.z);
      if (k < 1) this.v.lerp(per.world(a.s * 0.25, 0.9, 0.22, this.v2), 1 - k);
      per.hand(a, this.v);
      per.grip(a, 0.3 + 0.6 * k);
    });
  }

  animJacks(t, dt) {
    const gs = this.box.side, H = this.box.heading;
    const C = new THREE.Vector3(), Hd = new THREE.Vector3();
    for (const front of [true, false]) {
      const J = front ? this.jackF : this.jackR, f = front ? 1 : -1, per = J.per;
      const lift = front ? this.liftF : this.liftR;
      const tin = t >= 0 ? (front ? smoother(0, 0.14, t) : smoother(0.06, 0.24, t)) : 0;
      const push = t >= 0 ? (front ? ph(t, this.tLiftF) : ph(t, this.tLiftR)) - ph(t, this.tDrop) : 0;
      const out = t >= 0 ? ph(t, this.tJackOut) : 0;
      // cradle + handle in box-local space
      let cx = 0, cy = (front ? 0.13 : 0.2) + 0.05 * tin + lift, cz = f * (3.75 - 1.03 * tin);
      let hx = 0, hy = 0.98 - 0.3 * push, hz = f * (4.85 - 0.95 * tin + 0.08 * push);
      let rx = 0, rz = f * (5.25 - 0.95 * tin);
      if (!front && t < 0) { rx = gs * 2.1; rz = -3.6; hx = gs * 1.85; hz = -3.3; cx = gs * 1.5; cz = -2.6; } // rear jack waits beside the lane
      else if (!front) { const k = smoother(0.0, 0.2, t); rx = gs * 2.1 * (1 - k); hx = gs * 1.85 * (1 - k); cx = gs * 1.5 * (1 - k); rz = -3.6 + (rz + 3.6) * k; hz = -3.3 + (hz + 3.3) * k; cz = -2.6 + (cz + 2.6) * k; }
      if (out > 0) {
        if (front) { cx += gs * 1.4 * out; cz += 0.9 * out; cy = cy * (1 - out) + 0.12 * out; hx += gs * 1.9 * out; hz += 0.5 * out; rx += gs * 2.0 * out; rz += 0.5 * out; }
        else { cz -= 0.6 * out; cy = cy * (1 - out) + 0.12 * out; hz -= 0.4 * out; rz -= 0.45 * out; }
      }
      this.pt(cx, cy, cz, C); this.pt(hx, hy, hz, Hd);
      const yaw = Math.atan2(Hd.x - C.x, Hd.z - C.z);
      J.jack.userData.setPose(C, Hd, yaw);
      const moving = !front && t >= 0 && t < 0.2;
      const faceYaw = Math.atan2(cx - rx, cz - rz);
      this.stand(per, rx, rz, faceYaw);
      if (moving) { per.gait(dt, 4.5, { lean: 0.3, arms: false }); }
      else {
        per.reset();
        per.body({ y: 0.9 - 0.12 * push - 0.05 * tin, lean: 0.2 + 0.25 * tin + 0.25 * push, headPitch: -0.2 });
      }
      per.update();
      if (!moving) per.stance([0.14, 0.22, -0.16, -0.22], { R: { pitch: 0.35 * push } });
      const g = J.jack.userData.grip;
      // grip[0] sits on the jack's +x side: give it to the hand on that side of the person
      const leftDot = Math.cos(per.root.rotation.y - yaw);
      per.hand(leftDot > 0 ? per.L : per.R, g[0]); per.hand(leftDot > 0 ? per.R : per.L, g[1]);
      per.grip(per.L, 1); per.grip(per.R, 1);
    }
  }

  animStabs(t, lift) {
    for (const S of this.stabs) {
      const per = S.per, s = S.sx;
      this.stand(per, s * 1.28, -0.42, -s * Math.PI / 2);
      const k = t >= 0 && this.state === 'service' ? smoother(0.0, 0.2, t) : 0;
      per.reset();
      per.body({ y: 0.9 - 0.2 * k, lean: 0.25 + 0.3 * k, headPitch: -0.15 });
      per.update();
      per.stance([0.18, 0.08, -0.18, -0.12]);
      const pA = this.pt(s * 0.66, 0.6 + lift, -0.18, new THREE.Vector3()), pB = this.pt(s * 0.56, 0.62 + lift, -0.72, new THREE.Vector3());
      const rA = per.world(0.25, 0.85, 0.3, new THREE.Vector3()), rB = per.world(-0.25, 0.85, 0.3, new THREE.Vector3());
      // facing the car, the person's left is towards the nose on the car's left side
      per.hand(per.L, (s > 0 ? pA : pB).lerp(rA, 1 - k));
      per.hand(per.R, (s > 0 ? pB : pA).lerp(rB, 1 - k));
      per.grip(per.L, 0.4 * k); per.grip(per.R, 0.4 * k);
    }
  }

  animChief(t, dt) {
    const per = this.chief, gs = this.box.side;
    this.stand(per, gs * 2.55, 3.3, Math.atan2(-gs * 2.55, -3.3));
    per.idle(this.wait);
    per.update();
    if (t >= 0 && this.state === 'service') per.signal(per.R, t);
    else if (t >= 0 && t - this.releasedT < 1.2) { per.arm(per.R, -1.6 + Math.sin((t - this.releasedT) * 6) * 0.5, 0.2, 0.3); }
    per.lookAt(this.car.model.group.position, 0.8);
    void dt;
  }

  camPose(out) {
    if (this.state !== 'service' || this.ai) return null;
    const B = this.box, H = B.heading, side = -B.side;
    // low broadcast angle from the fast lane, front quarter, drifting slowly
    const drift = Math.min(1, this.t / 3);
    toWorld(B.x, B.z, H, side * (5.2 - drift * 0.6), 4.6 - drift * 1.2, this.o);
    out.pos.set(this.o.x, B.y + 1.45, this.o.z);
    toWorld(B.x, B.z, H, side * 0.4, -0.2, this.o);
    out.look.set(this.o.x, B.y + 0.45, this.o.z);
    out.fov = 48;
    return out;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); if (o.userData.ownMat) o.material.dispose(); } });
    this.wheels = [];
    if (this.car.visual) this.car.visual = null;
    this.car.model.wheels.forEach((w, i) => { w.steer.position.x = this.wheelBase[i]; w.steer.visible = true; });
  }
}
