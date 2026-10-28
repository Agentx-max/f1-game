// Team radio: the race engineer talks to you like on a real F1 broadcast.
// - Courtesy beep + squelch when the channel opens and closes, radio static under the voice.
// - Voice: recorded clips in /radio/<id>.mp3 (listed in /radio/manifest.json) are played through a
//   radio filter; without recordings the browser's built-in speech voice is used.
// - On-screen "TEAM RADIO" graphic, synced to the audio in real time: the waveform follows the actual
//   voice level (AnalyserNode) and the transcript lights up word by word with the clip's playback position.

export const RADIO_LINES = {
  drs: "DRS enabled. You're free to use it.",
  lap1: 'Keep it clean. Plenty of time to settle in.',
  box: 'Box, box. Box this lap. Switch to the hard tyres.',
  hardBest: 'We think the hard tyre is the fastest option.',
  pitEntry: 'Pit entry this lap. Watch the line. Speed limiter on.',
  pitExit: "You're clear. Watch for traffic on the exit.",
  finalLap: 'Final lap. Give it everything.',
  tyreTemp: 'Tyre temperatures are getting high. Manage the fronts.',
  tyreWear: "We're seeing some degradation. Look after the tyres.",
  tyreGood: 'Tyres are looking good. You can push.',
  brakeTemp: 'Brake temperatures are climbing. Give them some air.',
  fuelSave: "We're a little tight on fuel. Lift and coast where possible.",
  fuelCritical: 'Fuel critical. We need you to save fuel now.',
  fuelOk: 'Fuel target achieved. You can push again.',
  damage: "We're seeing damage on the front wing. How does the car feel?",
  lowGrip: 'Grip is low through the final sector. Be careful.',
  rainSoon: 'Rain expected in three minutes. Keep an eye on the radar.',
  drying: 'Track is drying quickly. Slicks could be an option soon.',
  // Max Verstappen race win (engineer, then Max's reply)
  maxWin: 'Well done Max, you absolutely deserved that one.',
  simplyLovely: 'Simply lovely!',
};

// who is on the mic for each line (default: the race engineer)
const SPEAKER = { simplyLovely: 'driver' };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TeamRadio {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.queue = []; this.current = null; this.last = {}; this.gap = 0;
    this.clips = null; this.buffers = {}; this.raw = {}; this.windows = {};
    this.voice = null;
    this.token = 0; this.cut = null; this.clock = null;
    this.victoryActive = false;
    this.el = document.getElementById('radio');
    this.bars = [...this.el.querySelectorAll('.rd-wave i')];
    this.textEl = this.el.querySelector('.rd-text');
    this.spkEl = this.el.querySelector('.rd-spk');
    this.words = []; this.wordAt = [];
    this.freq = null;
    this.ready = this.loadManifest();
    if ('speechSynthesis' in window) {
      const pick = () => { this.voice = pickVoice(speechSynthesis.getVoices()); };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  async loadManifest() {
    try {
      const r = await fetch('radio/manifest.json', { cache: 'no-cache' });
      this.clips = r.ok ? new Set(await r.json()) : new Set();
    } catch { this.clips = new Set(); }
    // download every clip up front: a message must never wait for the network
    await Promise.all([...this.clips].map(id => this.fetchClip(id)));
    this.decodeAll();
  }

  fetchClip(id) {
    if (!this.raw[id]) this.raw[id] = fetch(`radio/${id}.mp3`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    return this.raw[id];
  }

  // decode once the AudioContext exists (after the first tap) so playback starts with the graphic
  decodeAll() {
    if (!this.audio.ctx || !this.clips) return;
    for (const id of this.clips) this.decode(id).catch(() => {});
  }

  decode(id) {
    if (this.buffers[id]) return this.buffers[id];
    const ctx = this.audio.ctx;
    if (!ctx) return Promise.reject(new Error('no audio'));
    this.buffers[id] = this.fetchClip(id).then(ab => {
      if (!ab) throw new Error('missing clip ' + id);
      return ctx.decodeAudioData(ab.slice(0));
    }).then(buf => { this.windows[id] = speechWindow(buf); return buf; });
    this.buffers[id].catch(() => { delete this.buffers[id]; });
    return this.buffers[id];
  }

  // iOS / Safari only allow speech after a tap: call this from the START button
  unlock() {
    if ('speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ } }
    this.ready.then(() => this.decodeAll());
  }

  setDriver({ name, num, team, color }) {
    this.el.style.setProperty('--tc', color);
    this.el.querySelector('.rd-name').textContent = name.toUpperCase();
    this.el.querySelector('.rd-num').textContent = num;
    this.el.querySelector('.rd-team').textContent = team.toUpperCase();
  }

  // priority: 3 = urgent (box / fuel critical), 2 = strategy, 1 = info. cooldown in seconds per message id
  say(id, { priority = 1, cooldown = 40, chain = null } = {}) {
    if (!this.enabled || !RADIO_LINES[id]) return false;
    const now = performance.now() / 1000;
    if (this.last[id] && now - this.last[id] < cooldown) return false;
    if (this.queue.some(q => q.id === id) || this.current?.id === id) return false;
    this.last[id] = now;
    this.queue.push({ id, priority, t: now, chain });
    this.queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
    if (this.queue.length > 4) this.queue.length = 4;
    return true;
  }

  // the player won the race as Max Verstappen: cut whatever is on air, then the engineer's
  // congratulations followed by Max's reply, in one radio window
  victory() {
    if (!this.enabled) return false;
    this.queue.length = 0;
    if (this.current) { // abort the message on air right now
      this.token++;
      this.cut?.(); this.cut = null; this.clock = null;
      this.audio.radioStatic(false); this.audio.radioClose();
      this.el.classList.remove('talking');
      this.current = null;
    }
    this.victoryActive = true;
    this.queue.push({ id: 'maxWin', priority: 9, t: performance.now() / 1000, chain: ['simplyLovely'], victory: true });
    return true;
  }

  // true while the victory radio is queued or on air (results wait for it)
  get busy() { return this.victoryActive; }

  update(dt, paused) {
    if (this.current && this.current.talking) this.animate();
    if (this.current || (paused && !this.victoryActive)) return;
    this.gap -= dt;
    if (!this.queue.length || (this.gap > 0 && !this.queue[0].victory)) return;
    const now = performance.now() / 1000;
    // info messages that waited too long are no longer relevant
    while (this.queue.length && this.queue[0].priority < 3 && now - this.queue[0].t > 12) this.queue.shift();
    const m = this.queue.shift();
    if (m) this.play(m);
  }

  // waveform + caption, driven by the real playback position every frame
  animate() {
    const c = this.clock;
    if (!c) return;
    const p = c.progress();
    if (c.analyser) {
      const a = c.analyser, f = this.freq && this.freq.length === a.frequencyBinCount ? this.freq : (this.freq = new Uint8Array(a.frequencyBinCount));
      a.getByteFrequencyData(f);
      const n = this.bars.length, hz = a.context.sampleRate / a.fftSize;
      this.bars.forEach((b, k) => {
        // log-spaced voice bands 160 Hz .. 4.5 kHz
        const lo = Math.max(1, Math.floor(160 * Math.pow(4500 / 160, k / n) / hz));
        const hi = Math.max(lo + 1, Math.floor(160 * Math.pow(4500 / 160, (k + 1) / n) / hz));
        let s = 0; for (let i = lo; i < hi; i++) s += f[i];
        const v = Math.min(1, (s / (hi - lo)) / 200);
        b.style.transform = `scaleY(${(0.12 + v * 0.88).toFixed(2)})`;
      });
    } else { // browser speech: no audio signal available, animate while it talks
      const tt = performance.now() / 1000;
      this.bars.forEach((b, k) => { const v = 0.25 + Math.abs(Math.sin(tt * (11 + k * 1.7) + k)) * (0.4 + Math.random() * 0.45); b.style.transform = `scaleY(${v.toFixed(2)})`; });
    }
    this.reveal(p);
  }

  reveal(p) {
    for (let i = 0; i < this.words.length; i++) {
      const on = p >= this.wordAt[i];
      if (on !== this.words[i]._on) { this.words[i]._on = on; this.words[i].classList.toggle('on', on); }
    }
  }

  // transcript as word spans; each word lights up at its share of the spoken text
  setCaption(id) {
    const text = RADIO_LINES[id], driver = SPEAKER[id] === 'driver';
    const parts = text.split(/\s+/);
    this.textEl.innerHTML = '“' + parts.map(w => `<span class="w">${esc(w)}</span>`).join(' ') + '”';
    this.words = [...this.textEl.querySelectorAll('.w')];
    const weight = parts.map(w => w.length + 1.5 + (/[.,!?]$/.test(w) ? 3 : 0));
    const total = weight.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.wordAt = weight.map(w => { const s = acc / total; acc += w; return s; });
    this.el.classList.toggle('driver', driver);
    if (this.spkEl) this.spkEl.textContent = driver ? 'DRIVER' : 'RACE ENGINEER';
  }

  async play(m) {
    const token = ++this.token;
    const ids = [m.id, ...(m.chain || [])].filter(id => RADIO_LINES[id]);
    const alive = () => token === this.token;
    this.current = { id: m.id, talking: false };
    const el = this.el;
    this.setCaption(ids[0]);
    this.reveal(-1);
    el.classList.remove('hidden', 'out');
    el.classList.add('in');
    this.audio.radioOpen();
    // make sure the first clip is decoded while the channel-open beep plays
    const first = this.clips?.has(ids[0]) ? Promise.resolve(this.decode(ids[0])).catch(() => null) : null;
    await Promise.all([wait(380), first]);
    for (let k = 0; k < ids.length && alive(); k++) {
      const id = ids[k], text = RADIO_LINES[id];
      if (k > 0) { // reply on the same channel: short squelch, new speaker
        await wait(380);
        if (!alive()) return;
        this.setCaption(id);
        this.reveal(-1);
      }
      this.current.talking = true;
      el.classList.add('talking');
      this.audio.radioStatic(true);
      try {
        if (this.clips && this.clips.has(id)) await this.playClip(id);
        else await this.speak(text);
      } catch { // no voice available: keep the caption up for a natural reading time
        const t0 = performance.now(), len = Math.max(1600, text.length * 62);
        this.clock = { progress: () => (performance.now() - t0) / len };
        await wait(len);
      }
      if (!alive()) return;
      this.reveal(2);
      this.clock = null;
      this.audio.radioStatic(false);
      el.classList.remove('talking');
      this.current.talking = false;
      this.bars.forEach(b => { b.style.transform = 'scaleY(0.15)'; });
    }
    if (!alive()) return;
    this.audio.radioClose();
    await wait(m.victory ? 1400 : 900);
    if (!alive()) return;
    el.classList.remove('in'); el.classList.add('out');
    await wait(320);
    if (!alive()) return;
    el.classList.add('hidden');
    this.current = null;
    this.gap = this.queue[0]?.victory ? 0 : 1.2;
    if (m.victory) this.victoryActive = false;
  }

  async playClip(id) {
    const ctx = this.audio.ctx;
    if (!ctx) throw new Error('no audio');
    const buf = await this.decode(id);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const an = ctx.createAnalyser();
    an.fftSize = 512; an.smoothingTimeConstant = 0.55;
    src.connect(an).connect(this.audio.radioInput()); // the analyser passes the signal through
    const [s0, s1] = this.windows[id] || [0, buf.duration];
    const startAt = ctx.currentTime + 0.02;
    this.clock = { analyser: an, progress: () => (ctx.currentTime - startAt - s0) / Math.max(0.2, s1 - s0) };
    return new Promise(res => {
      let done = false;
      const fin = () => { if (!done) { done = true; this.cut = null; try { src.disconnect(); an.disconnect(); } catch { /* ignore */ } res(); } };
      src.onended = fin;
      this.cut = () => { try { src.stop(); } catch { /* ignore */ } fin(); };
      src.start(startAt);
    });
  }

  speak(text) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) return reject(new Error('no speech'));
      const u = new SpeechSynthesisUtterance(text.replace(/\bDRS\b/g, 'D R S').replace(/\bBox, box\b/i, 'Box. Box.'));
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang || 'en-GB';
      u.rate = 1.04; u.pitch = 0.92; u.volume = Math.min(1, 0.6 + this.audio.volume * 0.6);
      // caption timing: word boundary events when the browser has them, otherwise an estimate
      const t0 = performance.now(), est = Math.max(1200, text.length * 66);
      let bound = -1;
      u.onboundary = e => { if (e.name === 'word' || e.charIndex >= 0) bound = e.charIndex / text.length; };
      this.clock = { progress: () => Math.max(bound, Math.min(0.98, (performance.now() - t0) / est)) };
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(guard); this.cut = null; resolve(); } };
      const guard = setTimeout(fin, 2500 + text.length * 90); // some browsers never fire 'end'
      u.onend = fin; u.onerror = () => { if (!done) { done = true; clearTimeout(guard); this.cut = null; reject(new Error('speech failed')); } };
      this.cut = () => { speechSynthesis.cancel(); fin(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.token++;
    this.queue.length = 0;
    this.cut?.(); this.cut = null; this.clock = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.audio.radioStatic(false);
    this.el.classList.add('hidden'); this.el.classList.remove('in', 'talking', 'out', 'driver');
    this.current = null; this.gap = 0;
    this.victoryActive = false;
  }
  reset() { this.stop(); this.last = {}; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// where the voice actually starts and ends inside a clip (skips leading/trailing silence),
// so the caption timing matches the spoken words
function speechWindow(buf) {
  const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < n; i += 16) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  if (peak <= 0) return [0, buf.duration];
  const th = peak * 0.08;
  let a = 0; while (a < n && Math.abs(d[a]) < th) a += 32;
  let b = n - 1; while (b > a && Math.abs(d[b]) < th) b -= 32;
  return [a / sr, Math.max(a + sr * 0.2, b) / sr];
}

// prefer a British male voice: race engineers are usually British on the broadcast
function pickVoice(list) {
  if (!list || !list.length) return null;
  const en = list.filter(v => /^en/i.test(v.lang));
  const score = v => (/en-GB/i.test(v.lang) ? 4 : 0) + (/male|daniel|george|arthur|ryan|guy|brian|oliver|thomas|james/i.test(v.name) ? 3 : 0)
    + (/female|zira|susan|hazel|libby|sonia|mia|samantha|karen|moira|tessa|fiona|victoria/i.test(v.name) ? -3 : 0) + (/natural|neural|online|premium|enhanced/i.test(v.name) ? 2 : 0);
  return (en.length ? en : list).slice().sort((a, b) => score(b) - score(a))[0];
}
