// Team radio: the race engineer talks to you like on a real F1 broadcast.
// - Courtesy beep + squelch when the channel opens and closes, radio static under the voice.
// - Voice: recorded clips in /radio/<id>.mp3 (listed in /radio/manifest.json) are played through a
//   radio filter; without recordings the browser's built-in speech voice is used.
// - On-screen "TEAM RADIO" graphic with live waveform and the transcript.

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
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TeamRadio {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.queue = []; this.current = null; this.last = {}; this.gap = 0;
    this.clips = null; this.buffers = {};
    this.voice = null;
    this.el = document.getElementById('radio');
    this.bars = [...this.el.querySelectorAll('.rd-wave i')];
    this.loadManifest();
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
  }

  // iOS / Safari only allow speech after a tap: call this from the START button
  unlock() {
    if ('speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ } }
  }

  setDriver({ name, num, team, color }) {
    this.el.style.setProperty('--tc', color);
    this.el.querySelector('.rd-name').textContent = name.toUpperCase();
    this.el.querySelector('.rd-num').textContent = num;
    this.el.querySelector('.rd-team').textContent = team.toUpperCase();
  }

  // priority: 3 = urgent (box / fuel critical), 2 = strategy, 1 = info. cooldown in seconds per message id
  say(id, { priority = 1, cooldown = 40 } = {}) {
    if (!this.enabled || !RADIO_LINES[id]) return false;
    const now = performance.now() / 1000;
    if (this.last[id] && now - this.last[id] < cooldown) return false;
    if (this.queue.some(q => q.id === id) || this.current?.id === id) return false;
    this.last[id] = now;
    this.queue.push({ id, priority, t: now });
    this.queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
    if (this.queue.length > 4) this.queue.length = 4;
    return true;
  }

  update(dt, paused) {
    // waveform animation
    if (this.current && this.current.talking) {
      const tt = performance.now() / 1000;
      this.bars.forEach((b, k) => { const v = 0.25 + Math.abs(Math.sin(tt * (11 + k * 1.7) + k)) * (0.4 + Math.random() * 0.45); b.style.transform = `scaleY(${v.toFixed(2)})`; });
    }
    if (this.current || paused) return;
    this.gap -= dt;
    if (this.gap > 0 || !this.queue.length) return;
    const now = performance.now() / 1000;
    // info messages that waited too long are no longer relevant
    while (this.queue.length && this.queue[0].priority < 3 && now - this.queue[0].t > 12) this.queue.shift();
    const m = this.queue.shift();
    if (m) this.play(m);
  }
  async play(m) {
    const text = RADIO_LINES[m.id];
    this.current = { id: m.id, talking: false };
    const el = this.el;
    el.querySelector('.rd-text').innerHTML = `“${esc(text)}”`;
    el.classList.remove('hidden', 'out');
    el.classList.add('in');
    this.audio.radioOpen();
    await wait(380);
    this.current.talking = true;
    el.classList.add('talking');
    this.audio.radioStatic(true);
    try {
      if (this.clips && this.clips.has(m.id)) await this.playClip(m.id);
      else await this.speak(text);
    } catch { await wait(Math.max(1600, text.length * 62)); } // no voice available: keep the caption up
    this.audio.radioStatic(false);
    el.classList.remove('talking');
    this.current.talking = false;
    this.bars.forEach(b => { b.style.transform = 'scaleY(0.15)'; });
    this.audio.radioClose();
    await wait(900);
    el.classList.remove('in'); el.classList.add('out');
    await wait(320);
    el.classList.add('hidden');
    this.current = null;
    this.gap = 1.2;
  }

  async playClip(id) {
    const ctx = this.audio.ctx;
    if (!ctx) throw new Error('no audio');
    if (!this.buffers[id]) {
      const r = await fetch(`radio/${id}.mp3`);
      this.buffers[id] = await ctx.decodeAudioData(await r.arrayBuffer());
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[id];
    src.connect(this.audio.radioInput());
    return new Promise(res => { src.onended = res; src.start(); });
  }

  speak(text) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) return reject(new Error('no speech'));
      const u = new SpeechSynthesisUtterance(text.replace(/\bDRS\b/g, 'D R S').replace(/\bBox, box\b/i, 'Box. Box.'));
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang || 'en-GB';
      u.rate = 1.04; u.pitch = 0.92; u.volume = Math.min(1, 0.6 + this.audio.volume * 0.6);
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
      const guard = setTimeout(fin, 2500 + text.length * 90); // some browsers never fire 'end'
      u.onend = fin; u.onerror = () => { if (!done) { done = true; clearTimeout(guard); reject(new Error('speech failed')); } };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.queue.length = 0;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.audio.radioStatic(false);
    this.el.classList.add('hidden'); this.el.classList.remove('in', 'talking', 'out');
    this.current = null; this.gap = 0;
  }
  reset() { this.stop(); this.last = {}; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// prefer a British male voice: race engineers are usually British on the broadcast
function pickVoice(list) {
  if (!list || !list.length) return null;
  const en = list.filter(v => /^en/i.test(v.lang));
  const score = v => (/en-GB/i.test(v.lang) ? 4 : 0) + (/male|daniel|george|arthur|ryan|guy|brian|oliver|thomas|james/i.test(v.name) ? 3 : 0)
    + (/female|zira|susan|hazel|libby|sonia|mia|samantha|karen|moira|tessa|fiona|victoria/i.test(v.name) ? -3 : 0) + (/natural|neural|online|premium|enhanced/i.test(v.name) ? 2 : 0);
  return (en.length ? en : list).slice().sort((a, b) => score(b) - score(a))[0];
}
