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
 * This walks the module's source and fails if a raw `fetch(` call
 * reappears — every request in this module should go through the shared
 * `api` client in `services/api.ts` instead.
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
      // A bare `fetch(` call — not `.fetch(` (a method on some other object,
      // e.g. a Map or a mocked client) and not inside a comment line.
      const lines = src.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/(?<![.\w])fetch\(/.test(line)) {
          offenders.push(`${path.relative(MODULE_ROOT, file)}:${idx + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
