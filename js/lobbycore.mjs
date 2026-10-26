// Lobby + race relay logic for the online multiplayer server (run by netcode/lobbies.cjs).
// Each client simulates its own car and streams snapshots; the lobby host also simulates the AI cars.
// This code owns lobby state, join codes, the start signal and the finishing order.
// A "conn" is any object with send(string), open() -> bool, buffered() -> bytes waiting, close().
export const PROTOCOL = 1;
const TRACK_IDS = ['it-1922', 'gb-1948', 'be-1925', 'at-1969', 'az-2016', 'mc-1929'];
const TEAM_IDS = ['mercedes', 'ferrari', 'redbull', 'forceindia', 'williams', 'renault', 'tororosso', 'haas', 'mclaren', 'sauber'];
const TYRES = ['supersoft', 'soft', 'medium', 'hard'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const MAX_CARS = 20;
const LOAD_TIMEOUT = 30000, FINISH_GRACE = 60000, RACE_TIMEOUT = 45 * 60000;

const clampInt = (v, lo, hi, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };

export function makeCode(taken = () => false) {
  for (let tries = 0; tries < 100; tries++) {
    let c = '';
    for (let k = 0; k < 5; k++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!taken(c)) return c;
  }
  return null;
}
export const isCode = c => typeof c === 'string' && c.length === 5 && [...c].every(ch => CODE_CHARS.includes(ch));

function sanitizeSettings(s, prev) {
  const p = prev || { track: 'it-1922', cond: 'day', laps: 3, ai: 5, aiDiff: 0.91, maxPlayers: 8, public: true, collisions: true, equal: true };
  s = s || {};
  const bool = k => (s[k] === undefined ? p[k] : !!s[k]);
  const diff = Number(s.aiDiff ?? p.aiDiff);
  return {
    track: TRACK_IDS.includes(s.track) ? s.track : p.track,
    cond: ['day', 'night', 'rain'].includes(s.cond) ? s.cond : p.cond, // time of day / weather
    laps: clampInt(s.laps ?? p.laps, 1, 30, 3),
    ai: clampInt(s.ai ?? p.ai, 0, MAX_CARS - 1, 5),
    aiDiff: Number.isFinite(diff) ? Math.max(0.8, Math.min(0.995, diff)) : 0.91,
    maxPlayers: clampInt(s.maxPlayers ?? p.maxPlayers, 2, MAX_CARS, 8),
    public: bool('public'),
    collisions: bool('collisions'), // off = drivers pass through each other (no wrecking)
    equal: bool('equal'), // on = garage upgrades + EASY grip bonus are switched off for a fair race
  };
}

// grid: humans spread evenly through the field, AI drivers fill the remaining seats
function buildGrid(lobby) {
  const used = new Set();
  const hs = [];
  for (const p of lobby.players) {
    let d = p.driver;
    if (used.has(p.team + ':' + d)) d = 1 - d; // two humans picked the same car: take the team-mate's
    if (used.has(p.team + ':' + d)) { const free = TEAM_IDS.flatMap(t => [[t, 0], [t, 1]]).find(([t, k]) => !used.has(t + ':' + k)); p.team = free[0]; d = free[1]; }
    p.driver = d;
    used.add(p.team + ':' + d);
    hs.push({ id: p.id, name: p.name, team: p.team, driver: d, tyre: p.tyre });
  }
  const nAI = Math.max(0, Math.min(lobby.settings.ai, MAX_CARS - hs.length));
  const pool = shuffle(TEAM_IDS.flatMap(t => [[t, 0], [t, 1]]).filter(([t, d]) => !used.has(t + ':' + d)));
  const ai = pool.slice(0, nAI).map(([team, driver]) => ({ id: null, name: null, team, driver, tyre: Math.random() < 0.6 ? 'soft' : 'medium' }));
  shuffle(hs);
  const grid = [], total = hs.length + ai.length;
  let hi = 0, aj = 0;
  for (let k = 0; k < total; k++) {
    const wantHuman = hi < hs.length && (aj >= ai.length || Math.floor((k + 1) * hs.length / total) > hi);
    grid.push(wantHuman ? hs[hi++] : ai[aj++]);
  }
  grid.forEach((g, k) => { g.slot = k; });
  return grid;
}

// options:
//   maxLobbies  - server capacity
//   fixedCode   - force one lobby code (tests)
//   allowCreate - who may open lobbies
export function createLobbyCore({ maxLobbies = 300, fixedCode = null, allowCreate = () => true } = {}) {
  const lobbies = new Map(); // code -> lobby
  const players = new Set();
  let nextId = 1;
  const send = (conn, type, data = {}) => { if (conn.open()) conn.send(JSON.stringify({ t: type, ...data })); };
  function broadcast(lobby, type, data, except) {
    const msg = JSON.stringify({ t: type, ...data });
    for (const p of lobby.players) if (p.conn !== except && p.conn.open()) p.conn.send(msg);
  }
  const publicPlayer = (p, lobby) => ({ id: p.id, name: p.name, team: p.team, driver: p.driver, tyre: p.tyre, ready: p.ready, host: lobby.hostId === p.id, ping: p.ping, loaded: p.loaded, finished: p.finished });
  const lobbyState = lobby => ({ code: lobby.code, name: lobby.name, hostId: lobby.hostId, state: lobby.state, settings: lobby.settings, players: lobby.players.map(p => publicPlayer(p, lobby)) });
  const pushLobby = lobby => broadcast(lobby, 'lobby', { lobby: lobbyState(lobby) });
  const sysChat = (lobby, text) => broadcast(lobby, 'chat', { sys: true, text });

  function lobbyList() {
    const out = [];
    for (const l of lobbies.values()) {
      if (!l.settings.public) continue;
      out.push({ code: l.code, name: l.name, players: l.players.length, max: l.settings.maxPlayers, track: l.settings.track, cond: l.settings.cond, laps: l.settings.laps, state: l.state, host: l.players.find(p => p.id === l.hostId)?.name || '' });
    }
    out.sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.players - a.players);
    return out.slice(0, 50);
  }

  function clearLobbyTimers(lobby) {
    clearTimeout(lobby.loadTimer); clearTimeout(lobby.finishTimer); clearTimeout(lobby.raceTimer);
    lobby.loadTimer = lobby.finishTimer = lobby.raceTimer = null;
  }

  function leaveLobby(player, reason) {
    const lobby = player.lobby;
    if (!lobby) return;
    player.lobby = null;
    lobby.players = lobby.players.filter(p => p !== player);
    if (!lobby.players.length) { clearLobbyTimers(lobby); lobbies.delete(lobby.code); return; }
    if (lobby.hostId === player.id) {
      lobby.hostId = lobby.players[0].id;
      sysChat(lobby, `${lobby.players[0].name} is now the host`);
    }
    sysChat(lobby, `${player.name} ${reason || 'left'}`);
    if (lobby.state === 'racing' || lobby.state === 'loading') {
      // the leaving car is retired (DNF) for everybody
      const g = lobby.grid.find(x => x.id === player.id);
      if (g) { g.id = null; g.left = true; }
      broadcast(lobby, 'retired', { slot: g ? g.slot : -1, hostId: lobby.hostId });
      checkRaceProgress(lobby);
    }
    pushLobby(lobby);
  }

  function startRace(lobby) {
    clearLobbyTimers(lobby);
    lobby.state = 'loading';
    lobby.grid = buildGrid(lobby);
    lobby.finishes = [];
    lobby.seed = Math.floor(Math.random() * 1e9);
    for (const p of lobby.players) { p.loaded = false; p.finished = false; p.ready = false; }
    broadcast(lobby, 'start', { grid: lobby.grid, settings: lobby.settings, seed: lobby.seed, hostId: lobby.hostId });
    pushLobby(lobby);
    lobby.loadTimer = setTimeout(() => go(lobby), LOAD_TIMEOUT);
    lobby.raceTimer = setTimeout(() => endRace(lobby, 'time limit reached'), RACE_TIMEOUT);
  }

  function go(lobby) {
    if (lobby.state !== 'loading') return;
    clearTimeout(lobby.loadTimer); lobby.loadTimer = null;
    lobby.state = 'racing';
    const holdT = 0.3 + (lobby.seed % 1000) / 1000 * 2.2; // same random lights-out delay for everyone
    broadcast(lobby, 'go', { holdT });
    pushLobby(lobby);
  }

  function checkRaceProgress(lobby) {
    if (lobby.state === 'loading' && lobby.players.every(p => p.loaded)) go(lobby);
    if (lobby.state === 'racing' && lobby.players.length && lobby.players.every(p => p.finished)) {
      clearTimeout(lobby.finishTimer);
      lobby.finishTimer = setTimeout(() => endRace(lobby, 'all drivers finished'), 6000);
    }
  }

  function endRace(lobby, why) {
    if (lobby.state !== 'racing' && lobby.state !== 'loading') return;
    clearLobbyTimers(lobby);
    lobby.state = 'lobby';
    broadcast(lobby, 'end', { why, finishes: lobby.finishes });
    for (const p of lobby.players) { p.ready = false; p.loaded = false; p.finished = false; }
    pushLobby(lobby);
  }

  function recordFinish(lobby, slot, time, best) {
    if (lobby.state !== 'racing' || lobby.finishes.some(f => f.slot === slot)) return;
    const f = { slot, time: Number(time) || 0, best: Number(best) || null, order: lobby.finishes.length + 1 };
    lobby.finishes.push(f);
    broadcast(lobby, 'finish', f);
    const g = lobby.grid[slot];
    if (f.order === 1) {
      clearTimeout(lobby.finishTimer);
      lobby.finishTimer = setTimeout(() => endRace(lobby, 'chequered flag'), FINISH_GRACE);
    }
    if (g && g.id != null) { const p = lobby.players.find(q => q.id === g.id); if (p) p.finished = true; }
    checkRaceProgress(lobby);
  }

  function joinLobby(player, lobby, car) {
    player.lobby = lobby;
    player.ready = false; player.loaded = false; player.finished = false;
    if (car) {
      if (TEAM_IDS.includes(car.team)) player.team = car.team;
      if (car.driver === 0 || car.driver === 1) player.driver = car.driver;
      if (TYRES.includes(car.tyre)) player.tyre = car.tyre;
    }
    lobby.players.push(player);
    send(player.conn, 'joined', { code: lobby.code });
    sysChat(lobby, `${player.name} joined`);
    pushLobby(lobby);
  }

  // may this player send data for grid slot k? (own car, or AI / departed cars if host)
  const ownsSlot = (lobby, player, k) => { const g = lobby.grid[k]; return !!g && (g.id === player.id || (g.id == null && lobby.hostId === player.id)); };
  function handle(player, msg) {
    const conn = player.conn;
    switch (msg.t) {
      case 'hello':
        player.name = cleanText(msg.name, 16) || player.name;
        if (msg.v !== PROTOCOL) send(conn, 'error', { msg: 'Game version mismatch: refresh the page to update.' });
        return send(conn, 'welcome', { id: player.id, name: player.name, protocol: PROTOCOL });
      case 'name':
        player.name = cleanText(msg.name, 16) || player.name;
        if (player.lobby) pushLobby(player.lobby);
        return;
      case 'ping': return send(conn, 'pong', { c: msg.c });
      case 'rtt': player.ping = clampInt(msg.ms, 0, 9999, 0); return;
      case 'list': return send(conn, 'lobbies', { list: lobbyList() });
      case 'create': {
        if (!allowCreate(player)) return send(conn, 'error', { msg: 'Only the host can create the lobby.' });
        if (player.lobby) leaveLobby(player);
        if (lobbies.size >= maxLobbies) return send(conn, 'error', { msg: 'Server is full, try again in a minute.' });
        const code = fixedCode || makeCode(c => lobbies.has(c));
        if (!code || lobbies.has(code)) return send(conn, 'error', { msg: 'Could not create a lobby, try again.' });
        const l = { code, name: cleanText(msg.name, 28) || `${player.name}'s Grand Prix`, hostId: player.id, state: 'lobby', settings: sanitizeSettings(msg.settings), players: [], grid: [], finishes: [] };
        lobbies.set(code, l);
        return joinLobby(player, l, msg.car);
      }
      case 'join': {
        const code = cleanText(msg.code, 8).toUpperCase();
        const l = lobbies.get(code);
        if (!l) return send(conn, 'error', { msg: fixedCode ? 'The host has not opened the lobby yet, try again in a moment.' : `No lobby with code ${code || '?'}. Check the code and try again.` });
        if (l === player.lobby) return pushLobby(l);
        if (l.players.length >= l.settings.maxPlayers) return send(conn, 'error', { msg: 'That lobby is full.' });
        if (l.state !== 'lobby') return send(conn, 'error', { msg: 'That lobby is racing right now. Try again when the race ends.' });
        if (player.lobby) leaveLobby(player);
        return joinLobby(player, l, msg.car);
      }
      case 'leave':
        leaveLobby(player);
        return send(conn, 'left', {});
    }
    if (player.lobby) handleInLobby(player, msg, player.lobby);
  }
  function handleInLobby(player, msg, lobby) {
    const conn = player.conn;
    const isHost = lobby.hostId === player.id;
    switch (msg.t) {
      case 'car':
        if (lobby.state !== 'lobby') return;
        if (TEAM_IDS.includes(msg.team)) player.team = msg.team;
        if (msg.driver === 0 || msg.driver === 1) player.driver = msg.driver;
        if (TYRES.includes(msg.tyre)) player.tyre = msg.tyre;
        return pushLobby(lobby);
      case 'ready':
        if (lobby.state !== 'lobby') return;
        player.ready = !!msg.ready;
        return pushLobby(lobby);
      case 'settings':
        if (!isHost || lobby.state !== 'lobby') return;
        lobby.settings = sanitizeSettings(msg.settings, lobby.settings);
        if (msg.name !== undefined) lobby.name = cleanText(msg.name, 28) || lobby.name;
        return pushLobby(lobby);
      case 'chat': {
        const text = cleanText(msg.text, 140);
        const now = Date.now();
        if (!text || now - (player.lastChat || 0) < 600) return;
        player.lastChat = now;
        return broadcast(lobby, 'chat', { from: player.name, id: player.id, text });
      }
      case 'kick': {
        if (!isHost || msg.id === player.id) return;
        const target = lobby.players.find(p => p.id === msg.id);
        if (!target) return;
        leaveLobby(target, 'was removed by the host');
        return send(target.conn, 'kicked', {});
      }
      case 'start':
        if (!isHost || lobby.state !== 'lobby') return;
        if (lobby.players.some(p => p.id !== player.id && !p.ready)) return send(conn, 'error', { msg: 'Wait until every driver is ready.' });
        return startRace(lobby);
      case 'loaded':
        if (lobby.state !== 'loading') return;
        player.loaded = true;
        pushLobby(lobby);
        return checkRaceProgress(lobby);
      case 's': // car snapshot: collected and relayed as one batch per incoming frame
        if ((lobby.state !== 'racing' && lobby.state !== 'loading') || !Array.isArray(msg.d) || msg.d.length > 24 || !ownsSlot(lobby, player, msg.k)) return;
        player.relay.push({ t: 's', k: msg.k, d: msg.d });
        return;
      case 'finish':
        if (!ownsSlot(lobby, player, msg.k)) return;
        return recordFinish(lobby, msg.k, msg.time, msg.best);
      case 'abort':
        if (!isHost) return;
        sysChat(lobby, 'The host ended the race');
        return endRace(lobby, 'host ended the race');
    }
  }

  // a client connected: the transport calls message(rawText) for every frame and close() once
  function connect(conn) {
    const player = { id: nextId++, conn, name: 'Driver' + Math.floor(100 + Math.random() * 900), team: 'mclaren', driver: 0, tyre: 'soft', lobby: null, ready: false, loaded: false, finished: false, ping: 0, msgs: 0, msgWindow: Date.now(), relay: [] };
    players.add(player);
    return {
      player,
      message(raw) {
        const now = Date.now(); // flood protection
        if (now - player.msgWindow > 1000) { player.msgWindow = now; player.msgs = 0; }
        if (++player.msgs > 120) return;
        let msg;
        try { msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch { return; }
        if (!msg || typeof msg.t !== 'string') return;
        const list = msg.t === 'b' && Array.isArray(msg.m) ? msg.m.slice(0, 24) : [msg]; // 'b' = batch
        for (const m of list) {
          if (!m || typeof m.t !== 'string' || m.t === 'b') continue;
          try { handle(player, m); } catch (e) { console.error('[mp] error', e); }
        }
        if (player.relay.length) {
          const lobby = player.lobby;
          const out = JSON.stringify({ t: 'b', m: player.relay });
          player.relay = [];
          if (lobby) for (const p of lobby.players) if (p !== player && p.conn.open() && p.conn.buffered() < 256 * 1024) p.conn.send(out);
        }
      },
      close(reason = 'disconnected') { if (!players.delete(player)) return; leaveLobby(player, reason); },
    };
  }

  return { connect, stats: () => ({ lobbies: lobbies.size, players: players.size }) };
}
