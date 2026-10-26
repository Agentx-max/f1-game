import * as THREE from 'three';
import { makePerson, lerpAngle } from './crew.js';
import { compoundColor, FRONT_AXLE, REAR_AXLE } from './car.js';
import * as TX from './textures.js';

const clamp01 = t => Math.max(0, Math.min(1, t));
const sstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

// car-local (x = left, z = forward) -> world
function toWorld(x0, z0, h, lx, lz, out) {
  out.x = x0 + Math.cos(h) * lx + Math.sin(h) * lz;
  out.z = z0 - Math.sin(h) * lx + Math.cos(h) * lz;
  return out;
}

const MARSHAL = { kind: 'marshal', base: '#ff6400' };

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
    this.slots = [[0.45, -3.05], [-0.45, -3.05], [1.28, -0.75], [-1.28, -0.75], null];
    this.people = this.slots.map((slot, k) => {
      const person = makePerson({ costume: MARSHAL, cap: '#ffffff', gloves: '#f0f0f0', boots: '#222' });
      const sp = tr.pointAt(car.proj.s - 10 + k * 5 - (slot ? 0 : 22), this.side * (wall + 1.6 + (k % 2) * 0.8));
      person.root.position.set(sp.x, sp.y - 0.5, sp.z);
      if (!slot) person.attachFlag('#ffd400');
      scene.add(person.root);
      return { person, slot, flag: !slot, spawn: new THREE.Vector3(sp.x, sp.y - 0.5, sp.z), delay: slot ? k * 0.18 : 0 };
    });
    this.tmp = {};
    this.proj = {};
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
      per.waveFlag(this.t);
      per.root.position.y = this.groundY(per.root.position.x, per.root.position.z);
    } else if (per.flag) per.flag.userData.update(this.t);
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
        const W = toWorld(p.x, p.z, p.heading, m.slot[0], m.slot[1], this.tmp);
        if (!this.runTo(m, W.x, W.z, 5.4, dt)) all = false;
        else { per.root.rotation.y = lerpAngle(per.root.rotation.y, p.heading, Math.min(1, dt * 8)); per.crouchHold(); }
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
        const W = toWorld(p.x, p.z, p.heading, m.slot[0], m.slot[1], this.tmp);
        per.root.position.set(W.x, this.groundY(W.x, W.z), W.z);
        per.root.rotation.y = p.heading;
        if (this.phaseT < 0.5) per.crouchHold(); else per.push(dt, Math.max(0.6, v));
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

// ------------------------------------------------------------------ driver-controlled pit stop with an animated crew
let tyreGeo = null;
function tyreProp(compound) {
  if (!tyreGeo) { tyreGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.36, 28); tyreGeo.rotateZ(Math.PI / 2); }
  const g = new THREE.Group();
  const t = new THREE.Mesh(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9 }));
  const discMat = new THREE.MeshStandardMaterial({ map: TX.tyreWall(compoundColor(compound)), roughness: 0.6 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.322, 28), discMat);
  disc.rotation.y = Math.PI / 2; disc.position.x = 0.185;
  const disc2 = disc.clone(); disc2.rotation.y = -Math.PI / 2; disc2.position.x = -0.185;
  t.castShadow = true;
  g.add(t, disc, disc2);
  return g;
}

// service timeline (seconds after the car stops on its marks)
const T = { snap: 0.3, lift: 0.5, off: 0.85, on: 1.1, seated: 1.4, tight: 1.75, drop: 1.85, go: 2.1 };

export class PitStop {
  // box: {x, y, z, heading, side}  side = which side of the car the garage is on (+1 = car's left)
  constructor({ scene, car, box, onMessage }) {
    this.scene = scene; this.car = car; this.box = box; this.msg = onMessage;
    this.state = 'waiting'; this.t = 0; this.wait = 0;
    this.compound = car.compound;
    this.wheelBase = car.model.wheels.map(w => w.steer.position.x);
    this.people = [];
    this.tmp = {};
    this.spawnCrew();
  }

  spawnCrew() {
    const team = this.car.team, L = team.livery;
    const base = team.id === 'williams' ? '#f2f2f2' : team.color;
    const costume = { kind: 'crew', base, panel: L.dark, accent: L.accent === base ? L.accent2 : L.accent, text: team.id === 'williams' || team.id === 'renault' ? '#111111' : '#ffffff', name: team.name.toUpperCase() };
    const helmet = team.id === 'williams' ? '#ffffff' : L.dark === base ? L.accent : base;
    const mk = (role, lx, lz, extra = {}) => {
      const per = makePerson({ costume, helmet, gloves: '#151515' });
      this.scene.add(per.root);
      const o = { per, role, lx, lz, ...extra };
      this.people.push(o);
      return o;
    };
    const gs = this.box.side;
    mk('jackF', 0, 5.3);
    mk('jackR', 0, -3.75);
    for (const [wz, wx] of [[FRONT_AXLE, 0.85], [FRONT_AXLE, -0.85], [REAR_AXLE, 0.8], [REAR_AXLE, -0.8]]) {
      const sx = Math.sign(wx), front = wz > 0;
      mk('gun', sx * 1.42, wz, { sx });
      const off = mk('off', sx * 1.55, wz + (front ? 0.8 : -0.8), { sx, front });
      off.prop = tyreProp(this.car.compound); off.prop.visible = false; this.scene.add(off.prop);
      const on = mk('on', sx * 2.5, wz + (front ? -0.55 : 0.55), { sx, front });
      on.prop = tyreProp(this.compound); this.scene.add(on.prop);
    }
    mk('stab', 1.3, -0.45); mk('stab', -1.3, -0.45);
    mk('release', gs * 2.6, 4.4);
  }

  service(precise) {
    if (this.state !== 'waiting') return;
    const p = this.car.phys;
    this.state = 'service'; this.t = 0; this.precise = precise;
    this.from = { x: p.x, z: p.z, h: p.heading };
    this.msg('PIT STOP', '', 1.6);
  }

  update(dt) {
    const car = this.car, p = car.phys, B = this.box;
    this.wait += dt;
    let t = 0;
    if (this.state === 'service') {
      this.t += dt; t = this.t;
      // settle the car exactly on its marks
      const k = sstep(t / T.snap);
      const x = this.from.x + (B.x - this.from.x) * k, z = this.from.z + (B.z - this.from.z) * k;
      const h = lerpAngle(this.from.h, B.heading, k);
      const lift = t < T.lift ? sstep((t - T.snap) / (T.lift - T.snap)) * 0.075 : t < T.drop ? 0.075 : Math.max(0, 0.075 * (1 - (t - T.drop) / 0.12));
      car.visual = { x, y: B.y + lift, z, heading: h, pitch: lift > 0.01 ? -0.012 : 0 };
      p.x = x; p.z = z; p.heading = h; p.u = 0; p.w = 0; p.r = 0;
      car.model.wheels.forEach((w, i) => {
        const sx = Math.sign(this.wheelBase[i]);
        let off = 0, vis = true;
        if (t >= T.lift && t < T.off) off = sstep((t - T.lift) / (T.off - T.lift)) * 0.65;
        else if (t >= T.off && t < T.on) vis = false;
        else if (t >= T.on && t < T.seated) off = (1 - sstep((t - T.on) / (T.seated - T.on))) * 0.6;
        w.steer.position.x = this.wheelBase[i] + sx * off;
        w.steer.visible = vis;
      });
      if (t >= T.on && !this.swapped) { this.swapped = true; car.model.setCompound(this.compound); }
      if (t >= T.go) {
        this.state = 'released';
        car.visual = null;
        car.model.wheels.forEach((w, i) => { w.steer.position.x = this.wheelBase[i]; w.steer.visible = true; });
        this.stationary = T.go;
      }
    }
    const S = this.state, H = B.heading;
    const svc = S === 'service', after = S === 'released';
    for (const o of this.people) {
      const per = o.per;
      let lx = o.lx, lz = o.lz, anim = 'idle', v = 0;
      switch (o.role) {
        case 'jackF':
          if (svc && t < T.drop) { lz = 5.3 - sstep(t / 0.25) * 1.7; anim = 'jack'; }
          else if (svc || after) { const k = sstep(((svc ? t : T.go + 0.3) - T.drop) / 0.3); lx = -this.box.side * 1.9 * k; lz = 3.6; anim = k < 1 ? 'run' : 'idle'; v = 3; }
          else anim = 'ready';
          break;
        case 'jackR': anim = svc && t < T.drop ? 'jack' : 'ready'; break;
        case 'gun':
          if (svc) anim = t < T.tight ? 'kneel' : 'raise';
          else anim = after ? 'idle' : 'crouch';
          break;
        case 'off':
          if (svc && t >= T.lift && t < T.off) { lx += o.sx * sstep((t - T.lift) / (T.off - T.lift)) * 0.6; anim = 'crouch'; }
          else if ((svc && t >= T.off) || after) {
            const k = clamp01(((svc ? t : 3) - T.off) / 0.9);
            lx += o.sx * (0.6 + k * 1.6); lz += (o.front ? 1 : -1) * k * 1.2; anim = k < 1 ? 'carry' : 'carryIdle'; v = 2.2;
            o.prop.visible = true;
          } else anim = 'crouch';
          break;
        case 'on':
          if (!svc && !after) anim = 'carryIdle';
          else if (svc && t < T.on) { const k = sstep((t - T.off + 0.15) / (T.on - T.off + 0.15)); lx -= o.sx * k * 0.95; lz += (o.front ? 0.55 : -0.55) * k; anim = 'carry'; v = 2.5; }
          else { lx -= o.sx * 0.95; lz += o.front ? 0.55 : -0.55; anim = svc && t < T.seated ? 'crouch' : 'idle'; o.prop.visible = false; }
          break;
        case 'stab': anim = svc ? 'crouch' : 'idle'; break;
        case 'release': anim = svc && t < T.go ? 'raise' : after ? 'wave' : 'idle'; break;
      }
      const W = toWorld(B.x, B.z, H, lx, lz, this.tmp);
      per.root.position.set(W.x, B.y - 0.02, W.z);
      if (o.role === 'jackF') per.root.rotation.y = H + Math.PI;
      else if (o.role === 'jackR') per.root.rotation.y = H;
      else if (o.sx) per.root.rotation.y = H + (o.sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      else per.root.rotation.y = Math.atan2(B.x - W.x, B.z - W.z);
      const tt = svc ? t : this.wait;
      switch (anim) {
        case 'jack': per.jack(sstep(t / 0.25)); break;
        case 'ready': per.jack(0); break;
        case 'kneel': per.kneel(tt); break;
        case 'crouch': per.crouchHold(); break;
        case 'raise': per.raiseArm(tt); break;
        case 'wave': per.raiseArm(tt * 2); break;
        case 'run': per.gait(dt, v); break;
        case 'carry': per.carry(dt, Math.max(0.8, v)); break;
        case 'carryIdle': per.carry(0, 0.3); break;
        default: per.idle(tt);
      }
      if (o.prop && o.prop.visible) {
        const r = per.root.rotation.y;
        o.prop.position.set(W.x + Math.sin(r) * 0.42, B.y + 0.78, W.z + Math.cos(r) * 0.42);
        o.prop.rotation.y = r + Math.PI / 2;
      }
    }
  }

  camPose(out) {
    if (this.state !== 'service') return null;
    const B = this.box, H = B.heading;
    // trackside of the box, slightly ahead, looking back at the car and crew
    const side = -B.side;
    out.pos.set(B.x + Math.cos(H) * side * 6.5 + Math.sin(H) * 4.5, B.y + 2.2, B.z - Math.sin(H) * side * 6.5 + Math.cos(H) * 4.5);
    out.look.set(B.x, B.y + 0.5, B.z);
    out.fov = 50;
    return out;
  }

  dispose() {
    for (const o of this.people) { this.scene.remove(o.per.root); if (o.prop) this.scene.remove(o.prop); }
    this.people = [];
    if (this.car.visual) this.car.visual = null;
    this.car.model.wheels.forEach((w, i) => { w.steer.position.x = this.wheelBase[i]; w.steer.visible = true; });
  }
}
