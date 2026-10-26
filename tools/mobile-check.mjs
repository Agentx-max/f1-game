// Dev check: serves ./dist, opens it in headless Chrome emulating a phone, logs errors and saves screenshots.
// usage: node tools/mobile-check.mjs [outDir]   (run `npm run build` first)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(os.tmpdir(), 'f1-shots'));
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(8099);

const chromePaths = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
const exe = chromePaths.find(p => fs.existsSync(p));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'f1prof-'));
const chrome = spawn(exe, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${prof}`, '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const errors = [];
async function connect() {
  for (let k = 0; k < 150; k++) { try { const v = await (await fetch('http://127.0.0.1:9333/json/version')).json(); ws = new WebSocket(v.webSocketDebuggerUrl); break; } catch { await sleep(200); } }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
}
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
let sid;
const cmd = (m, p) => send(m, p, sid);
const evaluate = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function shot(name) { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('saved', name); }
async function setView(w, h) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true, screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await sleep(600);
}
async function waitFor(expr, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr)) return true; await sleep(300); } return false; }
const tap = sel => evaluate(`(() => { const el = document.querySelector('${sel}'); if (!el) return false; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el.click(); return true; })()`);

try {
  await connect();
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  sid = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Page.enable');
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const [W, H] = [800, 360];
  await setView(W, H);
  // optional: preset weather / camera before the page loads (CHECK_COND=rain|night, CHECK_CAM=3 for cockpit)
  if (process.env.CHECK_COND) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('f1gp.settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('f1gp.settings')||'{}'), { cond: '${process.env.CHECK_COND}', cam: ${Number(process.env.CHECK_CAM || 0)}, radio: true }))); localStorage.setItem('f1gp.guideSeen','1');` });
  await cmd('Page.navigate', { url: process.env.CHECK_URL || 'http://127.0.0.1:8099/' });
  await waitFor(`!document.getElementById('menu').classList.contains('hidden')`);
  console.log('body class:', await evaluate(`document.body.className`));
  await shot('01-menu-landscape');
  await setView(H, W); await shot('02-menu-portrait');
  await setView(W, H);
  await evaluate(`document.querySelector('[data-tab=controls]').click()`); await sleep(300); await shot('03-howto-landscape');
  await evaluate(`document.getElementById('start-btn').click()`);
  const ok = await waitFor(`!!(window.__game && window.__game.race) && document.getElementById('loading').classList.contains('hidden')`, 180000);
  console.log('race loaded:', ok);
  await sleep(1500); await shot('04-race-start');
  if (process.env.CHECK_COND) { // drive a bit so spray / lens drops / radio show up
    await evaluate(`(() => { const r = window.__game.race; r.phase = 'go'; r.started = true; r.startTime = r.time; r.player.phys.u = 55; for (const c of r.cars) c.phys.u = 50; })()`);
    await sleep(2500); await shot('04b-driving');
    await evaluate(`window.__game.settings.cam = 3`);
  }
  if (await tap('#tguide [data-guide=close]')) { await sleep(800); await shot('05-race-after-guide'); }
  await tap('[data-t=list]'); await sleep(800); await shot('06-standings-toggled');
  console.log('tower collapsed:', await evaluate(`document.getElementById('tower').className`));
  await tap('[data-t=list]'); await sleep(500);
  await setView(H, W); await shot('07-race-portrait');
  console.log('paused after portrait:', await evaluate(`!document.getElementById('pause').classList.contains('hidden')`));
  await setView(W, H); await sleep(500); await shot('08-race-back-landscape');
  await setView(667, 375); await shot('09-race-667x375');
  console.log('rects:', JSON.stringify(await evaluate(`[...document.querySelectorAll('#touch .tbtn, #tower, .timing, #minimap, .dash')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return (e.dataset.t || e.id || e.className.split(' ')[0]) + ':' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','); })`)));
} catch (e) { console.error('check failed', e); }
console.log('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
ws?.close(); chrome.kill(); server.close();
setTimeout(() => process.exit(0), 300);
