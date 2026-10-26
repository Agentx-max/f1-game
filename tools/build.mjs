// Production build: bundles + minifies the game into ./dist (drag & drop to Netlify).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'css'), { recursive: true });

// multiplayer server address baked into the build, so a Netlify copy of the game knows where to connect:
//   npm run build -- --server=https://your-game.onrender.com     (or MP_SERVER=... npm run build)
// Leave it out when the game is served by the multiplayer server itself (Render) - it then uses its own address.
const arg = process.argv.find(a => a.startsWith('--server='));
const mpServer = (arg ? arg.slice(9) : process.env.MP_SERVER || '').trim().replace(/\/+$/, '');

const t0 = Date.now();
const res = await build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  outfile: path.join(dist, 'game.js'),
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  define: { __MP_SERVER__: JSON.stringify(mpServer) },
});

// content hashes so a re-deploy never mixes a new page with a cached old script/stylesheet
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
fs.copyFileSync(path.join(root, 'css/style.css'), path.join(dist, 'css/style.css'));
const jsV = hash(path.join(dist, 'game.js')), cssV = hash(path.join(dist, 'css/style.css'));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
const before = html;
html = html.replace('<script type="module" src="js/main.js"></script>', `<script type="module" src="game.js?v=${jsV}"></script>`);
html = html.replace('href="css/style.css"', `href="css/style.css?v=${cssV}"`);
if (html === before || !html.includes('game.js?v=') || !html.includes('style.css?v=')) throw new Error('build: could not rewrite script/style tags in index.html');
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['favicon.svg', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, f), path.join(dist, f));
// optional recorded team-radio voice clips (radio/<id>.mp3 + manifest.json); without them the browser voice is used
const radioDir = path.join(root, 'radio');
if (fs.existsSync(radioDir)) fs.cpSync(radioDir, path.join(dist, 'radio'), { recursive: true });

// Netlify: page always revalidated, versioned assets cached for a year
fs.writeFileSync(path.join(dist, '_headers'), [
  '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin',
  '/', '  Cache-Control: no-cache',
  '/index.html', '  Cache-Control: no-cache',
  '/game.js', '  Cache-Control: public, max-age=31536000, immutable',
  '/css/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/manifest.webmanifest', '  Content-Type: application/manifest+json', '  Cache-Control: no-cache',
  '',
].join('\n'));

const kb = f => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log(`Built in ${Date.now() - t0} ms -> dist/  (game.js ${kb('game.js')}, index.html ${kb('index.html')}, style.css ${kb('css/style.css')})`);
console.log(mpServer ? `Online multiplayer server: ${mpServer}` : 'Online multiplayer server: https://f1-grand-prix-racer.onrender.com (official)');
void res;
