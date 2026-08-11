/**
 * Every Compliance Configuration tab is addressable by `?tab=`.
 *
 * The fourth page found holding its tab in plain `useState`, after Email
 * Templates, Notifications and Medical Screening. The consequences are the same
 * every time: the tab cannot be linked to, the Back button does nothing after a
 * tab change because there is nothing in the URL to go back to, and the
 * screenshot harness can only ever shoot the default — which is how `02-21`
 * and `02-41` came to be byte-identical images published under two different
 * captions.
 *
 * Here it kept the **report history** and the **profile list** unlinkable, and
 * those are the two an officer has cause to send a colleague.
 *
 * Asserted against the source rather than a render: reaching the tab strip
 * needs the page's whole fetch and permission surface mocked, and the defect is
 * two small expressions a render test would pass over.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ComplianceRequirementsConfigPage.tsx'), 'utf8');

const TABS = ['thresholds', 'profiles', 'reports', 'schedule'];

describe('ComplianceRequirementsConfigPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('tab')");
  });

  it.each(TABS)('lists %s among the addressable tabs', (tab) => {
    const declared = source.slice(source.indexOf('const COMPLIANCE_CONFIG_TABS'), source.indexOf('type ActiveTab ='));
    expect(declared).toContain(`'${tab}'`);
  });

  it('validates the query value against the declared tabs', () => {
    // A bare cast would let `?tab=nonsense` through and render no tab at all.
    expect(source).toContain('COMPLIANCE_CONFIG_TABS.includes(');
  });

  it('writes the tab back to the URL when it changes', () => {
    expect(source).toContain('setSearchParams({ tab })');
  });

  it('does not keep a second copy of the tab in component state', () => {
    expect(source).not.toContain("useState<ActiveTab>('thresholds')");
  });
});
