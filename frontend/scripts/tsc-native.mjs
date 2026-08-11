/**
 * Runs the TypeScript 7 compiler, which this package depends on under the
 * alias `typescript-native` rather than as plain `typescript`.
 *
 * Why the alias exists: typescript-eslint refuses to load against TypeScript 7
 * (it throws "typescript-eslint does not support TS 7.0" from a hard version
 * guard, and every published version caps its peer range at <6.1.0 — see
 * typescript-eslint#10940 for TS >=7.1 support). A workspace can only declare
 * one package named `typescript`, so `typescript` is the 5.9.3 the linter can
 * actually run against, and the compiler the project builds and typechecks
 * with is the same package installed a second time under another name.
 *
 * Why this wrapper rather than calling the binary by path: both installs ship a
 * `tsc` bin, so npm links only one of them into node_modules/.bin — plain `tsc`
 * is the 5.9.3 one. The path to the alias also moves depending on whether npm
 * hoists it to the repo root or nests it under frontend/, so it is resolved
 * here instead of hardcoded.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Resolved via ./package.json rather than ./bin/tsc directly: TypeScript 7
// ships an `exports` map that does not expose the bin subpath, so resolving it
// throws ERR_PACKAGE_PATH_NOT_EXPORTED. `./package.json` is exported, and gives
// the package root wherever npm decided to place it.
const tsc = path.join(path.dirname(require.resolve('typescript-native/package.json')), 'bin', 'tsc');

const { status, error } = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (error) {
  console.error(error);
  process.exit(1);
}

// A signal-terminated tsc reports status null; treat that as failure so a
// killed typecheck can never be mistaken for a clean one.
process.exit(status ?? 1);
