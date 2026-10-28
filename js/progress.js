// Coins, car upgrades and handling difficulty.
const KEY = 'f1gp.progress';
const state = Object.assign({ coins: 1500, up: {} }, JSON.parse(localStorage.getItem(KEY) || '{}'));
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const listeners = new Set();
const emit = () => listeners.forEach(f => f(state));

export const COSTS = [600, 1200, 2000, 3200, 5000];
export const UPGRADES = [
  { id: 'engine', name: 'POWER UNIT', icon: '⚙', desc: 'More horsepower. Higher top speed and faster acceleration out of corners.', per: '+2.5% power', apply: (s, l) => { s.power *= 1 + 0.025 * l; } },
  { id: 'fuel', name: 'FUEL TANK', icon: '⛽', desc: 'Lightweight fuel cell. A lighter car accelerates, brakes and turns better.', per: '−6 kg weight', apply: (s, l) => { s.mass -= 6 * l; s.Iz *= 1 - 0.006 * l; } },
  { id: 'aero', name: 'AERODYNAMICS', icon: '✈', desc: 'New front and rear wings. More downforce means more grip in fast corners.', per: '+3% downforce', apply: (s, l) => { s.ClA *= 1 + 0.03 * l; s.CdA *= 1 + 0.004 * l; } },
  { id: 'brakes', name: 'BRAKES', icon: '◎', desc: 'Carbon brake upgrade. Stop harder and brake later into corners.', per: '+6% brake force', apply: (s, l) => { s.maxBrake *= 1 + 0.06 * l; } },
  { id: 'tyres', name: 'TYRE PACKAGE', icon: '◉', desc: 'Better tyre warm-up and suspension. More grip everywhere, slower wear.', per: '+1.5% grip', apply: (s, l) => { s.mu *= 1 + 0.015 * l; s.wearRate = (s.wearRate || 1) * (1 - 0.08 * l); } },
  { id: 'ers', name: 'ERS BATTERY', icon: '⚡', desc: 'Bigger battery and motor. Longer and stronger electric overtake boost.', per: '+12 kW · +0.4 MJ', apply: (s, l) => { s.ersPower += 12000 * l; s.ersMax = (s.ersMax || 4e6) + 0.4e6 * l; } },
];

export const progress = {
  get coins() { return state.coins; },
  level(id) { return state.up[id] || 0; },
  cost(id) { const l = this.level(id); return l >= COSTS.length ? null : COSTS[l]; },
  buy(id) {
    const c = this.cost(id);
    if (c == null || state.coins < c) return false;
    state.coins -= c; state.up[id] = this.level(id) + 1; save(); emit();
    return true;
  },
  add(n) { state.coins += Math.round(n); save(); emit(); },
  onChange(f) { listeners.add(f); },
  applyTo(spec) { for (const u of UPGRADES) { const l = this.level(u.id); if (l) u.apply(spec, l); } return spec; },
};

// race reward breakdown
const POS_REWARD = [1000, 800, 650, 520, 430, 360, 300, 250, 210, 180];
export function raceReward({ pos, laps, aiSkill, fastestLap, gained, handling }) {
  const items = [];
  const lapF = Math.max(0.4, Math.min(2, laps / 5));
  const skillF = aiSkill < 0.88 ? 0.8 : aiSkill < 0.93 ? 1 : aiSkill < 0.97 ? 1.25 : 1.6;
  const handF = handling === 'hard' ? 1.3 : handling === 'medium' ? 1.1 : 1;
  items.push([`Finished P${pos}`, Math.round((POS_REWARD[pos - 1] || 120) * lapF)]);
  if (skillF !== 1) items.push([`AI difficulty ×${skillF}`, Math.round(items[0][1] * (skillF - 1))]);
  if (handF !== 1) items.push([`${handling.toUpperCase()} handling ×${handF}`, Math.round(items[0][1] * (handF - 1))]);
  if (fastestLap) items.push(['Fastest lap', 150]);
  if (gained > 0) items.push([`${gained} places gained`, gained * 25]);
  return { items, total: items.reduce((a, b) => a + b[1], 0) };
}

// Player handling difficulty: surface grip/drag overrides + steering help
export const HANDLING = {
  easy: { name: 'EASY', grip: 1.1, steerBoost: 1.3, counter: 1.4, surf: { runoff: [0.98, 0.0], grass: [0.93, 0.015], gravel: [0.9, 0.03], kerb: [0.98, 0.0] } },
  medium: { name: 'MEDIUM', grip: 1.02, steerBoost: 1.1, counter: 1.0, surf: { runoff: [0.92, 0.02], grass: [0.75, 0.05], gravel: [0.66, 0.12], kerb: [0.95, 0.01] } },
  hard: { name: 'HARD', grip: 1.0, steerBoost: 1.0, counter: 0.8, surf: null },
};
