import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACK_DATA } from './trackdata.js';
import { TRACKS } from './tracks.js';
import { TEAMS } from './teams.js';
import { Track, KERB_W } from './track.js';
import { buildScenery, gridSlot } from './scenery.js';
import { buildCar, FRONT_AXLE, REAR_AXLE } from './car.js';
import { CarPhysics, makeSpec, collideWalls, collideCars } from './physics.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import * as TX from './textures.js';
import { buildMenu, buildPauseSettings } from './menu.js';
import { progress, UPGRADES, HANDLING, raceReward } from './progress.js';
import { Rescue, PitStop } from './events.js';
import { Weather } from './weather.js';
import { setupOnline } from './online.js';
import { SEND_HZ, packCar, makeRemote, pushSnapshot, applyRemote, makeNameTag } from './mpcars.js';
import { TeamRadio } from './radio.js';
import { Engineer } from './engineer.js';

const $ = id => document.getElementById(id);
const escHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.addEventListener('error', e => { const el = $('error'); el.textContent = 'Error: ' + e.message + '\n' + (e.error && e.error.stack || ''); el.classList.remove('hidden'); });

// ---------------------------------------------------------------- settings
const isMobile = matchMedia('(pointer: coarse)').matches || (('ontouchstart' in window) && Math.min(screen.width, screen.height) < 900);
if (isMobile) document.body.classList.add('mobile');
const DEFAULTS = { mode: 'race', track: 'it-1922', team: 'mclaren', driver: 0, laps: 0, diff: 0.91, field: isMobile ? 10 : 20, grid: 'mid', tyre: 'soft', tc: true, abs: true, gear: true, steer: true, line: true, quality: isMobile ? 'low' : 'medium', cam: 0, blur: !isMobile, vol: 0.7, touch: 'buttons', tiltInvert: false, standings: true, cond: 'day', mpName: '', radio: true, handling: isMobile ? 'easy' : 'medium' };
const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('f1gp.settings') || '{}'));
const saveSettings = () => localStorage.setItem('f1gp.settings', JSON.stringify(settings));
const TYRE_GRIP = { supersoft: 1.025, soft: 1.0, medium: 0.98, hard: 0.96 };

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
TX.setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
const pmrem = new THREE.PMREMGenerator(renderer);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 9000);
let composer, renderPass, bloomPass, blurPass;

const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, vignette: { value: 0.35 }, center: { value: new THREE.Vector2(0.5, 0.52) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette; uniform vec2 center; varying vec2 vUv;
    void main(){
      vec2 dir = vUv - center; float d = length(dir);
      float k = amount * smoothstep(0.12, 0.75, d);
      vec4 col = vec4(0.0); float tot = 0.0;
      for (int i = 0; i < 10; i++) { float t = float(i) / 9.0; float w = 1.0 - t * 0.6; col += texture2D(tDiffuse, vUv - dir * t * k) * w; tot += w; }
      col /= tot;
      float ca = k * 0.25;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + dir * ca).r, 0.6);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - dir * ca).b, 0.6);
      col.rgb *= 1.0 - vignette * smoothstep(0.35, 0.95, d);
      gl_FragColor = col;
    }`,
};

// rear-view mirrors (rendered only in cockpit view)
const mirror = {
  rt: new THREE.WebGLRenderTarget(384, 148, { type: THREE.HalfFloatType }),
  cam: new THREE.PerspectiveCamera(30, 384 / 148, 0.5, 1500),
  frame: 0,
};
mirror.mat = new THREE.MeshBasicMaterial({ map: mirror.rt.texture });

// adaptive resolution keeps the frame rate up on slower GPUs
let basePR = 1, resScale = 1;
const perf = { t: 0, frames: 0 };
function applyResolution() {
  const pr = basePR * resScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  if (effects) effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
}
function adaptResolution(dt) {
  perf.t += dt; perf.frames++;
  if (perf.t < 2) return;
  const fps = perf.frames / perf.t;
  perf.t = 0; perf.frames = 0;
  if (fps < 48 && resScale > 0.55) { resScale = Math.max(0.55, resScale * 0.85); applyResolution(); }
  else if (fps > 58 && resScale < 1) { resScale = Math.min(1, resScale / 0.88); applyResolution(); }
}

function setupComposer() {
  if (composer) composer.dispose();
  const q = settings.quality;
  const dpr = Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1);
  basePR = q === 'low' ? Math.min(1, dpr) * 0.85 : dpr;
  renderer.setPixelRatio(basePR * resScale);
  renderer.setSize(innerWidth, innerHeight);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(new THREE.Scene(), camera);
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92);
  bloomPass.enabled = q !== 'low';
  composer.addPass(bloomPass);
  blurPass = new ShaderPass(SpeedShader);
  blurPass.enabled = q !== 'low' || settings.blur;
  composer.addPass(blurPass);
  composer.addPass(new OutputPass());
  renderer.shadowMap.enabled = true;
  if (sun) { const s = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024; if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  show.camera.aspect = innerWidth / innerHeight; show.camera.updateProjectionMatrix();
  setupComposer();
  if (effects) effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
});

// ---------------------------------------------------------------- showroom (menu background)
const show = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200), car: null, t: 0 };
{
  const s = show.scene;
  s.background = new THREE.Color(0x07070b);
  s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  s.environmentIntensity = 0.55;
  s.fog = new THREE.Fog(0x07070b, 14, 40);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 96), new THREE.MeshStandardMaterial({ color: 0x0e0e13, roughness: 0.32, metalness: 0.7 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  s.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.0, 128), new THREE.MeshBasicMaterial({ color: 0xe10600 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003;
  s.add(ring);
  const key = new THREE.SpotLight(0xffffff, 380, 30, 0.6, 0.6, 1.6);
  key.position.set(3, 9, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002;
  s.add(key);
  const rim = new THREE.SpotLight(0xff3020, 220, 30, 0.7, 0.8, 1.6);
  rim.position.set(-6, 4, -6); s.add(rim);
  const fill = new THREE.SpotLight(0x88aaff, 140, 30, 0.8, 0.8, 1.6);
  fill.position.set(6, 3, -4); s.add(fill);
  for (let k = 0; k < 3; k++) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    strip.position.set(0, 7, -2 + k * 2); strip.rotation.x = Math.PI / 2;
    s.add(strip);
  }
}
function setShowroomCar() {
  if (show.car) { show.scene.remove(show.car.group); }
  const team = TEAMS.find(t => t.id === settings.team);
  show.car = buildCar(team, settings.driver, { compound: settings.tyre, hands: true });
  show.car.group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  show.scene.add(show.car.group);
  $('sc-team').textContent = team.name;
  $('sc-team').style.color = team.color === '#FFFFFF' ? '#fff' : team.color;
  $('sc-car').textContent = team.car;
  $('sc-drivers').innerHTML = team.drivers.map((d, i) => `<span style="color:${i === settings.driver ? '#fff' : '#777'}">#${d.num} ${d.name}</span>`).join(' &nbsp;·&nbsp; ');
}
function updateShowroom(dt) {
  show.t += dt;
  const a = show.t * 0.25;
  if (show.car) {
    show.car.group.rotation.y = a;
    show.car.update(dt, { speed: 0, steer: Math.sin(show.t * 0.6) * 0.25, drs: Math.sin(show.t * 0.4) > 0.6 });
  }
  const c = show.camera;
  const aspect = innerWidth / innerHeight;
  const off = aspect > 1.25 ? 2.7 * Math.min(1, aspect / 1.78) : 0;
  const dist = aspect > 1.25 ? 11.5 : 15;
  c.position.set(-off * 0.85, 2.4, dist);
  c.lookAt(-off, 0.25, 0);
}

// ---------------------------------------------------------------- race scene
let scene = null, sun = null, hemi = null, sky = null, track = null, scenery = null, trackId = null, effects = null;
const input = new Input();
const audio = new AudioEngine();
let state = 'menu';
let paused = false;
let race = null;
let camMode = settings.cam | 0;
const CAMS = ['CHASE CAM', 'FAR CHASE', 'T-CAM', 'COCKPIT', 'NOSE CAM', 'TV CAM'];
let hudVisible = true;
let showLine = settings.line;
let weather = null, envCond = null;
// online race context (null in single player): { lobby, grid, hostId, mySlot, settings, sendT }
let mp = null, online = null;
let radio = null, engineer = null;

const sleep = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
function setLoading(text, pct) { $('load-text').textContent = text; $('load-fill').style.width = pct + '%'; }

function disposeObject(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
  });
}

async function loadEvent() {
  const trackSel = mp ? mp.settings.track : settings.track;
  const cond = mp ? mp.settings.cond || 'day' : settings.cond || 'day';
  const meta = TRACKS.find(t => t.id === trackSel);
  $('menu').classList.add('hidden');
  $('online').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const condTxt = cond === 'night' ? ' · NIGHT RACE' : cond === 'rain' ? ' · WET RACE' : '';
  $('load-track').innerHTML = `${meta.gp}<div style="font-size:16px;color:#aaa;letter-spacing:4px;font-style:normal;font-weight:600;margin-top:6px">${meta.name.toUpperCase()}${condTxt}${mp ? ' · ONLINE' : ''}</div>`;
  setLoading('Building circuit geometry', 10); await sleep();

  if (trackId !== meta.id || scenery?.quality !== settings.quality || envCond !== cond) {
    if (weather) { weather.dispose(); weather = null; }
    if (scene) disposeObject(scene);
    scene = new THREE.Scene();
    track = new Track(meta, TRACK_DATA[meta.id]);
    trackId = meta.id;
    setLoading('Laying asphalt, kerbs and barriers', 35); await sleep();
    scenery = buildScenery(track, settings.quality);
    scenery.quality = settings.quality;
    scene.add(scenery.group);
    setLoading(cond === 'night' ? 'Switching on the floodlights' : cond === 'rain' ? 'Bringing the rain' : 'Lighting the sky', 65); await sleep();
    setupEnvironment(meta);
    weather = new Weather({ scene, track, sky, sun, hemi, renderer, quality: settings.quality, condition: cond, scenery });
    weather.onThunder = dist => { if (state === 'race' && !paused) audio.thunder(dist); };
    envCond = cond;
    effects = new Effects(scene);
    effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
    weather.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
    buildTVCams();
    buildMinimap();
  } else {
    // remove old cars
    endEvent();
    for (const c of race?.cars || []) { scene.remove(c.model.group); c.model.dispose(); }
    if (race?.ghostCar) scene.remove(race.ghostCar.group);
  }
  setLoading('Rolling cars onto the grid', 85); await sleep();
  weather.apply();
  setupRace(meta);
  setLoading(mp ? 'Waiting for the other drivers' : 'Ready', 100); await sleep();
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isMobile);
  document.body.classList.toggle('mp', !!mp);
  document.body.classList.toggle('mp-host', !!mp && mp.hostId === online.net.id);
  state = 'race'; paused = false;
  applyStandings(false);
  if (isMobile && !localStorage.getItem('f1gp.guideSeen') && !mp) showGuide(true);
  checkOrientation();
  audio.init(); audio.setVolume(settings.vol); audio.resume();
  audio.setRain(envCond === 'rain');
  if (mp) { online.net.send('loaded'); showMsg('WAITING FOR ALL DRIVERS…', 'small', 30); }
}

function setupEnvironment(meta) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - meta.sun.elevation), THREE.MathUtils.degToRad(meta.sun.azimuth));
  const mkSky = scale => {
    const s = new Sky(); s.scale.setScalar(scale);
    const u = s.material.uniforms;
    u.turbidity.value = meta.sky.turbidity; u.rayleigh.value = meta.sky.rayleigh;
    u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
    u.sunPosition.value.copy(sunDir);
    return s;
  };
  sky = mkSky(8000);
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(mkSky(50));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: meta.ground === 'urban' ? 0x6b6865 : 0x4c5a35 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;
  scene.fog = new THREE.Fog(meta.fog, 250, 5200);
  const warm = meta.sun.elevation < 20;
  sun = new THREE.DirectionalLight(warm ? 0xffd2a6 : 0xfff3e2, warm ? 3.0 : 3.4);
  sun.castShadow = true;
  const sm = settings.quality === 'high' ? 4096 : settings.quality === 'medium' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  sun.userData.dir = sunDir.clone();
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0xbcd3f0, 0x55503f, 0.55);
  scene.add(hemi);
}

// ---------------------------------------------------------------- race setup
function makeCar(team, di, isPlayer, compound) {
  const perf = { ...team.perf };
  const spec = makeSpec(perf);
  spec.mu *= TYRE_GRIP[compound] || 1;
  // online "equal cars": no garage upgrades and no EASY grip bonus, so the race is fair
  const fair = mp && mp.settings.equal;
  if (isPlayer && !fair) { progress.applyTo(spec); spec.mu *= (HANDLING[settings.handling] || HANDLING.medium).grip; }
  spec.mu *= weather ? weather.gripMul : 1; // wet track: less grip for everyone (AI brakes earlier too)
  const phys = new CarPhysics(spec);
  const model = buildCar(team, di, { compound, player: isPlayer });
  scene.add(model.group);
  if (isPlayer && settings.quality !== 'low') model.mirrors.forEach(m => { m.material = mirror.mat; });
  return {
    team, driver: team.drivers[di], di, isPlayer, phys, model, compound,
    proj: { i: -1, s: 0, d: 0, y: 0, grade: 0 }, lastS: 0, totalDist: 0,
    lapStart: 0, lastLap: null, bestLap: null, laps: [], sectorIdx: 0, sectorStart: 0, curSectors: [null, null, null], lastSectors: [null, null, null],
    cp: [], finished: false, finishTime: 0, finishOrder: 0, drsAllowed: false, drsOpen: false, inDrs: false, gapAhead: 99, gapLeader: 0,
    ai: null, retired: false, invalid: false, wear: 0, frozen: false, visual: null, stuckT: 0, sF: { grip: 1, drag: 0, bump: 0, name: 'road' }, sR: { grip: 1, drag: 0, bump: 0, name: 'road' },
    ctl: { throttle: 0, brake: 0, steerAngle: 0, ers: false, tc: true, abs: true, autoGear: true }, lapCp: [], pos: 0, wallHitT: 0,
  };
}

function placeCar(car, s, d, speed = 0) {
  const pt = track.pointAt(s, d);
  car.phys.reset(pt.x, pt.z, pt.heading, speed);
  track.project(pt.x, pt.z, pt.i, car.proj);
  car.lastS = car.proj.s;
  car.totalDist = s;
}

// online grid: every human drives their own car on their own device, the host also drives the AI.
function setupOnlineGrid() {
  const myId = online.net.id;
  const cars = mp.grid.map(g => {
    const team = TEAMS.find(t => t.id === g.team) || TEAMS[0];
    const mine = g.id === myId;
    const c = makeCar(team, g.driver, mine, g.tyre);
    c.slot = g.slot; c.netId = g.id; c.human = g.id != null;
    c.name = g.name || team.drivers[g.driver].name;
    c.tag = c.human ? (g.name || 'PLAYER').slice(0, 12).toUpperCase() : team.drivers[g.driver].code;
    if (mine) { c.ai = new AIDriver(c, track, 0.9); mp.mySlot = g.slot; }
    else if (!c.human) c.ai = new AIDriver(c, track, Math.min(0.995, mp.settings.aiDiff * (0.965 + 0.035 * (team.drivers[g.driver].rating - 0.95) / 0.05)));
    if (!mine) { c.remote = makeRemote(); c.isRemote = !c.ai || online.net.id !== mp.hostId; }
    if (c.human && !mine) { c.nameTag = makeNameTag(c.tag, team.color); c.model.group.add(c.nameTag); }
    return c;
  });
  race.cars = cars;
  race.player = cars[mp.mySlot];
  cars.forEach((c, k) => { const g = gridSlot(track, k); placeCar(c, g.s, g.d, 0); });
  race.ghostSkip = !mp.settings.collisions;
}

function setupRace(meta) {
  const mode = mp ? 'race' : settings.mode;
  const laps = mp ? mp.settings.laps : mode === 'tt' ? Infinity : (settings.laps | 0) || meta.laps;
  const pTeam = TEAMS.find(t => t.id === settings.team);
  race = {
    mode, laps, time: 0, startTime: 0, started: false, lightsOn: false, phase: mp ? 'wait' : 'grid', phaseT: 0, lightsCount: 0, holdT: 0,
    cars: [], player: null, finishCount: 0, fastest: null, bestSectors: [null, null, null], respawn: car => respawnCar(car),
    resultsShown: false, playerFinishedAt: 0, ghost: null, ghostRec: [], ghostCar: null, bestTT: Number(localStorage.getItem('f1gp.tt.' + meta.id)) || null,
    bestLapCp: null, msgs: [], online: !!mp,
  };
  if (mp) {
    setupOnlineGrid();
  } else {
  const player = makeCar(pTeam, settings.driver, true, settings.tyre);
  race.player = player;
  player.ai = new AIDriver(player, track, 0.9);
  // single player: use the online name if one was set
  player.name = settings.mpName || null;

  if (mode === 'race') {
    let pool = [];
    for (const t of TEAMS) t.drivers.forEach((d, i) => { if (!(t === pTeam && i === settings.driver)) pool.push([t, i]); });
    pool.sort((a, b) => (b[0].perf.power * 0.4 + b[0].perf.aero * 0.6 + b[0].drivers[b[1]].rating * 0.5 + Math.random() * 0.03) - (a[0].perf.power * 0.4 + a[0].perf.aero * 0.6 + a[0].drivers[a[1]].rating * 0.5 + Math.random() * 0.03));
    const nAI = Math.max(1, Math.min(19, settings.field - 1));
    if (nAI < pool.length) {
      // keep a spread of teams
      const pick = [];
      const step = pool.length / nAI;
      for (let k = 0; k < nAI; k++) pick.push(pool[Math.floor(k * step)]);
      pool = pick;
    }
    const order = pool.map(([t, i]) => {
      const c = makeCar(t, i, false, Math.random() < 0.6 ? 'soft' : 'medium');
      const skill = settings.diff * (0.965 + 0.035 * (t.drivers[i].rating - 0.95) / 0.05);
      c.ai = new AIDriver(c, track, Math.min(0.995, skill));
      return c;
    });
    const slot = settings.grid === 'pole' ? 0 : settings.grid === 'back' ? order.length : Math.floor(order.length / 2);
    order.splice(slot, 0, player);
    race.cars = order;
    order.forEach((c, k) => { const g = gridSlot(track, k); placeCar(c, g.s, g.d, 0); });
  } else {
    race.cars = [player];
    placeCar(player, -320, track.rlOffset[track.indexAtS(-320)], 50);
    race.phase = 'go'; race.started = true; race.startTime = 0;
    if (race.ghost) race.ghostCar = null;
  }
  }
  const player = race.player;
  race.cars.forEach((c, k) => { c.pos = k + 1; c.lapStart = 0; });
  for (let k = 0; k < 3; k++) $('sec' + k).className = '';
  race.gridPos = race.cars.indexOf(player) + 1;
  race.event = null; race.crew = null; race.pitRequested = false; race.reward = null; race.pitStops = 0;
  race.pitBox = null; race.pitMarker = null;
  if (track.pit && track.pit.boxes.length) {
    const bx = track.pit.boxes[(TEAMS.indexOf(pTeam) * 2 + settings.driver) % track.pit.boxes.length];
    const pt = track.pointAt(bx.s, bx.d);
    race.pitBox = { s: bx.s, d: bx.d, x: pt.x, y: pt.y, z: pt.z, heading: pt.heading, side: track.pit.side };
    race.pitMarker = buildPitMarker(race.pitBox, pTeam.color);
  }
  $('res-coins').innerHTML = '';
  setStuckAlert(false); setFade(false); updateBoxUI();
  buildTower();
  $('hud-track').textContent = meta.gp;
  $('lights').classList.toggle('hidden', mode !== 'race');
  if (weather) weather.hideLens();
  // team radio + engineer
  radio.reset();
  radio.enabled = settings.radio !== false;
  radio.setDriver({ name: player.name || player.driver.name, num: player.driver.num, team: player.team.name, color: player.team.color });
  engineer.reset(race, track);
  // single-player day races of 4+ laps sometimes get a passing shower (announced by the engineer)
  race.shower = !mp && envCond === 'day' && mode === 'race' && laps >= 4 && Math.random() < 0.35;
  setLightsUI(0);
  scenery.setLights(0);
  scenery.rlMesh.visible = showLine;
  $('delta-row').style.visibility = 'visible';
  updateAssistBadges();
  camYaw = player.phys.heading;
  $('pause').classList.add('hidden');
  $('results').classList.add('hidden');
  if (mode === 'race') showMsg(meta.gp.toUpperCase(), 'red', 2.5);
  else showMsg('TIME TRIAL · ' + meta.name.toUpperCase(), 'red', 2.5);
  flashCamName();
}

function respawnCar(car) {
  const i = car.proj.i;
  const s = track.s[i];
  const d = track.rlOffset[i];
  const pt = track.pointAt(s, d);
  car.phys.reset(pt.x, pt.z, pt.heading, car.isPlayer ? 0 : 8);
  car.phys.ers = Math.max(car.phys.ers, 1e6);
  track.project(pt.x, pt.z, pt.i, car.proj);
  car.lastS = car.proj.s;
  if (car.isPlayer) { showMsg('CAR RESET', 'small', 1.5); car.invalid = true; }
}

// ---------------------------------------------------------------- simulation
const tmpV = new THREE.Vector3();
let lastSurfPlayer = 'road';

function setAxleSurface(out, i, d, player) {
  const a = track.surface(i, d + 0.8), b = track.surface(i, d - 0.8);
  const tbl = player ? (HANDLING[settings.handling] || HANDLING.medium).surf : null;
  const ga = tbl && tbl[a.name] ? tbl[a.name] : [a.grip, a.drag], gb = tbl && tbl[b.name] ? tbl[b.name] : [b.grip, b.drag];
  out.grip = (ga[0] + gb[0]) / 2; out.drag = (ga[1] + gb[1]) / 2; out.bump = Math.max(a.bump, b.bump) * (tbl ? 0.6 : 1);
  out.name = a.bump >= b.bump ? a.name : b.name;
}

function playerControls(inp, dt) {
  const p = race.player.phys;
  const c = race.player.ctl;
  // online races can't freeze the world: while paused (or phone turned upright / guide open) the car
  // brakes to a stop and then stays parked until the driver presses the throttle again
  if (mp) {
    const away = paused || guideOpen || document.body.classList.contains('portrait');
    if (away) race.holdCar = true;
    else if (race.holdCar && inp.throttle > 0.15) race.holdCar = false;
    if (race.holdCar) {
      c.steerAngle = 0; c.throttle = 0; c.brake = Math.abs(p.u) > 0.3 ? 1 : 0.6; c.ers = false;
      c.tc = true; c.abs = true; c.autoGear = true; c.shiftUp = c.shiftDown = false;
      if (Math.abs(p.u) < 0.4) { p.u = 0; p.w = 0; p.r = 0; }
      if (!away && !race.holdMsg) { race.holdMsg = true; showMsg('PRESS THROTTLE TO DRIVE ON', 'small', 3); }
      return;
    }
    race.holdMsg = false;
  }
  const u = Math.abs(p.u);
  const hd = HANDLING[settings.handling] || HANDLING.medium;
  const assist = settings.steer || settings.handling === 'easy';
  const maxSteer = (assist ? 0.34 / (1 + Math.pow(u / 26, 1.5)) + 0.022 : 0.38 / (1 + u / 50)) * hd.steerBoost;
  let steer = inp.steer * maxSteer;
  if (assist && Math.abs(p.slipR) > 0.085 && u > 8) steer += (p.slipR - Math.sign(p.slipR) * 0.085) * 0.8 * hd.counter;
  if (settings.handling === 'easy' && Math.abs(p.slipR) > 0.12) p.r *= Math.exp(-dt * 2.5); // stability control
  c.steerAngle = Math.max(-0.4, Math.min(0.4, steer));
  c.throttle = inp.throttle; c.brake = inp.brake;
  c.ers = inp.ers; c.tc = settings.tc; c.abs = settings.abs; c.autoGear = settings.gear;
  c.shiftUp = inp.shiftUp; c.shiftDown = inp.shiftDown;
  if (race.inPitLane) { // 80 km/h pit limiter
    if (p.u > 22.2) { c.throttle = 0; c.brake = Math.max(c.brake, Math.min(1, (p.u - 22.2) * 0.35)); }
    else if (p.u > 21) c.throttle = Math.min(c.throttle, 0.25);
    c.ers = false;
  }
}

function stepRace(dt, inp) {
  race.time += dt;
  const L = track.length;
  // start procedure
  if (race.mode === 'race' && !race.started) {
    race.phaseT += dt;
    if (race.phase === 'grid' && race.phaseT > 2.5) { race.phase = 'lights'; race.phaseT = 0; race.lightsOn = true; }
    if (race.phase === 'lights') {
      const n = Math.min(5, Math.floor(race.phaseT) + 1);
      if (n !== race.lightsCount) { race.lightsCount = n; setLightsUI(n); scenery.setLights(n); audio.beep(false); }
      // online: every driver gets the same random lights-out delay from the server
      if (race.phaseT >= 5) { race.phase = 'hold'; race.phaseT = 0; race.holdT = race.netHold ?? 0.3 + Math.random() * 2.2; }
    }
    if (race.phase === 'hold' && race.phaseT >= race.holdT) {
      race.phase = 'go'; race.started = true; race.lightsOn = false; race.startTime = race.time;
      setLightsUI(0); scenery.setLights(0); audio.beep(true);
      showMsg('LIGHTS OUT AND AWAY WE GO!', '', 2.5);
      for (const c of race.cars) { c.lapStart = race.time; c.sectorStart = race.time; }
      $('sec0').className = 's-cur';
      setTimeout(() => $('lights').classList.add('hidden'), 1500);
    }
  }

  // controls
  const pl = race.player;
  if (!pl.finished) playerControls(inp, dt);
  // other players' cars (and the host's AI on guests) are replayed from network snapshots
  for (const c of race.cars) if (c.isRemote && !c.retired) applyRemote(c);
  for (const c of race.cars) {
    if (c.isRemote || c.retired) continue;
    if (c.ai && (!c.isPlayer || c.finished)) {
      const ctl = c.ai.control(dt, race.cars, race);
      Object.assign(c.ctl, ctl);
      if (c.isPlayer) c.drsOpen = false;
    }
  }
  // DRS for player
  if (inp.drs && pl.drsAllowed && track.inDRSZone(pl.proj.s)) { pl.drsOpen = !pl.drsOpen; }
  if (pl.ctl.brake > 0.15) pl.drsOpen = false;

  // slipstream
  for (const c of race.cars) { c.phys.dragMul = 1; c.phys.downMul = 1; }
  for (const a of race.cars) for (const b of race.cars) {
    if (a === b) continue;
    let gap = b.proj.s - a.proj.s;
    if (gap < -L / 2) gap += L; if (gap > L / 2) gap -= L;
    if (gap > 2 && gap < 32 && Math.abs(b.proj.d - a.proj.d) < 1.8) {
      const f = 1 - gap / 32;
      a.phys.dragMul = Math.min(a.phys.dragMul, 1 - 0.3 * f);
      a.phys.downMul = Math.min(a.phys.downMul, 1 - 0.1 * f);
    }
  }

  // tyre wear (player) + front wing damage + running out of fuel
  pl.phys.gripMul = (1 - 0.1 * Math.pow(pl.wear, 1.3)) * (engineer && race.mode === 'race' ? engineer.gripMul() : 1);
  if (engineer && race.mode === 'race' && !pl.finished && race.started) {
    pl.ctl.throttle *= engineer.powerMul();
    engineer.update(dt, pl, race, { onBox: () => { if (!race.pitRequested && track.pit) { race.hardCall = true; togglePitRequest(true); } } });
  }
  // changing weather: rain races dry out late on, some day races get a shower after the forecast call
  if (weather && race.mode === 'race' && race.started && Number.isFinite(race.laps)) {
    const frac = Math.max(0, pl.totalDist) / (race.laps * L);
    if (envCond === 'rain' && race.laps >= 3 && frac > 0.55) { weather.setWetness(Math.max(0.35, 1 - (frac - 0.55) * 2)); engineer?.onWeather('drying'); }
    if (race.shower && frac > 0.12) engineer?.onWeather('rainSoon');
    if (race.shower && frac > 0.45) weather.setWetness(Math.min(1, (frac - 0.45) * 3));
    // grip follows the wetness for everyone (AI slows down in the wet too)
    const rel = weather.gripNow() / weather.gripBase;
    for (const c of race.cars) {
      if (c.isRemote || c.retired) continue;
      if (!c.isPlayer) c.phys.gripMul = rel;
      if (c.ai) c.ai.speedScale = Math.sqrt(rel);
    }
    pl.phys.gripMul *= rel;
    if (Math.abs(rel - (race.lastRel ?? 1)) > 0.03) { race.lastRel = rel; audio.setRain(weather.wetness > 0.05); }
  }

  // physics substeps
  const sub = Math.min(6, Math.max(3, Math.ceil(dt / 0.0045)));
  const h = dt / sub;
  const held = !race.started;
  for (let k = 0; k < sub; k++) {
    for (const c of race.cars) {
      const p = c.phys;
      const i = c.proj.i;
      const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
      const nn = sh * track.nx[i] + ch * track.nz[i];
      if (c.frozen || c.isRemote || c.retired) continue;
      setAxleSurface(c.sF, i, c.proj.d + nn * FRONT_AXLE, c.isPlayer);
      setAxleSurface(c.sR, i, c.proj.d + nn * REAR_AXLE, c.isPlayer);
      p.surfF = c.sF; p.surfR = c.sR;
      const along = sh * track.tx[i] + ch * track.tz[i];
      p.grade = c.proj.grade * along;
      if (held) {
        p.u = p.w = p.r = 0;
        const thr = c.isPlayer ? inp.throttle : (race.lightsOn ? 0.45 + Math.random() * 0.1 : 0.1);
        p.throttle = thr; p.gear = 1;
        p.rpm += ((p.spec.idle + thr * 7600) - p.rpm) * Math.min(1, h * 12);
        if (thr > 0.97) p.rpm = p.spec.revLimit - Math.random() * 400;
        continue;
      }
      p.step(h, c.ctl);
      c.ctl.shiftUp = false; c.ctl.shiftDown = false;
      p.drs = c.drsOpen;
      track.project(p.x, p.z, c.proj.i, c.proj);
      collideWalls(c, track, onWallHit);
    }
    if (!held) {
      const cars = race.cars;
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (A.retired || B.retired || (A.isRemote && B.isRemote)) continue;
        if (race.ghostSkip && (A.human || B.human)) continue; // online "ghost" mode: humans pass through
        collideCars(A, B, onCarHit);
      }
    }
  }

  // race progress
  for (const c of race.cars) {
    if (c.retired) continue;
    track.project(c.phys.x, c.phys.z, c.proj.i, c.proj);
    let ds = c.proj.s - c.lastS;
    if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L;
    c.lastS = c.proj.s;
    if (!race.started) continue;
    const prev = c.totalDist;
    if (c.isRemote) { remoteProgress(c, prev); continue; }
    c.totalDist += ds;
    // checkpoints for gaps
    const CP = 20;
    if (c.totalDist > 0) {
      const k0 = Math.floor(Math.max(0, prev) / CP), k1 = Math.floor(c.totalDist / CP);
      for (let k = k0 + 1; k <= k1; k++) if (c.cp[k] === undefined) c.cp[k] = race.time;
      if (prev <= 0 && c.cp[0] === undefined) c.cp[0] = race.time;
    }
    const lapPrev = Math.floor(prev / L), lapNow = Math.floor(c.totalDist / L);
    // sectors
    const inLap = c.totalDist - lapNow * L;
    const sec = Math.min(2, Math.floor(inLap / (L / 3)));
    if (lapNow >= 0 && lapNow === lapPrev && sec > c.sectorIdx && c.totalDist > 0) {
      completeSector(c, c.sectorIdx);
      c.sectorIdx = sec;
    }
    if (lapNow > lapPrev) {
      if (lapNow >= 1) { completeSector(c, 2); completeLap(c, lapNow); }
      if (lapNow >= 1 || race.mode === 'tt') {
        c.lapStart = race.time; c.sectorStart = race.time; c.sectorIdx = 0; c.curSectors = [null, null, null];
        c.invalid = false;
        c.lapCp = [];
        if (c.isPlayer && race.mode === 'tt') { race.ghostRec = []; $('sec0').className = 's-cur'; }
      }
      if (c.ai) c.ai.onNewLap();
    }
    if (c.isPlayer) {
      const kk = Math.floor(Math.max(0, inLap) / 25);
      if (c.lapCp[kk] === undefined && c.totalDist >= 0) c.lapCp[kk] = race.time - c.lapStart;
    }
    // track limits (player)
    if (c.isPlayer && !c.frozen && !c.invalid && race.started && !track.inPitCorridor(c.proj.i, c.proj.d) && Math.abs(c.proj.d) > track.hw + KERB_W * 0.5 + 1.0) {
      const wall = c.proj.d > 0 ? track.wallL[c.proj.i] : track.wallR[c.proj.i];
      if (wall > track.hw + KERB_W + 1.5 || race.mode === 'tt') {
        c.invalid = true;
        if (race.mode === 'tt') showMsg('LAP INVALIDATED · TRACK LIMITS', 'red', 2);
        else showMsg('TRACK LIMITS', 'small', 1.6);
      }
    }
    // DRS zones
    const inZone = track.inDRSZone(c.proj.s);
    if (inZone && !c.inDrs) {
      const lapNo = Math.floor(c.totalDist / L) + 1;
      c.drsAllowed = race.mode === 'tt' || (lapNo >= 2 && c.gapAhead < 1.0);
      if (c.isPlayer && c.drsAllowed) { showMsg('DRS ENABLED', 'green', 1.4); engineer?.onDRS(); }
    }
    if (!inZone) { c.drsAllowed = false; c.drsOpen = false; }
    c.inDrs = inZone;
  }

  // positions and gaps
  const order = [...race.cars].sort((a, b) => (a.finished && b.finished) ? a.finishOrder - b.finishOrder : a.finished ? -1 : b.finished ? 1 : b.totalDist - a.totalDist);
  order.forEach((c, k) => { c.pos = k + 1; });
  race.order = order;
  const leader = order[0];
  for (let k = 0; k < order.length; k++) {
    const c = order[k];
    const kk = Math.floor(Math.max(0, c.totalDist) / 20);
    const t = c.cp[kk];
    if (k === 0 || t === undefined) { c.gapLeader = 0; c.gapAhead = 99; continue; }
    const tl = leader.cp[kk], ta = order[k - 1].cp[kk];
    c.gapLeader = tl !== undefined ? t - tl : 0;
    c.gapAhead = ta !== undefined ? t - ta : 99;
  }

  // ghost (time trial)
  if (race.mode === 'tt' && pl.totalDist >= 0) {
    const tLap = race.time - pl.lapStart;
    const g = pl.model.group;
    if (race.ghostRec.length === 0 || tLap - race.ghostRec[race.ghostRec.length - 1][0] >= 0.05) race.ghostRec.push([tLap, g.position.x, g.position.y, g.position.z, g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w]);
    if (race.ghost && race.ghostCar) {
      const gr = race.ghost;
      let lo = 0, hi = gr.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (gr[m][0] <= tLap) lo = m; else hi = m; }
      const a = gr[lo], b = gr[hi];
      const f = Math.min(1, Math.max(0, (tLap - a[0]) / ((b[0] - a[0]) || 1)));
      const gg = race.ghostCar.group;
      gg.visible = tLap <= gr[gr.length - 1][0];
      gg.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
      gg.quaternion.set(a[4], a[5], a[6], a[7]).slerp(new THREE.Quaternion(b[4], b[5], b[6], b[7]), f);
      race.ghostCar.update(dt, { speed: 60, steer: 0 });
    }
  }

  // finish handling (online: results come from the server's 'end' message)
  if (!mp && pl.finished && !race.resultsShown && race.time - race.playerFinishedAt > 4) { race.resultsShown = true; showResults(); }
  if (mp) mpSend(dt);
}

// ---------------------------------------------------------------- online race netcode
// Remote cars: position comes from snapshots; lap counting uses the sender's own distance.
function remoteProgress(c, prev) {
  const L = track.length;
  const d = c.remote.dist;
  if (!c.remote.buf.length || !Number.isFinite(d)) return;
  c.totalDist = d;
  if (race.started && c.totalDist > 0) {
    const k0 = Math.floor(Math.max(0, prev) / 20), k1 = Math.floor(c.totalDist / 20);
    for (let k = k0 + 1; k <= Math.min(k1, k0 + 60); k++) if (c.cp[k] === undefined) c.cp[k] = race.time;
  }
  const lapPrev = Math.floor(prev / L), lapNow = Math.floor(c.totalDist / L);
  if (lapNow > lapPrev && lapNow >= 1) {
    c.lastLap = c.remote.lastLap; c.bestLap = c.remote.bestLap;
    if (c.bestLap && (!race.fastest || c.bestLap < race.fastest.time - 1e-4)) { race.fastest = { car: c, time: c.bestLap }; showMsg(`FASTEST LAP · ${c.human ? c.tag : c.driver.code} ${fmt(c.bestLap)}`, 'purple', 2.5); }
  }
}

// send my car (and, if I am the host, every AI car) ~15 times a second
function mpSend(dt) {
  mp.sendT = (mp.sendT || 0) + dt;
  if (mp.sendT < 1 / SEND_HZ) return;
  mp.sendT = 0;
  const host = online.net.id === mp.hostId;
  for (const c of race.cars) {
    if (c.retired) continue;
    if (c.isPlayer || (host && !c.human && !c.isRemote) || (host && c.leftByPlayer)) online.net.queue('s', { k: c.slot, d: packCar(c) });
  }
  online.net.flush();
}

function mpStartRace(msg, lobby) {
  mp = { grid: msg.grid, settings: msg.settings, hostId: msg.hostId, lobby, mySlot: -1, sendT: 0 };
  if (state === 'race') { endEvent(); }
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  camMode = settings.cam | 0;
  loadEvent().catch(err => { console.error(err); const el = $('error'); el.textContent = String(err.stack || err); el.classList.remove('hidden'); });
}

function mpGo(msg) {
  if (!race || !mp) return;
  race.netHold = msg.holdT;
  race.phase = 'grid'; race.phaseT = 0;
  document.querySelectorAll('#msg div').forEach(d => { if (/WAITING/.test(d.textContent)) d.remove(); });
}

// a player disconnected mid-race: their car is NOT handed to the AI. It is classified DNF and
// taken off the track so nobody crashes into an abandoned car.
function mpRetired(msg) {
  if (!race || !mp) return;
  mp.hostId = msg.hostId;
  document.body.classList.toggle('mp-host', mp.hostId === online.net.id);
  const c = race.cars.find(x => x.slot === msg.slot);
  if (c && !c.isPlayer && !c.retired) {
    c.retired = true; c.dnf = true;
    c.model.group.visible = false;
    if (c.row) c.row.classList.add('out');
    showMsg(`${c.tag} LEFT THE RACE`, 'small', 2.5);
  }
  // host migrated: the new host now simulates the AI cars locally (they were replayed from the old host)
  if (online.net.id === mp.hostId) for (const x of race.cars) if (!x.human && !x.isPlayer && x.isRemote && !x.retired) {
    x.isRemote = false;
    x.ai = x.ai || new AIDriver(x, track, Math.min(0.99, mp.settings.aiDiff));
  }
}

function mpFinish(f) {
  if (!race || !mp) return;
  const c = race.cars.find(x => x.slot === f.slot);
  if (!c || c.netFinished) return;
  c.netFinished = true;
  c.finished = true; c.finishTime = f.time; c.finishOrder = f.order; c.bestLap = f.best || c.bestLap;
  if (f.order === 1) showMsg(`🏁 ${(c.human ? c.name : c.driver.name).toUpperCase()} WINS!`, 'red', 3);
  if (c.isPlayer) {
    race.reward = raceReward({ pos: f.order, laps: race.laps, aiSkill: mp.settings.aiDiff, fastestLap: race.fastest && race.fastest.car === c, gained: race.gridPos - f.order, handling: settings.handling });
    progress.add(race.reward.total);
    showMsg(`🏁 FINISHED P${f.order}`, f.order === 1 ? 'purple' : 'red', 4);
  }
}

function mpEnd(msg) {
  if (!race || !mp) return;
  for (const f of msg.finishes || []) mpFinish(f); // catch up on anything missed
  // classification: finishers by order, then everyone still running by distance, DNFs last
  const rank = c => (c.netFinished ? c.finishOrder : 1000 + (c.dnf ? 1e6 : 0) - c.totalDist / 1e5);
  race.order = [...race.cars].sort((a, b) => rank(a) - rank(b));
  if (state === 'race' && !race.resultsShown) { race.resultsShown = true; showResults(msg.why); }
}

// ---------------------------------------------------------------- events: marshal rescue, pit stops, tyre wear, coins
const evCam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
let helpClicked = false, boxClicked = false;
const WEAR_RATE = { supersoft: 1.5, soft: 1.15, medium: 0.85, hard: 0.65 };

function awardCoins(n, why) {
  progress.add(n);
  showMsg(`+${n} COINS · ${why.toUpperCase()}`, 'small', 1.8);
}
function setFade(on) { $('fade').classList.toggle('on', on); }
function setStuckAlert(on) {
  const el = $('stuck');
  if (on === !el.classList.contains('hidden')) return;
  el.classList.toggle('hidden', !on);
  if (on) { audio.beep(false); if (navigator.vibrate) navigator.vibrate([60, 60, 60]); }
}
function updateBoxUI() {
  const b = $('box-btn');
  b.classList.toggle('on', !!race?.pitRequested);
  b.textContent = race?.pitRequested ? 'BOX THIS LAP' : 'BOX';
  $('touch').querySelector('[data-t="box"]')?.classList.toggle('lit', !!race?.pitRequested);
}
function togglePitRequest(fromTeam) {
  if (!race || !race.started || race.player.finished || !track.pit) return;
  race.pitRequested = !race.pitRequested;
  if (!race.pitRequested) race.hardCall = false;
  updateBoxUI();
  const side = track.pit.side === 1 ? 'LEFT' : 'RIGHT';
  const tyre = race.hardCall ? ' · HARD TYRES' : '';
  showMsg(race.pitRequested ? `BOX, BOX${tyre} — PIT ENTRY ON THE ${side} BEFORE THE LINE` : 'PIT STOP CANCELLED', race.pitRequested ? 'red' : 'small', fromTeam ? 3.5 : 2.5);
}
function requestHelp() {
  const pl = race?.player;
  if (!pl || race.event || $('stuck').classList.contains('hidden')) return;
  setStuckAlert(false);
  pl.frozen = true; pl.drsOpen = false; pl.stuckT = 0;
  race.event = new Rescue({ scene, track, car: pl });
  showMsg('MARSHALS ARE ON THEIR WAY', 'small', 2.2);
}
function endEvent() {
  if (!race) return;
  if (race.event) { race.event.finish && race.event.finish(); race.event = null; }
  if (race.crew) { race.crew.dispose(); race.crew = null; }
  if (race.player) { race.player.frozen = false; race.player.visual = null; }
  if (race.pitMarker) { scene.remove(race.pitMarker.group); race.pitMarker = null; }
  setFade(false);
}

// spotlight, light beam and painted box that guide the player into their pit box
function buildPitMarker(box, color) {
  const group = new THREE.Group();
  group.position.set(box.x, box.y, box.z);
  group.rotation.y = box.heading;
  const spot = new THREE.SpotLight(0xfff2d0, 180, 26, 0.42, 0.55, 1.4);
  spot.position.set(0, 9, 0);
  spot.target.position.set(0, 0, 0);
  group.add(spot, spot.target);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 2.4, 9, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 4.5;
  group.add(beam);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95 });
  const mk = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); group.add(m); };
  mk(2.3, 0.12, 0, 2.95); mk(2.3, 0.12, 0, -2.75); mk(0.12, 5.7, 1.15, 0.1); mk(0.12, 5.7, -1.15, 0.1);
  const tMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const tbar = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.25), tMat); tbar.rotation.x = -Math.PI / 2; tbar.position.set(0, 0.021, 3.4); group.add(tbar);
  const tstem = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.0), tMat); tstem.rotation.x = -Math.PI / 2; tstem.position.set(0, 0.021, 2.9); group.add(tstem);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 48), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.5, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  group.add(ring);
  group.visible = false;
  scene.add(group);
  return { group, beam, ring, spot };
}

function updatePits(dt) {
  const pl = race.player, p = pl.phys, P = track.pit;
  if (!P || !race.pitBox) return;
  const i = pl.proj.i, d = pl.proj.d;
  const inCorr = track.inPitCorridor(i, d);
  const wasPit = race.inPitLane;
  race.inPitLane = track.inPitLane(i, d);
  // radio: pit entry / exit calls
  if (race.started && !pl.finished) {
    if (race.inPitLane && !wasPit) { engineer?.onPitEntry(); race.pitVisit = true; }
    if (!race.inPitLane && wasPit && race.pitVisit) { race.pitVisit = false; if (race.pitStopped) { race.pitStopped = false; engineer?.onPitExit(); } }
  }
  const want = race.started && !pl.finished && (race.pitRequested || inCorr);
  if (want && !race.crew) {
    race.crew = new PitStop({ scene, car: pl, box: race.pitBox, onMessage: showMsg });
    // the team called for hard tyres
    if (race.hardCall) race.crew.compound = 'hard';
    race.crewPaid = false;
  }
  if (!want && race.crew && race.crew.state !== 'service') { race.crew.dispose(); race.crew = null; }
  const mk = race.pitMarker;
  if (mk) {
    mk.group.visible = !!race.crew && race.crew.state === 'waiting';
    const pulse = 0.5 + 0.5 * Math.sin(race.time * 4);
    mk.beam.material.opacity = 0.08 + pulse * 0.1;
    mk.ring.scale.setScalar(1 + pulse * 0.15);
    mk.ring.material.opacity = 0.25 + pulse * 0.35;
  }
  const crew = race.crew;
  if (!crew) return;
  if (crew.state === 'waiting' && race.inPitLane) {
    const B = race.pitBox;
    let ds = pl.proj.s - B.s; if (ds > track.length / 2) ds -= track.length; if (ds < -track.length / 2) ds += track.length;
    const dd = pl.proj.d - B.d;
    if (Math.abs(ds) < 2.8 && Math.abs(dd) < 1.8 && Math.abs(p.u) < 2.5) {
      pl.frozen = true; pl.drsOpen = false;
      crew.service(Math.hypot(ds, dd) < 0.8);
    }
  }
  crew.update(dt);
  if (crew.state === 'released' && !race.crewPaid) {
    race.crewPaid = true;
    pl.frozen = false; pl.wear = 0; p.u = 0; p.gear = 1;
    if (crew.compound !== pl.compound) { // new compound: different grip and wear rate
      p.spec.mu *= (TYRE_GRIP[crew.compound] || 1) / (TYRE_GRIP[pl.compound] || 1);
      pl.compound = crew.compound;
    }
    race.hardCall = false; race.pitStopped = true;
    engineer?.onPitStop();
    race.pitRequested = false; updateBoxUI();
    race.pitStops = (race.pitStops || 0) + 1;
    showMsg(`GO, GO, GO! · STATIONARY ${crew.stationary.toFixed(1)}s`, 'green', 2.4);
    awardCoins(crew.precise ? 100 : 60, crew.precise ? 'Pit stop · perfect marks' : 'Pit stop');
  }
}

function updateEvents(dt) {
  const pl = race.player, p = pl.phys;
  if (race.started && !pl.frozen) {
    const slip = Math.min(2, Math.abs(p.slipR) * 8 + p.lock + p.spin);
    pl.wear = Math.min(1, pl.wear + Math.abs(p.u) * dt * 0.000018 * (WEAR_RATE[pl.compound] || 1) * (p.spec.wearRate || 1) * (1 + slip));
  }
  updatePits(dt);
  // beached in grass / gravel?
  const offSurf = n => n === 'grass' || n === 'gravel';
  const inCorr = track.inPitCorridor(pl.proj.i, pl.proj.d);
  const off = !inCorr && (offSurf(pl.sF.name) || offSurf(pl.sR.name) || Math.abs(pl.proj.d) > track.hw + KERB_W + 3);
  if (race.started && !pl.finished && !race.event && !pl.frozen && off && Math.abs(p.u) < 2.5) pl.stuckT += dt;
  else pl.stuckT = Math.max(0, pl.stuckT - dt * 3);
  setStuckAlert(pl.stuckT > 1.6 && !race.event);
  const ev = race.event;
  if (!ev) return;
  ev.update(dt);
  if (ev.released && pl.frozen) {
    pl.frozen = false; p.u = 0; p.w = 0; p.r = 0; p.gear = 1;
    showMsg('BACK ON TRACK — GO, GO, GO!', 'green', 2.2);
  }
  if (ev.done) race.event = null;
}

function completeSector(c, idx) {
  const t = race.time - c.sectorStart;
  c.sectorStart = race.time;
  c.curSectors[idx] = t;
  if (!c.isPlayer) { if (!race.bestSectors[idx] || t < race.bestSectors[idx]) race.bestSectors[idx] = t; return; }
  // engineer: slow final sector on a slippery track (rain, worn tyres or wing damage)
  if (engineer && idx === 2) {
    const slow = c.pbSectors && c.pbSectors[2] && t > c.pbSectors[2] * 1.06;
    engineer.onSector(2, slow && (envCond === 'rain' || c.wear > 0.35 || engineer.damage > 0.1));
  }
  const el = $('sec' + idx);
  let cls = 's-yellow';
  if (!c.invalid) {
    if (!race.bestSectors[idx] || t < race.bestSectors[idx]) { race.bestSectors[idx] = t; cls = 's-purple'; }
    else if (!c.pbSectors || !c.pbSectors[idx] || t < c.pbSectors[idx]) cls = 's-green';
    c.pbSectors = c.pbSectors || [null, null, null];
    if (!c.pbSectors[idx] || t < c.pbSectors[idx]) c.pbSectors[idx] = t;
  }
  el.className = cls;
  if (idx < 2) $('sec' + (idx + 1)).className = 's-cur';
}

function completeLap(c, lapNow) {
  const t = race.time - c.lapStart;
  c.lastLap = t;
  c.laps.push(t);
  const valid = !c.invalid;
  if (valid && (!c.bestLap || t < c.bestLap)) {
    c.bestLap = t;
    if (c.isPlayer) c.bestLapCp = c.lapCp.slice();
  }
  if (valid && (!race.fastest || t < race.fastest.time)) {
    const had = !!race.fastest;
    race.fastest = { car: c, time: t };
    if (had || c.isPlayer) showMsg(`FASTEST LAP · ${c.human ? c.tag : c.driver.code} ${fmt(t)}`, 'purple', 2.5);
  }
  if (c.isPlayer) {
    for (let k = 0; k < 3; k++) $('sec' + k).className = '';
    $('sec0').className = 's-cur';
    if (race.mode === 'tt') {
      if (valid && (!race.bestTT || t < race.bestTT)) {
        race.bestTT = t;
        localStorage.setItem('f1gp.tt.' + track.meta.id, t);
        showMsg('NEW PERSONAL BEST ' + fmt(t), 'purple', 3);
        awardCoins(200, 'Personal best');
      } else showMsg((valid ? 'LAP ' : 'INVALID LAP ') + fmt(t), valid ? '' : 'red', 2.5);
      if (valid) awardCoins(40, 'Clean lap');
      if (valid && (!race.ghostBest || t <= race.ghostBest)) {
        race.ghostBest = t;
        race.ghost = race.ghostRec.slice();
        if (!race.ghostCar) { race.ghostCar = buildCar(c.team, c.di, { ghost: true, compound: c.compound }); scene.add(race.ghostCar.group); }
      }
    } else showMsg(`LAP ${lapNow} · ${fmt(t)}`, 'small', 2);
  }
  if (race.mode === 'race' && lapNow >= race.laps && !c.finished) {
    if (mp) { // online: the server decides the official finishing order
      if (!c.sentFinish) { c.sentFinish = true; online.net.send('finish', { k: c.slot, time: race.time - race.startTime, best: c.bestLap }); }
      if (c.isPlayer) { c.finished = true; c.finishTime = race.time - race.startTime; race.playerFinishedAt = race.time; c.finishOrder = 99; }
      return;
    }
    c.finished = true;
    c.finishTime = race.time - race.startTime;
    c.finishOrder = ++race.finishCount;
    if (c.finishOrder === 1) showMsg(`🏁 ${(c.name || c.driver.name).toUpperCase()} WINS!`, 'red', 3);
    if (c.isPlayer) {
      race.playerFinishedAt = race.time;
      race.reward = raceReward({ pos: c.finishOrder, laps: race.laps, aiSkill: settings.diff, fastestLap: race.fastest && race.fastest.car === c, gained: race.gridPos - c.finishOrder, handling: settings.handling });
      progress.add(race.reward.total);
      showMsg(`🏁 FINISHED P${c.finishOrder}`, c.finishOrder === 1 ? 'purple' : 'red', 4);
    }
  }
  if (race.mode === 'race' && c.isPlayer && lapNow === race.laps - 1) showMsg('FINAL LAP', 'red', 2);
  if (c.isPlayer && engineer && lapNow < race.laps) engineer.onLap(lapNow, race);
}

function onWallHit(car, x, z, v) {
  if (v > 3 && performance.now() - car.wallHitT > 120) {
    car.wallHitT = performance.now();
    if (car.isPlayer) { audio.impact(v); shake = Math.min(1, v / 20); engineer?.onHit(v); }
    if (effects && camera.position.distanceToSquared(tmpV.set(x, car.proj.y, z)) < 200 * 200) effects.sparkBurst(x, car.proj.y + 0.2, z, car.phys.vx, car.phys.vz, Math.min(40, v * 2));
  }
}
function onCarHit(a, b, x, z, v) {
  if (v > 2 && (a.isPlayer || b.isPlayer)) { audio.impact(v * 0.8); shake = Math.min(1, v / 15); engineer?.onHit(v * 0.9); }
  if (v > 4 && effects) effects.sparkBurst(x, (a.proj.y + b.proj.y) / 2 + 0.2, z, (a.phys.vx + b.phys.vx) / 2, (a.phys.vz + b.phys.vz) / 2, Math.min(25, v * 2));
}

// ---------------------------------------------------------------- visuals per frame
let shake = 0;
function updateCarVisuals(dt) {
  for (const c of race.cars) {
    const p = c.phys, g = c.model.group;
    const along = Math.sin(p.heading) * track.tx[c.proj.i] + Math.cos(p.heading) * track.tz[c.proj.i];
    const grade = c.proj.grade * along;
    const bump = (c.sF.bump + c.sR.bump) * 0.5;
    const jitter = bump > 0 && Math.abs(p.u) > 5 ? (Math.random() - 0.5) * 0.012 * bump * Math.min(1, Math.abs(p.u) / 30) : 0;
    if (c.visual) { g.position.set(c.visual.x, c.visual.y, c.visual.z); g.rotation.set(c.visual.pitch || 0, c.visual.heading, 0, 'YXZ'); }
    else { g.position.set(p.x, c.proj.y + jitter, p.z); g.rotation.set(-Math.atan(grade), p.heading, 0, 'YXZ'); }
    const d2 = camera.position.distanceToSquared(g.position);
    c.model.setDetail(c.isPlayer || d2 < 95 * 95);
    c.model.update(dt, {
      speed: p.u, steer: p.steer, pitch: Math.max(-0.03, Math.min(0.035, -p.axF * 0.0007)), roll: Math.max(-0.04, Math.min(0.04, p.ay * 0.0008)),
      drs: c.drsOpen, rainBlink: p.harvesting && !p.ersDeploying && race.started, locked: p.lock > 0.5, heave: -Math.min(0.02, p.u * p.u * 0.0000025),
      ers: p.ersDeploying, wheel: c.isPlayer ? THREE.MathUtils.clamp(p.steer * 5.5 + input.steer * 0.35, -1.9, 1.9) : undefined,
    });
    if (c.gearSeen !== p.gear) { if (c.gearSeen !== undefined) c.model.paddle(p.gear > c.gearSeen); c.gearSeen = p.gear; }
    // particles near camera
    if (!effects) continue;
    if (d2 > 160 * 160) continue;
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
    const speed = Math.abs(p.u);
    if (p.lock > 0.3 && speed > 5) for (const sx of [0.85, -0.85]) effects.tyreSmoke(p.x + sh * FRONT_AXLE + ch * sx, c.proj.y, p.z + ch * FRONT_AXLE - sh * sx, p.vx, p.vz, p.lock * 0.9);
    const slideR = Math.abs(p.slipR) > 0.16 && speed > 6;
    if ((p.spin > 0.2 || slideR) && speed > 2) for (const sx of [0.8, -0.8]) effects.tyreSmoke(p.x + sh * REAR_AXLE + ch * sx, c.proj.y, p.z + ch * REAR_AXLE - sh * sx, p.vx, p.vz, Math.max(p.spin, slideR ? 0.6 : 0));
    const nm = c.sR.name;
    if ((nm === 'grass' || nm === 'gravel') && speed > 4 && Math.random() < 0.7) effects.dirt(p.x + sh * REAR_AXLE, c.proj.y, p.z + ch * REAR_AXLE, p.vx, p.vz, nm === 'gravel');
    if (speed > 65 && Math.random() < (c.sF.bump > 0.5 ? 0.6 : 0.05 + (p.ax < -25 ? 0.3 : 0))) effects.sparkBurst(p.x - sh * 0.5, c.proj.y - 0.05, p.z - ch * 0.5, p.vx, p.vz, 3);
  }
  effects?.update(dt);
}

// ---------------------------------------------------------------- cameras
let camYaw = 0, camPitchY = 0;
let tvCams = [];
let tvIdx = -1;
function buildTVCams() {
  tvCams = [];
  for (let s = 40; s < track.length; s += 190) {
    const i = track.indexAtS(s);
    const side = track.curvWide[i] > 0 ? -1 : 1;
    const wall = side === 1 ? track.wallL[i] : track.wallR[i];
    const off = wall + 5;
    tvCams.push({ s, pos: new THREE.Vector3(track.px[i] + track.nx[i] * side * off, track.py[i] + 5 + Math.random() * 4, track.pz[i] + track.nz[i] * side * off) });
  }
}
const camQ = new THREE.Quaternion(), flipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const pitchQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), Y_AXIS = new THREE.Vector3(0, 1, 0);
const head = { x: 0, z: 0, yaw: 0 };

// cockpit-only extras: rear-view mirrors and the live steering-wheel display
let dashT = 0;
function updateCockpit(dt) {
  if (camMode !== 3 || !race) return;
  const pl = race.player, p = pl.phys, g = pl.model.group;
  dashT += dt;
  if (dashT > 0.066) {
    dashT = 0;
    let delta = null;
    if (pl.bestLapCp && pl.totalDist >= 0) {
      const kk = Math.floor(Math.max(0, pl.totalDist - Math.floor(pl.totalDist / track.length) * track.length) / 25);
      if (pl.bestLapCp[kk] !== undefined && pl.lapCp[kk] !== undefined) delta = pl.lapCp[kk] - pl.bestLapCp[kk];
    }
    pl.model.drawDash({
      rpm: p.rpm / p.spec.revLimit, gear: !race.started ? 'N' : p.u < -0.5 ? 'R' : String(p.gear), speed: Math.round(Math.abs(p.u) * 3.6),
      ers: p.ers / 4e6, ersOn: p.ersDeploying, drs: pl.drsOpen, drsAvail: pl.drsAllowed, delta,
      lap: Math.max(1, Math.floor(pl.totalDist / track.length) + 1), pos: pl.pos, bias: Math.round(p.spec.brakeBias * 100),
    });
  }
  if (settings.quality === 'low') return;
  if ((mirror.frame++ & 1) === 0) {
    mirror.cam.position.set(0, 1.12, -0.25).applyMatrix4(g.matrixWorld);
    mirror.cam.quaternion.copy(g.quaternion);
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    pl.model.mirrors.forEach(m => { m.visible = false; });
    renderer.setRenderTarget(mirror.rt);
    renderer.render(scene, mirror.cam);
    renderer.setRenderTarget(null);
    pl.model.mirrors.forEach(m => { m.visible = true; });
    renderer.shadowMap.autoUpdate = auto;
  }
}
function updateCamera(dt, inp) {
  const car = race.player, p = car.phys, g = car.model.group;
  const speed = Math.abs(p.u);
  const look = inp.lookBack;
  car.model.helmet.visible = camMode !== 3;
  let blur = 0, fov = 60;
  camera.near = 0.1;
  const ev = (race.event && race.event.camPose(evCam)) || (race.crew && race.crew.camPose(evCam));
  if (ev) {
    camera.position.lerp(ev.pos, camera.userData.evInit ? Math.min(1, dt * 3) : 1); camera.userData.evInit = true;
    camera.lookAt(ev.look); fov = ev.fov; blur = 0;
  } else if (camMode <= 1) {
    camera.userData.evInit = false;
    const far = camMode === 1;
    const target = p.heading + (look ? Math.PI : 0);
    let dy = target - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-dt * (look ? 30 : 7)));
    const dist = far ? 9.2 : 6.4, hgt = far ? 2.7 : 1.75;
    camPitchY += ((car.proj.y) - camPitchY) * (1 - Math.exp(-dt * 6));
    camera.position.set(p.x - Math.sin(camYaw) * dist, camPitchY + hgt, p.z - Math.cos(camYaw) * dist);
    camera.lookAt(p.x + Math.sin(camYaw) * 4, camPitchY + (far ? 0.9 : 0.85), p.z + Math.cos(camYaw) * 4);
    fov = 58 + Math.min(14, speed * 0.14);
    blur = 1;
  } else if (camMode <= 4) {
    // driver's head reacts to g-forces and looks into corners
    const k = Math.min(1, dt * 7);
    head.x += (THREE.MathUtils.clamp(-p.ay * 0.0011, -0.045, 0.045) - head.x) * k;
    head.z += (THREE.MathUtils.clamp(p.axF * 0.0006, -0.03, 0.02) - head.z) * k;
    head.yaw += (THREE.MathUtils.clamp(p.steer * 1.4, -0.4, 0.4) - head.yaw) * Math.min(1, dt * 4);
    const off = camMode === 2 ? [0, 1.13, -0.42] : camMode === 3 ? [head.x, 0.815, -0.1 + head.z] : [0, 0.6, 2.0];
    const pitch = camMode === 2 ? 0.07 : camMode === 3 ? 0.075 : 0.02;
    g.updateMatrixWorld();
    camera.position.set(...off).applyMatrix4(g.matrixWorld);
    camQ.copy(g.quaternion).multiply(flipQ);
    if (look) camQ.multiply(flipQ);
    else if (camMode === 3) camQ.multiply(yawQ.setFromAxisAngle(Y_AXIS, head.yaw));
    pitchQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
    camera.quaternion.copy(camQ).multiply(pitchQ);
    fov = camMode === 3 ? 72 : 66 + Math.min(8, speed * 0.08);
    camera.near = camMode === 3 ? 0.03 : 0.1;
    blur = camMode === 3 ? 0.7 : 1;
    if (camMode === 3) { const b = (car.sF.bump + car.sR.bump) * 0.5; camera.position.y += (Math.random() - 0.5) * 0.006 * b * Math.min(1, speed / 30); }
  } else {
    // TV camera: pick nearest camera slightly ahead of the car
    let best = -1, bd = Infinity;
    tvCams.forEach((c, k) => {
      let ds = c.s - car.proj.s; if (ds < -track.length / 2) ds += track.length; if (ds > track.length / 2) ds -= track.length;
      const sc = Math.abs(ds - 50);
      if (ds > -60 && ds < 200 && sc < bd) { bd = sc; best = k; }
    });
    if (best !== tvIdx && best >= 0) tvIdx = best;
    const tc = tvCams[tvIdx] || tvCams[0];
    camera.position.copy(tc.pos);
    camera.lookAt(p.x, car.proj.y + 0.6, p.z);
    const d = tc.pos.distanceTo(g.position);
    fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / d)), 4, 55);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.15;
    camera.position.y += (Math.random() - 0.5) * shake * 0.15;
    shake = Math.max(0, shake - dt * 3);
  }
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  blurPass.uniforms.amount.value = settings.blur ? blur * THREE.MathUtils.clamp((speed - 35) / 60, 0, 1) * 0.05 : 0;
  blurPass.uniforms.vignette.value = camMode === 3 ? 0.45 : 0.32;
  // sun shadow follows the player
  const sd = sun.userData.dir;
  const focus = tmpV.set(p.x + Math.sin(p.heading) * 25, car.proj.y, p.z + Math.cos(p.heading) * 25);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sd, 300);
  sun.target.updateMatrixWorld();
  sky.position.copy(camera.position);
}

function flashCamName() {
  const el = $('cam-name');
  el.textContent = CAMS[camMode];
  el.classList.add('show');
  clearTimeout(flashCamName.t);
  flashCamName.t = setTimeout(() => el.classList.remove('show'), 1400);
}

// ---------------------------------------------------------------- HUD
const fmt = t => {
  if (t == null || !isFinite(t)) return '-:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
};
let msgTimers = [];
function showMsg(text, cls = '', dur = 2) {
  const box = $('msg');
  const el = document.createElement('div');
  el.textContent = text;
  if (cls) el.className = cls;
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  msgTimers.push(setTimeout(() => el.remove(), dur * 1000));
}
function setLightsUI(n) { document.querySelectorAll('#lights .lamp').forEach((l, k) => l.classList.toggle('on', k < n)); }

function buildTower() {
  const rows = $('tower-rows');
  rows.innerHTML = '';
  race.cars.forEach(c => {
    const r = document.createElement('div');
    r.className = 'trow' + (c.isPlayer ? ' me' : '') + (c.human && !c.isPlayer ? ' human' : '');
    // online players show their own name, AI cars their 3-letter driver code
    const label = c.human || (c.isPlayer && c.name) ? escHTML((c.tag || c.name).slice(0, 10)) : c.driver.code;
    r.innerHTML = `<span class="tp"></span><span class="tc" style="background:${c.team.color}"></span><span class="td">${label}</span><span class="tg"></span>`;
    rows.appendChild(r);
    c.row = r;
  });
  const leds = $('leds');
  leds.innerHTML = '';
  for (let k = 0; k < 15; k++) leds.appendChild(document.createElement('i'));
}

function updateAssistBadges() {
  $('assists').innerHTML = [['TC', settings.tc], ['ABS', settings.abs], [settings.gear ? 'AUTO' : 'MANUAL', true], ['LINE', showLine]].map(([n, on]) => `<span class="${on ? 'on' : ''}" data-a="${n}">${n}</span>`).join('');
}

let hudT = 0, lastGear = null;
function updateHUD(dt) {
  const pl = race.player, p = pl.phys, L = track.length;
  hudT += dt;
  // dash every frame
  const kmh = Math.round(Math.abs(p.u) * 3.6);
  $('hud-speed').textContent = kmh;
  const gear = !race.started ? 'N' : p.u < -0.5 ? 'R' : String(p.gear);
  if (gear !== lastGear) { $('hud-gear').textContent = gear; if (lastGear && gear !== 'N' && race.started) audio.shift(); lastGear = gear; }
  const frac = p.rpm / p.spec.revLimit;
  const lit = Math.round(THREE.MathUtils.clamp((frac - 0.72) / 0.25, 0, 1) * 15);
  const leds = $('leds');
  leds.classList.toggle('flash', frac > 0.975 && Math.floor(performance.now() / 70) % 2 === 0);
  [...leds.children].forEach((el, k) => { el.className = k < lit ? (k < 5 ? 'g' : k < 10 ? 'r' : 'b') : ''; });
  const ef = $('ers-fill');
  ef.style.width = (p.ers / (p.spec.ersMax || 4e6) * 100).toFixed(1) + '%';
  $('hud-tyre').textContent = Math.round((1 - pl.wear) * 100) + '%';
  $('hud-tyre').style.color = pl.wear > 0.5 ? '#ff4040' : pl.wear > 0.3 ? '#ffd200' : '#fff';
  $('tyre-dot').style.background = ({ supersoft: '#a0168c', soft: '#e8202a', medium: '#ffd200', hard: '#f0f0f0' })[pl.compound] || '#e8202a';
  ef.classList.toggle('dep', p.ersDeploying);
  const drs = $('drs');
  drs.className = 'drs' + (pl.drsOpen ? ' open' : pl.drsAllowed ? ' avail' : '');
  $('limiter').classList.toggle('hidden', !race.inPitLane);
  $('ped-thr').style.width = (p.throttle * 100) + '%';
  $('ped-brk').style.width = (p.brake * 100) + '%';

  // timing
  const lapNo = Math.max(1, Math.floor(pl.totalDist / L) + 1);
  if (race.mode === 'race') $('hud-lap').textContent = `LAP ${Math.min(lapNo, race.laps)}/${race.laps}`;
  else $('hud-lap').textContent = pl.totalDist < 0 ? 'OUT LAP' : `LAP ${lapNo}`;
  const lapRunning = race.started && pl.totalDist >= 0 && !pl.finished;
  const cur = lapRunning ? race.time - pl.lapStart : (pl.finished ? pl.lastLap : 0);
  $('hud-cur').textContent = fmt(cur);
  $('hud-last').textContent = fmt(pl.lastLap);
  $('hud-best').textContent = fmt(race.mode === 'tt' ? race.bestTT : pl.bestLap);
  $('hud-invalid').classList.toggle('hidden', !pl.invalid);
  $('hud-pos').textContent = race.mode === 'tt' ? 'TT' : 'P' + pl.pos;
  $('hud-of').textContent = race.mode === 'tt' ? '' : '/' + race.cars.length;
  if (pl.bestLapCp && lapRunning) {
    const kk = Math.floor(Math.max(0, pl.totalDist - Math.floor(pl.totalDist / L) * L) / 25);
    const ref = pl.bestLapCp[kk];
    const el = $('hud-delta');
    if (ref !== undefined && pl.lapCp[kk] !== undefined) {
      const d = pl.lapCp[kk] - ref;
      el.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
      el.className = d < 0 ? 'neg' : 'pos';
    }
  } else $('hud-delta').textContent = '--';

  if (hudT > 0.2) {
    hudT = 0;
    // timing tower
    const rows = $('tower-rows');
    const order = race.order || race.cars;
    order.forEach((c, k) => {
      const r = c.row;
      if (rows.children[k] !== r) rows.insertBefore(r, rows.children[k] || null);
      if (isMobile) r.style.display = (k === 0 || Math.abs(k - (pl.pos - 1)) <= 2) ? '' : 'none';
      r.children[0].textContent = k + 1;
      let gap;
      if (race.mode === 'tt') gap = fmt(c.bestLap);
      else if (c.finished) gap = k === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - order[0].finishTime).toFixed(3);
      else if (k === 0) gap = race.started ? 'LEADER' : '';
      else {
        const lapsDown = Math.floor((order[0].totalDist - c.totalDist) / L);
        gap = lapsDown >= 1 && !order[0].finished ? `+${lapsDown} LAP` : race.started && c.gapLeader > 0 ? '+' + c.gapLeader.toFixed(3) : '';
      }
      r.children[3].innerHTML = gap + (c.drsOpen ? '<span class="drsb">DRS</span>' : '') + (race.fastest && race.fastest.car === c ? '<span class="fl"></span>' : '');
    });
    if (race.mode === 'tt' && race.bestTT) $('hud-best').textContent = fmt(race.bestTT);
  }
  // assists activity
  const tcAct = settings.tc && p.throttle > 0.5 && race.started && Math.abs(p.slipR) > 0.08;
  const absAct = settings.abs && p.brake > 0.8 && Math.abs(p.u) > 10;
  for (const el of $('assists').children) {
    const a = el.dataset.a;
    el.classList.toggle('act', (a === 'TC' && tcAct) || (a === 'ABS' && absAct));
  }
  drawMinimap();
}

// minimap
let mm = null;
function buildMinimap() {
  const cv = $('minimap'), W = cv.width;
  const bb = track.bbox;
  const sc = (W * 0.78) / Math.max(bb.maxx - bb.minx, bb.maxz - bb.minz);
  const cx = (bb.minx + bb.maxx) / 2, cz = (bb.minz + bb.maxz) / 2;
  const off = document.createElement('canvas'); off.width = off.height = W;
  const ctx = off.getContext('2d');
  const tp = (x, z) => [(x - cx) * sc + W / 2, (z - cz) * sc + W / 2];
  ctx.lineJoin = 'round';
  for (const [w, col] of [[9, 'rgba(0,0,0,0.6)'], [5, '#e8e8ee']]) {
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
    for (let i = 0; i <= track.n; i += 3) { const k = i % track.n; const [x, y] = tp(track.px[k], track.pz[k]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
  }
  // DRS zones
  ctx.strokeStyle = '#00d26a'; ctx.lineWidth = 3;
  for (const [a, b] of track.meta.drs) {
    ctx.beginPath();
    const s0 = a * track.length, s1 = (b > a ? b : b + 1) * track.length;
    for (let s = s0; s <= s1; s += 6) { const i = track.indexAtS(s); const [x, y] = tp(track.px[i], track.pz[i]); s === s0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const [sx, sy] = tp(track.px[0], track.pz[0]);
  ctx.fillStyle = '#e10600'; ctx.fillRect(sx - 4, sy - 4, 8, 8);
  mm = { off, tp };
}
function drawMinimap() {
  const cv = $('minimap'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(mm.off, 0, 0);
  const list = race.order ? [...race.order].reverse() : race.cars;
  const labels = [];
  for (const c of list) {
    if (c.retired) continue;
    const [x, y] = mm.tp(c.phys.x, c.phys.z);
    const big = c.isPlayer || c.human;
    ctx.beginPath(); ctx.arc(x, y, c.isPlayer ? 7 : big ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = c.team.color; ctx.fill();
    ctx.lineWidth = big ? 2.5 : 1; ctx.strokeStyle = c.isPlayer ? '#fff' : c.human ? '#ffd200' : '#000'; ctx.stroke();
    if (c.human || (c.isPlayer && race.online)) labels.push([x, y, c.isPlayer ? 'YOU' : c.tag, c.isPlayer]);
  }
  // real players' names on the map
  ctx.font = '700 15px "Titillium Web", "Segoe UI", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  for (const [x, y, t, me] of labels) {
    const w = ctx.measureText(t).width + 8, lx = Math.min(cv.width - w - 2, x + 9), ly = Math.max(10, y - 11);
    ctx.fillStyle = 'rgba(8,8,14,0.82)'; ctx.fillRect(lx, ly - 9, w, 18);
    ctx.fillStyle = me ? '#fff' : '#ffd200'; ctx.fillText(t, lx + 4, ly + 1);
  }
  if (race.ghostCar && race.ghostCar.group.visible) {
    const gp = race.ghostCar.group.position;
    const [x, y] = mm.tp(gp.x, gp.z);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.strokeStyle = '#a020f0'; ctx.lineWidth = 2; ctx.stroke();
  }
}

// results
function showResults(why) {
  const order = race.order;
  const leader = order[0];
  const tbl = $('res-table');
  const meta = track.meta;
  if (radio) radio.stop();
  $('res-title').textContent = mp ? 'ONLINE RACE CLASSIFICATION' : 'RACE CLASSIFICATION';
  $('res-sub').textContent = `${meta.gp} · ${meta.name} · ${race.laps} LAPS${why && mp ? ' · ' + String(why).toUpperCase() : ''}`;
  let html = '<tr><th>POS</th><th>NO</th><th>DRIVER</th><th>TEAM</th><th>TIME / GAP</th><th>BEST LAP</th></tr>';
  order.forEach((c, k) => {
    let time;
    if (c.dnf) time = 'DNF';
    else if (c.finished && leader.finished) time = k === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - leader.finishTime).toFixed(3) + 's';
    else {
      const lapsDown = Math.floor((leader.totalDist - c.totalDist) / track.length);
      time = lapsDown >= 1 ? `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}` : (c.gapLeader > 0 ? '+' + c.gapLeader.toFixed(3) + 's' : 'RUNNING');
    }
    const fl = race.fastest && race.fastest.car === c;
    const who = c.human ? `${escHTML(c.name)} <small class="res-real">${c.driver.code}</small>` : (c.isPlayer && c.name ? escHTML(c.name) : c.driver.name);
    html += `<tr class="${c.isPlayer ? 'me' : ''}"><td class="pos">${k + 1}</td><td>${c.driver.num}</td><td><span class="bar" style="background:${c.team.color}"></span>${who}</td><td>${c.team.name}</td><td>${time}</td><td class="${fl ? 'fl' : ''}">${fmt(c.bestLap)}${fl ? ' ◆' : ''}</td></tr>`;
  });
  tbl.innerHTML = html;
  if (race.reward) $('res-coins').innerHTML = `<div class="rc-title"><span class="coin-ico">C</span>+${race.reward.total.toLocaleString()} COINS EARNED</div>` + race.reward.items.map(([k, v]) => `<div class="rc-row"><span>${k}</span><b>+${v}</b></div>`).join('') + `<div class="rc-row total"><span>Balance</span><b>${progress.coins.toLocaleString()}</b></div>`;
  $('results').classList.remove('hidden');
}

// ---------------------------------------------------------------- audio per frame
function updateAudio() {
  const pl = race.player, p = pl.phys;
  let other = null, best = Infinity;
  for (const c of race.cars) {
    if (c === pl) continue;
    const d = camera.position.distanceTo(c.model.group.position);
    if (d < best) { best = d; other = c; }
  }
  let o = null;
  if (other && best < 160) {
    const op = other.phys;
    const toCam = tmpV.copy(camera.position).sub(other.model.group.position).normalize();
    const closing = op.vx * toCam.x + op.vz * toCam.z - (p.vx * toCam.x + p.vz * toCam.z);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pan = -toCam.dot(right);
    o = { dist: best, rpm: op.rpm, throttle: op.throttle, closing, pan: THREE.MathUtils.clamp(pan, -0.9, 0.9) };
  }
  const slip = Math.max(Math.abs(p.slipF), Math.abs(p.slipR)) * 6 + p.lock + p.spin;
  audio.update({ rpm: p.rpm, throttle: p.throttle, speed: Math.abs(p.u), slip, surface: pl.sF.name === 'road' ? pl.sR.name : pl.sF.name, ers: p.ersDeploying, other: o, inCockpit: camMode >= 2 && camMode <= 4, paused: paused || guideOpen });
}

// ---------------------------------------------------------------- main loop
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const inp = input.update(dt);
  if (state === 'menu') {
    updateShowroom(dt);
    renderPass.scene = show.scene; renderPass.camera = show.camera;
    blurPass.uniforms.amount.value = 0; blurPass.uniforms.vignette.value = 0.5;
    composer.render();
    return;
  }
  if (state !== 'race' || !race) return;
  if (inp.pause && !race.resultsShown) togglePause();
  if (inp.mute) { audio.enabled = !audio.enabled; if (!audio.enabled) audio.suspend(); else audio.resume(); showMsg(audio.enabled ? 'SOUND ON' : 'SOUND OFF', 'small', 1); }
  if (inp.hud) { hudVisible = !hudVisible; $('hud').style.opacity = hudVisible ? 1 : 0; }
  if (inp.line) { showLine = !showLine; scenery.rlMesh.visible = showLine; updateAssistBadges(); }
  if (inp.camera) { camMode = (camMode + 1) % CAMS.length; flashCamName(); }
  if (inp.standings) toggleStandings();
  if (inp.help || helpClicked) { helpClicked = false; requestHelp(); }
  if (inp.box || boxClicked) { boxClicked = false; togglePitRequest(); }
  // online races keep running while you pause (your car parks itself, see playerControls)
  if (mp || (!paused && !guideOpen)) {
    if (inp.reset && race.started && !race.player.finished && !race.player.frozen && !paused) respawnCar(race.player);
    stepRace(dt, paused || guideOpen ? { ...inp, throttle: 0, drs: false } : inp);
    updateEvents(dt);
    updateCarVisuals(dt);
  }
  updateCamera(dt, inp);
  if (showLine) scenery.updateRacingLine(race.player.proj.i, Math.abs(race.player.phys.u), race.playerProfile || (race.playerProfile = track.speedProfile(race.player.phys.spec, 0.97)));
  if (weather) weather.update(paused ? 0 : dt, { camera, player: race.player, cars: race.cars.filter(c => !c.retired), track, cockpit: camMode >= 2 && camMode <= 4 && !race.event && !(race.crew && race.crew.state === 'service') });
  radio?.update(dt, paused && !mp);
  updateHUD(dt);
  updateAudio();
  updateCockpit(dt);
  renderPass.scene = scene; renderPass.camera = camera;
  composer.render();
  adaptResolution(dt);
}

function togglePause(force) {
  paused = force !== undefined ? force : !paused;
  $('pause').classList.toggle('hidden', !paused);
  if (paused && pauseSync) pauseSync();
  if (paused) audio.update({ rpm: 0, throttle: 0, speed: 0, slip: 0, surface: 'road', paused: true });
}

document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.act;
  if (a === 'resume') togglePause(false);
  if (a === 'restart') { togglePause(false); loadEvent(); }
  if (a === 'camera') { camMode = (camMode + 1) % CAMS.length; flashCamName(); }
  if (a === 'standings') toggleStandings();
  if (a === 'guide') { togglePause(false); showGuide(true); }
  if (a === 'menu') { togglePause(false); toMenu(); }
  if (a === 'abort' && mp) { togglePause(false); online.net.send('abort'); }
  if (a === 'lobby') { // leave an online race (mid-race this counts as a DNF) and go back to the lobby room
    togglePause(false);
    const finished = !race || race.resultsShown;
    if (!finished) online.leave();
    toMenu(true);
    if (finished) online.backToRoom(); else online.open();
  }
}));
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'race' && !paused && !race?.resultsShown) togglePause(true); });

function toMenu(keepOnline) {
  endEvent();
  state = 'menu';
  mp = null;
  document.body.classList.remove('mp', 'mp-host');
  radio?.stop();
  weather?.hideLens();
  audio.setRain(false);
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  showGuide(false, true);
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('lights').classList.add('hidden');
  $('msg').innerHTML = '';
  if (!keepOnline) $('menu').classList.remove('hidden');
  audio.update({ rpm: 0, throttle: 0, speed: 0, slip: 0, surface: 'road', paused: true });
  setShowroomCar();
  menuUI?.refresh();
  checkOrientation();
}

// ---------------------------------------------------------------- menu UI
let menuUI = null;
let pauseSync = null;
function onSettingChange(key) {
  if (key === 'quality' || key === 'blur') setupComposer();
  if (key === 'line') { showLine = settings.line; if (scenery) scenery.rlMesh.visible = showLine && state === 'race'; }
  if (key === 'cam') { camMode = settings.cam | 0; if (state === 'race') flashCamName(); }
  if (key === 'vol') audio.setVolume(settings.vol);
  if (key === 'touch' || key === 'tiltInvert') applyTouchSettings();
  if (key === 'gear') document.body.classList.toggle('manual', !settings.gear);
  if (key === 'standings') applyStandings(state === 'race');
  if (key === 'radio' && radio) { radio.enabled = settings.radio !== false; if (!radio.enabled) radio.stop(); }
  if (state === 'race' && ['tc', 'abs', 'gear', 'line'].includes(key)) {
    updateAssistBadges();
    if (key === 'gear') showMsg(settings.gear ? 'AUTOMATIC GEARBOX' : (isMobile ? 'MANUAL GEARBOX · USE ▼ ▲ TO SHIFT' : 'MANUAL GEARBOX · E / Q TO SHIFT'), 'small', 2);
  }
}
function setupMenu() {
  $('help-btn').addEventListener('click', () => { helpClicked = true; });
  $('box-btn').addEventListener('click', () => { boxClicked = true; });
  $('tower').querySelector('.tower-head').addEventListener('click', () => toggleStandings());
  $('tguide').addEventListener('click', e => { if (e.target.closest('[data-guide="close"]') || e.target === $('tguide')) showGuide(false); });
  menuUI = buildMenu({
    settings, fmt, progress, upgrades: UPGRADES,
    save: saveSettings,
    onTeam: () => setShowroomCar(),
    onChange: onSettingChange,
  });
  pauseSync = buildPauseSettings($('pause-settings'), { settings, save: saveSettings, onChange: onSettingChange }, isMobile);
  document.body.classList.toggle('manual', !settings.gear);
  applyTouchSettings();
  input.bindTouch($('touch'));
  // team radio + engineer
  radio = new TeamRadio(audio);
  engineer = new Engineer(radio);
  // online multiplayer
  online = setupOnline({
    settings, save: saveSettings,
    onStartRace: (msg, lobby) => { audio.init(); radio.unlock(); goFullscreen(); mpStartRace(msg, lobby); },
    onShowMenu: (err, fromDisconnect) => {
      if (fromDisconnect && state === 'race' && mp) { toMenu(); if (err) showToastMenu(err); return; }
      if (!fromDisconnect) { $('online').classList.add('hidden'); $('menu').classList.remove('hidden'); menuUI?.refresh(); }
    },
  });
  const on = online.net;
  on.on('go', mpGo);
  on.on('retired', mpRetired);
  on.on('finish', mpFinish);
  on.on('end', mpEnd);
  on.on('s', m => { const c = race?.cars?.find(x => x.slot === m.k); if (c && c.remote && c.isRemote) pushSnapshot(c.remote, m.d); });
  on.on('chat', m => { if (state === 'race' && mp && !m.sys) showMsg(`${m.from}: ${m.text}`, 'small', 3); });
  $('online-btn').addEventListener('click', () => { audio.init(); online.open(); });
  // opened from an invite link (?join=CODE): go straight to the online screen
  if (online.hasInvite()) setTimeout(() => online.open(), 50);
  $('start-btn').addEventListener('click', () => {
    audio.init(); radio.unlock(); camMode = settings.cam | 0;
    if (isMobile) {
      const de = document.documentElement;
      const fs = de.requestFullscreen || de.webkitRequestFullscreen;
      if (fs) { try { const p = fs.call(de); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      if (settings.touch === 'tilt' && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {});
    }
    loadEvent().catch(err => { console.error(err); const el = $('error'); el.textContent = String(err.stack || err); el.classList.remove('hidden'); });
  });
}
function goFullscreen() {
  if (!isMobile) return;
  const de = document.documentElement;
  const fs = de.requestFullscreen || de.webkitRequestFullscreen;
  if (fs && !document.fullscreenElement) { try { const p = fs.call(de); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
}
function showToastMenu(text) {
  const el = $('error');
  el.textContent = text; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
function applyTouchSettings() {
  input.touchMode = settings.touch;
  input.tiltInvert = !!settings.tiltInvert;
  document.body.classList.toggle('tilt', settings.touch === 'tilt');
}
// standings tower: LIST button, T key, tapping the tower header or the pause-menu setting. Choice is remembered.
function applyStandings(announce) {
  const on = settings.standings !== false;
  $('tower').classList.toggle('collapsed', !on);
  $('tower-toggle').setAttribute('aria-expanded', String(on));
  const lb = $('touch').querySelector('[data-t="list"]');
  if (lb) { lb.classList.toggle('on-state', on); lb.setAttribute('aria-pressed', String(on)); }
  if (announce) showMsg(on ? 'STANDINGS SHOWN' : 'STANDINGS HIDDEN', 'small', 1);
}
function toggleStandings() {
  settings.standings = settings.standings === false;
  saveSettings();
  applyStandings(true);
  pauseSync?.();
}

// touch controls guide: shown automatically on the first race on a phone, and from the ? button
let guideOpen = false;
function showGuide(on, silent) {
  guideOpen = !!on;
  $('tguide').classList.toggle('hidden', !guideOpen);
  document.body.classList.toggle('guide-open', guideOpen);
  if (!guideOpen && !silent) localStorage.setItem('f1gp.guideSeen', '1');
}

// phones must be held sideways: show the rotate prompt and pause the race while upright
let wasPortrait = false;
function checkOrientation() {
  const portrait = isMobile && innerHeight > innerWidth;
  $('rotate').classList.toggle('hidden', !portrait);
  document.body.classList.toggle('portrait', portrait);
  if (portrait && !wasPortrait && state === 'race' && race && !paused && !race.resultsShown) togglePause(true);
  if (!portrait && wasPortrait && isMobile && (state === 'race' || !$('menu').classList.contains('hidden'))) {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  }
  wasPortrait = portrait;
}
addEventListener('resize', checkOrientation);
addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(checkOrientation, 100));

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
  setLoading('Loading fonts & assets', 20);
  try { await document.fonts.load('900 italic 20px "Titillium Web"'); } catch (e) { /* offline fallback */ }
  setupComposer();
  setLoading('Preparing garage', 60);
  await sleep();
  setupMenu();
  setShowroomCar();
  setLoading('Ready', 100);
  await sleep();
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  checkOrientation();
  requestAnimationFrame(frame);
  // debug hook
  window.__game = { get race() { return race; }, get track() { return track; }, settings, camera, renderer, loadEvent, get scene() { return scene; } };
  } catch (err) {
    console.error(err);
    const el = $('error'); el.textContent = 'Startup error: ' + (err.stack || err); el.classList.remove('hidden');
  }
})();
