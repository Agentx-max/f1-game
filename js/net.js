// WebSocket client for online multiplayer (game server: netcode/lobbies.cjs + js/lobbycore.mjs).
/* global __MP_SERVER__ */
import { PROTOCOL } from './lobbycore.mjs';
export { PROTOCOL };
const BAKED = typeof __MP_SERVER__ !== 'undefined' ? __MP_SERVER__ : ''; // set at build time: npm run build -- --server=https://...

// Which server to use: ?server=... in the URL > address saved in the Online screen > build default > this website.
export function serverAddress() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  return localStorage.getItem('f1gp.mpServer') || BAKED || (location.protocol.startsWith('http') ? location.origin : 'http://localhost:8080');
}
export const defaultServer = () => BAKED || (location.protocol.startsWith('http') ? location.origin : 'http://localhost:8080');
export function setServerAddress(s) {
  s = String(s || '').trim();
  if (!s || s === defaultServer()) localStorage.removeItem('f1gp.mpServer'); else localStorage.setItem('f1gp.mpServer', s);
}
export function wsUrl(server) {
  let u = String(server).trim().replace(/\/+$/, '').replace(/\/mp$/, '');
  if (!/^[a-z]+:\/\//i.test(u)) u = (/^(localhost|127\.|192\.168\.|10\.)/.test(u) ? 'http://' : 'https://') + u;
  return u.replace(/^http/i, 'ws') + '/mp';
}
export function healthUrl(server) { return wsUrl(server).replace(/^ws/i, 'http').replace(/\/mp$/, '/healthz'); }

export class Net {
  constructor() {
    this.ws = null; this.id = null; this.name = '';
    this.status = 'offline'; // offline | connecting | online
    this.handlers = {};
    this.out = [];
    this.rtt = 0;
    this.timers = [];
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); return () => { this.handlers[t] = this.handlers[t].filter(f => f !== fn); }; }
  emit(t, m) { for (const f of this.handlers[t] || []) { try { f(m); } catch (e) { console.error(e); } } }
  get online() { return this.status === 'online' && this.ws && this.ws.readyState === 1; }

  // resolves once the server says welcome; free hosts can take ~1 minute to wake up, so be patient
  connect(server, name, onWaking) {
    this.close();
    this.status = 'connecting';
    return new Promise((resolve, reject) => {
      let settled = false, ws;
      const fail = msg => { if (settled) return; settled = true; this.close(); reject(new Error(msg)); };
      const wakeT = setTimeout(() => onWaking && onWaking(), 3500);
      const giveUp = setTimeout(() => fail('The multiplayer server did not answer. Check the server address, or try again in a minute (free servers sleep when nobody plays).'), 75000);
      const attempt = () => {
        try { ws = new WebSocket(wsUrl(server)); } catch (e) { return fail('Invalid server address.'); }
        this.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, name }));
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'b' && Array.isArray(m.m)) { for (const x of m.m) this.emit(x.t, x); return; }
          if (m.t === 'welcome' && !settled) {
            settled = true; clearTimeout(wakeT); clearTimeout(giveUp);
            this.id = m.id; this.name = m.name; this.status = 'online';
            this.startPing();
            resolve(m);
          }
          this.emit(m.t, m);
        };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          if (!settled) { setTimeout(() => { if (!settled && this.status === 'connecting') attempt(); }, 2500); return; } // sleeping server: keep knocking
          this.status = 'offline'; this.stopPing(); this.ws = null;
          this.emit('close', {});
        };
        ws.onerror = () => {};
      };
      attempt();
    });
  }

  // transport hooks
  _tx(s) { this.ws.send(s); }
  _buffered() { return this.ws.bufferedAmount; }

  send(t, data = {}) { if (this.online) this._tx(JSON.stringify({ t, ...data })); }
  // queue small high-rate messages and send them together (one frame per tick)
  queue(t, data) { this.out.push({ t, ...data }); }
  flush() {
    if (!this.out.length) return;
    if (this.online && this._buffered() < 64 * 1024) {
      for (let k = 0; k < this.out.length; k += 24) this._tx(JSON.stringify({ t: 'b', m: this.out.slice(k, k + 24) }));
    }
    this.out.length = 0;
  }

  startPing() {
    this.stopPing();
    const unsub = this.on('pong', m => { this.rtt = Math.round(performance.now() - m.c); });
    let n = 0;
    const iv = setInterval(() => {
      this.send('ping', { c: performance.now() });
      if (++n % 3 === 0) this.send('rtt', { ms: this.rtt });
    }, 2000);
    this.timers = [iv, unsub];
  }
  stopPing() { for (const t of this.timers) typeof t === 'function' ? t() : clearInterval(t); this.timers = []; }

  close() {
    this.stopPing();
    const ws = this.ws;
    this.ws = null; this.status = 'offline'; this.out.length = 0;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* ignore */ } }
  }
}
