import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const storeState = {
  templates: [],
  apparatus: [],
  templatesLoaded: true,
  platoonsEnabled: false,
  settingsLoaded: false,
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
    storeState.settingsLoaded = false;
    window.history.replaceState({}, '', '/scheduling/admin/settings/general');
  });

  // The header names the page, not the module. It used to read "Shift
  // Scheduling" — the module's identity — on a screen whose entire subject is
  // that module's settings, which left the tab strip as the only thing saying
  // where you were.
  // Every section route is drawn inside the Scheduling Administration header
  // (SchedulingAdminLayout), whose <h1>, area cards and trail already name the
  // module and are the way back. A second icon tile, <h1> and back button would
  // repeat them; the page's title stays for heading navigation only.
  it('names the page for heading navigation without a second visible header', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Scheduling Settings' })).toHaveClass('sr-only');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to scheduling administration' })).not.toBeInTheDocument();
  });

  it('renders the section the route mounts, and lists the rest', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
    const nav = settingsNav();
    // Anchored: "Apparatus" is also the tail of "Outside Apparatus".
    for (const label of [
      'General',
      'Apparatus',
      'Eligibility',
      'Notifications',
      'Shift Reports',
      'Outside Apparatus',
    ]) {
      expect(within(nav).getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
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

  // Not a redirect yet: platoonsEnabled arrives a beat after mount, and sending
  // the user away would bounce them off the section they asked for before the
  // setting that permits it has loaded.
  it('falls back to General without leaving the URL while settings load', () => {
    window.history.replaceState({}, '', '/scheduling/admin/settings/platoons');

    renderWithRouter(<SchedulingSettingsPage section="platoons" />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/scheduling/admin/settings/platoons');
  });

  it('moves to General and says why once settings show platoons are off', async () => {
    storeState.settingsLoaded = true;
    window.history.replaceState({}, '', '/scheduling/admin/settings/platoons');

    renderWithRouter(<SchedulingSettingsPage section="platoons" />);

    await waitFor(() => expect(window.location.pathname).toBe('/scheduling/admin/settings/general'));
    expect(screen.getByRole('status')).toHaveTextContent(/Platoon scheduling is turned off/);
  });

  it('stays on Platoons when the department has them on', () => {
    storeState.settingsLoaded = true;
    storeState.platoonsEnabled = true;
    window.history.replaceState({}, '', '/scheduling/admin/settings/platoons');

    renderWithRouter(<SchedulingSettingsPage section="platoons" />);

    expect(screen.getByText('section:platoons')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/scheduling/admin/settings/platoons');
    expect(screen.queryByText(/Platoon scheduling is turned off/)).not.toBeInTheDocument();
  });

  it('says nothing about platoons on an ordinary visit to General', () => {
    storeState.settingsLoaded = true;

    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.queryByText(/Platoon scheduling is turned off/)).not.toBeInTheDocument();
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
