import * as THREE from 'three';
import * as TX from './textures.js';

// Pooled point-sprite particle system (tyre smoke, dust, sparks)
class Pool {
  constructor(max, { texture, additive, color }) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 pcolor;
        varying float vA; varying vec3 vC;
        uniform float scale;
        void main(){
          vA = alpha; vC = pcolor;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC * t.rgb, t.a * vA);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.defaultColor = new THREE.Color(color || 0xffffff);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, color) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    const c = color || this.defaultColor;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }

  update(dt, gravity, drag, fade) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-drag * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - gravity * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = fade(t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
  }
}

function sparkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,200,80,0.9)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene) {
    this.smoke = new Pool(700, { texture: TX.smokeSprite(), color: 0xdddddd });
    this.sparks = new Pool(500, { texture: sparkTexture(), additive: true, color: 0xffc060 });
    scene.add(this.smoke.points, this.sparks.points);
    this.dust = new THREE.Color(0xb59a76);
    this.grassC = new THREE.Color(0x6f7f4a);
    this.white = new THREE.Color(0xe8e8e8);
  }

  tyreSmoke(x, y, z, vx, vz, amount) {
    if (Math.random() > amount) return;
    this.smoke.emit(x + (Math.random() - 0.5) * 0.3, y + 0.15, z + (Math.random() - 0.5) * 0.3, vx * 0.3 + (Math.random() - 0.5), 0.6 + Math.random(), vz * 0.3 + (Math.random() - 0.5), 1.6 + Math.random(), 0.8, 3.2, this.white);
  }

  dirt(x, y, z, vx, vz, gravel) {
    this.smoke.emit(x, y + 0.2, z, vx * 0.4 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, vz * 0.4 + (Math.random() - 0.5) * 2, 1.2, 0.6, 2.5, gravel ? this.dust : this.grassC);
  }

  sparkBurst(x, y, z, vx, vz, n) {
    for (let k = 0; k < n; k++) {
      this.sparks.emit(x, y + 0.05, z, vx * 0.7 + (Math.random() - 0.5) * 8, Math.random() * 4, vz * 0.7 + (Math.random() - 0.5) * 8, 0.25 + Math.random() * 0.35, 0.09, -0.05);
    }
  }

  update(dt) {
    this.smoke.update(dt, -0.4, 1.2, t => Math.min(1, (1 - t) * 6) * t * 0.55);
    this.sparks.update(dt, 9.8, 0.8, t => t);
  }

  setScale(h) { this.smoke.points.material.uniforms.scale.value = h * 0.6; this.sparks.points.material.uniforms.scale.value = h * 0.6; }
}
