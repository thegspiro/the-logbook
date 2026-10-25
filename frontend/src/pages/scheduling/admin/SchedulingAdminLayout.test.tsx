/**
 * The Scheduling Administration header, drawn around a page other than the
 * hub: it must say which area and page the officer is on, label the page as
 * that area's panel, and keep the Overview-only refresh off every other page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
const mockGetAdminHubSummary = vi.fn();

vi.mock('../../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: null, isLoading: false, isModuleOn: () => true }),
}));

const storeState = { platoonsEnabled: false, loadSettings: vi.fn() };
vi.mock('../../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

import { SchedulingAdminLayout } from './SchedulingAdminLayout';
import { useSchedulingAdminShell } from './schedulingAdminShell';

const SubPage = () => {
  const shell = useSchedulingAdminShell();
  return <p>{shell ? 'inside the admin header' : 'on its own'}</p>;
};

const renderAt = (url: string) => {
  window.history.pushState({}, '', url);
  return renderWithRouter(
    <SchedulingAdminLayout>
      <SubPage />
    </SchedulingAdminLayout>
  );
};

describe('SchedulingAdminLayout', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockImplementation((permission: string) => permission === 'scheduling.manage');
    storeState.platoonsEnabled = false;
    storeState.loadSettings.mockReset();
    storeState.loadSettings.mockResolvedValue(undefined);
    mockGetAdminHubSummary.mockReset();
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'scheduling',
      generatedAt: '2026-10-25T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  it('draws the hub header around a sub-page and marks where it is', () => {
    renderAt('/scheduling/admin/planning/templates');

    expect(screen.getByRole('heading', { level: 1, name: 'Scheduling Administration' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Planning' })).toHaveAttribute('aria-selected', 'true');
    const strip = screen.getByRole('navigation', { name: 'Planning pages' });
    expect(within(strip).getByRole('link', { name: 'Shift Templates' })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: 'Shift Planning' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('inside the admin header')).toBeInTheDocument();
  });

  it('labels the page body as the selected area’s panel', () => {
    renderAt('/scheduling/admin/closeout');

    const tab = screen.getByRole('tab', { name: 'Close-Out & History' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByText('inside the admin header')).toBeInTheDocument();
  });

  // Platoon settings exist only once platoon scheduling is on, so no card
  // names them; the header still says the officer is in Settings.
  it('keeps a settings section with no page of its own under Settings', () => {
    renderAt('/scheduling/admin/settings/platoons');

    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    const strip = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(within(strip).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    expect(screen.getByText(/Choose a page above/)).toBeInTheDocument();
  });

  it('offers Create Shift on every page, not only the Overview', () => {
    renderAt('/scheduling/admin/reports');

    expect(screen.getByRole('button', { name: 'Create Shift' })).toBeInTheDocument();
  });

  it('offers the figures refresh on the Overview only, where the figures are the page', () => {
    const { unmount } = renderAt('/scheduling/admin/reports');
    expect(screen.queryByRole('button', { name: 'Refresh scheduling figures' })).not.toBeInTheDocument();
    unmount();

    renderAt('/scheduling/admin');
    expect(screen.getByRole('button', { name: 'Refresh scheduling figures' })).toBeInTheDocument();
  });

  it('asks for no scheduling figures on behalf of a viewer without the grant', () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('/scheduling/admin');

    expect(mockGetAdminHubSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create Shift' })).not.toBeInTheDocument();
  });

  // Its route falls back to General while platoon scheduling is off, so the
  // strip offers it only once the department has turned platoons on.
  it('offers Platoon Rosters in the Settings strip only when platoons are on', () => {
    const { unmount } = renderAt('/scheduling/admin/settings/general');
    const strip = () => screen.getByRole('navigation', { name: 'Settings pages' });
    expect(within(strip()).queryByRole('link', { name: 'Platoon Rosters' })).not.toBeInTheDocument();
    unmount();

    storeState.platoonsEnabled = true;
    renderAt('/scheduling/admin/settings/platoons');
    expect(within(strip()).getByRole('link', { name: 'Platoon Rosters' })).toHaveAttribute('aria-current', 'page');
  });

  it('asks for the platoon setting only on behalf of a scheduling officer', () => {
    const { unmount } = renderAt('/scheduling/admin');
    expect(storeState.loadSettings).toHaveBeenCalledTimes(1);
    unmount();

    storeState.loadSettings.mockClear();
    mockCheckPermission.mockReturnValue(false);
    renderAt('/scheduling/admin');
    expect(storeState.loadSettings).not.toHaveBeenCalled();
  });
});
