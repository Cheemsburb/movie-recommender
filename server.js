// RatingSense local dev server (zero dependencies).
// Serves the static files AND executes the /api/* serverless functions,
// so the app behaves locally exactly as it will on Vercel.
// Run: node server.js   then open http://localhost:3000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = __dirname.endsWith(sep) ? __dirname.slice(0, -1) : __dirname;
const PORT = process.env.PORT || 3000;

// Load .env so the handlers get their credentials.
try {
  loadEnvFile(join(__dirname, '.env'));
  console.log('Loaded .env — API credentials available.');
} catch {
  console.warn('Warning: could not load .env. API calls will fail without credentials.');
}

const routes = {
  '/api/search': await import('./api/search.js'),
  '/api/recommend': await import('./api/recommend.js'),
  '/api/popular': await import('./api/popular.js'),
  '/api/movie': await import('./api/movie.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // ---- API routes: delegate to the serverless handlers ----
    if (pathname.startsWith('/api/')) {
      const route = routes[pathname];
      if (!route) return sendJson(res, 404, { error: `No such route: ${pathname}` });

      const query = Object.fromEntries(url.searchParams);
      const mockReq = { method: req.method, query };
      const mockRes = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; } };
      let responded = false;
      mockRes.json = (body) => { responded = true; sendJson(res, mockRes.statusCode, body); };

      await route.default(mockReq, mockRes);
      if (!responded) sendJson(res, mockRes.statusCode, { error: 'Handler produced no response.' });
      return;
    }

    // ---- Static files (block path traversal) ----
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = normalize(join(rootDir, rel));
    if (!file.startsWith(rootDir + sep)) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }

    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err && err.code === 'ENOENT') return sendJson(res, 404, { error: 'Not found' });
    console.error(err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`RatingSense running at http://localhost:${PORT}`);
});
