import * as THREE from 'three';

// Night floodlighting without hundreds of real lights: a light field baked over the circuit (intensity, direction to
// the nearest lamp banks, reference height) is sampled by every MeshStandard/MeshPhysical material and shaded with
// the regular PBR direct-light model, so asphalt, paint, helmets and suits get correct diffuse + specular highlights.
// Off (floodOn = 0) the extra code is skipped, so day and rain races look exactly as before.
const empty = new THREE.DataTexture(new Uint8Array([0, 128, 128, 0]), 1, 1);
empty.needsUpdate = true;
export const FLOOD = {
  on: { value: 0 }, map: { value: empty }, min: { value: new THREE.Vector2() }, inv: { value: new THREE.Vector2(1, 1) },
  h: { value: new THREE.Vector2(0, 1) }, color: { value: new THREE.Color(1, 0.965, 0.92) }, intensity: { value: 2.5 },
};

THREE.MeshStandardMaterial.prototype.onBeforeCompile = function (shader) {
  const U = shader.uniforms;
  U.floodOn = FLOOD.on; U.floodMap = FLOOD.map; U.floodMin = FLOOD.min; U.floodInv = FLOOD.inv;
  U.floodH = FLOOD.h; U.floodColor = FLOOD.color; U.floodIntensity = FLOOD.intensity;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFloodW;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 fw = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          fw = batchingMatrix * fw;
        #endif
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
        vFloodW = ( modelMatrix * fw ).xyz;
      }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vFloodW;
      uniform float floodOn; uniform sampler2D floodMap; uniform vec2 floodMin; uniform vec2 floodInv;
      uniform vec2 floodH; uniform vec3 floodColor; uniform float floodIntensity;`)
    .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      if ( floodOn > 0.5 ) {
        vec2 fuv = ( vFloodW.xz - floodMin ) * floodInv;
        if ( fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0 ) {
          vec4 fl = texture2D( floodMap, fuv );
          float dy = vFloodW.y - ( floodH.x + fl.a * floodH.y );
          float vf = smoothstep( -16.0, -2.0, dy ) * ( 1.0 - smoothstep( 14.0, 32.0, dy ) );
          float fI = fl.r * vf * floodIntensity;
          if ( fI > 0.002 ) {
            vec2 fd = fl.gb * 2.0 - 1.0;
            vec3 fLw = normalize( vec3( fd.x, 0.95, fd.y ) );
            IncidentLight fLight;
            fLight.direction = normalize( ( viewMatrix * vec4( fLw, 0.0 ) ).xyz );
            fLight.color = floodColor * fI;
            fLight.visible = true;
            RE_Direct( fLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
            // the many other lamp banks around fill the shadows softly
            reflectedLight.indirectDiffuse += floodColor * fI * 0.24 * BRDF_Lambert( material.diffuseColor );
          }
        }
      }`);
};

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// lamps: [{ x, z, i (aim sample), side, off }] -> field texture + mapping
export function buildFloodField(track, lamps, spacing) {
  const bb = track.bbox, M = 90;
  const minx = bb.minx - M, minz = bb.minz - M, w = bb.maxx - bb.minx + 2 * M, h = bb.maxz - bb.minz + 2 * M;
  const cell = Math.max(2.2, Math.max(w, h) / 1024);
  const W = Math.ceil(w / cell) + 1, H = Math.ceil(h / cell) + 1;
  const I = new Float32Array(W * H), DX = new Float32Array(W * H), DZ = new Float32Array(W * H), HY = new Float32Array(W * H);
  const hw = track.hw, sig = spacing * 0.85, R = Math.max(sig * 2.4, hw + 48);
  for (const L of lamps) {
    const i = L.i, ax = track.px[i], az = track.pz[i], ay = track.py[i];
    const tx = track.tx[i], tz = track.tz[i], nx = track.nx[i] * L.side, nz = track.nz[i] * L.side;
    const x0 = Math.max(0, Math.floor((ax - R - minx) / cell)), x1 = Math.min(W - 1, Math.ceil((ax + R - minx) / cell));
    const z0 = Math.max(0, Math.floor((az - R - minz) / cell)), z1 = Math.min(H - 1, Math.ceil((az + R - minz) / cell));
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const X = minx + gx * cell, Z = minz + gz * cell, dx = X - ax, dz = Z - az;
      const along = dx * tx + dz * tz, lat = dx * nx + dz * nz; // lat > 0 = towards this lamp's side
      const fa = Math.exp(-(along * along) / (2 * sig * sig));
      if (fa < 0.01) continue;
      const al = Math.abs(lat);
      let fl = 1 - sm(hw + 1.5, hw + 44, al) * 0.97;
      if (al > hw + 44) fl *= Math.exp(-(al - hw - 44) / 8);
      if (lat > L.off + 1.5) fl *= Math.exp(-(lat - L.off - 1.5) / 5); // behind the lamp
      const v = fa * fl * (lat > 0 ? 1.1 : 0.9);
      if (v < 0.004) continue;
      const k = gz * W + gx;
      let ddx = L.x - X, ddz = L.z - Z; const dl = Math.hypot(ddx, ddz) || 1;
      I[k] += v; DX[k] += ddx / dl * v; DZ[k] += ddz / dl * v; HY[k] += ay * v;
    }
  }
  // normalise so the racing surface sits at ~1
  let sum = 0, n = 0;
  for (let i = 0; i < track.n; i += 3) {
    const gx = Math.round((track.px[i] - minx) / cell), gz = Math.round((track.pz[i] - minz) / cell);
    sum += I[gz * W + gx]; n++;
  }
  const norm = n && sum > 0 ? n / sum : 1;
  let hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < track.n; i++) { hmin = Math.min(hmin, track.py[i]); hmax = Math.max(hmax, track.py[i]); }
  hmin -= 10; hmax += 10;
  const data = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const v = I[k];
    const l = Math.hypot(DX[k], DZ[k]) || 1;
    data[k * 4] = Math.min(255, Math.round(Math.min(1, v * norm) * 255));
    data[k * 4 + 1] = Math.round((DX[k] / l * 0.5 + 0.5) * 255 * Math.min(1, l / (v || 1)) + 127.5 * (1 - Math.min(1, l / (v || 1))));
    data[k * 4 + 2] = Math.round((DZ[k] / l * 0.5 + 0.5) * 255 * Math.min(1, l / (v || 1)) + 127.5 * (1 - Math.min(1, l / (v || 1))));
    data[k * 4 + 3] = v > 0 ? Math.round(Math.max(0, Math.min(1, (HY[k] / v - hmin) / (hmax - hmin))) * 255) : 0;
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { tex, min: new THREE.Vector2(minx - cell / 2, minz - cell / 2), inv: new THREE.Vector2(1 / (W * cell), 1 / (H * cell)), h: new THREE.Vector2(hmin, hmax - hmin) };
}

export function enableFlood(field) {
  FLOOD.map.value = field.tex; FLOOD.min.value.copy(field.min); FLOOD.inv.value.copy(field.inv); FLOOD.h.value.copy(field.h);
  FLOOD.on.value = 1;
}
export function disableFlood() { FLOOD.on.value = 0; FLOOD.map.value = empty; }
