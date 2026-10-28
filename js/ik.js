import * as THREE from 'three';

// Analytic two-bone IK shared by the crew figures and the driver's arms/thumbs.
// Chain convention: lower.position = (0, -a, 0) in upper space, end effector at (0, -b, 0) in lower space,
// the joint bends about the lower bone's local X axis. bend = -1 bends forward like an elbow, +1 like a knee.
// target / pole are given in upper.parent space; pole = the direction the joint should point.
const _D = new THREE.Vector3(), _P = new THREE.Vector3(), _W = new THREE.Vector3(), _E = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const MIN_BEND = Math.cos(0.04);

export function solveTwoBone(upper, lower, b, target, pole, bend) {
  const a = -lower.position.y;
  _D.subVectors(target, upper.position);
  const d = _D.length();
  const dc = Math.min(Math.max(d, Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const c = Math.min(MIN_BEND, Math.max(-1, (dc * dc - a * a - b * b) / (2 * a * b)));
  const phi = bend * Math.acos(c);
  lower.rotation.set(phi, 0, 0);
  _W.set(0, -a - b * Math.cos(phi), -b * Math.sin(phi)).normalize();
  _E.set(0, -a, 0).addScaledVector(_W, a * _W.y);
  if (_E.lengthSq() < 1e-10) _E.set(0, 0, bend);
  _E.normalize();
  if (d < 1e-6) _D.set(0, -1, 0); else _D.multiplyScalar(1 / d);
  _P.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_P.lengthSq() < 1e-8) _P.set(0, 0, bend).addScaledVector(_D, -_D.z * bend);
  _P.normalize();
  _X.crossVectors(_W, _E); _m1.makeBasis(_W, _E, _X).transpose();
  _Y.crossVectors(_D, _P); _m2.makeBasis(_D, _P, _Y).multiply(_m1);
  upper.quaternion.setFromRotationMatrix(_m2);
  return d / (a + b);
}

const _q = new THREE.Quaternion();
// orient obj so that its world rotation equals worldQ (parent world matrix must be up to date)
export function setWorldQuat(obj, worldQ) {
  obj.parent.getWorldQuaternion(_q);
  obj.quaternion.copy(_q.invert().multiply(worldQ));
}

// world-space direction -> obj local direction
export function dirToLocal(obj, dir, out) {
  obj.getWorldQuaternion(_q);
  return out.copy(dir).applyQuaternion(_q.invert());
}

export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smoother = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };
