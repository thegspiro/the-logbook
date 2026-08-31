/**
 * Module fetch integrity (AH-21, pass 2)
 *
 * `AllEntriesTab.tsx`'s CSV export used a hand-rolled `fetch()` with a
 * manually-set `credentials: 'include'` instead of the module's shared axios
 * client (`services/api.ts`, built by `createApiClient()`). It worked, but it
 * bypassed the auth-refresh-and-retry interceptor every other request in this
 * module gets: a request that hit a 401 mid-session failed outright with a
 * generic "Export failed" toast instead of transparently refreshing the
 * session and retrying, and it also bypassed the shared error-reporting
 * integration (CLAUDE.md Pitfall #7 — a module axios instance, or a call
 * that bypasses it altogether, must not lose the auth handling every other
 * request in the app relies on).
 *
 * This walks the module's source and fails on a reintroduced bypass: a bare
 * `fetch(`, a `window.fetch(`/`globalThis.fetch(`/`self.fetch(` call (still a
 * bypass, but not caught by the bare-`fetch(` pattern alone since it's a
 * dotted call), or a direct `import axios` — every request in this module
 * should go through the shared `api` client in `services/api.ts` instead.
 * This is a source scan, not a behavioral test — see
 * `services/exportCsv.behavior.test.ts` for a test that actually drives
 * `exportCsv()` through the real client and proves the 401-refresh path
 * still applies to it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

describe('admin-hours module fetch integrity', () => {
  it('never calls the global fetch() directly — every request goes through the shared api client', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(MODULE_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        // A bare `fetch(` call — not `.fetch(` on some other object (a Map,
        // a mocked client) — OR the same call explicitly qualified onto the
        // global object (`window.fetch(`, `globalThis.fetch(`, `self.fetch(`),
        // which the bare-pattern's dot exclusion would otherwise miss.
        const isBareFetch = /(?<![.\w])fetch\(/.test(line);
        const isGlobalQualifiedFetch = /\b(?:window|globalThis|self)\.fetch\(/.test(line);
        if (isBareFetch || isGlobalQualifiedFetch) {
          offenders.push(`${path.relative(MODULE_ROOT, file)}:${idx + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never imports axios directly — every request goes through createApiClient()', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(MODULE_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      if (/from\s+['"]axios['"]/.test(src)) {
        offenders.push(path.relative(MODULE_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
