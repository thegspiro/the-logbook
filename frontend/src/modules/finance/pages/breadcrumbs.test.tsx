/**
 * Every finance detail page keeps its breadcrumb trail once the record loads.
 *
 * Two of them rendered `<Breadcrumbs />` in the loading and not-found branches
 * only. The trail therefore appeared while the record was being fetched and
 * vanished the moment it arrived — the one state in which nobody is looking at
 * the page was the only state with navigation.
 *
 * Asserted against the source rather than a render: the bug is a missing line
 * in the last of three sibling branches, and a render test would only ever
 * cover whichever branch its mocks happened to produce.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGES_DIR = __dirname;

const detailPages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('DetailPage.tsx') && !f.includes('.test.'));

/** The component's top-level `return (` — the one that renders the loaded page. */
const loadedPageMarkup = (source: string): string => {
  const matches = [...source.matchAll(/^ {2}return \(/gm)];
  const last = matches[matches.length - 1];
  return last?.index === undefined ? '' : source.slice(last.index);
};

describe('finance detail page breadcrumbs', () => {
  it('finds the detail pages to check', () => {
    expect(detailPages.length).toBeGreaterThan(0);
  });

  it.each(detailPages)('%s shows breadcrumbs on the loaded page', (file) => {
    const source = readFileSync(join(PAGES_DIR, file), 'utf8');
    // A page that uses breadcrumbs at all must use them where the record shows.
    if (!source.includes('<Breadcrumbs />')) return;

    expect(loadedPageMarkup(source)).toContain('<Breadcrumbs />');
  });
});
