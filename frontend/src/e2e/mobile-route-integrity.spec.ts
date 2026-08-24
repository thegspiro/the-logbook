import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { MOBILE_ROUTE_COVERAGE } from './mobile-route-inventory';

test('every registered route has mobile coverage or a documented exemption', () => {
  const src = resolve(process.cwd(), 'src');
  const files = [resolve(src, 'App.tsx'), ...globSync(resolve(src, 'modules/*/routes.tsx'))];
  const registered = files.flatMap((file) => {
    // `replace(/\\/g, ...)` rather than `replaceAll`: the latter is ES2021 and
    // this project's lib is ES2020, so it resolves to an error type. Nothing
    // caught that because tsconfig excludes src/e2e from typecheck — only
    // type-aware lint sees these files.
    const source = `src/${relative(src, file).replace(/\\/g, '/')}`;
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/<Route\b[^>]*?\bpath=["']([^"']+)["']/gs)]
      .map((match) => ({ path: match[1], source }))
      .filter(({ path }) => path !== '*');
  });

  const key = ({ path, source }: { path: string; source: string }) => `${source}::${path}`;
  const inventory = new Map(MOBILE_ROUTE_COVERAGE.map((entry) => [key(entry), entry]));
  const missing = registered.filter((route) => !inventory.has(key(route)));
  const stale = MOBILE_ROUTE_COVERAGE.filter((entry) => !registered.some((route) => key(route) === key(entry)));
  const undocumented = MOBILE_ROUTE_COVERAGE.filter(
    (entry) => entry.coverage === 'exempt' && entry.detail.trim().length < 20
  );

  expect(missing, 'new routes need a ratchet/workflow entry or reviewed exemption').toEqual([]);
  expect(stale, 'remove inventory entries with no registered route').toEqual([]);
  expect(undocumented, 'exemptions must explain the representative coverage').toEqual([]);
});
