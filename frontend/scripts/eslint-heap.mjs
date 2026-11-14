/**
 * Runs ESLint with a larger V8 heap ceiling.
 *
 * Why: a full lint is type-aware across about 2,350 files and peaks near
 * 3.5 GB. Node's default old-space ceiling scales with the machine's memory,
 * so GitHub's runners get enough by default, but a smaller host (a 2 GB
 * container, a modest Docker or Unraid box) stops with "JavaScript heap out of
 * memory" partway through (workflow review W77). The flag is a ceiling, not a
 * reservation: a machine only uses what the lint needs, up to its own RAM.
 *
 * Why a wrapper rather than `NODE_OPTIONS=... eslint` in package.json: that
 * form is POSIX-shell only and fails under npm on Windows, and the flag has to
 * reach the Node process that runs ESLint, not npm's. ESLint's entry file is
 * resolved here, as tsc-native.mjs resolves the compiler, because npm may hoist
 * it to the repository root or nest it under frontend/.
 *
 * An operator who already sets --max-old-space-size in NODE_OPTIONS keeps
 * their value: the flag is only added when they have not chosen one.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const HEAP_CEILING_MB = 8192;

const require = createRequire(import.meta.url);
const eslintBin = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');

const operatorChoseHeap = (process.env.NODE_OPTIONS ?? '').includes('--max-old-space-size');
const nodeArgs = operatorChoseHeap ? [] : [`--max-old-space-size=${HEAP_CEILING_MB}`];

const { status, error } = spawnSync(process.execPath, [...nodeArgs, eslintBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (error) {
  console.error(error);
  process.exit(1);
}
// A signal-terminated ESLint (the OOM killer, for one) reports status null;
// treat that as failure so a killed lint is never mistaken for a clean one.
process.exit(status ?? 1);
