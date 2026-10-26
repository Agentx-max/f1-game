// Game + multiplayer server.
//   node server.js           -> serves the source files (development), http://localhost:8080
//   npm run serve            -> serves the production build in ./dist
// Online multiplayer runs on the same port at ws(s)://<host>/mp. Health check: /healthz
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./netcode/lobbies.cjs');

const base = __dirname;
const distDir = path.join(base, 'dist');
const useDist = process.env.SERVE === 'dist' || (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distDir, 'index.html')));
const root = useDist ? distDir : base;
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
// never serve server code, tooling or dependencies other than three.js (needed by the dev importmap)
const blocked = p => /(^|[\\/])(\.git|netcode|tools)([\\/]|$)/.test(p)
  || /(^|[\\/])(server\.js|package(-lock)?\.json|render\.yaml|Dockerfile|_headers)$/.test(p)
  || (/node_modules/.test(p) && !/^node_modules[\\/]three[\\/]/.test(p));

let mp;
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, ...mp.stats() }));
  }
  // backend-only mode (game hosted on Netlify): the home page just says the server is running
  if (process.env.GAME_URL && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    const u = String(process.env.GAME_URL).replace(/[<>"]/g, '');
    return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>F1 multiplayer server</title><body style="font-family:sans-serif;background:#111;color:#eee;padding:40px"><h2>F1 multiplayer server is running ✅</h2><p>${mp.stats().players} players online, ${mp.stats().lobbies} lobbies.</p><p><a style="color:#3ad1ff" href="${u}">Play the game →</a></p>`);
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root + path.sep) || blocked(path.relative(root, file))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const versioned = useDist && /\?v=/.test(req.url);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});
mp = attach(server);
server.listen(port, () => console.log(`F1 game running at http://localhost:${port}  (serving ${useDist ? 'dist/' : 'source'}; multiplayer on /mp)`));
