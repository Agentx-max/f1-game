// Synthesised audio: V12 engine (firing-order harmonics, rasp, overrun crackle), turbo/ERS whine,
// tyre squeal, wind, kerb rumble, impacts, rain and thunder.
const ctx_bp = (ctx, f, q) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.player = this._engineVoice(1.0);
    this.other = this._engineVoice(0.0);

    // turbo whine
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master); this.turbo.start();

    // tyre squeal
    this.squeal = this._noise(); this.squealF = ctx.createBiquadFilter();
    this.squealF.type = 'bandpass'; this.squealF.frequency.value = 1500; this.squealF.Q.value = 8;
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    this.squeal.connect(this.squealF).connect(this.squealG).connect(this.master);

    // wind
    this.wind = this._noise(); this.windF = ctx.createBiquadFilter();
    this.windF.type = 'lowpass'; this.windF.frequency.value = 600;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF).connect(this.windG).connect(this.master);

    // kerb / surface rumble
    this.rumble = ctx.createOscillator(); this.rumble.type = 'square'; this.rumble.frequency.value = 28;
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 180;
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0;
    this.rumble.connect(this.rumbleF).connect(this.rumbleG).connect(this.master); this.rumble.start();
    this.gravel = this._noise(); this.gravelF = ctx.createBiquadFilter(); this.gravelF.type = 'lowpass'; this.gravelF.frequency.value = 900;
    this.gravelG = ctx.createGain(); this.gravelG.gain.value = 0;
    this.gravel.connect(this.gravelF).connect(this.gravelG).connect(this.master);
  }

  _noise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.start();
    return src;
  }

  // V12 voice. A 12-cylinder four-stroke fires 6 times per crank turn, so the scream is the 6th
  // engine order. The custom wave's fundamental is half an engine order (cam speed), which lets us
  // add the 3rd-order bank beat and rough half-orders that make it sound mechanical, not synthetic.
  _v12Wave(onThrottle) {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      const order = n / 2;
      let a;
      if (order % 6 === 0) a = (onThrottle ? 1.0 : 0.7) / Math.pow(order / 6, onThrottle ? 0.55 : 1.1); // firing orders
      else if (order % 3 === 0) a = onThrottle ? 0.32 : 0.45; // bank-to-bank beat
      else if (Number.isInteger(order)) a = (onThrottle ? 0.09 : 0.16) / Math.sqrt(order); // crank orders
      else a = onThrottle ? 0.035 : 0.07; // half orders
      im[n] = a * (n % 4 === 1 ? 1 : n % 4 === 3 ? -1 : 0.6);
      re[n] = a * 0.3;
    }
    return this.ctx.createPeriodicWave(re, im);
  }

  _engineVoice(level) {
    const ctx = this.ctx;
    if (!this.waves) this.waves = { on: this._v12Wave(true), off: this._v12Wave(false) };
    const out = ctx.createGain(); out.gain.value = 0;
    const mk = wave => { const o = ctx.createOscillator(); o.setPeriodicWave(wave); const g = ctx.createGain(); g.gain.value = 0; o.connect(g); o.start(); return { o, g }; };
    const on = mk(this.waves.on), off = mk(this.waves.off), bank = mk(this.waves.on); // bank = detuned 2nd cylinder bank
    const pre = ctx.createGain(); pre.gain.value = 0.55;
    on.g.connect(pre); off.g.connect(pre); bank.g.connect(pre);
    // exhaust rasp: noise focused around the firing frequency
    const rasp = this._noise(); const raspF = ctx.createBiquadFilter(); raspF.type = 'bandpass'; raspF.Q.value = 3;
    const raspG = ctx.createGain(); raspG.gain.value = 0;
    rasp.connect(raspF).connect(raspG).connect(pre);
    // combustion pulse wobble at crank speed
    const am = ctx.createOscillator(); am.type = 'triangle';
    const amG = ctx.createGain(); amG.gain.value = 0.12;
    am.connect(amG).connect(pre.gain); am.start();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 1.8) * 0.9 + x * 0.1; }
    shaper.curve = curve; shaper.oversample = '2x';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 900; body.Q.value = 0.8; body.gain.value = 3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9; lp.frequency.value = 3000;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    pre.connect(shaper).connect(hp).connect(body).connect(lp).connect(out);
    if (panner) out.connect(panner).connect(this.master); else out.connect(this.master);
    return { out, on, off, bank, raspF, raspG, am, body, lp, panner, level, lastThr: 0 };
  }

  _crackle(n) { // overrun pops through the exhaust
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let k = 0; k < n; k++) {
      const t = t0 + 0.03 + k * (0.035 + Math.random() * 0.07);
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 900; f.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14 + Math.random() * 0.16, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.07);
    }
  }

  // physics rpm (12.5k limit) is mapped onto a 90s-style V12 range (~18k rpm) for the sound
  _setEngine(v, rpm, throttle, gain, pan = 0) {
    const t = this.ctx.currentTime;
    const srpm = 2600 + rpm * 1.25;
    const cam = srpm / 120, fire = srpm / 60 * 6;
    const load = Math.min(1, throttle * 1.15);
    v.on.o.frequency.setTargetAtTime(cam, t, 0.012);
    v.off.o.frequency.setTargetAtTime(cam, t, 0.012);
    v.bank.o.frequency.setTargetAtTime(cam * 1.004, t, 0.012);
    v.on.g.gain.setTargetAtTime(0.25 + load * 0.75, t, 0.03);
    v.off.g.gain.setTargetAtTime(0.65 * (1 - load) + 0.1, t, 0.03);
    v.bank.g.gain.setTargetAtTime(0.35 * load, t, 0.04);
    v.am.frequency.setTargetAtTime(srpm / 60, t, 0.02);
    v.raspF.frequency.setTargetAtTime(fire * 1.5, t, 0.02);
    v.raspG.gain.setTargetAtTime(0.05 + load * 0.22, t, 0.04);
    v.body.frequency.setTargetAtTime(Math.min(4000, fire * 0.9), t, 0.03);
    v.lp.frequency.setTargetAtTime(Math.min(11000, 1100 + load * 3800 + srpm * 0.32), t, 0.03);
    v.out.gain.setTargetAtTime(gain, t, 0.04);
    if (v.panner) v.panner.pan.setTargetAtTime(pan, t, 0.05);
    if (v === this.player && v.lastThr > 0.6 && throttle < 0.2 && rpm > 8500 && gain > 0.01) this._crackle(5 + Math.floor(Math.random() * 6));
    v.lastThr = throttle;
  }

  // ------------------------------------------------------------------ team radio
  // F1-style courtesy tone: a short two-tone electronic chirp, then a burst of squelch.
  _tone(freqs, t0, len, vol, type = 'square') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    freqs.forEach(([f, dt]) => o.frequency.setValueAtTime(f, t0 + dt));
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.setValueAtTime(vol, t0 + len - 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    o.connect(bp).connect(g).connect(this.master); o.start(t0); o.stop(t0 + len + 0.02);
  }
  _squelch(t0, len, vol) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    s.connect(f).connect(g).connect(this.master); s.start(t0, Math.random()); s.stop(t0 + len + 0.02);
  }
  radioOpen() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.01;
    this._squelch(t, 0.07, 0.09);
    this._tone([[1470, 0], [1960, 0.075]], t + 0.05, 0.16, 0.13);
    this._ducking(true);
  }
  radioClose() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.01;
    this._tone([[1960, 0], [1470, 0.06]], t, 0.12, 0.1);
    this._squelch(t + 0.12, 0.16, 0.12);
    this._ducking(false);
  }
  // engine and effects dip while the engineer talks so the message is easy to hear
  _ducking(on) { if (this.master) this.master.gain.setTargetAtTime(this.volume * (on ? 0.55 : 1), this.ctx.currentTime, 0.15); }
  // band-limited, slightly distorted path for recorded voice clips
  radioInput() {
    if (!this.radioIn) {
      const ctx = this.ctx;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3300;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 5;
      const sh = ctx.createWaveShaper(); const c = new Float32Array(512);
      for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 2.2); }
      sh.curve = c;
      const g = ctx.createGain(); g.gain.value = 1.9; // overcome ducking
      hp.connect(lp).connect(pk).connect(sh).connect(g).connect(ctx.destination);
      this.radioIn = hp;
    }
    return this.radioIn;
  }
  radioStatic(on) {
    if (!this.ctx) return;
    if (!this.staticG) {
      const s = this._noise(); const f = ctx_bp(this.ctx, 2600, 0.5);
      this.staticG = this.ctx.createGain(); this.staticG.gain.value = 0;
      s.connect(f).connect(this.staticG).connect(this.ctx.destination);
    }
    this.staticG.gain.setTargetAtTime(on && this.enabled ? 0.012 * this.volume : 0, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ weather
  setRain(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.rainG) {
      this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
      const hiss = this._noise(); const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2500;
      const hg = ctx.createGain(); hg.gain.value = 0.35;
      hiss.connect(hf).connect(hg).connect(this.rainG);
      const pat = this._noise(); const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 700; pf.Q.value = 0.7;
      const pg = ctx.createGain(); pg.gain.value = 0.5;
      pat.connect(pf).connect(pg).connect(this.rainG);
      this.rainG.connect(this.master);
      // tyres hissing through standing water
      this.wetHiss = this._noise(); this.wetF = ctx.createBiquadFilter(); this.wetF.type = 'bandpass'; this.wetF.frequency.value = 3500; this.wetF.Q.value = 0.8;
      this.wetG = ctx.createGain(); this.wetG.gain.value = 0;
      this.wetHiss.connect(this.wetF).connect(this.wetG).connect(this.master);
    }
    this.raining = on;
    this.rainG.gain.setTargetAtTime(on ? 0.075 : 0, t, 0.6);
    if (!on) this.wetG.gain.setTargetAtTime(0, t, 0.2);
  }

  // thunder: a sharp crack for close strikes, then a long rolling rumble
  thunder(dist = 0.6) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, near = 1 - dist;
    if (near > 0.35) {
      const c = ctx.createBufferSource(); c.buffer = this.noiseBuf;
      const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 900;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.5 * near, t + 0.01); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      c.connect(cf).connect(cg).connect(this.master); c.start(t, Math.random()); c.stop(t + 0.5);
    }
    const dur = 3.5 + dist * 3;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(420 - dist * 200, t); lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85 - dist * 0.4, t + 0.25 + dist * 0.4);
    for (let tt = t + 0.6; tt < t + dur - 0.5; tt += 0.4 + Math.random() * 0.7) g.gain.setTargetAtTime((0.25 + Math.random() * 0.5) * (1 - (tt - t) / dur), tt, 0.25);
    g.gain.setTargetAtTime(0.0001, t + dur - 0.5, 0.4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = (Math.random() - 0.5) * 1.2;
    src.connect(lp).connect(g);
    if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.5);
  }

  update(state) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const { rpm, throttle, speed, slip, surface, ers, other, inCockpit, paused } = state;
    const mute = paused ? 0 : 1;
    this._setEngine(this.player, rpm, throttle, mute * (0.13 + throttle * 0.17 + rpm / 12500 * 0.06) * (inCockpit ? 1.15 : 0.9));
    if (this.wetG) {
      this.wetG.gain.setTargetAtTime(this.raining ? mute * Math.min(0.12, speed / 500) : 0, t, 0.1);
      this.wetF.frequency.setTargetAtTime(1800 + speed * 25, t, 0.2);
      if (this.rainG && this.raining) this.rainG.gain.setTargetAtTime(paused ? 0.03 : 0.075, t, 0.3);
    }
    this.turbo.frequency.setTargetAtTime(2500 + rpm * 0.55, t, 0.05);
    this.turboGain.gain.setTargetAtTime(mute * (0.006 + throttle * 0.012 + (ers ? 0.01 : 0)), t, 0.1);
    this.squealG.gain.setTargetAtTime(mute * Math.min(0.25, Math.max(0, slip - 0.25) * 0.5) * Math.min(1, speed / 10), t, 0.05);
    this.squealF.frequency.setTargetAtTime(1200 + Math.min(1, slip) * 600, t, 0.1);
    this.windG.gain.setTargetAtTime(mute * Math.min(0.18, speed * speed / 50000), t, 0.1);
    this.windF.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    const kerb = surface === 'kerb' ? 1 : 0;
    this.rumbleG.gain.setTargetAtTime(mute * kerb * Math.min(0.25, speed / 120), t, 0.02);
    this.rumble.frequency.setTargetAtTime(10 + speed * 0.9, t, 0.05);
    const rough = surface === 'gravel' ? 0.35 : surface === 'grass' ? 0.15 : 0;
    this.gravelG.gain.setTargetAtTime(mute * rough * Math.min(1, speed / 20), t, 0.05);
    if (other) {
      const g = mute * Math.min(0.22, 6 / (other.dist + 4)) * (0.4 + other.throttle * 0.6);
      // doppler-ish pitch shift
      this._setEngine(this.other, other.rpm * (1 + other.closing / 343), other.throttle, g, other.pan);
    } else this.other.out.gain.setTargetAtTime(0, t, 0.1);
  }

  impact(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + strength * 60;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.9, strength * 0.06), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.4);
  }

  beep(high) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = high ? 1320 : 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  shift() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.08);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
