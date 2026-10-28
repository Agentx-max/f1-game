// Keyboard + gamepad input with smoothing for digital steering. Keys and buttons come from js/keybinds.js.
import { loadBindings, defaultBindings, registerInput } from './keybinds.js';

// edge-triggered actions (output field = binding id) and their on-screen touch button
const EDGE = { shiftUp: 'up', shiftDown: 'down', drs: 'drs', camera: 'cam', standings: 'list', pause: 'pause', help: 'help', box: 'box', mute: null, hud: null, line: null };
const NAV = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
// text fields keep their keys (range sliders, buttons etc. do not)
const isField = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(t.type)));

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.usingPad = false;
    this._capturing = false;
    this.padPrev = [];
    this.setBindings(loadBindings());
    registerInput(this);
    addEventListener('keydown', e => {
      if (this.capturing || (isField(e.target) && e.code !== 'Escape')) return;
      if (NAV.has(e.code) || (this.bound.has(e.code) && !e.ctrlKey && !e.metaKey)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // touch
    this.touch = { left: false, right: false, thr: false, brk: false, ers: false, look: false };
    this.touchMode = 'buttons';
    this.tiltInvert = false;
    this.tilt = 0;
    this.usingTouch = false;
    addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
      const raw = (ang === 90 ? -1 : 1) * e.beta;
      this.tilt = Math.max(-1, Math.min(1, raw / 22)) * (this.tiltInvert ? -1 : 1);
    });
  }

  setBindings(b) {
    this.bindings = Object.assign(defaultBindings(), b);
    this.bound = new Set(Object.values(this.bindings).flatMap(a => a.keys).filter(Boolean));
  }

  // set by the rebinding UI while it waits for a key / button: no action fires, and a button
  // still held when it ends does not count as a fresh press
  get capturing() { return this._capturing; }
  set capturing(v) {
    this._capturing = !!v;
    const p = this.pad();
    this.padPrev = p ? Array.from(p.buttons, b => !!(b && b.pressed)) : [];
    this.pressed.clear();
  }

  // Bind on-screen buttons: elements with data-t="left|right|thr|brk|ers|look|drs|cam|pause"
  bindTouch(root) {
    const edgeKeys = ['drs', 'cam', 'pause', 'help', 'box', 'up', 'down', 'list'];
    root.querySelectorAll('[data-t]').forEach(el => {
      const k = el.dataset.t;
      const down = e => {
        e.preventDefault();
        el.classList.add('on');
        this.usingTouch = true; this.usingPad = false;
        if (edgeKeys.includes(k)) this.pressed.add('T_' + k); else this.touch[k] = true;
        if (navigator.vibrate && (k === 'drs' || k === 'ers')) navigator.vibrate(15);
      };
      const up = e => { e.preventDefault(); el.classList.remove('on'); if (k in this.touch) this.touch[k] = false; };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  // action held / just pressed on the keyboard
  key(id) { return this.bindings[id].keys.some(c => c && this.keys.has(c)); }
  hit(id) { return this.bindings[id].keys.some(c => c && this.pressed.has(c)); }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt) {
    const p = this.pad();
    const out = { steer: 0, throttle: 0, brake: 0, shiftUp: false, shiftDown: false, drs: false, ers: false, camera: false, lookBack: false, pause: false, standings: false, help: false, box: false, mute: false, hud: false, line: false };
    const down = p ? Array.from(p.buttons, b => !!(b && b.pressed)) : [], was = this.padPrev;
    this.padPrev = down;
    if (this.capturing) { this.pressed.clear(); this.steer = this.throttle = this.brake = 0; return out; }
    const B = this.bindings;
    const padHeld = id => B[id].pad != null && !!down[B[id].pad];
    const padHit = id => padHeld(id) && !was[B[id].pad];
    let padActive = false;
    if (p) {
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) { padActive = true; this.usingPad = true; }
      if (this.usingPad) {
        const dz = 0.06;
        const a = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
        out.steer = -Math.sign(a) * Math.pow(Math.abs(a), 1.6);
        out.throttle = rt; out.brake = lt;
      }
    }
    if (!padActive && !this.usingPad) {
      const T = this.touch;
      const kl = this.key('left'), kr = this.key('right');
      const left = kl || T.left, right = kr || T.right;
      if (this.usingTouch && this.touchMode === 'tilt' && !kl && !kr) {
        const target = Math.sign(this.tilt) * Math.pow(Math.abs(this.tilt), 1.3);
        this.steer += (target - this.steer) * Math.min(1, dt * 14);
      } else {
        const target = (left ? 1 : 0) - (right ? 1 : 0);
        const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.2);
        const d = target - this.steer;
        this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      }
      out.steer = this.steer;
      const up = this.key('throttle') || T.thr, dn = this.key('brake') || T.brk;
      this.throttle += ((up ? 1 : 0) - this.throttle) * Math.min(1, dt * (up ? 9 : 14));
      this.brake += ((dn ? 1 : 0) - this.brake) * Math.min(1, dt * (dn ? 14 : 18));
      out.throttle = this.throttle; out.brake = this.brake;
    } else {
      this.steer = out.steer;
    }
    for (const id in EDGE) if (this.hit(id) || padHit(id) || (EDGE[id] && this.pressed.has('T_' + EDGE[id]))) out[id] = true;
    if (this.key('ers') || padHeld('ers') || this.touch.ers) out.ers = true;
    if (this.key('lookBack') || padHeld('lookBack') || this.touch.look) out.lookBack = true;
    if (this.pressed.has('Escape')) out.pause = true; // Esc always pauses, even when unbound
    this.pressed.clear();
    return out;
  }
}
