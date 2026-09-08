/**
 * The two addresses that still have to work after the move.
 *
 * `/settings?tab=members` is in bookmarks and in links already sent; the bare
 * `/members/admin/settings` names no section. Both would otherwise reach the
 * app's catch-all and land on the dashboard — a redirect to somewhere plausible
 * is the worst kind of broken link, because nothing looks wrong.
 */

import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { render, screen } from '@testing-library/react';
import MembersSettingsRedirect from './MembersSettingsRedirect';

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/members/admin/settings" element={<MembersSettingsRedirect />} />
        <Route path="/members/admin/settings/visibility" element={<p>Contact Visibility landed</p>} />
        <Route path="/members/admin/settings/ids" element={<p>Membership IDs landed</p>} />
        <Route path="/members/admin/settings/ranks" element={<p>Operational Ranks landed</p>} />
        <Route path="/members/admin/settings/evoc" element={<p>EVOC Levels landed</p>} />
        <Route path="*" element={<p>fell through</p>} />
      </Routes>
    </MemoryRouter>
  );

describe('MembersSettingsRedirect', () => {
  it('forwards the bare path to the first section', () => {
    renderAt('/members/admin/settings');

    expect(screen.getByText('Contact Visibility landed')).toBeInTheDocument();
  });

  it('carries the named section across', () => {
    renderAt('/members/admin/settings?tab=ids');

    // A link to Membership IDs has to arrive at Membership IDs. Dropping the
    // parameter would land the reader on a screen they then have to search.
    expect(screen.getByText('Membership IDs landed')).toBeInTheDocument();
  });

  it.each([
    ['ranks', 'Operational Ranks landed'],
    ['evoc', 'EVOC Levels landed'],
  ])('carries the %s section across', (tab, landed) => {
    // Both arrived on 2026-09-08 and both are reachable from the redirect the
    // moment the manifest lists them — `isTab` reads the manifest rather than a
    // second hand-written union, which is what stops a new section being
    // routable but not redirectable.
    renderAt(`/members/admin/settings?tab=${tab}`);

    expect(screen.getByText(landed)).toBeInTheDocument();
  });

  it('sends an unknown section to the first one rather than nowhere', () => {
    renderAt('/members/admin/settings?tab=retired-section');

    expect(screen.getByText('Contact Visibility landed')).toBeInTheDocument();
    expect(screen.queryByText('fell through')).not.toBeInTheDocument();
  });
});
