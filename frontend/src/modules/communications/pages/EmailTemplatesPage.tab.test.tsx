/**
 * Every Email Templates tab is addressable by `?tab=`.
 *
 * The page held its tab in plain `useState('templates')`, so none of the five
 * could be linked to. Two consequences, and the second is the one that made
 * this worth fixing rather than noting:
 *
 * - A secretary could not send a colleague a link to the **Footers** library,
 *   which is the tab a colleague is most likely to be pointed at.
 * - The screenshot harness could only ever shoot the default tab. That is
 *   exactly how `02-21` and `02-41` came to be byte-identical images published
 *   under two different captions, and how `04-20` and `17-01` did the same —
 *   all four were hub routes defaulting to a tab nobody asked for.
 *
 * Asserted against the source rather than a render. Reaching the tab strip
 * needs the page's whole store, permission and fetch surface mocked, and the
 * defect is two small expressions; a render test would pass against a mock
 * that happened to produce the right tab. Same approach as
 * `NotificationsPage.tab.test.tsx`, for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'EmailTemplatesPage.tsx'), 'utf8');

const TABS = ['templates', 'footers', 'officers', 'scheduled', 'history'];

describe('EmailTemplatesPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('tab')");
  });

  it.each(TABS)('lists %s among the addressable tabs', (tab) => {
    const declared = source.slice(
      source.indexOf('const EMAIL_TEMPLATES_TABS'),
      source.indexOf('type EmailTemplatesTab')
    );
    expect(declared).toContain(`'${tab}'`);
  });

  it('validates the query value against the declared tabs', () => {
    // A bare cast would let `?tab=nonsense` through and render nothing at all.
    expect(source).toContain('EMAIL_TEMPLATES_TABS.includes(');
  });

  it('writes the tab back to the URL when it changes', () => {
    const handler = source.slice(
      source.indexOf('const handleTabChange'),
      source.indexOf('const handleTabChange') + 300
    );
    expect(handler).toContain('setSearchParams({ tab })');
  });

  // The page now renders its sections through the shared SettingsLayout, which
  // maps one section list onto the nav and calls one handler. There is no
  // longer a per-tab call site to miss — the equivalent omission is a tab that
  // never reaches SECTIONS, so that is what these assert.
  it.each(TABS)('offers %s as a section the shell can render', (tab) => {
    const declared = source.slice(source.indexOf('const SECTIONS'), source.indexOf('export const EmailTemplatesPage'));
    expect(declared).toContain(`key: '${tab}'`);
  });

  it('routes every section through the handler rather than bare state', () => {
    expect(source).toContain('onSectionChange={handleTabChange}');
    expect(source).not.toContain('setActiveTab(');
  });

  it('derives the active tab from the URL rather than mirroring it into state', () => {
    // The first version of this fix read the parameter once with
    // `useState(initialTab)`. That makes a link work and leaves the **Back
    // button** broken: click Footers then Officers, press Back, and the URL
    // says `?tab=footers` while the page still renders Officers.
    //
    // Asserting the absence of the state is the point. A sync `useEffect` would
    // also work, but it reintroduces two sources of truth and one more ordering
    // problem to get wrong; there is nothing for this page to hold that the URL
    // does not already say.
    expect(source).toMatch(/const activeTab: EmailTemplatesTab =/);
    expect(source).not.toMatch(/useState<EmailTemplatesTab>/);
  });
});
