// Keyboard + gamepad input with smoothing for digital steering.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.usingPad = false;
    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
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

  // Bind on-screen buttons: elements with data-t="left|right|thr|brk|ers|look|drs|cam|pause"
  bindTouch(root) {
    const edgeKeys = ['drs', 'cam', 'pause', 'reset', 'help', 'box', 'up', 'down', 'list'];
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

  key(...codes) { return codes.some(c => this.keys.has(c)); }
  hit(code) { return this.pressed.has(code); }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt) {
    const p = this.pad();
    const out = { steer: 0, throttle: 0, brake: 0, shiftUp: false, shiftDown: false, drs: false, ers: false, camera: false, lookBack: false, reset: false, pause: false };
    let padActive = false;
    if (p) {
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      const btn = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const edge = i => { const now = btn(i); const was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; };
      if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) { padActive = true; this.usingPad = true; }
      if (this.usingPad) {
        const dz = 0.06;
        const a = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
        out.steer = -Math.sign(a) * Math.pow(Math.abs(a), 1.6);
        out.throttle = rt; out.brake = lt;
      }
      if (edge(0)) out.shiftUp = true;
      if (edge(2)) out.shiftDown = true;
      if (edge(3)) out.camera = true;
      if (edge(1)) out.drs = true;
      if (btn(5)) out.ers = true;
      if (btn(4)) out.lookBack = true;
      if (edge(9)) out.pause = true;
      if (edge(8)) out.reset = true;
    }
    if (!padActive && !this.usingPad) {
      const T = this.touch;
      const left = this.key('ArrowLeft', 'KeyA') || T.left, right = this.key('ArrowRight', 'KeyD') || T.right;
      if (this.usingTouch && this.touchMode === 'tilt' && !this.key('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD')) {
        const target = Math.sign(this.tilt) * Math.pow(Math.abs(this.tilt), 1.3);
        this.steer += (target - this.steer) * Math.min(1, dt * 14);
      } else {
        const target = (left ? 1 : 0) - (right ? 1 : 0);
        const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.2);
        const d = target - this.steer;
        this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
      }
      out.steer = this.steer;
      const up = this.key('ArrowUp', 'KeyW') || T.thr, down = this.key('ArrowDown', 'KeyS') || T.brk;
      this.throttle += ((up ? 1 : 0) - this.throttle) * Math.min(1, dt * (up ? 9 : 14));
      this.brake += ((down ? 1 : 0) - this.brake) * Math.min(1, dt * (down ? 14 : 18));
      out.throttle = this.throttle; out.brake = this.brake;
    } else {
      this.steer = out.steer;
    }
    if (this.hit('KeyE') || this.hit('T_up')) out.shiftUp = true;
    if (this.hit('KeyQ') || this.hit('T_down')) out.shiftDown = true;
    if (this.hit('KeyT') || this.hit('T_list')) out.standings = true;
    if (this.hit('KeyC')) out.camera = true;
    if (this.hit('KeyF') || this.hit('Space')) out.drs = true;
    if (this.key('ShiftLeft', 'ShiftRight') || this.touch.ers) out.ers = true;
    if (this.key('KeyB') || this.touch.look) out.lookBack = true;
    if (this.hit('KeyR') || this.hit('T_reset')) out.reset = true;
    if (this.hit('Escape') || this.hit('KeyP') || this.hit('T_pause')) out.pause = true;
    if (this.hit('T_drs')) out.drs = true;
    if (this.hit('T_cam')) out.camera = true;
    if (this.hit('KeyG') || this.hit('T_help')) out.help = true;
    if (this.hit('KeyY') || this.hit('T_box')) out.box = true;
    if (this.hit('KeyM')) out.mute = true;
    if (this.hit('KeyH')) out.hud = true;
    if (this.hit('KeyL')) out.line = true;
    this.pressed.clear();
    return out;
  }
}
