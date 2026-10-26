// Headless simulation for tuning: node tools/sim.mjs [trackKey] [laps] [skill]
import { TRACK_DATA } from '../js/trackdata.js';
import { TRACKS } from '../js/tracks.js';
import { TEAMS } from '../js/teams.js';
import { Track } from '../js/track.js';
import { CarPhysics, makeSpec, collideWalls, collideCars } from '../js/physics.js';
import { AIDriver } from '../js/ai.js';
import { gridSlotFn } from './gridslot.mjs';

const key = process.argv[2] || 'monza';
const LAPS = Number(process.argv[3] || 2);
const SKILL = Number(process.argv[4] || 0.95);
const NCARS = Number(process.argv[5] || 1);
const meta = TRACKS.find(t => t.key === key);
let t0 = Date.now();
const track = new Track(meta, TRACK_DATA[meta.id]);
console.log(meta.name, 'len', track.length.toFixed(0), 'samples', track.n, 'build ms', Date.now() - t0);

const prof = track.speedProfile(makeSpec(), SKILL);
let est = 0; for (let i = 0; i < track.n; i++) est += track.rlds[i] / Math.max(prof[i], 5);
console.log('profile lap estimate', est.toFixed(2), 'min v', Math.min(...prof).toFixed(1), 'max v', Math.max(...prof).toFixed(1));

const cars = [];
for (let k = 0; k < NCARS; k++) {
  const team = TEAMS[k % 10];
  const phys = new CarPhysics(makeSpec(team.perf));
  const car = { phys, proj: { i: -1 }, team, driver: team.drivers[Math.floor(k / 10) % 2], totalDist: 0, lastS: 0, drsAllowed: false, gapAhead: 9, laps: [], lapStart: 0, wallHits: 0, resp: 0, off: 0 };
  const g = gridSlotFn(track, k);
  const pt = track.pointAt(g.s, g.d);
  phys.reset(pt.x, pt.z, pt.heading, 0);
  track.project(pt.x, pt.z, pt.i, car.proj);
  car.lastS = car.proj.s; car.totalDist = g.s;
  car.ai = new AIDriver(car, track, SKILL);
  cars.push(car);
}
const race = { started: true, time: 0, startTime: 0, lightsOn: false, respawn: c => { c.resp++; const i = c.proj.i; const pt = track.pointAt(track.s[i], track.rlOffset[i]); c.phys.reset(pt.x, pt.z, pt.heading, 8); track.project(pt.x, pt.z, pt.i, c.proj); c.lastS = c.proj.s; } };
const dt = 1 / 60, sub = 4, h = dt / sub;
let maxV = 0;
t0 = Date.now();
const L = track.length;
while (race.time < LAPS * 200 && cars.some(c => c.laps.length < LAPS)) {
  race.time += dt;
  for (const c of cars) Object.assign(c.ctl = c.ctl || {}, c.ai.control(dt, cars, race));
  for (let k = 0; k < sub; k++) {
    for (const c of cars) {
      const p = c.phys, i = c.proj.i;
      const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
      const nn = sh * track.nx[i] + ch * track.nz[i];
      p.surfF = track.surface(i, c.proj.d + nn * 1.65);
      p.surfR = track.surface(i, c.proj.d - nn * 1.95);
      p.grade = c.proj.grade * (sh * track.tx[i] + ch * track.tz[i]);
      p.step(h, c.ctl);
      track.project(p.x, p.z, c.proj.i, c.proj);
      if (collideWalls(c, track) > 2) c.wallHits++;
    }
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) collideCars(cars[a], cars[b]);
  }
  for (const c of cars) {
    let ds = c.proj.s - c.lastS; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    c.lastS = c.proj.s;
    const prev = c.totalDist; c.totalDist += ds;
    if (Math.floor(c.totalDist / L) > Math.floor(prev / L) && c.totalDist > 1) { c.laps.push(race.time - c.lapStart); c.lapStart = race.time; }
    if (Math.abs(c.proj.d) > track.hw + 1.5) c.off += dt;
    maxV = Math.max(maxV, c.phys.u);
  }
}
console.log('sim wall ms', Date.now() - t0, 'max speed km/h', (maxV * 3.6).toFixed(0));
for (const c of cars) console.log(c.driver.code.padEnd(4), 'laps', c.laps.map(x => x.toFixed(2)).join(' '), 'wallHits', c.wallHits, 'respawns', c.resp, 'offtrack s', c.off.toFixed(1));
