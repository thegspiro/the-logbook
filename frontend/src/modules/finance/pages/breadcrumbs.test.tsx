/**
 * Every branch a finance page can return keeps its breadcrumb trail.
 *
 * The defect has now appeared in both directions, which is why this checks
 * every branch rather than a chosen one:
 *
 *  * Two detail pages rendered `<Breadcrumbs />` in the loading and not-found
 *    branches ONLY, so the trail appeared while the record was being fetched
 *    and vanished the moment it arrived — the one state nobody is looking at
 *    was the only state with navigation.
 *  * Then four pages (the three request forms and the approval-chain settings)
 *    turned out to have the mirror of it: a trail on the loaded page and none
 *    while loading. The earlier version of this file asserted only that the
 *    LAST return carries a trail, so it caught the first direction and was
 *    blind to the second.
 *
 * Asserted against the source rather than a render: the bug is a missing line
 * in one of several sibling branches, and a render test only ever covers
 * whichever branch its mocks happen to produce.
 *
 * The branch heuristic is `return (` at two or four spaces of indentation
 * inside the exported page component — top-level and one `if` deep. JSX
 * returned from a callback sits deeper than that and is not a page branch.
 * Verified against all fifteen pages in this directory when written.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = __dirname;

/** The exported page component's body — sub-components above it are not branches of the page. */
const componentBody = (file: string, source: string): string => {
  const name = file.replace(/\.tsx$/, '');
  const start = new RegExp(`^(?:export )?const ${name}: React\\.FC`, 'm').exec(source);
  return start?.index === undefined ? '' : source.slice(start.index);
};

/** Each JSX block the page component can return, top-level or one `if` deep. */
const returnedBlocks = (body: string): string[] => {
  const starts = [...body.matchAll(/^ {2,4}return \(/gm)].map((m) => m.index ?? 0);
  return starts.map((from, i) => body.slice(from, starts[i + 1] ?? body.length));
};

// A page that uses no breadcrumbs at all is out of scope rather than a vacuous
// pass: the finance dashboard is one crumb deep, where a generated trail
// renders nothing by design.
const breadcrumbedPages = readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith('Page.tsx') && !f.includes('.test.'))
  .map((file) => [file, readFileSync(join(PAGES_DIR, file), 'utf8')] as const)
  .filter(([, source]) => source.includes('<Breadcrumbs'));

describe('finance page breadcrumbs', () => {
  it('finds the pages to check', () => {
    // Passes vacuously if the scan returns nothing, so pin the floor. Fourteen
    // when written; a new finance page should raise it, not slip under it.
    expect(breadcrumbedPages.length).toBeGreaterThanOrEqual(14);
  });

  it.each(breadcrumbedPages)('%s finds branches to check', (file, source) => {
    expect(returnedBlocks(componentBody(file, source)).length).toBeGreaterThan(0);
  });

  it.each(breadcrumbedPages)('%s shows breadcrumbs in every branch', (file, source) => {
    const missing = returnedBlocks(componentBody(file, source))
      .map((block, i) => (block.includes('<Breadcrumbs') ? null : i))
      .filter((i): i is number => i !== null);

    expect(missing, `branch ${missing.join(', ')} returns no trail`).toEqual([]);
  });
});
