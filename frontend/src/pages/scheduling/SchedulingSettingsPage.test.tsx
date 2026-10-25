import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

describe('SchedulingSettingsPage', () => {
  beforeEach(() => {
    // Reset, not clear — implementations and queued one-shot results survive
    // `vi.clearAllMocks()` (CLAUDE.md pitfall #28).
    storeState.loadInitialData.mockReset();
    storeState.platoonsEnabled = false;
    storeState.settingsLoaded = false;
    window.history.replaceState({}, '', '/scheduling/admin/settings/general');
  });

  // Every section route is drawn inside the Scheduling Administration header
  // (SchedulingAdminLayout). Its page strip is the way between sections and its
  // strip line names the open one, so the page draws neither: SettingsLayout's
  // section row, title and back button repeated all three beneath it. The
  // section's name stays for heading navigation only.
  it('names its section for heading navigation without a visible header of its own', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Scheduling settings: General' })).toHaveClass('sr-only');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to scheduling administration' })).not.toBeInTheDocument();
  });

  it('draws no section nav of its own beneath the header’s', () => {
    renderWithRouter(<SchedulingSettingsPage section="general" />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Scheduling settings sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Eligibility/ })).not.toBeInTheDocument();
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
});
