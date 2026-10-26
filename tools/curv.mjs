import { TRACK_DATA } from '../js/trackdata.js';
import { TRACKS } from '../js/tracks.js';
import { Track } from '../js/track.js';
for (const meta of TRACKS) {
  const t = new Track(meta, TRACK_DATA[meta.id]);
  // local minima of radius
  const out = [];
  for (let i = 0; i < t.n; i++) {
    const k = t.rlCurv[i];
    let isMax = true;
    for (let o = -15; o <= 15; o++) if (t.rlCurv[(i + o + t.n) % t.n] > k) { isMax = false; break; }
    if (isMax && k > 1 / 120) out.push(`${(t.s[i]).toFixed(0)}m r_rl=${(1 / k).toFixed(1)} r_c=${(1 / Math.abs(t.curv[i])).toFixed(1)} off=${t.rlOffset[i].toFixed(1)}`);
  }
  console.log(meta.key, out.join(' | '));
}
