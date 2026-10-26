import * as THREE from 'three';

// Procedurally drawn sponsor stickers (stylised recreations of the 2018 liveries).
// Every sticker is drawn into a transparent 512x128 (4:1) canvas.
const W = 512, H = 128;
const FONT = '"Titillium Web", "Arial Black", Arial, sans-serif';
const cache = {};

function fit(ctx, txt, { weight = 900, italic = false, family = FONT, maxW = W * 0.92, maxH = H * 0.7, x = W / 2, y = H / 2, color = '#fff', stroke = null, strokeW = 0.08, align = 'center', spacing = 0 } = {}) {
  let size = maxH;
  const set = () => { ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`; if ('letterSpacing' in ctx) ctx.letterSpacing = spacing * size + 'px'; };
  set();
  while (ctx.measureText(txt).width > maxW && size > 6) { size -= 2; set(); }
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = size * strokeW; ctx.strokeStyle = stroke; ctx.strokeText(txt, x, y); }
  ctx.fillStyle = color; ctx.fillText(txt, x, y);
  const w = ctx.measureText(txt).width;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return { size, w };
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// charging bull silhouette in a unit box (facing right)
const BULL = [[0.14, 0.2], [0.3, 0.12], [0.47, 0.1], [0.6, 0.16], [0.7, 0.22], [0.8, 0.24], [0.97, 0.1], [0.9, 0.26], [0.86, 0.3], [0.95, 0.44], [0.9, 0.5], [0.8, 0.46], [0.72, 0.42], [0.76, 0.62], [0.7, 0.64], [0.63, 0.46], [0.45, 0.47], [0.36, 0.64], [0.3, 0.64], [0.3, 0.46], [0.18, 0.42], [0.06, 0.62], [0.02, 0.6], [0.11, 0.36], [0.03, 0.3], [0.09, 0.28]];
function bull(ctx, x, y, s, flip, col) {
  ctx.fillStyle = col; ctx.beginPath();
  BULL.forEach(([bx, by], i) => { const px = x + (flip ? 1 - bx : bx) * s, py = y + by * s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath(); ctx.fill();
}
function redBullEmblem(ctx, cx, cy, s) {
  ctx.fillStyle = '#FFC906'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2); ctx.fill();
  bull(ctx, cx - s * 0.62, cy - s * 0.36, s * 0.62, false, '#D7182A');
  bull(ctx, cx, cy - s * 0.36, s * 0.62, true, '#D7182A');
}

function star(ctx, cx, cy, r, col) {
  ctx.strokeStyle = col; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + k * Math.PI * 2 / 3;
    const b1 = a + Math.PI / 3, b2 = a - Math.PI / 3;
    ctx.moveTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
    ctx.lineTo(cx + Math.cos(b1) * r * 0.16, cy + Math.sin(b1) * r * 0.16);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + Math.cos(b2) * r * 0.16, cy + Math.sin(b2) * r * 0.16);
    ctx.closePath();
  }
  ctx.fill();
}

const DRAW = {
  pirelli(ctx) {
    // signature elongated "P"
    ctx.save();
    ctx.translate(W * 0.17, H * 0.52); ctx.scale(1, 1.45);
    fit(ctx, 'P', { italic: true, maxH: H * 0.62, x: 0, y: 0, color: '#FFD100', stroke: '#111', align: 'left' });
    ctx.restore();
    ctx.fillStyle = '#FFD100'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W * 0.2, H * 0.14); ctx.lineTo(W * 0.86, H * 0.14); ctx.lineTo(W * 0.85, H * 0.22); ctx.lineTo(W * 0.2, H * 0.22); ctx.closePath(); ctx.fill(); ctx.stroke();
    fit(ctx, 'IRELLI', { italic: true, maxW: W * 0.58, maxH: H * 0.6, x: W * 0.28, y: H * 0.6, color: '#FFD100', stroke: '#111', align: 'left' });
  },
  redbull(ctx) {
    redBullEmblem(ctx, W * 0.28, H * 0.5, H * 1.15);
    fit(ctx, 'Red Bull', { weight: 900, maxW: W * 0.42, maxH: H * 0.5, x: W * 0.76, y: H * 0.52, color: '#D7182A', stroke: '#FFC906', strokeW: 0.05 });
  },
  redbullText(ctx) { fit(ctx, 'Red Bull', { maxH: H * 0.7, color: '#D7182A', stroke: '#FFC906', strokeW: 0.05 }); },
  astonmartin(ctx) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    for (const s of [1, -1]) for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(W / 2 + s * W * 0.05, H * (0.2 + k * 0.06)); ctx.lineTo(W / 2 + s * W * (0.36 - k * 0.06), H * (0.2 + k * 0.06)); ctx.stroke(); }
    fit(ctx, 'ASTON MARTIN', { weight: 600, maxW: W * 0.9, maxH: H * 0.38, y: H * 0.7, color: '#fff', spacing: 0.15 });
  },
  tagheuer(ctx) {
    const x = W / 2 - H * 0.35, y = H * 0.08, w = H * 0.7, h = H * 0.84;
    ctx.fillStyle = '#c8102e'; rrect(ctx, x, y, w, h, 8); ctx.fill();
    ctx.fillStyle = '#006747'; rrect(ctx, x + 5, y + 5, w - 10, h * 0.55, 5); ctx.fill();
    fit(ctx, 'TAG', { maxW: w * 0.8, maxH: h * 0.38, x: W / 2, y: y + h * 0.3, color: '#fff' });
    fit(ctx, 'Heuer', { weight: 700, maxW: w * 0.85, maxH: h * 0.26, x: W / 2, y: y + h * 0.78, color: '#fff' });
  },
  mobil1(ctx) {
    const r = fit(ctx, 'Mobil', { weight: 700, maxW: W * 0.6, maxH: H * 0.6, x: W * 0.45, color: '#0a3d91', stroke: '#fff', strokeW: 0.06 });
    fit(ctx, '1', { italic: true, maxH: H * 0.75, x: W * 0.45 + r.w / 2 + 30, color: '#e4002b', stroke: '#fff', strokeW: 0.06 });
  },
  petronas(ctx) { fit(ctx, 'PETRONAS', { weight: 900, maxH: H * 0.62, color: '#00A19C', stroke: '#ffffff', strokeW: 0.06, spacing: 0.04 }); },
  petronasWhite(ctx) { fit(ctx, 'PETRONAS', { weight: 900, maxH: H * 0.62, color: '#ffffff', stroke: '#00A19C', strokeW: 0.05, spacing: 0.04 }); },
  mercedesStar(ctx) { star(ctx, W / 2, H / 2, H * 0.42, '#e8eaed'); },
  shell(ctx) {
    const cx = W * 0.5, cy = H * 0.62, r = H * 0.5;
    ctx.fillStyle = '#FFD500'; ctx.strokeStyle = '#DD1D21'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy + r * 0.62); ctx.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.95); ctx.lineTo(cx + r * 0.35, cy + r * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 4;
    for (let k = -3; k <= 3; k++) { const a = -Math.PI / 2 + k * 0.24; ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.55); ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.stroke(); }
  },
  kaspersky(ctx) { fit(ctx, 'kaspersky', { weight: 600, maxH: H * 0.62, color: '#ffffff', stroke: '#006D5C', strokeW: 0.05 }); },
  ups(ctx) {
    const x = W / 2 - H * 0.36, w = H * 0.72;
    ctx.fillStyle = '#351C15'; ctx.strokeStyle = '#FFB500'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, H * 0.08); ctx.quadraticCurveTo(x + w / 2, H * 0.0, x + w, H * 0.08); ctx.lineTo(x + w, H * 0.6); ctx.quadraticCurveTo(x + w, H * 0.86, x + w / 2, H * 0.96); ctx.quadraticCurveTo(x, H * 0.86, x, H * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    fit(ctx, 'ups', { weight: 700, maxW: w * 0.8, maxH: H * 0.45, y: H * 0.5, color: '#FFB500' });
  },
  bwt(ctx) {
    fit(ctx, 'BWT', { weight: 900, italic: true, maxH: H * 0.7, y: H * 0.42, color: '#ffffff', stroke: '#c2185b', strokeW: 0.04, spacing: 0.08 });
    fit(ctx, 'best water technology', { weight: 600, maxW: W * 0.6, maxH: H * 0.16, y: H * 0.86, color: '#ffffff' });
  },
  martini(ctx) {
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = '#E3001B'; ctx.beginPath(); ctx.ellipse(cx, cy, H * 0.75, H * 0.46, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0C2340'; ctx.fillRect(cx - W * 0.42, cy - H * 0.17, W * 0.84, H * 0.34);
    fit(ctx, 'MARTINI', { weight: 700, maxW: W * 0.78, maxH: H * 0.3, y: cy + 2, color: '#ffffff', spacing: 0.12 });
  },
  rexona(ctx) { fit(ctx, 'Rexona', { weight: 900, italic: true, maxH: H * 0.62, color: '#0a2e6e' }); },
  williams(ctx) { fit(ctx, 'WILLIAMS', { weight: 900, maxH: H * 0.55, color: '#0A2E6E', spacing: 0.06 }); },
  renaultDiamond(ctx) {
    const cx = W / 2, cy = H / 2, s = H * 0.46;
    const diamond = (k, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(cx, cy - s * k); ctx.lineTo(cx + s * 0.62 * k, cy); ctx.lineTo(cx, cy + s * k); ctx.lineTo(cx - s * 0.62 * k, cy); ctx.closePath(); ctx.stroke(); };
    diamond(1, '#141414', 12); diamond(1, '#ffffff', 5); diamond(0.55, '#141414', 10); diamond(0.55, '#ffffff', 4);
  },
  renault(ctx) {
    const s = H * 0.4, cx = W * 0.12, cy = H / 2;
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.62, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 0.62, cy); ctx.closePath(); ctx.stroke();
    fit(ctx, 'RENAULT', { weight: 900, maxW: W * 0.72, maxH: H * 0.62, x: W * 0.58, color: '#141414', spacing: 0.06 });
  },
  castrol(ctx) {
    ctx.fillStyle = '#009A44'; rrect(ctx, W * 0.12, H * 0.12, W * 0.76, H * 0.76, 14); ctx.fill();
    ctx.strokeStyle = '#E4002B'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(W * 0.14, H * 0.74); ctx.bezierCurveTo(W * 0.4, H * 0.5, W * 0.6, H * 0.95, W * 0.86, H * 0.66); ctx.stroke();
    fit(ctx, 'Castrol', { weight: 900, italic: true, maxW: W * 0.62, maxH: H * 0.5, y: H * 0.44, color: '#ffffff' });
  },
  microsoft(ctx) {
    const s = H * 0.2, x = W * 0.12, y = H / 2 - s - 3;
    [['#F25022', 0, 0], ['#7FBA00', 1, 0], ['#00A4EF', 0, 1], ['#FFB900', 1, 1]].forEach(([c, i, j]) => { ctx.fillStyle = c; ctx.fillRect(x + i * (s + 6), y + j * (s + 6), s, s); });
    fit(ctx, 'Microsoft', { weight: 600, maxW: W * 0.66, maxH: H * 0.55, x: W * 0.6, color: '#141414' });
  },
  mapfre(ctx) { fit(ctx, 'MAPFRE', { weight: 900, maxH: H * 0.62, color: '#D81E05', spacing: 0.05 }); },
  bellross(ctx) { fit(ctx, 'Bell & Ross', { weight: 600, maxH: H * 0.55, color: '#141414' }); },
  honda(ctx) { fit(ctx, 'HONDA', { weight: 900, maxH: H * 0.62, color: '#E40521', stroke: '#ffffff', strokeW: 0.06, spacing: 0.08 }); },
  haas(ctx) {
    ctx.fillStyle = '#D7141A'; ctx.fillRect(W * 0.1, H * 0.12, W * 0.8, H * 0.76);
    fit(ctx, 'HAAS', { weight: 900, maxW: W * 0.7, maxH: H * 0.62, color: '#ffffff', spacing: 0.1 });
  },
  richardmille(ctx) { fit(ctx, 'RICHARD MILLE', { weight: 700, maxH: H * 0.45, color: '#ffffff', spacing: 0.08 }); },
  dell(ctx) {
    // circle with tilted E
    const r = H * 0.44, cx = W * 0.5, cy = H / 2;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const f = { weight: 900, maxH: H * 0.42, color: '#ffffff' };
    fit(ctx, 'D', { ...f, x: cx - r * 0.55, y: cy });
    ctx.save(); ctx.translate(cx - r * 0.05, cy); ctx.rotate(-0.45); fit(ctx, 'E', { ...f, x: 0, y: 0 }); ctx.restore();
    fit(ctx, 'LL', { ...f, x: cx + r * 0.5, y: cy });
  },
  delltech(ctx) {
    fit(ctx, 'DELL', { weight: 900, maxW: W * 0.5, maxH: H * 0.62, x: W * 0.3, color: '#ffffff' });
    fit(ctx, 'Technologies', { weight: 600, maxW: W * 0.42, maxH: H * 0.3, x: W * 0.74, color: '#ffffff' });
  },
  kimoa(ctx) { fit(ctx, 'kimoa', { weight: 700, maxH: H * 0.7, color: '#ffffff', stroke: '#1F2A44', strokeW: 0.05 }); },
  sap(ctx) {
    const x = W * 0.3, w = W * 0.4;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#00AEEF'); g.addColorStop(1, '#0066B3');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, H * 0.12); ctx.lineTo(x + w, H * 0.12); ctx.lineTo(x + w * 0.72, H * 0.88); ctx.lineTo(x, H * 0.88); ctx.closePath(); ctx.fill();
    fit(ctx, 'SAP', { weight: 900, italic: true, maxW: w * 0.6, maxH: H * 0.5, x: x + w * 0.38, color: '#ffffff' });
  },
  lubrax(ctx) { fit(ctx, 'LUBRAX', { weight: 900, italic: true, maxH: H * 0.58, color: '#ffffff', stroke: '#00843D', strokeW: 0.07 }); },
  mclaren(ctx) {
    fit(ctx, 'McLAREN', { weight: 900, maxW: W * 0.78, maxH: H * 0.6, x: W * 0.45, color: '#ffffff' });
    ctx.fillStyle = '#FF8000'; ctx.beginPath(); ctx.moveTo(W * 0.82, H * 0.62); ctx.quadraticCurveTo(W * 0.9, H * 0.15, W * 0.97, H * 0.3); ctx.quadraticCurveTo(W * 0.9, H * 0.3, W * 0.82, H * 0.62); ctx.fill();
  },
  alfaromeo(ctx) {
    const cx = W * 0.14, cy = H / 2, r = H * 0.4;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1E3A8A'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#C8102E'; ctx.fillRect(cx - r * 0.55, cy - r * 0.1, r * 0.5, r * 0.2); ctx.fillRect(cx - r * 0.35, cy - r * 0.55, r * 0.12, r * 1.1);
    ctx.fillStyle = '#0B6E3F'; ctx.beginPath(); ctx.arc(cx + r * 0.32, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
    fit(ctx, 'ALFA ROMEO', { weight: 700, maxW: W * 0.68, maxH: H * 0.48, x: W * 0.6, color: '#9B0000', spacing: 0.06 });
  },
  sauber(ctx) { fit(ctx, 'SAUBER', { weight: 900, maxH: H * 0.6, color: '#ffffff', spacing: 0.1 }); },
  carrera(ctx) { fit(ctx, 'CARRERA', { weight: 900, maxH: H * 0.55, color: '#9B0000', spacing: 0.12 }); },
  ferrari(ctx) {
    ctx.fillStyle = '#FFD100'; rrect(ctx, W * 0.42, H * 0.06, W * 0.16, H * 0.88, 6); ctx.fill();
    ctx.fillStyle = '#009246'; ctx.fillRect(W * 0.42, H * 0.06, W * 0.053, H * 0.1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(W * 0.473, H * 0.06, W * 0.053, H * 0.1);
    ctx.fillStyle = '#CE2B37'; ctx.fillRect(W * 0.527, H * 0.06, W * 0.053, H * 0.1);
    // prancing horse silhouette (simplified)
    ctx.fillStyle = '#111'; ctx.beginPath();
    const px = W * 0.5, py = H * 0.55, s = H * 0.3;
    [[-0.5, 0.9], [-0.35, 0.2], [-0.5, -0.1], [-0.2, -0.5], [0.1, -0.9], [0.25, -0.6], [0.5, -0.7], [0.35, -0.3], [0.2, 0.1], [0.4, 0.9], [0.25, 0.9], [0.05, 0.35], [-0.2, 0.4], [-0.3, 0.9]].forEach(([x, y], i) => (i ? ctx.lineTo(px + x * s, py + y * s) : ctx.moveTo(px + x * s, py + y * s)));
    ctx.closePath(); ctx.fill();
  },
  forceindia(ctx) { fit(ctx, 'FORCE INDIA', { weight: 900, maxH: H * 0.5, color: '#ffffff', spacing: 0.05 }); },
  tororosso(ctx) { fit(ctx, 'TORO ROSSO', { weight: 900, maxH: H * 0.5, color: '#ffffff', stroke: '#D7182A', strokeW: 0.04, spacing: 0.05 }); },
  johnniewalker(ctx) { fit(ctx, 'JOHNNIE WALKER', { weight: 700, maxH: H * 0.42, color: '#ffffff', spacing: 0.05 }); },
};

export function sponsorTexture(id) {
  if (cache[id]) return cache[id];
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  (DRAW[id] || (x => fit(x, id.toUpperCase(), {})))(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return (cache[id] = t);
}

// 2018-season sticker placement per team. Slots are defined in car.js.
export const TEAM_SPONSORS = {
  mercedes: { sidepod: 'petronas', sidepodTop: 'mercedesStar', cover: 'petronasWhite', noseTop: 'mercedesStar', nose: ['petronas', 'pirelli'], flap: 'petronas', rearEnd: ['petronas', 'mercedesStar', 'pirelli'] },
  ferrari: { sidepod: 'shell', sidepodTop: 'ferrari', cover: 'kaspersky', noseTop: 'ferrari', nose: ['ups', 'pirelli', 'shell'], flap: 'shell', rearEnd: ['ups', 'kaspersky', 'pirelli'] },
  redbull: { sidepod: 'redbull', sidepodTop: 'tagheuer', cover: 'redbull', noseTop: 'redbullText', nose: ['astonmartin', 'mobil1', 'pirelli'], flap: 'astonmartin', rearEnd: ['redbullText', 'tagheuer', 'pirelli'] },
  forceindia: { sidepod: 'bwt', sidepodTop: 'johnniewalker', cover: 'forceindia', noseTop: 'bwt', nose: ['bwt', 'pirelli'], flap: 'bwt', rearEnd: ['bwt', 'forceindia', 'pirelli'] },
  williams: { sidepod: 'martini', sidepodTop: 'rexona', cover: 'williams', noseTop: 'martini', nose: ['rexona', 'pirelli'], flap: 'martini', rearEnd: ['martini', 'williams', 'pirelli'] },
  renault: { sidepod: 'renault', sidepodTop: 'bellross', cover: 'renaultDiamond', noseTop: 'renaultDiamond', nose: ['pirelli', 'microsoft', 'mapfre', 'castrol'], flap: 'renault', rearEnd: ['castrol', 'renault', 'pirelli'] },
  tororosso: { sidepod: 'redbull', sidepodTop: 'tororosso', cover: 'honda', noseTop: 'redbullText', nose: ['honda', 'pirelli'], flap: 'redbullText', rearEnd: ['tororosso', 'honda', 'pirelli'] },
  haas: { sidepod: 'haas', sidepodTop: 'richardmille', cover: 'haas', noseTop: 'haas', nose: ['richardmille', 'pirelli'], flap: 'haas', rearEnd: ['haas', 'richardmille', 'pirelli'] },
  mclaren: { sidepod: 'delltech', sidepodTop: 'kimoa', cover: 'mclaren', noseTop: 'dell', nose: ['kimoa', 'delltech', 'lubrax', 'sap'], flap: 'mclaren', rearEnd: ['dell', 'mclaren', 'pirelli'] },
  sauber: { sidepod: 'alfaromeo', sidepodTop: 'carrera', cover: 'sauber', noseTop: 'alfaromeo', nose: ['carrera', 'pirelli'], flap: 'alfaromeo', rearEnd: ['alfaromeo', 'sauber', 'pirelli'] },
};
