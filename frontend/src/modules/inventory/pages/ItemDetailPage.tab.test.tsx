/**
 * An inventory item's tabs are addressable by `?tab=`.
 *
 * The fifth page found holding its tab in plain `useState`, after Email
 * Templates, Notifications, Medical Screening and Compliance Config. The
 * consequences repeat every time: the tab cannot be linked to, the Back button
 * does nothing after a tab change because there is nothing in the URL to go
 * back to, and the screenshot harness can only shoot the default.
 *
 * Here it kept the **Stock Lots** tab unlinkable, which is the one an officer
 * has cause to send — "this is where that lot is deployed" is a link, not a set
 * of directions.
 *
 * Asserted against the source rather than a render: reaching the tab strip
 * needs the item, its category, its history and its permission surface mocked,
 * and the defect is two small expressions a render test would pass over.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ItemDetailPage.tsx'), 'utf8');

const TABS = ['history', 'nfpa', 'inspections', 'exposures', 'stock'];

describe('ItemDetailPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('tab')");
  });

  it.each(TABS)('lists %s among the addressable tabs', (tab) => {
    const declared = source.slice(source.indexOf('const ITEM_DETAIL_TABS'), source.indexOf('type Tab ='));
    expect(declared).toContain(`'${tab}'`);
  });

  it('validates the query value against the declared tabs', () => {
    // A bare cast would let `?tab=nonsense` through and render no panel at all.
    expect(source).toContain('ITEM_DETAIL_TABS.includes(');
  });

  it('writes the tab back to the URL when it changes', () => {
    expect(source).toContain('setSearchParams({ tab })');
  });

  it('does not keep a second copy of the tab in component state', () => {
    expect(source).not.toContain("useState<Tab>('history')");
  });
});
