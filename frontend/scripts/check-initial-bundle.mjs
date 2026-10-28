// What every visit downloads before the first page can render: the entry
// script and everything index.html preloads with it. Run after `vite build`.
//
// Two checks. Lazy-only libraries stay out of the first load — the drag-and-
// drop, rich text editor and scanner chunks are named groups in vite.config.ts,
// and each of them has reached it before through a shared dependency (react-dom
// landed in vendor-dnd, and a catch-all vendor group took the editor). And the
// total stays under a budget: a ratchet set a little above the measured size,
// like the coverage floors in vitest.config.ts, so a regression fails here and
// a reduction is kept by lowering the number.
//
// Sizes are gzipped at zlib's default level. nginx compresses at its own level,
// so the bytes on the wire differ by a few percent; what matters here is the
// change between builds, which this measures the same way every time.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 400 * 1024;
const LAZY_ONLY_CHUNKS = ['vendor-dnd', 'vendor-editor', 'vendor-scanner'];

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');

const assets = [...new Set([...indexHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
assert(assets.length > 0, 'index.html references no assets — was the build run?');

const sizes = await Promise.all(
  assets.map(async (asset) => ({ asset, gzip: gzipSync(await readFile(path.join(dist, asset))).length }))
);
sizes.sort((a, b) => b.gzip - a.gzip);
const total = sizes.reduce((sum, { gzip }) => sum + gzip, 0);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`First load: ${sizes.length} files, ${kb(total)} gzipped (budget ${kb(BUDGET_BYTES)})`);
for (const { asset, gzip } of sizes.slice(0, 10)) console.log(`  ${kb(gzip).padStart(9)}  ${asset}`);

const leaked = assets.filter((asset) => LAZY_ONLY_CHUNKS.some((name) => path.basename(asset).startsWith(`${name}-`)));
assert.deepEqual(
  leaked,
  [],
  `lazy-only chunks are in the first load: ${leaked.join(', ')}. Something the entry imports statically now depends on them.`
);
assert(
  total <= BUDGET_BYTES,
  `the first load is ${kb(total)} gzipped, over the ${kb(BUDGET_BYTES)} budget. Lazy-load what was added, or raise the budget in this file with the reason in the commit.`
);
