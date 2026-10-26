// End-to-end test of the Netlify + Render setup: the game is served as static files (like Netlify) on one port,
// the multiplayer server runs backend-only (like Render) on another. Two headless Chrome "players" race.
// usage: npm run build -- --server=http://127.0.0.1:8097 && node tools/online-test.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const front = http.createServer((req, res) => { // "Netlify"
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(dist, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(8098);
const back = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '8097', GAME_URL: 'http://127.0.0.1:8098/' }, stdio: ['ignore', 'pipe', 'inherit'] }); // "Render"
await new Promise(r => back.stdout.once('data', r));

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const errors = [], chromes = [];
async function player(name, port) { // one Chrome process per player, like two real devices
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'f1on-'));
  chromes.push(spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' }));
  let ws, id = 0; const pending = new Map();
  for (let k = 0; k < 150 && !ws; k++) { try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ws = new WebSocket(v.webSocketDebuggerUrl); } catch { await sleep(200); } }
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(name + ' EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const cmd = (m, p) => send(m, p, sid);
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 900, height: 500, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('f1gp.settings', JSON.stringify({ mpName: '${name}', track: 'mc-1929', quality: 'low', guideSeen: true }));` });
  await cmd('Page.navigate', { url: 'http://127.0.0.1:8098/' });
  const ev = async e => (await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(e)) return true; await sleep(300); } return false; };
  return { ev, until };
}
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
const click = sel => `(document.querySelector('${sel}').click(), true)`;
try {
  const home = await (await fetch('http://127.0.0.1:8097/')).text();
  check(/server is running/.test(home), 'backend-only server shows its status page');
  const A = await player('Alice', 9334), B = await player('Bob', 9335);
  const menu = `!document.getElementById('menu').classList.contains('hidden')`;
  check(await A.until(menu, 90000) && await B.until(menu, 90000), 'both games booted');
  check(await A.ev(`document.getElementById('on-server').value`) === 'http://127.0.0.1:8097', 'server address baked into the build');
  for (const P of [A, B]) { await P.ev(click('#online-btn')); await P.ev(click('#on-go')); }
  check(await A.until(`!document.getElementById('on-browse').classList.contains('hidden')`) && await B.until(`!document.getElementById('on-browse').classList.contains('hidden')`), 'both connected to the separate server');
  await A.ev(click('#on-create-priv'));
  check(await A.until(`/^[A-Z2-9]{5}$/.test(document.getElementById('lb-code').textContent)`), 'lobby created');
  const code = await A.ev(`document.getElementById('lb-code').textContent`);
  await B.ev(`document.getElementById('on-code').value = '${code}'; true`); await B.ev(click('#on-join'));
  check(await B.until(`document.querySelectorAll('#lb-players .lbp').length === 2`), 'friend joined with code ' + code);
  await B.ev(click('#lb-ready'));
  check(await A.until(`!document.getElementById('lb-start').disabled`, 8000), 'host can start');
  await A.ev(click('#lb-start'));
  const go = `!!(window.__game && window.__game.race && window.__game.race.netHold != null)`;
  check(await A.until(go, 150000) && await B.until(go, 150000), 'both loaded the race and got lights-out');
  await sleep(5000);
  const got = P => P.ev(`window.__game.race.cars.filter(c => c.human && !c.isPlayer).every(c => c.remote && c.remote.buf.length > 0)`);
  check(await got(A), 'host sees the friend car moving');
  check(await got(B), 'friend sees the host car moving');
} catch (e) { console.error(e); fails++; }
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
chromes.forEach(c => c.kill()); back.kill(); front.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
