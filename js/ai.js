// AI driver: pure-pursuit steering on the racing line, speed-profile throttle/brake,
// simple overtaking/defending lateral offsets, DRS + ERS usage.
export class AIDriver {
  constructor(car, track, skill) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.offset = 0;
    this.targetOffset = 0;
    this.profile = track.speedProfile(car.phys.spec, skill, 1);
    this.reaction = 0.15 + Math.random() * 0.35;
    this.stuckT = 0;
    this.mistakeT = 0;
    this.ersLap = Math.random() < 0.5;
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
    this.targetOffset = wantOffset;
    const rate = 2.2 * dt;
    this.offset += Math.max(-rate, Math.min(rate, this.targetOffset - this.offset));

    // --- steering: pure pursuit
    const look = Math.min(48, Math.max(9, 7 + Math.abs(u) * 0.42));
    const j = (i + Math.round(look / tr.ds)) % N;
    const off = Math.max(-lim, Math.min(lim, tr.rlOffset[j] + this.offset));
    const tx = tr.px[j] + tr.nx[j] * off, tz = tr.pz[j] + tr.nz[j] * off;
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
    const rx = tx - p.x, rz = tz - p.z;
    const fwd = rx * sh + rz * ch, left = rx * ch - rz * sh;
    const alpha = Math.atan2(left, fwd);
    const Ld = Math.hypot(rx, rz);
    let delta = Math.atan(2 * 3.6 * Math.sin(alpha) / Ld);
    // yaw damping to stop oscillation, counter-steer on slides
    const desiredR = u * 2 * Math.sin(alpha) / Ld;
    delta += (desiredR - p.r) * 0.04;
    if (Math.abs(p.slipR) > 0.07) delta += (p.slipR - Math.sign(p.slipR) * 0.07) * 0.9;
    ctl.steerAngle = Math.max(-0.38, Math.min(0.38, delta));

    // --- speed
    const k = (i + Math.round(Math.max(3, u * 0.12) / tr.ds)) % N;
    let vt = this.profile[k] * (this.speedScale || 1); // speedScale < 1 when the track gets wetter
    vt = Math.min(vt, speedCap);
    const offTrack = Math.abs(car.proj.d) > tr.hw + 0.5;
    if (offTrack) vt = Math.min(vt, 45);
    const err = vt - u;
    if (err > 0) {
      ctl.throttle = Math.min(1, 0.35 + err * 0.35);
      // ease throttle if sliding
      if (Math.abs(p.slipR) > 0.1) ctl.throttle *= 0.6;
    } else {
      ctl.throttle = err > -1.2 ? 0.25 : 0;
      ctl.brake = Math.min(1, Math.max(0, (-err - 0.6) * 0.3));
    }

    // DRS & ERS
    car.drsOpen = car.drsAllowed && tr.inDRSZone(car.proj.s) && ctl.throttle > 0.9;
    const straight = Math.abs(tr.curvWide[i]) < 1 / 600;
    ctl.ers = straight && u > 35 && ctl.throttle > 0.9 && p.ers > 0.6e6 && (car.gapAhead < 1.2 || this.ersLap);

    // stuck / wrong way recovery
    const along = sh * tr.tx[i] + ch * tr.tz[i];
    if ((Math.abs(u) < 3 || along < -0.3) && race.started) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 2.5) { race.respawn(car); this.stuckT = 0; }
    return ctl;
  }

  onNewLap() { this.ersLap = Math.random() < 0.45; }
}
