import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The embed page's framing policy is written per request by nginx; the
 * service worker's precached index.html carries DENY. A worker that answered
 * an /embed/ navigation from that copy would block every embed, and the
 * console would name no reason — so the denylist entry is checked here.
 */
describe('service worker and /embed/', () => {
  it('never answers an /embed/ navigation from the precache', () => {
    const config = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf8');
    const denylist = /navigateFallbackDenylist:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
    expect(denylist).toContain('/^\\/embed\\//');
  });
});
