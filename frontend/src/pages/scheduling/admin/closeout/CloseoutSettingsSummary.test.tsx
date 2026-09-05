/**
 * The close-out settings mirror.
 *
 * The point of the file is the word "mirror": every value on it is a link to
 * the section that owns it, and nothing here writes. A second screen writing
 * the same settings object means whichever saved last silently reverts the
 * other, which is the failure that moved checklist timing to one home in
 * Inventory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../../test/utils';

const mockGetFeatureSettings = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getFeatureSettings: (...args: unknown[]) => mockGetFeatureSettings(...args) as unknown,
  },
}));

let granted: string[] = [];
vi.mock('../../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission: string) => granted.includes(permission) }),
}));

let modulesOn: string[] = [];
vi.mock('../../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: (key: string) => modulesOn.includes(key), isLoading: false }),
}));

import CloseoutSettingsSummary from './CloseoutSettingsSummary';

describe('CloseoutSettingsSummary', () => {
  beforeEach(() => {
    granted = ['scheduling.manage', 'settings.manage'];
    modulesOn = ['scheduling', 'inventory'];
    mockGetFeatureSettings.mockReset();
    mockGetFeatureSettings.mockResolvedValue({
      require_end_of_shift_checks: true,
      open_ended_shift_cushion_hours: 12,
      call_tracking: { mode: 'count_only', call_types: [{ slug: 'fire', label: 'Fire' }] },
    });
  });

  it('shows the rules that govern close-out', async () => {
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByText('Block close-out')).toBeInTheDocument();
    expect(screen.getByText('A count at close-out')).toBeInTheDocument();
    expect(screen.getByText('12 hours')).toBeInTheDocument();
    expect(screen.getByText('1 configured')).toBeInTheDocument();
  });

  it('offers no control that writes — every value links to where it is edited', async () => {
    renderWithRouter(<CloseoutSettingsSummary />);
    await screen.findByText('Block close-out');

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Block close-out' })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/general'
    );
    expect(screen.getByRole('link', { name: 'Shift Reports section' })).toHaveAttribute(
      'href',
      '/scheduling/admin/settings/shift-reports'
    );
  });

  // Three modes, not two. `off` means the department has said it does not want
  // to be asked about calls at all; reporting "Individual call records" for it
  // states the opposite of what was configured.
  it('names all three call-tracking modes, not two', async () => {
    mockGetFeatureSettings.mockResolvedValue({
      require_end_of_shift_checks: false,
      call_tracking: { mode: 'off', call_types: [] },
    });
    const { unmount } = renderWithRouter(<CloseoutSettingsSummary />);
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
    unmount();

    mockGetFeatureSettings.mockResolvedValue({
      require_end_of_shift_checks: false,
      call_tracking: { mode: 'detailed', call_types: [] },
    });
    renderWithRouter(<CloseoutSettingsSummary />);
    expect(await screen.findByText('Individual call records')).toBeInTheDocument();
  });

  // The cushion is derived from Inventory's checklist timing, not from any
  // scheduling setting: Scheduling General exposes no control for it, so a link
  // there lands on a screen where the number shown does not appear.
  it('points the cushion at the screen that actually owns it', async () => {
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByRole('link', { name: '12 hours' })).toHaveAttribute(
      'href',
      '/inventory/admin/checklists/settings'
    );
  });

  // That screen is behind Inventory's module gate and its settings grants,
  // neither implied by scheduling.manage. Offering the link anyway is the app
  // handing an officer a door onto Access Denied.
  it('shows the cushion as plain text for a viewer who cannot open its screen', async () => {
    granted = ['scheduling.manage'];
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByText('12 hours')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '12 hours' })).not.toBeInTheDocument();
  });

  // A dash reads as "not loaded"; a fabricated default reads as a value
  // somebody chose, and an officer would act on it.
  it('shows a dash rather than a made-up default when the settings do not load', async () => {
    mockGetFeatureSettings.mockRejectedValue(new Error('nope'));
    renderWithRouter(<CloseoutSettingsSummary />);

    expect(await screen.findByText('What close-out asks for')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Block close-out')).not.toBeInTheDocument();
  });
});
