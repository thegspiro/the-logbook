/**
 * The hub shows each administrator the cards their permissions open, and no
 * others.
 *
 * Two of its cards point into Inventory, whose grants `scheduling.manage` does
 * not imply, so "gated by the page" is not a gate. Every assertion below is
 * about a viewer seeing exactly what they can use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

const mockIsModuleOn = vi.fn();
const mockModulesLoading = vi.fn();
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isLoading: mockModulesLoading() as boolean,
    isModuleOn: (...args: unknown[]) => mockIsModuleOn(...args) as boolean,
  }),
}));

const mockGetAdminHubSummary = vi.fn();
vi.mock('../../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
  },
}));

import SchedulingAdminHub from './SchedulingAdminHub';

const grant = (...held: string[]) =>
  mockCheckPermission.mockImplementation((permission: unknown) => held.includes(permission as string));

/**
 * The cards this viewer is offered — which is what every assertion below is
 * about. Scoped to the card grid's own landmark rather than sweeping the page:
 * the frame also renders a breadcrumb trail, whose crumbs are links and are not
 * cards, and an unscoped sweep reported that chrome as though the hub had
 * offered it.
 */
const hrefs = () => {
  const tools = screen.queryByRole('navigation', { name: 'Scheduling administration tools' });
  return tools
    ? within(tools)
        .queryAllByRole('link')
        .map((link) => link.getAttribute('href'))
    : [];
};

describe('SchedulingAdminHub', () => {
  beforeEach(() => {
    // Reset, not clear: `vi.clearAllMocks()` drops recorded calls but keeps
    // implementations and any unconsumed `mockResolvedValueOnce`, so a default
    // installed here would not survive a neighbour's leftover config — and the
    // borrowed value is usually the one the test wanted, so it passes for the
    // wrong reason and only goes red when run alone (CLAUDE.md pitfall #28).
    mockCheckPermission.mockReset();
    mockIsModuleOn.mockReset();
    mockModulesLoading.mockReset();
    mockGetAdminHubSummary.mockReset();

    mockModulesLoading.mockReturnValue(false);
    mockIsModuleOn.mockReturnValue(true);
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'scheduling',
      generatedAt: new Date().toISOString(),
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
    window.history.replaceState({}, '', '/scheduling/admin');
  });

  it('names the page', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.getByRole('heading', { name: 'Scheduling Administration' })).toBeInTheDocument();
  });

  it('offers a scheduling officer the settings, the schedule tools and the roster', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    const offered = hrefs();
    expect(offered).toContain('/scheduling/admin/settings/general');
    expect(offered).toContain('/scheduling/admin/templates');
    expect(offered).toContain('/scheduling/admin/patterns');
    expect(offered).toContain('/scheduling/admin/reports');
    expect(offered).toContain('/scheduling/admin/platoons');
    expect(offered).toContain('/scheduling/admin/positions');
  });

  // scheduling.manage does not imply Inventory's grants, and the seeded
  // Scheduling Officer holds the check grants but not settings.manage — so
  // these two cards are gated separately, not together.
  it('withholds the Inventory cards from an officer without Inventory’s grants', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(hrefs()).not.toContain('/inventory/admin/checklists');
    expect(hrefs()).not.toContain('/inventory/admin/checklists/settings');
  });

  it('offers each Inventory card to whoever its own destination admits', () => {
    grant('scheduling.manage', 'inventory.check_manage');
    const { unmount } = renderWithRouter(<SchedulingAdminHub />);
    expect(hrefs()).toContain('/inventory/admin/checklists');
    expect(hrefs()).not.toContain('/inventory/admin/checklists/settings');
    unmount();

    grant('scheduling.manage', 'organization.update_settings');
    renderWithRouter(<SchedulingAdminHub />);
    expect(hrefs()).toContain('/inventory/admin/checklists/settings');
    expect(hrefs()).not.toContain('/inventory/admin/checklists');
  });

  // The roster accepted the training grants for a while, which forced every
  // gate above it to widen to match. It is scheduling administration.
  it('offers a training officer nothing, the roster included', () => {
    grant('training.view_all', 'training.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(hrefs()).toEqual([]);
    expect(screen.getByText('Nothing here for your role')).toBeInTheDocument();
  });

  // `?tab=settings` reaches the metrics panel whether or not the tab is drawn,
  // and that panel reads and writes on scheduling.manage — so the URL is
  // refused, not merely the control hidden.
  it('refuses the metrics settings tab to a viewer who could never save it', () => {
    grant('inventory.check_manage');
    window.history.replaceState({}, '', '/scheduling/admin?tab=settings');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
    expect(hrefs()).toEqual(['/inventory/admin/checklists']);
  });

  it('says so plainly when the department has the module switched off', () => {
    grant('scheduling.manage');
    mockIsModuleOn.mockReturnValue(false);
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.getByText('Nothing here for your role')).toBeInTheDocument();
    expect(hrefs()).toEqual([]);
  });

  // Every card is filtered by a module flag, so rendering before the flags land
  // would flash a grid and then remove half of it.
  it('draws no cards until the module flags are known', () => {
    grant('scheduling.manage');
    mockModulesLoading.mockReturnValue(true);
    renderWithRouter(<SchedulingAdminHub />);

    expect(hrefs()).toEqual([]);
    expect(screen.queryByText('Nothing here for your role')).not.toBeInTheDocument();
  });
});
