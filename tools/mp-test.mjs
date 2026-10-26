// Protocol test for the multiplayer server: two bots create / join / ready / race / finish.
// usage: node tools/mp-test.mjs   (starts its own server on port 8097)
import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = 8097;
const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.once('data', r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };

function bot(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/mp`);
  const b = { ws, name, got: [], last: {}, send: (t, d = {}) => ws.send(JSON.stringify({ t, ...d })) };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    const list = m.t === 'b' ? m.m : [m];
    for (const x of list) { b.got.push(x); b.last[x.t] = x; }
  };
  b.open = new Promise(r => { ws.onopen = r; });
  b.wait = async (t, pred = () => true, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = b.got.find(x => x.t === t && pred(x)); if (m) { b.got.splice(b.got.indexOf(m), 1); return m; } await sleep(20); }
    return null;
  };
  return b;
}

try {
  const h = await fetch(`http://127.0.0.1:${PORT}/healthz`).then(r => r.json());
  check(h.ok === true, 'healthz responds');
  const blocked = await fetch(`http://127.0.0.1:${PORT}/netcode/lobbies.cjs`);
  check(blocked.status === 404, 'server source is not served');

  const A = bot('Alice'), B = bot('Bob');
  await Promise.all([A.open, B.open]);
  A.send('hello', { v: 1, name: 'Alice' }); B.send('hello', { v: 1, name: 'Bob<script>' });
  const wa = await A.wait('welcome'), wb = await B.wait('welcome');
  check(wa && wb && wa.id !== wb.id, 'both bots welcomed with ids');
  check(wb.name === 'Bobscript', 'names are sanitised');

  A.send('create', { name: 'Test GP', settings: { track: 'mc-1929', laps: 2, ai: 3, public: true }, car: { team: 'ferrari', driver: 0 } });
  const joined = await A.wait('joined');
  check(joined && /^[A-Z2-9]{5}$/.test(joined.code), 'lobby created with 5-char code ' + joined?.code);

  B.send('list');
  const list = await B.wait('lobbies');
  check(list && list.list.some(l => l.code === joined.code && l.track === 'mc-1929'), 'public lobby appears in browser list');

  B.send('join', { code: 'ZZZZZ' });
  check(!!(await B.wait('error', m => /No lobby/.test(m.msg))), 'wrong code gives friendly error');

  B.send('join', { code: joined.code.toLowerCase(), car: { team: 'ferrari', driver: 0 } });
  check(!!(await B.wait('joined')), 'join with code (case-insensitive)');
  const lob = await A.wait('lobby', m => m.lobby.players.length === 2);
  check(!!lob, 'host sees 2 players');

  A.send('start');
  check(!!(await A.wait('error', m => /ready/.test(m.msg))), 'cannot start until everyone is ready');
  B.send('chat', { text: 'hi <b>all</b>' });
  const chat = await A.wait('chat', m => m.from);
  check(chat && chat.text === 'hi ball/b', 'chat relayed and sanitised');

  A.send('settings', { settings: { laps: 99, ai: 50, track: 'nope' } });
  const ls = await B.wait('lobby', m => m.lobby.settings.laps === 30);
  check(ls && ls.lobby.settings.ai === 19 && ls.lobby.settings.track === 'mc-1929', 'host settings clamped');
  B.send('settings', { settings: { laps: 5 } });
  await sleep(150);
  check(!B.got.some(m => m.t === 'lobby' && m.lobby.settings.laps === 5), 'non-host cannot change settings');
  A.send('settings', { settings: { laps: 2, ai: 3 } });

  B.send('ready', { ready: true });
  await A.wait('lobby', m => m.lobby.players.find(p => p.id === wb.id)?.ready);
  A.send('start');
  const st = await B.wait('start');
  check(st && st.grid.length === 5, 'race starts with 2 humans + 3 AI = ' + st?.grid.length);
  const humans = st.grid.filter(g => g.id != null);
  check(humans.length === 2 && humans[0].team + humans[0].driver !== humans[1].team + humans[1].driver, 'duplicate car resolved to team-mate');
  const slotA = st.grid.find(g => g.id === wa.id).slot, slotB = st.grid.find(g => g.id === wb.id).slot;
  const aiSlot = st.grid.find(g => g.id == null).slot;

  A.send('loaded'); B.send('loaded');
  const go = await B.wait('go');
  check(go && go.holdT > 0.2 && go.holdT < 2.6, 'go after everyone loaded');

  A.ws.send(JSON.stringify({ t: 'b', m: [{ t: 's', k: slotA, d: [1, 2, 3] }, { t: 's', k: aiSlot, d: [4, 5, 6] }] }));
  B.send('s', { k: slotA, d: [9, 9, 9] }); // spoof: Bob may not drive Alice's car
  const s1 = await B.wait('s', m => m.k === slotA), s2 = await B.wait('s', m => m.k === aiSlot);
  check(s1 && s2 && s1.d[0] === 1, 'host snapshots (own + AI) relayed in a batch');
  check(!(await A.wait('s', m => m.k === slotA, 300)), 'spoofed snapshot rejected');

  B.send('finish', { k: slotB, time: 80.5, best: 39.9 });
  const f1 = await A.wait('finish');
  check(f1 && f1.order === 1 && f1.slot === slotB, 'finish recorded, order 1');
  A.send('finish', { k: slotA, time: 81.2, best: 40.1 });
  check(!!(await A.wait('finish', m => m.order === 2)), 'second finish order 2');
  const end = await A.wait('end', () => true, 9000);
  check(end && end.finishes.length === 2, 'race ends when all humans finish, back to lobby');

  // host leaves -> Bob becomes host
  A.ws.close();
  const hl = await B.wait('lobby', m => m.lobby.hostId === wb.id && m.lobby.players.length === 1);
  check(!!hl, 'host migrates when host leaves');
  B.ws.close();
  await sleep(200);
  const h2 = await fetch(`http://127.0.0.1:${PORT}/healthz`).then(r => r.json());
  check(h2.lobbies === 0, 'empty lobby removed');
} catch (e) { console.error(e); fails++; }
srv.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
