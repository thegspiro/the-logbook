import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const portArgument = process.argv.indexOf('--port');
const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : 4173);
let serveUpgradedWorker = false;
/** Training submissions the stand-in API received, for the background-sync test. */
const receivedSubmissions = [];

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  // Test-only switch used to prove that an already controlled page activates
  // a changed worker. This server binds to loopback and is never shipped.
  if (request.method === 'POST' && url.pathname === '/__pwa-test/upgrade-worker') {
    serveUpgradedWorker = true;
    response.writeHead(204).end();
    return;
  }

  // Test-only stand-ins for the two API calls the service worker's background
  // sync makes for a queued training submission: who is signed in, and the
  // submission itself, which is recorded with the CSRF header it carried.
  if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'member-e2e' }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/training/submissions') {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    receivedSubmissions.push({ body: JSON.parse(raw || 'null'), csrf: request.headers['x-csrf-token'] ?? null });
    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'submission-e2e' }));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__pwa-test/received') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(receivedSubmissions));
    return;
  }

  // Test-only stand-in for a department's own website embedding a public
  // form. Requested as http://localhost so the iframe below is cross-site.
  if (request.method === 'GET' && url.pathname === '/__pwa-test/embedding-site') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      `<!doctype html><title>Department</title><iframe src="http://127.0.0.1:${port}/embed/f/abcdef123456"></iframe>`
    );
    return;
  }

  let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relativePath) relativePath = 'index.html';
  let file = path.resolve(root, relativePath);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400).end('Invalid path');
    return;
  }

  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    // Match the production SPA fallback for navigation routes, but never turn
    // missing assets or API requests into a misleading HTML 200 response.
    if (request.method !== 'GET' || path.extname(relativePath) || url.pathname.startsWith('/api/')) {
      response.writeHead(404).end('Not found');
      return;
    }
    file = path.join(root, 'index.html');
  }

  const headers = {
    'Content-Type': contentTypes.get(path.extname(file)) ?? 'application/octet-stream',
    'Cache-Control': path.basename(file) === 'sw.js' ? 'no-cache, no-store, must-revalidate' : 'no-cache',
  };
  response.writeHead(200, headers);
  const stream = createReadStream(file);
  stream.pipe(response, { end: !serveUpgradedWorker || path.basename(file) !== 'sw.js' });
  if (serveUpgradedWorker && path.basename(file) === 'sw.js') {
    stream.on('end', () => response.end('\n/* pwa-upgrade-smoke-v2 */\n'));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PWA test server listening on http://127.0.0.1:${port}`);
});
