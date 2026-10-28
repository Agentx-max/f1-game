// Player-customisable keyboard / gamepad bindings, saved in localStorage.
// Shape: { [actionId]: { keys: [code|null, code|null], pad: buttonIndex|null } }
const STORE = 'f1gp.keys';

// padFixed: analog gamepad control that cannot be rebound (triggers / left stick)
export const ACTIONS = [
  { id: 'throttle', label: 'Throttle', group: 'DRIVING', padFixed: 'RT' },
  { id: 'brake', label: 'Brake / reverse', group: 'DRIVING', padFixed: 'LT' },
  { id: 'left', label: 'Steer left', group: 'DRIVING', padFixed: 'STICK' },
  { id: 'right', label: 'Steer right', group: 'DRIVING', padFixed: 'STICK' },
  { id: 'shiftUp', label: 'Shift up', group: 'DRIVING' },
  { id: 'shiftDown', label: 'Shift down', group: 'DRIVING' },
  { id: 'drs', label: 'DRS rear wing', group: 'RACE' },
  { id: 'ers', label: 'ERS boost (hold)', group: 'RACE' },
  { id: 'box', label: 'Pit stop (box)', group: 'RACE' },
  { id: 'help', label: 'Call marshals when stuck', group: 'RACE' },
  { id: 'lookBack', label: 'Look behind (hold)', group: 'VIEW & SYSTEM' },
  { id: 'camera', label: 'Change camera', group: 'VIEW & SYSTEM' },
  { id: 'standings', label: 'Show / hide standings', group: 'VIEW & SYSTEM' },
  { id: 'line', label: 'Racing line on / off', group: 'VIEW & SYSTEM' },
  { id: 'hud', label: 'Hide HUD', group: 'VIEW & SYSTEM' },
  { id: 'mute', label: 'Mute sound', group: 'VIEW & SYSTEM' },
  { id: 'pause', label: 'Pause', group: 'VIEW & SYSTEM' },
];

// [key 1, key 2, gamepad button (standard mapping)]
const DEFAULTS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  shiftUp: ['KeyE', null, 0], shiftDown: ['KeyQ', null, 2],
  drs: ['KeyF', 'Space', 1], ers: ['ShiftLeft', 'ShiftRight', 5], box: ['KeyY', null, 8], help: ['KeyG', null, 10],
  lookBack: ['KeyB', null, 4], camera: ['KeyC', null, 3], standings: ['KeyT'], line: ['KeyL'], hud: ['KeyH'], mute: ['KeyM'],
  pause: ['Escape', 'KeyP', 9],
};

export function defaultBindings() {
  const b = {};
  for (const a of ACTIONS) {
    const [k1 = null, k2 = null, pad = null] = DEFAULTS[a.id];
    b[a.id] = { keys: [k1, k2], pad };
  }
  return b;
}

// saved bindings merged over the defaults; actions added later get their defaults unless those are already taken
export function loadBindings() {
  const b = defaultBindings();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { /* missing or corrupt */ }
  if (!saved || typeof saved !== 'object') return b;
  const keys = new Set(), pads = new Set(), fresh = [];
  for (const a of ACTIONS) {
    const s = saved[a.id];
    if (!s || typeof s !== 'object') { fresh.push(a.id); continue; }
    const B = b[a.id];
    if (Array.isArray(s.keys)) B.keys = [0, 1].map(i => typeof s.keys[i] === 'string' && s.keys[i] ? s.keys[i] : null);
    if (!a.padFixed && (s.pad === null || Number.isInteger(s.pad))) B.pad = s.pad;
    B.keys.forEach(k => k && keys.add(k));
    if (B.pad != null) pads.add(B.pad);
  }
  for (const id of fresh) {
    b[id].keys = b[id].keys.map(k => keys.has(k) ? null : k);
    if (pads.has(b[id].pad)) b[id].pad = null;
  }
  return b;
}

export function saveBindings(b) {
  try { localStorage.setItem(STORE, JSON.stringify(b)); } catch (e) { /* storage full or blocked */ }
}

const NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB',
  Backspace: 'BKSP', CapsLock: 'CAPS', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT', MetaLeft: 'L-META', MetaRight: 'R-META', ContextMenu: 'MENU',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', PageUp: 'PG UP', PageDown: 'PG DN', Home: 'HOME', End: 'END',
  Insert: 'INS', Delete: 'DEL', NumpadEnter: 'NUM ENTER', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  let m = /^(?:Key|Digit)(\w)$/.exec(code);
  if (m) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'NUM ' + m[1];
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toUpperCase();
}

const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT'];
export const padLabel = i => i == null ? '—' : PAD[i] || 'BTN ' + i;

// the game's Input instance, so the menus can rebind it without main.js passing it around
let input = null;
export const registerInput = inp => { input = inp; };
export const getInput = () => input;
