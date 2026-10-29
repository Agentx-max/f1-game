import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

let cachedGLTF = null;
let loadPromise = null;

// Start preloading immediately so the model is cached before any incident happens
export function preloadFlagMarshal() {
  if (cachedGLTF) return Promise.resolve(cachedGLTF);
  if (loadPromise) return loadPromise;

  const loader = new GLTFLoader();
  loadPromise = new Promise((resolve) => {
    loader.load(
      'models/flag_marshal.glb',
      (gltf) => {
        let mesh = null;
        gltf.scene.traverse((o) => {
          if (o.isSkinnedMesh) mesh = o;
        });

        if (mesh) {
          prepareMarshalMesh(mesh, gltf);
        }

        cachedGLTF = gltf;
        resolve(gltf);
      },
      undefined,
      (err) => {
        console.warn('Flag marshal GLB load failed, will use fallback:', err);
        resolve(null);
      }
    );
  });
  return loadPromise;
}

// Prepare FIA marshal vertex colors and cloth flutter metadata
function prepareMarshalMesh(mesh, gltf) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const j0 = geo.attributes.skinIndex;
  const w0 = geo.attributes.skinWeight;
  const j1 = geo.attributes.joints_1;
  const w1 = geo.attributes.weights_1;

  const names = mesh.skeleton.bones.map((b) => b.name);
  const mid3 = names.indexOf('LeftHandMiddle3');

  const colors = new Float32Array(pos.count * 3);
  const flagVerts = [];

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);

    let bestJ = -1, bestW = -1;
    for (let k = 0; k < 4; k++) {
      const jIdx = j0.getComponent(i, k), wt = w0.getComponent(i, k);
      if (wt > bestW) { bestW = wt; bestJ = jIdx; }
    }
    if (j1 && w1) {
      for (let k = 0; k < 4; k++) {
        const jIdx = j1.getComponent(i, k), wt = w1.getComponent(i, k);
        if (wt > bestW) { bestW = wt; bestJ = jIdx; }
      }
    }
    const jname = names[bestJ];

    // High-visibility FIA marshal color palette:
    // Base: vibrant marshal orange #ff6a12
    let r = 1.0, g = 0.416, b = 0.07;

    if (bestJ === mid3) {
      // Flag cloth & pole
      r = 1.0; g = 0.843; b = 0.0; // FIA yellow flag #ffd700
      flagVerts.push({
        idx: i,
        bx: px, by: py, bz: pz,
        dist: Math.hypot(px - 0.28, pz - 0.05),
      });
    } else if (/Head|Neck/.test(jname)) {
      if (py > 1.47) {
        // High-vis marshal cap
        r = 1.0; g = 0.416; b = 0.07;
      } else if (Math.abs(px - (-0.37)) > 0.08 && py > 1.36 && py < 1.47) {
        // Trackside radio headset
        r = 0.14; g = 0.15; b = 0.18;
      } else {
        // Natural skin tone
        r = 0.886; g = 0.702; b = 0.569;
      }
    } else if (/Hand|Thumb|Index|Middle|Ring|Pinky/.test(jname)) {
      // Work safety gloves
      r = 0.16; g = 0.17; b = 0.19;
    } else if (/Foot|Toe/.test(jname)) {
      // Heavy-duty marshal boots
      r = 0.11; g = 0.12; b = 0.14;
    } else if (/Leg/.test(jname)) {
      // FIA marshal blue trousers #2445a8
      r = 0.141; g = 0.271; b = 0.659;
    } else if (py > 1.10 && py < 1.16) {
      // High-vis reflective safety stripe
      r = 0.94; g = 0.95; b = 0.96;
    }

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mesh.userData.flagVerts = flagVerts;

  mesh.material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}

// FlagMarshal class wrapping the animated GLB model
export class FlagMarshal {
  constructor(gltf) {
    this.root = new THREE.Group();
    this.flag = { userData: { update: (t, amp) => this.flutter(t, amp) } };
    this.isGLB = true;

    this.phase = Math.random() * 6;
    this.gaitPhase = 0;
    this.waveBlend = 0;
    this.speed = 0;
    this.clothT = 0;

    // Scratch math objects
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();

    this.initModel(gltf);
  }

  initModel(gltf) {
    const clone = SkeletonUtils.clone(gltf.scene);
    this.sceneRoot = clone;
    this.root.add(clone);

    let mesh = null;
    clone.traverse((o) => {
      if (o.isSkinnedMesh) mesh = o;
    });

    this.mesh = mesh;
    this.bones = {};

    if (mesh) {
      mesh.skeleton.bones.forEach((b) => {
        this.bones[b.name] = b;
        b.userData.restPos = b.position.clone();
        b.userData.restQuat = b.quaternion.clone();
      });
      this.flagVerts = mesh.userData.flagVerts || [];
    }
  }

  // Set local rotation relative to rest pose: rot = restQuat * deltaQuat
  setBoneRel(b, rx, ry, rz) {
    if (!b) return;
    this._e.set(rx, ry, rz, 'YXZ');
    this._q.setFromEuler(this._e);
    b.quaternion.copy(b.userData.restQuat).multiply(this._q);
  }

  // Blend bone rotation between rest and target
  slerpBoneRel(b, rx, ry, rz, k) {
    if (!b) return;
    this._e.set(rx, ry, rz, 'YXZ');
    this._q.setFromEuler(this._e).premultiply(b.userData.restQuat);
    b.quaternion.slerp(this._q, k);
  }

  resetBones() {
    for (const name in this.bones) {
      const b = this.bones[name];
      b.position.copy(b.userData.restPos);
      b.quaternion.copy(b.userData.restQuat);
    }
  }

  // Smooth realistic running gait
  gait(dt, speed) {
    this.speed = speed;
    this.waveBlend = Math.max(0, this.waveBlend - dt * 4.5);

    const b = this.bones;
    if (!b.Hips) return;

    const run = speed > 2.5;
    const strideFreq = run ? 1.5 + speed * 0.12 : 0.9 + speed * 0.45;
    this.gaitPhase += dt * strideFreq * Math.PI * 2;

    const s = Math.sin(this.gaitPhase);
    const c = Math.cos(this.gaitPhase);
    const stride = Math.min(1.2, speed / 4.8);

    // 1. Pelvis / Hips
    const bob = Math.abs(c) * (run ? 0.045 : 0.02) * stride;
    b.Hips.position.y = b.Hips.userData.restPos.y - (run ? 0.04 : 0.015) * stride + bob;
    
    // Hip pitch (lean forward into sprint), roll (sway), twist
    const hipLean = (run ? 0.22 : 0.08) * stride;
    const hipRoll = s * 0.04 * stride;
    const hipTwist = -s * 0.09 * stride;
    this.setBoneRel(b.Hips, hipLean, hipTwist, hipRoll);

    // 2. Legs
    const legAmp = (run ? 0.72 : 0.4) * stride;
    // Local X bends leg forward/back
    this.setBoneRel(b.LeftUpLeg, -s * legAmp, 0, 0);
    this.setBoneRel(b.RightUpLeg, s * legAmp, 0, 0);

    // Knees bend backwards on recovery
    const kneeL = (Math.max(0, c) * (run ? 1.3 : 0.6) + 0.08) * stride;
    const kneeR = (Math.max(0, -c) * (run ? 1.3 : 0.6) + 0.08) * stride;
    this.setBoneRel(b.LeftLeg, -kneeL, 0, 0);
    this.setBoneRel(b.RightLeg, -kneeR, 0, 0);

    // Feet flex / toe-off
    const footL = -kneeL * 0.35 + Math.max(0, -s) * 0.25 * stride;
    const footR = -kneeR * 0.35 + Math.max(0, s) * 0.25 * stride;
    this.setBoneRel(b.LeftFoot, footL, 0, 0);
    this.setBoneRel(b.RightFoot, footR, 0, 0);

    // 3. Spine / Torso
    // Spine counter-twists for balance and leans forward
    this.setBoneRel(b.Spine, hipLean * 0.5, -hipTwist * 0.6, -hipRoll * 0.5);
    this.setBoneRel(b.Spine1, hipLean * 0.3, -hipTwist * 0.5, 0);
    this.setBoneRel(b.Spine2, hipLean * 0.2, -hipTwist * 0.4, 0);

    // 4. Arms
    // Right arm (free arm): pumps rhythmically opposite to right leg
    const armSwing = (run ? 0.65 : 0.35) * stride;
    const elbowFlex = run ? 1.1 : 0.5 + Math.max(0, -s) * 0.3;
    this.setBoneRel(b.RightShoulder, 0, 0, 0);
    this.setBoneRel(b.RightArm, -s * armSwing, 0, -0.15);
    this.setBoneRel(b.RightForeArm, -elbowFlex, 0, 0);

    // Left arm (carrying the flag): held firmly forward and angled up to slice through air
    this.setBoneRel(b.LeftShoulder, -0.1, 0, 0.1);
    this.setBoneRel(b.LeftArm, 0.3 + s * 0.12 * stride, 0.15, 0.25);
    this.setBoneRel(b.LeftForeArm, -0.55 - Math.abs(c) * 0.1 * stride, 0, 0);
    this.setBoneRel(b.LeftHand, 0.2, 0, 0.1);

    // 5. Head stays level and focused forward
    this.setBoneRel(b.Neck, -hipLean * 0.5, 0, 0);
    this.setBoneRel(b.Head, -hipLean * 0.3, 0, 0);

    this.flutter(this.gaitPhase * 0.5, 0.5 * stride);
  }

  // Smooth, energetic flag waving at the trackside
  waveFlag(t, amp = 1) {
    this.waveBlend = Math.min(1, this.waveBlend + 0.06);

    const b = this.bones;
    if (!b.Hips) return;

    // Grounded athletic stance: feet planted wide, knees slightly flexed
    b.Hips.position.y = b.Hips.userData.restPos.y - 0.05;
    this.setBoneRel(b.Hips, 0.08, 0, 0);

    this.setBoneRel(b.LeftUpLeg, 0.15, 0, 0.12);
    this.setBoneRel(b.RightUpLeg, -0.12, 0, -0.12);
    this.setBoneRel(b.LeftLeg, -0.22, 0, 0);
    this.setBoneRel(b.RightLeg, -0.18, 0, 0);
    this.setBoneRel(b.LeftFoot, 0.08, 0, 0);
    this.setBoneRel(b.RightFoot, 0.08, 0, 0);

    // Waving rhythm: broad, energetic sweeps overhead & across the track
    const w = t * 6.8;
    const swX = Math.sin(w) * 0.48 * amp;
    const swY = Math.cos(w) * 0.32 * amp;
    const swZ = Math.sin(w * 0.5) * 0.25 * amp;

    // Upper body weight shift into the wave
    this.setBoneRel(b.Spine, 0.05, swX * 0.25, -swY * 0.15);
    this.setBoneRel(b.Spine1, 0.05, swX * 0.22, -swY * 0.12);
    this.setBoneRel(b.Spine2, 0.06, swX * 0.20, -swY * 0.10);

    // Left arm: vigorous overhead waving figure-eight
    this.setBoneRel(b.LeftShoulder, -0.2 + swY * 0.2, 0, 0.25 + swX * 0.2);
    this.setBoneRel(b.LeftArm, -0.7 + swY * 0.55, swX * 0.35, 0.5 + swZ);
    this.setBoneRel(b.LeftForeArm, -0.45 - Math.max(0, Math.sin(w)) * 0.55 * amp, 0, swX * 0.3);
    this.setBoneRel(b.LeftHand, Math.cos(w) * 0.6 * amp, 0, Math.sin(w) * 0.4 * amp);

    // Right arm: alert trackside ready stance at hip
    this.setBoneRel(b.RightShoulder, 0, 0, -0.1);
    this.setBoneRel(b.RightArm, 0.1, 0, -0.25);
    this.setBoneRel(b.RightForeArm, -0.65, 0, 0);
    this.setBoneRel(b.RightHand, 0.15, 0, 0);

    // Head alert, watching oncoming traffic upstream
    this.setBoneRel(b.Neck, -0.05, -swX * 0.15, 0);
    this.setBoneRel(b.Head, -0.05, -swX * 0.2, 0);

    this.flutter(t, amp);
  }

  // Alert idle stance
  idle(t) {
    const b = this.bones;
    if (!b.Hips) return;

    const br = Math.sin(t * 1.8) * 0.01;
    b.Hips.position.y = b.Hips.userData.restPos.y + br;
    this.setBoneRel(b.Hips, 0.02, 0, 0);
    this.setBoneRel(b.Spine, 0.02 + br * 2, 0, 0);
    this.setBoneRel(b.Spine2, br * 2, 0, 0);

    this.setBoneRel(b.LeftUpLeg, 0.04, 0, 0.05);
    this.setBoneRel(b.RightUpLeg, 0.04, 0, -0.05);
    this.setBoneRel(b.LeftLeg, -0.08, 0, 0);
    this.setBoneRel(b.RightLeg, -0.08, 0, 0);

    // Left arm holding flag at rest
    this.setBoneRel(b.LeftArm, 0.15, 0.1, 0.2);
    this.setBoneRel(b.LeftForeArm, -0.4, 0, 0);

    // Right arm resting at side
    this.setBoneRel(b.RightArm, 0.05, 0, -0.1);
    this.setBoneRel(b.RightForeArm, -0.2, 0, 0);

    this.flutter(t, 0.15);
  }

  // Turn head to look towards incoming cars
  lookAt(worldPos, k = 1) {
    const b = this.bones;
    if (!b.Head) return;
    this._v.copy(worldPos);
    this.root.worldToLocal(this._v);

    const yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(this._v.x, this._v.z))) * k;
    const pitch = Math.max(-0.4, Math.min(0.4, -Math.atan2(this._v.y - 1.4, Math.hypot(this._v.x, this._v.z)))) * k;

    if (b.Neck) this.setBoneRel(b.Neck, pitch * 0.45, yaw * 0.45, 0);
    if (b.Head) this.setBoneRel(b.Head, pitch * 0.55, yaw * 0.55, 0);
  }

  // Real-time flag cloth ripple and flutter
  flutter(t, amp = 1) {
    if (!this.mesh || !this.flagVerts || !this.flagVerts.length) return;
    const pos = this.mesh.geometry.attributes.position;
    const verts = this.flagVerts;

    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      // Wave ripple travelling out from the pole
      const w1 = Math.sin(v.dist * 14 - t * 16) * 0.045 * (v.dist / 0.65) * amp;
      const w2 = Math.cos(t * 7.5 + v.dist * 8) * 0.02 * (v.dist / 0.65) * amp;
      const disp = w1 + w2;

      // Displace along cloth normal (mostly along local Z/X)
      pos.setXYZ(v.idx, v.bx + disp * 0.35, v.by + disp * 0.15, v.bz + disp * 0.9);
    }
    pos.needsUpdate = true;
  }

  update() {
    this.root.updateMatrixWorld(true);
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

// Factory function: returns a FlagMarshal if GLB is loaded, or begins loading and swaps in
export function makeFlagMarshal() {
  if (cachedGLTF) {
    return new FlagMarshal(cachedGLTF);
  }

  // If not yet cached, start loading and return proxy that populates when ready
  const proxy = new FlagMarshalFallback();
  preloadFlagMarshal().then((gltf) => {
    if (gltf) proxy.upgradeToGLTF(gltf);
  });
  return proxy;
}

// Lightweight proxy fallback that matches the Person interface while GLTF loads
class FlagMarshalFallback {
  constructor() {
    this.root = new THREE.Group();
    this.realMarshal = null;
    this.flag = { userData: { update: () => {} } };
  }

  upgradeToGLTF(gltf) {
    const fm = new FlagMarshal(gltf);
    this.realMarshal = fm;
    this.root.add(fm.root);
    this.flag = fm.flag;
  }

  gait(dt, speed) {
    if (this.realMarshal) this.realMarshal.gait(dt, speed);
  }

  waveFlag(t, amp) {
    if (this.realMarshal) this.realMarshal.waveFlag(t, amp);
  }

  idle(t) {
    if (this.realMarshal) this.realMarshal.idle(t);
  }

  lookAt(worldPos, k) {
    if (this.realMarshal) this.realMarshal.lookAt(worldPos, k);
  }

  update() {
    if (this.realMarshal) this.realMarshal.update();
    this.root.updateMatrixWorld(true);
  }

  dispose() {
    if (this.realMarshal) this.realMarshal.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

// Preload on initial import
preloadFlagMarshal();
