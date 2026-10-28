/**
 * Route chunk integrity
 *
 * Everything App.tsx imports statically is downloaded before the first page
 * renders, by every visitor, on every route. Two habits put whole modules into
 * that first load without anyone choosing it:
 *
 * - Importing a module's route factory from its barrel (`./modules/scheduling`)
 *   rather than from its router (`./modules/scheduling/routes`). The barrel
 *   re-exports the module's components, stores and services, and anything with
 *   a top-level call cannot be tree-shaken away, so scheduling's settings
 *   panels, the communications template editor and medical screening all
 *   shipped in the entry chunk.
 * - A router importing a page directly instead of through `lazyWithRetry`.
 *   The onboarding wizard's eighteen pages, visited once per installation, were
 *   the largest single part of the entry chunk this way.
 *
 * Together they were most of a 714 KB first load that put a phone on 4G 8.3s
 * from its first paint. `scripts/check-initial-bundle.mjs` measures the built
 * result in CI; this names the cause at the line that introduces it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Every static `import ... from '<specifier>'`, multi-line ones included. */
const staticImports = (source: string): string[] =>
  [...source.matchAll(/^import\s(?:[^;]*?)\sfrom\s'([^']+)';/gms)].map(([, specifier]) => specifier ?? '');

describe('route chunk integrity', () => {
  it('imports each route factory from its router, not the module barrel', () => {
    const barrels = staticImports(fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8')).filter((specifier) =>
      /^\.\/modules\/[\w-]+$/.test(specifier)
    );
    expect(barrels, 'import from ./modules/<name>/routes instead').toEqual([]);
  });

  it('loads every routed page lazily', () => {
    const eager = globSync(path.join(SRC, 'modules/*/routes.tsx')).flatMap((file) =>
      staticImports(fs.readFileSync(file, 'utf8'))
        .filter((specifier) => /(^|\/)pages(\/|$)/.test(specifier))
        .map((specifier) => `${path.relative(SRC, file)}: ${specifier}`)
    );
    expect(eager, 'load the page with lazyWithRetry(() => import(...))').toEqual([]);
  });

  // The premise, so neither check passes by reading nothing.
  it('finds the imports it checks', () => {
    expect(staticImports(fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8'))).toContain('./modules/scheduling/routes');
    expect(globSync(path.join(SRC, 'modules/*/routes.tsx')).length).toBeGreaterThan(20);
    expect(staticImports("import {\n  A,\n  B,\n} from './pages';\n")).toEqual(['./pages']);
  });
});
