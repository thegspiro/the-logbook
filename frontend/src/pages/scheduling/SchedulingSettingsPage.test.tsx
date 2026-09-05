import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const storeState = {
  templates: [],
  apparatus: [],
  templatesLoaded: true,
  platoonsEnabled: false,
  loadInitialData: vi.fn(),
};

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

// The panel's content is covered by its own tests; here we only need to see
// which section the page asked it to render.
vi.mock('../../modules/scheduling/components/ShiftSettingsPanel', async () => {
  const actual = await vi.importActual<typeof import('../../modules/scheduling/components/ShiftSettingsPanel')>(
    '../../modules/scheduling/components/ShiftSettingsPanel'
  );
  return {
    ...actual,
    ShiftSettingsPanel: ({ activeTab }: { activeTab: string }) => <div>section:{activeTab}</div>,
  };
});

import SchedulingSettingsPage from './SchedulingSettingsPage';

const settingsNav = () => screen.getAllByRole('navigation', { name: 'Scheduling settings sections' })[0] as HTMLElement;

describe('SchedulingSettingsPage', () => {
  beforeEach(() => {
    // Reset, not clear — implementations and queued one-shot results survive
    // `vi.clearAllMocks()` (CLAUDE.md pitfall #28).
    storeState.loadInitialData.mockReset();
    storeState.platoonsEnabled = false;
    window.history.replaceState({}, '', '/scheduling/admin/settings/general');
  });

  // The header names the page, not the module. It used to read "Shift
  // Scheduling" — the module's identity — on a screen whose entire subject is
  // that module's settings, which left the tab strip as the only thing saying
  // where you were.
  it('renders the page header once, naming the page rather than the module', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByRole('heading', { name: 'Scheduling Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Department-wide scheduling defaults')).toBeInTheDocument();
  });

  it('offers a way back to the administration hub it is reached from', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    await user.click(screen.getByRole('button', { name: 'Back to scheduling administration' }));

    expect(window.location.pathname).toBe('/scheduling/admin');
  });

  it('renders the section the route mounts, and lists the rest', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
    const nav = settingsNav();
    for (const label of ['General', 'Apparatus', 'Eligibility', 'Notifications', 'Shift Reports']) {
      expect(within(nav).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  // The Equipment section is gone: nothing on it was ever edited there, and its
  // two links now sit on the administration hub, where an officer looks for a
  // link rather than behind a settings tab.
  it('no longer offers an Equipment section', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(within(settingsNav()).queryByRole('button', { name: /Equipment/ })).not.toBeInTheDocument();
  });

  // A section is a route, not a `?tab=` that only client state reads: the
  // previous screen could not be linked to, bookmarked, or reached with the
  // back button, because selecting a section changed nothing the router saw.
  it('navigates to the chosen section rather than mirroring it into a query param', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    await user.click(within(settingsNav()).getByRole('button', { name: /Notifications/ }));

    expect(window.location.pathname).toBe('/scheduling/admin/settings/notifications');
    expect(window.location.search).not.toContain('tab=');
  });

  it('renders whichever section its route mounts', () => {
    window.history.replaceState({}, '', '/scheduling/admin/settings/notifications');

    renderWithRouter(<SchedulingSettingsPage section="notifications" />);

    expect(screen.getByText('section:notifications')).toBeInTheDocument();
  });

  // Not a redirect: platoonsEnabled arrives a beat after mount, and sending the
  // user away would bounce them off the section they asked for before the
  // setting that permits it has loaded.
  it('falls back to General for a section the department has turned off', () => {
    window.history.replaceState({}, '', '/scheduling/admin/settings/platoons');

    renderWithRouter(<SchedulingSettingsPage section="platoons" />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
  });

  it('hides Platoons until platoon scheduling is enabled', () => {
    const { unmount } = renderWithRouter(<SchedulingSettingsPage section="general" />);
    expect(within(settingsNav()).queryByRole('button', { name: /Platoons/ })).not.toBeInTheDocument();
    unmount();

    storeState.platoonsEnabled = true;
    renderWithRouter(<SchedulingSettingsPage section="general" />);
    expect(within(settingsNav()).getByRole('button', { name: /Platoons/ })).toBeInTheDocument();
  });
});
