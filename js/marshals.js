import * as THREE from 'three';
import { makePerson, MARSHAL_FLAG, MARSHAL_TRACK, makeExtinguisher } from './crew.js';

// Marshal posts behind the barriers: a flag marshal and a track marshal with an extinguisher on a small platform.
// They watch the cars go by and wave yellow flags when there is an incident just ahead of their post.
export class MarshalPosts {
  constructor(scene, track, quality) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.scene = scene; this.track = track; this.t = 0; this.posts = [];
    const n = quality === 'low' ? 5 : quality === 'medium' ? 9 : 12, P = track.pit;
    const padMat = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.9 });
    const signMat = new THREE.MeshStandardMaterial({ color: 0xff6a12, roughness: 0.6 });
    for (let k = 0; k < n; k++) {
      let i = track.indexAtS(track.length * (k + 0.55) / n);
      if (P && P.inPit[i]) i = track.indexAtS(track.s[i] + 260);
      const side = track.curvWide[(i + 20) % track.n] > 0 ? -1 : 1; // outside of the next corner
      const wall = side === 1 ? track.wallL[i] : track.wallR[i];
      const off = wall + 1.5, y = track.py[i];
      const at = d => new THREE.Vector3(track.px[i] + track.nx[i] * side * d, y, track.pz[i] + track.nz[i] * side * d);
      const face = Math.atan2(-track.nx[i] * side, -track.nz[i] * side) * 0.6 + Math.atan2(-track.tx[i], -track.tz[i]) * 0.4; // towards the track, upstream
      const base = at(off + 0.4);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1, 1.8), padMat);
      pad.position.copy(base).add(new THREE.Vector3(0, -0.52, 0)); pad.rotation.y = Math.atan2(track.tx[i], track.tz[i]); pad.receiveShadow = true;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.05), signMat);
      sign.position.copy(at(off + 1.3)).add(new THREE.Vector3(0, 2.3, 0)); sign.rotation.y = pad.rotation.y + (side === 1 ? -Math.PI / 2 : Math.PI / 2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), padMat);
      pole.position.copy(at(off + 1.3)).add(new THREE.Vector3(0, 1.15, 0));
      this.group.add(pad, sign, pole);
      const flag = makePerson({ costume: MARSHAL_FLAG }), mar = makePerson({ costume: MARSHAL_TRACK });
      flag.attachFlag('#ffd400');
      flag.root.position.copy(at(off)).addScaledVector(new THREE.Vector3(track.tx[i], 0, track.tz[i]), 0.6);
      mar.root.position.copy(at(off + 0.2)).addScaledVector(new THREE.Vector3(track.tx[i], 0, track.tz[i]), -0.7);
      const ext = makeExtinguisher(); ext.position.copy(mar.root.position).addScaledVector(new THREE.Vector3(track.tx[i], 0, track.tz[i]), -0.45);
      for (const p of [flag, mar]) { p.root.rotation.y = face; this.group.add(p.root); p.mesh.castShadow = quality !== 'low'; }
      this.group.add(ext);
      this.posts.push({ i, s: track.s[i], flag, mar, yellow: 0, pos: flag.root.position.clone() });
    }
    this.v = new THREE.Vector3();
    this.update(0.016, null, null, true);
  }

  // yellow flags at the posts covering the stretch just before (x, z)
  incident(x, z, dur = 15) {
    const i = this.track.nearestIndex(x, z, 300); if (i < 0) return;
    const L = this.track.length, s = this.track.s[i];
    for (const p of this.posts) { let d = (s - p.s) % L; if (d < 0) d += L; if (d < 450) p.yellow = Math.max(p.yellow, dur); }
  }

  update(dt, camera, race, force = false) {
    this.t += dt;
    for (const p of this.posts) {
      p.yellow = Math.max(0, p.yellow - dt);
      if (!force && camera && camera.position.distanceToSquared(p.pos) > 240 * 240) continue;
      const t = this.t + p.s;
      if (p.yellow > 0) p.flag.waveFlag(this.t * 1.1 + p.s, 1); else p.flag.holdFlag(t);
      p.mar.idle(t + 3);
      // heads follow the nearest car going by
      if (race) {
        let best = null, bd = 70 * 70;
        for (const c of race.cars) { const d = (c.phys.x - p.pos.x) ** 2 + (c.phys.z - p.pos.z) ** 2; if (d < bd) { bd = d; best = c; } }
        if (best) { this.v.set(best.phys.x, best.proj.y + 0.5, best.phys.z); p.flag.update(); p.flag.lookAt(this.v, 0.8); p.mar.update(); p.mar.lookAt(this.v, 0.9); }
      }
    }
  }

  dispose() { this.scene.remove(this.group); }
}
