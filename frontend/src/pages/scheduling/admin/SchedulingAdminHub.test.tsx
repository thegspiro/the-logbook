/**
 * The hub offers each administrator the areas and pages their permissions
 * open, and no others, under the same header Training and Inventory
 * Administration draw.
 *
 * Two of its pages point into Inventory, whose grants `scheduling.manage` does
 * not imply, so "gated by the page" is not a gate. Every assertion below is
 * about a viewer seeing exactly what they can use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const mockGetMetricSettings = vi.fn();
vi.mock('../../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
    getMetricSettings: (...args: unknown[]) => mockGetMetricSettings(...args) as unknown,
  },
}));

const mockGetSchedulingSummary = vi.fn();
vi.mock('../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getSummary: (...args: unknown[]) => mockGetSchedulingSummary(...args) as unknown,
  },
}));

import SchedulingAdminHub from './SchedulingAdminHub';

const grant = (...held: string[]) =>
  mockCheckPermission.mockImplementation((permission: unknown) => held.includes(permission as string));

const ALL_AREAS = [
  'Overview',
  'Planning',
  'On the Shift',
  'Close-Out & History',
  'People & Eligibility',
  'Reports',
  'Settings',
];

/**
 * The area cards this viewer is offered, by name. A card's accessible name is
 * its label alone (its description is the accessible description); the order
 * they are drawn in is `schedulingAdminAreas.test.ts`'s to check.
 */
const areaNames = () => {
  const offered = ALL_AREAS.filter((name) => screen.queryByRole('tab', { name }));
  // Guards against a card this list does not know about going unnoticed.
  return screen.queryAllByRole('tab').length === offered.length ? offered : ['<unknown area card>'];
};

/** The pages in the open area's strip, by href. */
const stripHrefs = (area: string) =>
  within(screen.getByRole('navigation', { name: `${area} pages` }))
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href'));
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
    mockGetMetricSettings.mockReset();
    mockGetSchedulingSummary.mockReset();
    localStorage.removeItem('scheduling_setup_guide_hidden');

    mockModulesLoading.mockReturnValue(false);
    mockGetSchedulingSummary.mockResolvedValue({
      shifts_scheduled: 0,
      shifts_scheduled_this_week: 0,
      shifts_scheduled_this_month: 0,
      hours_worked_this_month: 0,
      active_templates: 0,
      active_patterns: 0,
    });
    mockIsModuleOn.mockReturnValue(true);
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'scheduling',
      generatedAt: new Date().toISOString(),
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
    // Never settles: these tests are about who reaches the panel, not its body.
    mockGetMetricSettings.mockReturnValue(new Promise(() => undefined));
    window.history.replaceState({}, '', '/scheduling/admin');
  });

  it('shows a new scheduling officer where to start', async () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(await screen.findByRole('heading', { name: 'Set up scheduling for your department' })).toBeInTheDocument();
  });

  it('names the page', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.getByRole('heading', { level: 1, name: 'Scheduling Administration' })).toBeInTheDocument();
  });

  it('opens Overview on its dashboard', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(stripHrefs('Overview')).toEqual(['/scheduling/admin', '/scheduling/admin?tab=settings']);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  // The tool grid that used to sit under the setup guide is the area cards and
  // page strip now; drawing both would offer every page twice.
  it('draws no grid of tool cards under the header', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.queryByRole('navigation', { name: 'Scheduling administration tools' })).not.toBeInTheDocument();
  });

  it('offers a scheduling officer Create Shift, which opens it on the schedule', async () => {
    const user = userEvent.setup();
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    await user.click(screen.getByRole('button', { name: 'Create Shift' }));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/scheduling?create=shift');
  });

  it('offers a scheduling officer every scheduling area', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(areaNames()).toEqual([
      'Overview',
      'Planning',
      'Close-Out & History',
      'People & Eligibility',
      'Reports',
      'Settings',
    ]);
  });

  // scheduling.manage does not imply Inventory's grants, and the seeded
  // Scheduling Officer holds the check grants but not settings.manage — so
  // these two pages are gated separately, not together.
  it('withholds the Inventory pages from an officer without Inventory’s grants', () => {
    grant('scheduling.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.queryByRole('tab', { name: 'On the Shift' })).not.toBeInTheDocument();
  });

  it('offers each Inventory page to whoever its own destination admits', async () => {
    const user = userEvent.setup();
    grant('scheduling.manage', 'inventory.check_manage');
    const { unmount } = renderWithRouter(<SchedulingAdminHub />);
    await user.click(screen.getByRole('tab', { name: 'On the Shift' }));
    expect(stripHrefs('On the Shift')).toEqual(['/inventory/admin/checklists']);
    unmount();

    grant('scheduling.manage', 'organization.update_settings');
    renderWithRouter(<SchedulingAdminHub />);
    await user.click(screen.getByRole('tab', { name: 'On the Shift' }));
    expect(stripHrefs('On the Shift')).toEqual(['/inventory/admin/checklists/settings']);
  });

  // Both pages open Inventory's own screens, so choosing the area selects it
  // rather than navigating, and the strip says so on each link.
  it('selects On the Shift in place, and marks its pages as opening their own', async () => {
    const user = userEvent.setup();
    grant('scheduling.manage', 'inventory.check_manage', 'settings.manage');
    renderWithRouter(<SchedulingAdminHub />);

    await user.click(screen.getByRole('tab', { name: 'On the Shift' }));

    expect(window.location.pathname).toBe('/scheduling/admin');
    expect(screen.getByRole('tab', { name: 'On the Shift' })).toHaveAttribute('aria-selected', 'true');
    const links = within(screen.getByRole('navigation', { name: 'On the Shift pages' })).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Equipment Checklists (opens its own page)',
      'Checklist Timing (opens its own page)',
    ]);
  });

  // The roster accepted the training grants for a while, which forced every
  // gate above it to widen to match. It is scheduling administration.
  it('offers a training officer nothing beyond the Overview, the roster included', () => {
    grant('training.view_all', 'training.manage');
    renderWithRouter(<SchedulingAdminHub />);

    expect(areaNames()).toEqual(['Overview']);
    expect(stripHrefs('Overview')).toEqual(['/scheduling/admin']);
    expect(screen.queryByRole('button', { name: 'Create Shift' })).not.toBeInTheDocument();
  });

  // `?tab=settings` reaches the metrics panel whether or not the strip offers
  // it, and that panel reads and writes on scheduling.manage — so the URL is
  // refused, not merely the control hidden.
  it('refuses the metrics settings page to a viewer who could never save it', async () => {
    grant('inventory.check_manage');
    window.history.replaceState({}, '', '/scheduling/admin?tab=settings');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.queryByRole('link', { name: 'Headline Metrics' })).not.toBeInTheDocument();
    await waitFor(() => expect(mockGetSchedulingSummary).not.toHaveBeenCalled());
    expect(mockGetMetricSettings).not.toHaveBeenCalled();
  });

  it('opens the metrics settings for a scheduling officer', async () => {
    grant('scheduling.manage');
    window.history.replaceState({}, '', '/scheduling/admin?tab=settings');
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.getByRole('link', { name: 'Headline Metrics' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(mockGetMetricSettings).toHaveBeenCalledWith('scheduling'));
  });

  it('offers only the Overview when the department has the module switched off', () => {
    grant('scheduling.manage');
    mockIsModuleOn.mockReturnValue(false);
    renderWithRouter(<SchedulingAdminHub />);

    expect(areaNames()).toEqual(['Overview']);
  });

  // Every page is filtered by a module flag, so rendering before the flags land
  // would flash the areas and then remove some of them.
  it('draws no areas until the module flags are known', () => {
    grant('scheduling.manage');
    mockModulesLoading.mockReturnValue(true);
    renderWithRouter(<SchedulingAdminHub />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
