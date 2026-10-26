// Online screen: connect, browse public lobbies, create / join by code, lobby room (players, settings, chat).
import { TRACKS } from './tracks.js';
import { TEAMS } from './teams.js';
import { Net, serverAddress, setServerAddress, defaultServer } from './net.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trackName = id => TRACKS.find(t => t.id === id)?.name || id;
const DIFFS = [[0.86, 'ROOKIE'], [0.91, 'PRO'], [0.955, 'EXPERT'], [0.985, 'LEGEND']];
const COND = { day: 'DAY', night: 'NIGHT', rain: 'RAIN' };

export function setupOnline({ settings, save, onStartRace, onShowMenu, onLobbyUpdate }) {
  const net = new Net();
  const ui = { lobby: null, page: 'connect', pendingCode: null, chat: [], ready: false };
  let listTimer = null;

  // ------------------------------------------------------------------ helpers
  const page = p => {
    ui.page = p;
    for (const k of ['connect', 'browse', 'lobby']) $('on-' + k).classList.toggle('hidden', k !== p);
    clearInterval(listTimer);
    if (p === 'browse') { net.send('list'); listTimer = setInterval(() => net.send('list'), 4000); }
  };
  let toastT;
  const toast = (msg, bad) => {
    const el = $('on-toast');
    el.textContent = msg; el.className = 'on-toast' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 3800);
  };
  const setStatus = () => {
    const s = $('on-status');
    s.className = 'on-status ' + net.status;
    s.querySelector('span').textContent = net.status === 'online' ? `ONLINE · ${net.rtt || '–'} ms` : net.status === 'connecting' ? 'CONNECTING…' : 'OFFLINE';
  };
  setInterval(setStatus, 1000);
  const myCar = () => ({ team: settings.team, driver: settings.driver | 0, tyre: settings.tyre });
  const isHost = () => ui.lobby && ui.lobby.hostId === net.id;

  // ------------------------------------------------------------------ connect page
  $('on-name').value = settings.mpName || '';
  $('on-server').value = serverAddress();
  $('on-name').addEventListener('change', () => { settings.mpName = $('on-name').value.trim().slice(0, 16); save(); if (net.online) net.send('name', { name: settings.mpName }); });

  async function connect() {
    const name = $('on-name').value.trim().slice(0, 16) || settings.mpName || '';
    if (!name) { $('on-name').focus(); $('on-connect-msg').textContent = 'Pick a driver name first.'; return false; }
    settings.mpName = name; save();
    const server = $('on-server').value.trim() || defaultServer();
    setServerAddress(server);
    const btn = $('on-go');
    btn.disabled = true;
    $('on-connect-msg').textContent = 'Connecting…';
    setStatus();
    try {
      await net.connect(server, name, () => { $('on-connect-msg').textContent = 'Waking up the server… free servers sleep when nobody is playing, this can take up to a minute.'; });
      $('on-connect-msg').textContent = '';
      setStatus();
      if (ui.pendingCode) { const c = ui.pendingCode; ui.pendingCode = null; net.send('join', { code: c, car: myCar() }); }
      page('browse');
      return true;
    } catch (e) {
      $('on-connect-msg').textContent = e.message;
      setStatus();
      return false;
    } finally { btn.disabled = false; }
  }
  $('on-go').addEventListener('click', connect);


  // ------------------------------------------------------------------ browse page
  $('on-code').addEventListener('input', () => { $('on-code').value = $('on-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const joinCode = () => {
    const c = $('on-code').value.trim().toUpperCase();
    if (c.length < 5) return toast('Codes have 5 letters / numbers.', true);
    net.send('join', { code: c, car: myCar() });
  };
  $('on-join').addEventListener('click', joinCode);
  $('on-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinCode(); });
  const create = pub => net.send('create', {
    name: `${settings.mpName || net.name}'s Grand Prix`,
    settings: { track: settings.track, cond: settings.cond || 'day', laps: settings.mpLaps || 3, ai: settings.mpAi ?? 5, aiDiff: settings.diff, public: pub, collisions: true, equal: true, maxPlayers: 8 },
    car: myCar(),
  });
  $('on-create').addEventListener('click', () => create(true));
  $('on-create-priv').addEventListener('click', () => create(false));
  $('on-refresh').addEventListener('click', () => net.send('list'));

  net.on('lobbies', m => {
    const el = $('on-list');
    if (!m.list.length) { el.innerHTML = '<div class="on-empty">No public lobbies right now.<br>Create one and share the code with your friends!</div>'; return; }
    el.innerHTML = m.list.map(l => `<button class="on-lob${l.state !== 'lobby' ? ' busy' : ''}" data-code="${esc(l.code)}" ${l.state !== 'lobby' || l.players >= l.max ? 'disabled' : ''}>
      <div class="ol-main"><b>${esc(l.name)}</b><span>${esc(trackName(l.track))} · ${COND[l.cond] || 'DAY'} · ${l.laps} LAPS · host ${esc(l.host)}</span></div>
      <div class="ol-side"><b>${l.players}/${l.max}</b><span>${l.state === 'lobby' ? (l.players >= l.max ? 'FULL' : 'JOIN ▶') : 'RACING'}</span></div></button>`).join('');
    el.querySelectorAll('.on-lob').forEach(b => b.addEventListener('click', () => net.send('join', { code: b.dataset.code, car: myCar() })));
  });
  // ------------------------------------------------------------------ lobby room
  const teamSel = $('lb-team'), drvSel = $('lb-driver'), tyreSel = $('lb-tyre');
  teamSel.innerHTML = TEAMS.map(t => `<option value="${t.id}">${esc(t.name.toUpperCase())}</option>`).join('');
  const fillDrivers = () => {
    const t = TEAMS.find(x => x.id === teamSel.value) || TEAMS[0];
    drvSel.innerHTML = t.drivers.map((d, i) => `<option value="${i}">#${d.num} ${esc(d.name)}</option>`).join('');
  };
  const sendCar = () => {
    settings.team = teamSel.value; settings.driver = Number(drvSel.value) || 0; settings.tyre = tyreSel.value; save();
    net.send('car', myCar());
  };
  teamSel.addEventListener('change', () => { fillDrivers(); drvSel.value = '0'; sendCar(); });
  drvSel.addEventListener('change', sendCar);
  tyreSel.addEventListener('change', sendCar);

  const ctlRow = (label, html) => `<div class="lbs-row"><span>${label}</span><div class="lbs-ctl">${html}</div></div>`;
  const chips = (key, opts, cur) => opts.map(([v, l]) => `<button class="chip${String(v) === String(cur) ? ' on' : ''}" data-k="${key}" data-v="${v}">${l}</button>`).join('');
  const stepper = key => `<button class="on-mini" data-step="${key}" data-d="-1">−</button><b class="lbs-val">${ui.lobby.settings[key]}</b><button class="on-mini" data-step="${key}" data-d="1">+</button>`;
  function renderSettings() {
    const s = ui.lobby.settings, host = isHost();
    const near = DIFFS.reduce((a, d) => (Math.abs(d[0] - s.aiDiff) < Math.abs(a[0] - s.aiDiff) ? d : a))[0];
    $('lb-hostnote').textContent = host ? 'You are the host' : 'Only the host can change these';
    $('lb-settings').classList.toggle('ro', !host);
    $('lb-settings').innerHTML =
      ctlRow('CIRCUIT', `<select class="on-input on-sel" data-k="track" ${host ? '' : 'disabled'}>${TRACKS.map(t => `<option value="${t.id}" ${t.id === s.track ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`) +
      ctlRow('CONDITIONS', chips('cond', [['day', '☀ DAY'], ['night', '☾ NIGHT'], ['rain', '☂ RAIN']], s.cond)) +
      ctlRow('LAPS', stepper('laps')) + ctlRow('AI CARS', stepper('ai')) +
      ctlRow('AI LEVEL', chips('aiDiff', DIFFS, near)) + ctlRow('MAX PLAYERS', stepper('maxPlayers')) +
      ctlRow('COLLISIONS', chips('collisions', [[true, 'ON'], [false, 'GHOST']], s.collisions)) +
      ctlRow('EQUAL CARS', chips('equal', [[true, 'ON'], [false, 'UPGRADES']], s.equal)) +
      ctlRow('VISIBILITY', chips('public', [[true, 'PUBLIC'], [false, 'PRIVATE']], s.public));
    if (!host) return;
    const put = patch => net.send('settings', { settings: { ...ui.lobby.settings, ...patch } });
    const root = $('lb-settings');
    root.querySelectorAll('select[data-k]').forEach(el => el.addEventListener('change', () => put({ [el.dataset.k]: el.value })));
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => put({ [b.dataset.step]: ui.lobby.settings[b.dataset.step] + Number(b.dataset.d) })));
    root.querySelectorAll('.chip[data-k]').forEach(b => b.addEventListener('click', () => {
      const raw = b.dataset.v;
      const v = raw === 'true' ? true : raw === 'false' ? false : isNaN(Number(raw)) ? raw : Number(raw);
      put({ [b.dataset.k]: v });
    }));
  }

  function renderPlayers() {
    const L = ui.lobby, host = isHost();
    $('lb-players').innerHTML = L.players.map(p => {
      const t = TEAMS.find(x => x.id === p.team) || TEAMS[0], d = t.drivers[p.driver] || t.drivers[0];
      const me = p.id === net.id;
      const st = L.state !== 'lobby' ? (p.finished ? 'FINISHED' : p.loaded ? 'RACING' : 'LOADING') : p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY';
      return `<div class="lbp${me ? ' me' : ''}" style="--tc:${t.color}">
        <i class="lbp-bar"></i><div class="lbp-main"><b>${esc(p.name)}${me ? ' <em>(you)</em>' : ''}</b><span>${esc(t.name)} · #${d.num} ${esc(d.code)} · ${esc(p.tyre)}</span></div>
        <div class="lbp-ping">${p.ping ? p.ping + ' ms' : ''}</div>
        <div class="lbp-st ${p.host ? 'host' : p.ready ? 'ok' : ''}">${st}</div>
        ${host && !me && L.state === 'lobby' ? `<button class="on-mini lbp-kick" data-kick="${p.id}" title="Remove from lobby">✕</button>` : ''}</div>`;
    }).join('') + `<div class="lbp-ai">+ ${L.settings.ai} AI driver${L.settings.ai === 1 ? '' : 's'} fill the grid</div>`;
    $('lb-players').querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => net.send('kick', { id: Number(b.dataset.kick) })));
  }

  function renderLobby() {
    const L = ui.lobby;
    if (!L) return;
    $('lb-name').textContent = L.name;
    $('lb-sub').textContent = `${trackName(L.settings.track)} · ${COND[L.settings.cond] || 'DAY'} · ${L.settings.laps} LAPS · ${L.players.length}/${L.settings.maxPlayers} PLAYERS · ${L.settings.public ? 'PUBLIC' : 'PRIVATE'}`;
    $('lb-code').textContent = L.code;
    const me = L.players.find(p => p.id === net.id);
    if (me && !document.activeElement?.classList?.contains('on-sel')) { teamSel.value = me.team; fillDrivers(); drvSel.value = String(me.driver); tyreSel.value = me.tyre; }
    ui.ready = !!me?.ready;
    const host = isHost();
    $('lb-ready').classList.toggle('hidden', host);
    $('lb-ready').textContent = ui.ready ? 'NOT READY' : 'READY';
    $('lb-ready').classList.toggle('primary', !ui.ready);
    $('lb-start').classList.toggle('hidden', !host);
    const waiting = L.players.filter(p => !p.host && !p.ready).length;
    $('lb-start').disabled = waiting > 0 || L.state !== 'lobby';
    $('lb-wait').textContent = L.state !== 'lobby' ? 'Race in progress…' : waiting ? `Waiting for ${waiting} driver${waiting > 1 ? 's' : ''} to get ready` : L.players.length < 2 ? 'Share the code with friends (or race the AI solo)' : 'Everyone is ready!';
    [teamSel, drvSel, tyreSel].forEach(el => { el.disabled = L.state !== 'lobby'; });
    renderPlayers(); renderSettings();
  }
  const addChat = m => {
    ui.chat.push(m); if (ui.chat.length > 60) ui.chat.shift();
    const el = $('lb-chat');
    el.innerHTML = ui.chat.map(c => (c.sys ? `<div class="lc sys">${esc(c.text)}</div>` : `<div class="lc"><b>${esc(c.from)}</b> ${esc(c.text)}</div>`)).join('');
    el.scrollTop = el.scrollHeight;
  };
  $('lb-chat-form').addEventListener('submit', e => { e.preventDefault(); const v = $('lb-chat-in').value.trim(); if (v) net.send('chat', { text: v }); $('lb-chat-in').value = ''; });

  const shareLink = () => {
    const u = new URL(location.href.split('#')[0].split('?')[0]);
    u.searchParams.set('join', ui.lobby.code);
    const srv = serverAddress();
    if (srv !== location.origin) u.searchParams.set('server', srv);
    return u.toString();
  };
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { prompt('Copy this:', text); } };
  $('lb-copy').addEventListener('click', () => copy(ui.lobby.code, 'Code copied: ' + ui.lobby.code));
  $('lb-link').addEventListener('click', async () => {
    const url = shareLink();
    if (navigator.share) { try { await navigator.share({ title: 'F1 Grand Prix Racer', text: `Race me online! Lobby code ${ui.lobby.code}`, url }); return; } catch { /* cancelled */ } }
    copy(url, 'Invite link copied');
  });
  $('lb-ready').addEventListener('click', () => net.send('ready', { ready: !ui.ready }));
  $('lb-start').addEventListener('click', () => net.send('start'));
  $('lb-leave').addEventListener('click', () => { net.send('leave'); ui.lobby = null; page('browse'); });

  // ------------------------------------------------------------------ server events
  net.on('joined', () => { ui.chat = []; $('lb-chat').innerHTML = ''; page('lobby'); });
  net.on('lobby', m => { ui.lobby = m.lobby; renderLobby(); onLobbyUpdate && onLobbyUpdate(m.lobby); });
  net.on('chat', addChat);
  net.on('error', m => { toast(m.msg, true); if (ui.page === 'connect') $('on-connect-msg').textContent = m.msg; });
  net.on('kicked', () => { ui.lobby = null; toast('The host removed you from the lobby.', true); page('browse'); });
  net.on('left', () => { ui.lobby = null; });
  net.on('close', m => {
    const inRace = !!ui.lobby && ui.lobby.state !== 'lobby';
    const msg = 'Lost connection to the multiplayer server.';
    ui.lobby = null; setStatus(); page('connect');
    $('on-connect-msg').textContent = msg;
    onShowMenu(inRace ? msg : null, true);
  });
  net.on('start', m => onStartRace(m, ui.lobby));

  // ------------------------------------------------------------------ open / close
  function open() {
    $('menu').classList.add('hidden');
    $('online').classList.remove('hidden');
    if (net.online) page(ui.lobby ? 'lobby' : 'browse');
    else { page('connect'); if (settings.mpName && ui.pendingCode) connect(); }
  }
  function backToRoom() { // after a race: show the lobby room again
    $('online').classList.remove('hidden');
    if (net.online && ui.lobby) { page('lobby'); renderLobby(); } else page(net.online ? 'browse' : 'connect');
  }
  $('online').querySelector('[data-on="back"]').addEventListener('click', () => {
    if (ui.lobby) { net.send('leave'); ui.lobby = null; }
    clearInterval(listTimer);
    $('online').classList.add('hidden');
    onShowMenu();
  });

  // invite links: ?join=CODE (optionally &server=...)
  const q = new URLSearchParams(location.search);
  const jc = (q.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (jc.length === 5) { ui.pendingCode = jc; $('on-code').value = jc; }
  if (q.get('server')) $('on-server').value = q.get('server');

  const leave = () => { if (ui.lobby) net.send('leave'); ui.lobby = null; };
  return { net, open, backToRoom, leave, get lobby() { return ui.lobby; }, isHost, toast, hasInvite: () => !!ui.pendingCode };
}
