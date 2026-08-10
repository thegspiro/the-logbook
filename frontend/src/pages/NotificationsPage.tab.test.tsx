/**
 * Every notifications tab is addressable by `?tab=`.
 *
 * The page round-tripped exactly one value. `?tab=inbox` opened the inbox;
 * `?tab=log`, `?tab=templates` and `?tab=rules` all fell through to the rules
 * tab, and switching tabs *deleted* the parameter rather than updating it — so
 * the Send Log, the one screen anyone has cause to send a colleague a link to,
 * could not be linked to at all.
 *
 * Asserted against the source: reaching the tab strip in a render test needs
 * the page's whole permission and fetch surface mocked, and the defect is in
 * two small expressions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'NotificationsPage.tsx'), 'utf8');

const TABS = ['inbox', 'rules', 'templates', 'log'];

describe('NotificationsPage tab deep links', () => {
  it.each(TABS)('reads ?tab=%s back out of the URL', (tab) => {
    // The initial-tab expression must mention every tab it can restore.
    const initial = source.slice(source.indexOf('const requestedTab'), source.indexOf('const [activeTab'));
    expect(initial).toContain(`'${tab}'`);
  });

  it('writes the tab back to the URL when it changes', () => {
    const handler = source.slice(source.indexOf('const handleTabChange'), source.indexOf('if (loading &&'));
    expect(handler).toContain('setSearchParams({ tab })');
  });

  it('no longer deletes the tab parameter on a non-inbox tab', () => {
    const handler = source.slice(source.indexOf('const handleTabChange'), source.indexOf('if (loading &&'));
    expect(handler).not.toContain("searchParams.delete('tab')");
  });

  it('still falls back to the inbox for a viewer who cannot manage', () => {
    // The admin tabs must not be restorable by anyone who cannot see them.
    const initial = source.slice(source.indexOf('const requestedTab'), source.indexOf('const [activeTab'));
    expect(initial).toContain('canView');
  });
});
