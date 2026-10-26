// Main menu: event, team, settings and controls pages built from data.
import { TRACK_DATA } from './trackdata.js';
import { TRACKS } from './tracks.js';
import { TEAMS } from './teams.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- icons
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICONS = {
  flag: I('<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>'),
  helmet: I('<path d="M3 15a9 9 0 0 1 18-2v3H9l-2 3H4z"/><path d="M13 13h8"/>'),
  grid: I('<rect x="4" y="3" width="6" height="5"/><rect x="14" y="8" width="6" height="5"/><rect x="4" y="13" width="6" height="5"/><path d="M14 18h6"/>'),
  cars: I('<path d="M3 17h18"/><path d="M5 17l2-5h10l2 5"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>'),
  tyre: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>'),
  tc: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  abs: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  gear: I('<path d="M6 4v16M12 4v16M18 4v8"/><path d="M6 12h12"/>'),
  wheel: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10h6M14.5 10h6M12 14.5V21"/>'),
  line: I('<path d="M4 20c4-1 5-5 8-8s5-6 8-8"/><path d="M4 20l2 0" stroke="#00d26a"/>'),
  quality: I('<rect x="3" y="5" width="18" height="12" rx="1"/><path d="M8 21h8M12 17v4"/>'),
  camera: I('<path d="M3 7h4l2-2h6l2 2h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  blur: I('<path d="M3 12h10M3 7h14M3 17h8"/><path d="M17 12h4M19 17h2"/>'),
  volume: I('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/>'),
  phone: I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  swap: I('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  trophy: I('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
  clock: I('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  list: I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 12h1M4 18h1"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  radio: I('<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M7 9l9-5M8 15h3M15 14.5a1.5 1.5 0 1 0 0 .01"/>'),
};

// ---------------------------------------------------------------- graphics helpers
export function trackSVG(id, w = 200, h = 90, cls = '') {
  const pts = TRACK_DATA[id].points;
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
  const sc = Math.min((w - 12) / (maxx - minx), (h - 12) / (maxz - minz));
  const ox = (w - (maxx - minx) * sc) / 2, oz = (h - (maxz - minz) * sc) / 2;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + ((p[0] - minx) * sc + ox).toFixed(1) + ' ' + ((p[1] - minz) * sc + oz).toFixed(1)).join(' ') + 'Z';
  const s0 = pts[0];
  return `<svg viewBox="0 0 ${w} ${h}" class="${cls}"><path d="${d}" class="tr-shadow"/><path d="${d}" class="tr-base"/><path d="${d}" class="tr-run" pathLength="100"/><circle cx="${((s0[0] - minx) * sc + ox).toFixed(1)}" cy="${((s0[1] - minz) * sc + oz).toFixed(1)}" r="3.5" fill="#e10600"/></svg>`;
}

// top view of an F1 car painted in team colours (nose pointing right)
function carSVG(team) {
  const L = team.livery;
  return `<svg viewBox="0 0 160 52" class="car-svg">
    <rect x="18" y="4" width="20" height="12" rx="3" fill="#111"/><rect x="18" y="36" width="20" height="12" rx="3" fill="#111"/>
    <rect x="108" y="6" width="16" height="10" rx="3" fill="#111"/><rect x="108" y="36" width="16" height="10" rx="3" fill="#111"/>
    <rect x="4" y="10" width="12" height="32" rx="2" fill="${L.wing}"/><rect x="4" y="10" width="4" height="32" fill="${L.wingAccent}"/>
    <rect x="138" y="6" width="10" height="40" rx="2" fill="${L.wing}"/><rect x="146" y="6" width="3" height="40" fill="${L.wingAccent}"/>
    <path d="M14 22 L40 18 L58 12 L86 12 L96 19 L150 23 L152 26 L150 29 L96 33 L86 40 L58 40 L40 34 L14 30 Z" fill="${L.base}"/>
    <path d="M14 22 L40 18 L58 12 L64 12 L50 26 L64 40 L58 40 L40 34 L14 30 Z" fill="${L.dark}" opacity="0.85"/>
    <path d="M60 26 L96 21 L140 24.5" stroke="${L.accent}" stroke-width="2.4" fill="none"/>
    <ellipse cx="80" cy="26" rx="9" ry="5" fill="#0a0a0a"/><circle cx="78" cy="26" r="3.6" fill="${team.drivers[0].helmet[0]}"/>
    <path d="M72 20 Q86 18 92 26 Q86 34 72 32" stroke="${L.halo}" stroke-width="2.4" fill="none"/>
  </svg>`;
}

function helmetSVG(d) {
  const [a, b] = d.helmet;
  return `<svg viewBox="0 0 48 40" class="helmet-svg"><path d="M4 30 A20 20 0 0 1 44 22 L44 30 L18 30 L14 36 L6 36 Z" fill="${a}" stroke="rgba(0,0,0,.4)"/>
    <path d="M6 24 Q24 14 42 20 L43 24 Q24 19 7 29 Z" fill="${b}"/><path d="M26 22 L44 22 L44 28 L24 28 Z" fill="#141820"/></svg>`;
}

function tyreSVG(col) {
  return `<svg viewBox="0 0 48 48" class="tyre-svg"><circle cx="24" cy="24" r="22" fill="#151515"/><circle cx="24" cy="24" r="17" fill="none" stroke="${col}" stroke-width="3"/><circle cx="24" cy="24" r="11" fill="#26282c"/><circle cx="24" cy="24" r="3" fill="${col}"/></svg>`;
}

const bar = (label, v, col = '#e10600') => `<div class="stat"><span>${label}</span><div class="sbar"><i style="width:${Math.round(v * 100)}%;background:${col}"></i></div><b>${Math.round(v * 100)}</b></div>`;

// ---------------------------------------------------------------- settings definitions
const TYRES = [['supersoft', '#a0168c', 'SUPERSOFT', 'Most grip'], ['soft', '#e8202a', 'SOFT', 'High grip'], ['medium', '#ffd200', 'MEDIUM', 'Balanced'], ['hard', '#f0f0f0', 'HARD', 'Least grip']];
const GROUPS = [
  {
    title: 'RACE', hint: 'Shape the event to your liking',
    items: [
      {
        key: 'cond', type: 'chips', icon: 'sun', label: 'Track conditions', desc: 'Time of day and weather for the race.', options: [['day', '☀ DAY'], ['night', '☾ NIGHT'], ['rain', '☂ RAIN']],
        sub: { day: 'Sunny afternoon.', night: 'Floodlit circuit under the moon and stars.', rain: 'Wet, slippery track with spray and thunder. Brake earlier!' },
      },
      { key: 'laps', type: 'chips', icon: 'flag', label: 'Race distance', desc: 'How many laps the Grand Prix lasts. "Default" uses a quick, track-specific length.', options: [[0, 'DEFAULT'], [1, '1'], [3, '3'], [5, '5'], [10, '10']] },
      {
        key: 'diff', type: 'chips', icon: 'helmet', label: 'AI difficulty', desc: 'How fast the computer-controlled drivers are.', options: [[0.86, 'ROOKIE'], [0.91, 'PRO'], [0.955, 'EXPERT'], [0.985, 'LEGEND']],
        sub: { 0.86: 'Relaxed opponents that leave plenty of margin. Great for learning the tracks.', 0.91: 'Solid, competitive racers. A good challenge once you know the circuit.', 0.955: 'Quick and consistent. You will need clean, committed laps.', 0.985: 'Drivers at the limit. Only the perfect lap will do.' },
      },
      { key: 'field', type: 'chips', icon: 'cars', label: 'Number of cars', desc: 'Fewer cars run smoother on phones and older computers.', options: [[10, '10'], [16, '16'], [20, '20']] },
      { key: 'grid', type: 'chips', icon: 'grid', label: 'Starting position', desc: 'Where you line up when the lights go out. Starting at the back means more overtaking!', options: [['pole', 'POLE'], ['mid', 'MIDFIELD'], ['back', 'BACK']] },
      { key: 'tyre', type: 'tyres', icon: 'tyre', label: 'Tyre compound', desc: 'Softer rubber grips the road better, so you can corner faster. Coloured stripes match real Pirelli markings.' },
    ],
  },
  {
    title: 'DRIVING ASSISTS', hint: 'Helpers that make the car easier to drive',
    items: [
      { key: 'tc', type: 'toggle', icon: 'tc', label: 'Traction control', desc: 'Stops the rear tyres spinning when you accelerate out of corners. Keep it ON if you are new.' },
      { key: 'abs', type: 'toggle', icon: 'abs', label: 'Anti-lock brakes (ABS)', desc: 'Stops the wheels locking under heavy braking, so you can still steer while slowing down.' },
      { key: 'gear', type: 'toggle', icon: 'gear', label: 'Automatic gearbox', desc: 'Changes gear for you. Switch OFF to use the paddles yourself (E = up, Q = down).' },
      { key: 'steer', type: 'toggle', icon: 'wheel', label: 'Steering assist', desc: 'Calms the steering at high speed and helps catch slides. Very helpful on keyboard and touch screens.' },
      { key: 'line', type: 'toggle', icon: 'line', label: 'Racing line', desc: 'Shows the fastest path on the track. Green = full throttle, yellow = ease off, red = brake now!' },
    ],
  },
  {
    title: 'GRAPHICS & SOUND', hint: 'Balance looks and smoothness',
    items: [
      {
        key: 'quality', type: 'chips', icon: 'quality', label: 'Graphics quality', desc: 'Higher looks better but needs a stronger device. The game also lowers resolution automatically if it starts to stutter.', options: [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'ULTRA']],
        sub: { low: 'Fastest. Recommended for phones and laptops without a gaming GPU.', medium: 'Shadows, reflections and a full field of trees. Best for most PCs.', high: 'Sharpest shadows, more trees, high-resolution textures.' },
      },
      { key: 'cam', type: 'chips', icon: 'camera', label: 'Starting camera', desc: 'You can always switch during the race with C (or the CAM button).', options: [[0, 'CHASE'], [1, 'FAR'], [2, 'T-CAM'], [3, 'COCKPIT'], [4, 'NOSE'], [5, 'TV']] },
      { key: 'radio', type: 'toggle', icon: 'radio', label: 'Team radio', desc: 'Your race engineer talks to you: DRS, tyres, fuel, pit stops and weather, with the on-screen TEAM RADIO graphic.' },
      { key: 'standings', type: 'toggle', icon: 'list', label: 'Driver standings', desc: 'Shows the live timing tower with every driver. Hide it any time during a race with T, the LIST button or by tapping the tower.' },
      { key: 'blur', type: 'toggle', icon: 'blur', label: 'Speed blur', desc: 'Blurs the screen edges at high speed for a sense of velocity. Turn OFF for extra smoothness.' },
      { key: 'vol', type: 'slider', icon: 'volume', label: 'Master volume', desc: 'Engine, tyres, wind and impact sounds.' },
    ],
  },
  {
    title: 'TOUCH SCREEN', hint: 'For phones and tablets',
    items: [
      { key: 'touch', type: 'chips', icon: 'phone', label: 'Touch steering', desc: 'Buttons: tap ◀ ▶ to steer. Tilt: turn your device like a steering wheel.', options: [['buttons', 'BUTTONS'], ['tilt', 'TILT']] },
      { key: 'tiltInvert', type: 'toggle', icon: 'swap', label: 'Invert tilt', desc: 'Turn ON if tilting left makes the car go right.' },
    ],
  },
];

const PRESETS = [
  { id: 'rookie', name: 'ROOKIE', icon: '★', desc: 'Every assist on, racing line visible and relaxed opponents.', v: { tc: true, abs: true, gear: true, steer: true, line: true, diff: 0.86 } },
  { id: 'racer', name: 'RACER', icon: '★★', desc: 'Assists on, but no racing line. Competitive AI.', v: { tc: true, abs: true, gear: true, steer: true, line: false, diff: 0.91 } },
  { id: 'pro', name: 'PRO', icon: '★★★', desc: 'No traction control or ABS. Manage the tyres yourself.', v: { tc: false, abs: false, gear: true, steer: true, line: false, diff: 0.955 } },
  { id: 'legend', name: 'LEGEND', icon: '♛', desc: 'Pure simulation: manual gears, no helpers, AI at the limit.', v: { tc: false, abs: false, gear: false, steer: false, line: false, diff: 0.985 } },
];

const TIPS = [
  ['Brake in a straight line', 'Do most of your braking before you turn. The racing line turns red where you should brake.'],
  ['Hit the apex', 'Aim for the inside kerb in the middle of the corner, then let the car drift wide on the exit.'],
  ['Be smooth on the throttle', 'Squeeze the throttle as you straighten the wheel. Too much, too early = spin.'],
  ['Use DRS on the straights', 'When DRS turns green, press F / DRS to open the rear wing for extra top speed.'],
  ['Save ERS for overtakes', 'Hold Shift / ERS for a 120 kW electric boost. It recharges when you brake.'],
  ['Stay on the track', 'Grass and gravel kill your speed. All four wheels off the track invalidates a Time Trial lap.'],
];

// ---------------------------------------------------------------- build
export function buildMenu(ctx) {
  const { settings, save } = ctx;
  const changed = (key) => { save(); refreshSummary(); refreshPresets(); ctx.onChange?.(key); };

  // tabs
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
  }));

  // mode cards
  const modes = [
    ['race', 'GRAND PRIX', ICONS.trophy, 'Lights out against a full grid. Overtake your way to the chequered flag.'],
    ['tt', 'TIME TRIAL', ICONS.clock, 'Just you and the clock. Chase your best lap against your own ghost car.'],
  ];
  const mc = $('mode-cards');
  mc.innerHTML = modes.map(([v, n, ic, d]) => `<button class="mode-card" data-v="${v}" title="${d}"><div class="mc-ico">${ic}</div><div><div class="mc-name">${n}</div><div class="mc-desc">${d}</div></div></button>`).join('');
  const syncModes = () => mc.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('on', b.dataset.v === settings.mode));
  mc.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => { settings.mode = b.dataset.v; syncModes(); changed('mode'); }));
  syncModes();

  // handling difficulty
  const diffs = [
    ['easy', 'EASY', 1, 'Grippy and forgiving. The car turns easily and drives on grass or gravel almost like the road.'],
    ['medium', 'MEDIUM', 2, 'A little more realistic. Grass and gravel slow you down, but you can keep driving.'],
    ['hard', 'HARD', 3, 'Full simulation. Run wide and you will bog down in the grass or get stuck in the gravel.'],
  ];
  const dc = $('diff-cards');
  dc.innerHTML = diffs.map(([v, n, lv, d]) => `<button class="diff-card d-${v}" data-v="${v}" title="${d}"><div class="dc-bars">${[1, 2, 3].map(k => `<i class="${k <= lv ? 'f' : ''}"></i>`).join('')}</div><div class="dc-name">${n}</div><div class="dc-desc">${d}</div></button>`).join('');
  const syncDiff = () => dc.querySelectorAll('.diff-card').forEach(b => b.classList.toggle('on', b.dataset.v === settings.handling));
  dc.querySelectorAll('.diff-card').forEach(b => b.addEventListener('click', () => { settings.handling = b.dataset.v; syncDiff(); changed('handling'); }));
  syncDiff();

  // garage / upgrades
  const P = ctx.progress, UP = ctx.upgrades;
  const gar = $('garage');
  function renderGarage() {
    $('coin-val').textContent = P.coins.toLocaleString();
    gar.innerHTML = UP.map(u => {
      const lv = P.level(u.id), cost = P.cost(u.id);
      const can = cost != null && P.coins >= cost;
      return `<div class="up-card${lv >= 5 ? ' max' : ''}" title="${u.desc}"><div class="up-ico">${u.icon}</div><div class="up-body"><div class="up-name">${u.name}</div><div class="up-desc">${u.desc}</div>
        <div class="up-pips">${[0, 1, 2, 3, 4].map(k => `<i class="${k < lv ? 'f' : ''}"></i>`).join('')}<span>${u.per} / level</span></div></div>
        <button class="up-buy" data-id="${u.id}" ${can ? '' : 'disabled'}>${cost == null ? 'MAXED' : `<span class="coin-ico">C</span>${cost.toLocaleString()}`}</button></div>`;
    }).join('');
    gar.querySelectorAll('.up-buy').forEach(b => b.addEventListener('click', () => {
      if (P.buy(b.dataset.id)) { b.closest('.up-card').classList.add('bought'); setTimeout(renderGarage, 380); }
    }));
  }
  P.onChange(renderGarage);
  renderGarage();

  // tracks
  const tg = $('track-grid');
  tg.innerHTML = '';
  for (const t of TRACKS) {
    const el = document.createElement('button');
    el.className = 'tcard' + (t.id === settings.track ? ' on' : '');
    el.innerHTML = `<div class="tc-type">${t.style === 'street' ? 'STREET' : 'CIRCUIT'}</div>${trackSVG(t.id)}<div class="tname"><span class="cc">${t.cc}</span>${t.name}</div><div class="tcountry">${(TRACK_DATA[t.id].length / 1000).toFixed(2)} KM · ${t.country}</div>`;
    el.addEventListener('click', () => { settings.track = t.id; [...tg.children].forEach(c => c.classList.toggle('on', c === el)); refreshTrackInfo(); changed('track'); });
    tg.appendChild(el);
  }

  // teams
  const tm = $('team-grid');
  tm.innerHTML = '';
  for (const t of TEAMS) {
    const el = document.createElement('button');
    el.className = 'team-card' + (t.id === settings.team ? ' on' : '');
    el.style.setProperty('--tc', t.color);
    el.innerHTML = `<div class="tcar">${carSVG(t)}</div><div class="tinfo"><div class="tn">${esc(t.name)}</div><div class="td">${esc(t.car)}</div></div>`;
    el.addEventListener('click', () => { settings.team = t.id; settings.driver = 0; [...tm.children].forEach(c => c.classList.toggle('on', c === el)); buildDrivers(); ctx.onTeam(); changed('team'); });
    tm.appendChild(el);
  }
  function buildDrivers() {
    const team = TEAMS.find(t => t.id === settings.team);
    const box = $('driver-cards');
    box.innerHTML = '';
    team.drivers.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'driver-card' + (i === settings.driver ? ' on' : '');
      b.style.setProperty('--tc', team.color);
      b.innerHTML = `${helmetSVG(d)}<div class="dnum">${d.num}</div><div class="dinfo"><div class="dname">${esc(d.name)}</div><div class="dcode">${d.code} · ${i === 0 ? 'T-CAM BLACK' : 'T-CAM YELLOW'}</div></div>`;
      b.addEventListener('click', () => { settings.driver = i; buildDrivers(); ctx.onTeam(); changed('driver'); });
      box.appendChild(b);
    });
    refreshStats();
  }
  buildDrivers();

  // presets
  const pr = $('presets');
  pr.innerHTML = PRESETS.map(p => `<button class="preset" data-id="${p.id}" title="${p.desc}"><div class="ps-stars">${p.icon}</div><div class="ps-name">${p.name}</div><div class="ps-desc">${p.desc}</div></button>`).join('');
  pr.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
    const p = PRESETS.find(x => x.id === b.dataset.id);
    Object.assign(settings, p.v);
    for (const k of Object.keys(p.v)) ctx.onChange?.(k);
    syncAll(); changed('preset');
  }));
  function refreshPresets() {
    pr.querySelectorAll('.preset').forEach(b => {
      const p = PRESETS.find(x => x.id === b.dataset.id);
      b.classList.toggle('on', Object.entries(p.v).every(([k, v]) => settings[k] === v));
    });
  }

  const syncAll = buildRows($('settings-list'), GROUPS, settings, changed, ctx.onTeam);

  // controls & tips page
  $('tips').innerHTML = TIPS.map(([t, d], i) => `<div class="tip"><div class="tip-n">${String(i + 1).padStart(2, '0')}</div><div><b>${t}</b><span>${d}</span></div></div>`).join('');

  function refreshTrackInfo() {
    const t = TRACKS.find(x => x.id === settings.track);
    const len = TRACK_DATA[t.id].length;
    const best = localStorage.getItem('f1gp.tt.' + t.id);
    $('track-info').innerHTML = `<div class="ti-map">${trackSVG(t.id, 240, 150, 'big')}</div><div class="ti-body"><div class="ti-head"><span><span class="cc">${t.cc}</span>${t.gp}</span><em>${t.style === 'street' ? 'STREET CIRCUIT' : 'PERMANENT CIRCUIT'}</em></div><p>${t.description}</p>
      <div class="ti-stats"><div>LENGTH<b>${(len / 1000).toFixed(3)} km</b></div><div>LAPS<b>${t.laps}</b></div><div>DRS ZONES<b>${t.drs.length}</b></div><div>YOUR BEST<b>${best ? ctx.fmt(Number(best)) : '—'}</b></div></div></div>`;
  }
  function refreshStats() {
    const team = TEAMS.find(t => t.id === settings.team);
    const d = team.drivers[settings.driver];
    const norm = (v, lo, hi) => Math.max(0.05, Math.min(1, (v - lo) / (hi - lo)));
    $('sc-stats').innerHTML = bar('POWER UNIT', 0.55 + 0.45 * norm(team.perf.power, 0.94, 1.0), team.color) + bar('AERODYNAMICS', 0.55 + 0.45 * norm(team.perf.aero, 0.94, 1.01), team.color) + bar('DRIVER', 0.55 + 0.45 * norm(d.rating, 0.94, 1.0), team.color);
  }
  function refreshSummary() {
    const t = TRACKS.find(x => x.id === settings.track);
    const team = TEAMS.find(x => x.id === settings.team);
    const laps = (settings.laps | 0) || t.laps;
    const chip = (k, v) => `<div class="sum-chip"><span>${k}</span><b>${v}</b></div>`;
    $('summary').innerHTML = chip('MODE', settings.mode === 'race' ? 'GRAND PRIX' : 'TIME TRIAL') + chip('CIRCUIT', t.name + (settings.cond === 'night' ? ' · NIGHT' : settings.cond === 'rain' ? ' · RAIN' : '')) + chip('HANDLING', (settings.handling || 'medium').toUpperCase()) + chip('DRIVER', `<i style="background:${team.color}"></i>${team.drivers[settings.driver].name}`) + (settings.mode === 'race' ? chip('DISTANCE', `${laps} LAPS · ${settings.field} CARS`) : '');
  }
  refreshTrackInfo(); refreshSummary(); refreshPresets();
  return { refresh() { syncAll(); refreshTrackInfo(); refreshSummary(); refreshPresets(); refreshStats(); renderGarage(); } };
}

// settings rows (toggles, chips, tyre pickers, sliders) shared by the main menu and the pause menu
function buildRows(list, groups, settings, onChange, onTyre) {
  list.innerHTML = '';
  const syncers = [];
for (const g of groups) {
  const sec = document.createElement('div');
  sec.className = 'set-group';
  sec.innerHTML = `<div class="sec-title"><span>${g.title}</span><i>${g.hint || ''}</i></div>`;
  for (const it of g.items) {
    const row = document.createElement('div');
    row.className = 'set-item ' + it.type;
    row.title = it.desc;
    row.innerHTML = `<div class="si-ico">${ICONS[it.icon] || ''}</div><div class="si-text"><div class="si-label">${it.label}</div><div class="si-desc">${it.desc}</div><div class="si-sub"></div></div><div class="si-ctl"></div>`;
    const ctl = row.querySelector('.si-ctl'), sub = row.querySelector('.si-sub');
    let sync;
    if (it.type === 'toggle') {
      ctl.innerHTML = `<button class="switch" role="switch"><span class="sw-txt on">ON</span><span class="sw-txt off">OFF</span><i></i></button>`;
      const sw = ctl.firstChild;
      sync = () => sw.classList.toggle('on', !!settings[it.key]);
      row.addEventListener('click', () => { settings[it.key] = !settings[it.key]; sync(); onChange(it.key); });
    } else if (it.type === 'chips') {
      ctl.innerHTML = `<div class="chips">${it.options.map(([v, l]) => `<button class="chip" data-v="${v}">${l}</button>`).join('')}</div>`;
      sync = () => {
        ctl.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', String(settings[it.key]) === c.dataset.v));
        sub.textContent = it.sub ? (it.sub[settings[it.key]] || '') : '';
      };
      ctl.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
        const opt = it.options.find(([v]) => String(v) === c.dataset.v);
        settings[it.key] = opt[0]; sync(); onChange(it.key);
      }));
    } else if (it.type === 'tyres') {
      ctl.innerHTML = `<div class="tyres">${TYRES.map(([v, col, n, d]) => `<button class="tyre-opt" data-v="${v}">${tyreSVG(col)}<b>${n}</b><span>${d}</span></button>`).join('')}</div>`;
      sync = () => ctl.querySelectorAll('.tyre-opt').forEach(c => c.classList.toggle('on', settings.tyre === c.dataset.v));
      ctl.querySelectorAll('.tyre-opt').forEach(c => c.addEventListener('click', () => { settings.tyre = c.dataset.v; sync(); onTyre && onTyre(); onChange('tyre'); }));
    } else if (it.type === 'slider') {
      ctl.innerHTML = `<div class="slider"><input type="range" min="0" max="1" step="0.05"><b></b></div>`;
      const r = ctl.querySelector('input'), lbl = ctl.querySelector('b');
      sync = () => { r.value = settings[it.key]; lbl.textContent = Math.round(settings[it.key] * 100) + '%'; r.style.setProperty('--p', settings[it.key] * 100 + '%'); };
      r.addEventListener('input', () => { settings[it.key] = Number(r.value); sync(); onChange(it.key); });
    }
    syncers.push(sync);
    sync();
    sec.appendChild(row);
  }
  list.appendChild(sec);
}
  return () => syncers.forEach(s => s());
}

export function buildPauseSettings(container, ctx, mobile) {
  const all = GROUPS.flatMap(g => g.items);
  const pick = keys => keys.map(k => all.find(i => i.key === k)).filter(Boolean);
  const groups = [
    { title: 'DRIVING', items: [...pick(['gear']), { key: 'handlingLive', type: 'none' }].filter(i => i.type !== 'none').concat(pick(['tc', 'abs', 'steer', 'line'])) },
    { title: 'GRAPHICS & SOUND', items: pick(['quality', 'cam', 'radio', 'standings', 'blur', 'vol']) },
  ];
  if (mobile) groups.push({ title: 'TOUCH', items: pick(['touch', 'tiltInvert']) });
  return buildRows(container, groups, ctx.settings, key => { ctx.save(); ctx.onChange && ctx.onChange(key); });
}
