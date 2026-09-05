/**
 * Links written against the older `?tab=` contract still land.
 *
 * The sections became routes, so the bare path names none of them. Without this
 * the app's catch-all would send those links to the dashboard — the worst kind
 * of broken link, because the page it lands on looks fine.
 *
 * Driven through a real `<Routes>` rather than a bare render: the redirect's
 * whole job is what the router does with it, and the section routes it targets
 * have to exist for the answer to mean anything.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import SchedulingSettingsRedirect from './SchedulingSettingsRedirect';
import { SCHEDULING_SETTINGS_SECTIONS } from '../../../modules/scheduling/components/schedulingSettingsSections';

const Landed = () => <div data-testid="landed">{useLocation().pathname}</div>;

const landOn = (url: string) => {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/scheduling/admin/settings" element={<SchedulingSettingsRedirect />} />
        {SCHEDULING_SETTINGS_SECTIONS.map((section) => (
          <Route key={section.key} path={section.path} element={<Landed />} />
        ))}
      </Routes>
    </MemoryRouter>
  );
  return screen.getByTestId('landed').textContent;
};

describe('SchedulingSettingsRedirect', () => {
  it.each(SCHEDULING_SETTINGS_SECTIONS.map((section) => [section.key, section.path] as const))(
    'forwards ?tab=%s to the section it names',
    (tab, path) => {
      expect(landOn(`/scheduling/admin/settings?tab=${tab}`)).toBe(path);
    }
  );

  it('forwards the bare path to General', () => {
    expect(landOn('/scheduling/admin/settings')).toBe('/scheduling/admin/settings/general');
  });

  // The Equipment section was removed — its settings are Inventory's and always
  // were. A link to it should still arrive at the settings screen rather than at
  // the dashboard.
  it('forwards a section that no longer exists to General', () => {
    expect(landOn('/scheduling/admin/settings?tab=equipment')).toBe('/scheduling/admin/settings/general');
  });
});
