import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(frontendRoot, 'dist');

async function readDistFile(file) {
  return readFile(path.join(dist, file), 'utf8');
}

async function assertDistAsset(relativePath, label) {
  assert(!relativePath.startsWith('/') && !relativePath.includes('..'), `${label} must be a local asset`);
  await access(path.join(dist, relativePath));
}

const [indexHtml, manifestSource, serviceWorker] = await Promise.all([
  readDistFile('index.html'),
  readDistFile('manifest.webmanifest'),
  readDistFile('sw.js'),
]);
const manifest = JSON.parse(manifestSource);

assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/, 'index.html must link the manifest');
assert.equal(manifest.id, '/', 'the installed app must have a stable identity');
assert.equal(manifest.start_url, '/dashboard', 'the installed app must launch at the dashboard');
assert.equal(manifest.scope, '/', 'the service worker must cover every application route');
assert(
  ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display),
  'the app must use an installable display mode'
);
assert(manifest.name && manifest.short_name, 'the manifest must provide long and short names');
assert(manifest.theme_color && manifest.background_color, 'the manifest must define launch colors');

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
assert(
  icons.some((icon) => icon.sizes === '192x192'),
  'the manifest must provide a 192px icon'
);
assert(
  icons.some((icon) => icon.sizes === '512x512'),
  'the manifest must provide a 512px icon'
);
assert(
  icons.some((icon) => icon.purpose?.split(/\s+/).includes('maskable')),
  'the manifest must provide a maskable icon'
);

for (const icon of icons) await assertDistAsset(icon.src, `icon ${icon.src}`);
for (const screenshot of manifest.screenshots ?? []) {
  await assertDistAsset(screenshot.src, `screenshot ${screenshot.src}`);
}

await assertDistAsset('push-sw.js', 'push service worker');
assert.match(serviceWorker, /NavigationRoute/, 'the service worker must provide an offline navigation fallback');
assert.match(serviceWorker, /index\.html/, 'the application shell must be precached');
assert.match(serviceWorker, /NetworkOnly/, 'sensitive API and version requests must remain network-only');
assert.match(serviceWorker, /push-sw\.js\?v=/, 'the push worker must be imported with a cache-busting build id');

console.log('PWA validation passed: manifest, install assets, app shell, and service worker are present.');
