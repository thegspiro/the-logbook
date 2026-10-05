/**
 * E2E sweep-tag integrity
 *
 * `frontend-e2e` splits its matrix by weight rather than by test count. That
 * split is necessary because three tests carry most of the suite: each walks
 * every route, and `mobile-accessibility` renders ~50 of them in three themes
 * with an axe run apiece. Measured on 2026-10-04, a plain `--shard=i/4` put all
 * three on one shard — Playwright balances on the number of tests, which is the
 * wrong axis when one test is worth sixty — and the other three runners sat
 * idle while the wall clock barely moved.
 *
 * The workflow therefore selects on the `@sweep` tag: those tests get a runner
 * each, the remaining 120 share two. Nothing about Playwright enforces the tag,
 * so a new route-walking test would silently join the shared shards and drag
 * one of them back to the old serial time — the failure is a slow build, which
 * nobody reports as a bug.
 *
 * So the tag is checked here instead. A test that budgets itself past
 * SWEEP_THRESHOLD_MS is by definition one of the heavy ones.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'e2e');

/**
 * Five minutes. It has to sit under the *smallest* @sweep budget, which is
 * mobile-presentation's 720_000 — otherwise this file calls a test ordinary
 * while the workflow treats it as a sweep, and the two halves disagree, which
 * is what the second assertion below exists to catch. Nothing else in the suite
 * declares a budget at all, so ordinary tests sit on Playwright's 30s default,
 * an order of magnitude clear of this.
 *
 * Both margins are wide on purpose: raise this only if an ordinary test ever
 * needs a budget above it, and lower it if a sweep is ever budgeted below it.
 */
const SWEEP_THRESHOLD_MS = 300_000;

interface LongTest {
  file: string;
  title: string;
  budgetMs: number;
}

/**
 * Split a spec on its `test(` declarations and pair each with the longest
 * `test.setTimeout` in its body. Crude next to a real parse, but these specs
 * are plain top-level `test()` calls and a parser is a dependency this check
 * does not need.
 */
const longTestsIn = (file: string): LongTest[] => {
  const source = fs.readFileSync(path.join(E2E, file), 'utf8');
  const found: LongTest[] = [];

  // Chunk from one `test(`/`test.only(` to the next; the first chunk is the
  // file's preamble and has no title, so it is skipped by the title match.
  for (const chunk of source.split(/\btest(?:\.only)?\(/).slice(1)) {
    const title = /^\s*[`'"](.+?)[`'"]/.exec(chunk);
    if (!title?.[1]) continue;

    // `.replace(/_/g, …)` rather than `replaceAll`: tsconfig declares
    // `lib: ES2020`, and `String.prototype.replaceAll` is ES2021, so the
    // type-aware lint pass cannot resolve it.
    const budgets = [...chunk.matchAll(/test\.setTimeout\(\s*([\d_]+)\s*\)/g)].map((m) =>
      Number((m[1] ?? '0').replace(/_/g, ''))
    );
    const budgetMs = Math.max(0, ...budgets);
    if (budgetMs >= SWEEP_THRESHOLD_MS) found.push({ file, title: title[1], budgetMs });
  }
  return found;
};

describe('e2e sweep tags', () => {
  const specs = fs.readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));

  it('finds the spec directory', () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it('tags every long-running test @sweep so the CI matrix can isolate it', () => {
    const untagged = specs
      .flatMap(longTestsIn)
      .filter((t) => !t.title.includes('@sweep'))
      .map((t) => `${t.file}: "${t.title}" budgets ${t.budgetMs / 60_000} min`);

    expect(
      untagged,
      'A test with a budget this large walks the whole app and belongs on its own CI runner.\n' +
        'Add " @sweep" to its title — the frontend-e2e matrix selects on that tag, and an\n' +
        'untagged one joins the shared shards and slows the whole build.'
    ).toEqual([]);
  });

  it('keeps the tag meaningful — every @sweep test is actually a long one', () => {
    const longTitles = new Set(specs.flatMap(longTestsIn).map((t) => `${t.file}:${t.title}`));

    const mislabelled = specs.flatMap((file) => {
      const source = fs.readFileSync(path.join(E2E, file), 'utf8');
      return [...source.matchAll(/\btest(?:\.only)?\(\s*[`'"](.+?@sweep.*?)[`'"]/g)]
        .map((m) => ({ file, title: m[1] ?? '' }))
        .filter((t) => !longTitles.has(`${t.file}:${t.title}`))
        .map((t) => `${t.file}: "${t.title}"`);
    });

    expect(
      mislabelled,
      'This test is tagged @sweep but does not declare a long budget, so it takes a\n' +
        'whole CI runner to itself for nothing. Drop the tag, or give it the budget it needs.'
    ).toEqual([]);
  });
});
