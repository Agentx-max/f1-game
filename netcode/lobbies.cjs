// Online multiplayer game server (WebSocket at /mp). The lobby logic itself lives in js/lobbycore.mjs,
// which is shared with the direct P2P mode (there it runs inside the lobby host's browser).
'use strict';
const { WebSocketServer } = require('ws');

function attach(server) {
  let core = null;
  const ready = import('../js/lobbycore.mjs').then(m => { core = m.createLobbyCore({ maxLobbies: 300 }); });
  const wss = new WebSocketServer({ server, path: '/mp', maxPayload: 16 * 1024 });
  wss.on('connection', async ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    const early = [];
    let link = null, closed = false;
    ws.on('message', raw => { if (link) link.message(String(raw)); else early.push(String(raw)); });
    ws.on('close', () => { closed = true; if (link) link.close('disconnected'); });
    await ready;
    link = core.connect({ send: s => ws.send(s), open: () => ws.readyState === 1, buffered: () => ws.bufferedAmount, close: () => ws.close() });
    for (const m of early) link.message(m);
    if (closed) link.close('disconnected');
  });
  // drop dead connections (phones that lost signal) so lobbies do not fill with ghosts
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 20000);
  wss.on('close', () => clearInterval(hb));
  return { wss, stats: () => (core ? core.stats() : { lobbies: 0, players: 0 }) };
}

module.exports = { attach, PROTOCOL: 1 };