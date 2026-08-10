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
    vi.clearAllMocks();
    storeState.platoonsEnabled = false;
    window.history.replaceState({}, '', '/scheduling/settings');
  });

  it('renders the page header once, not stacked with a panel heading', () => {
    renderWithRouter(<SchedulingSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Scheduling Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('opens on General and lists the settings sections', () => {
    renderWithRouter(<SchedulingSettingsPage />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
    const nav = settingsNav();
    for (const label of ['General', 'Apparatus', 'Eligibility', 'Notifications', 'Equipment', 'Shift Reports']) {
      expect(within(nav).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('switches section and mirrors the choice into the URL', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingSettingsPage />);

    await user.click(within(settingsNav()).getByRole('button', { name: /Equipment/ }));

    expect(screen.getByText('section:equipment')).toBeInTheDocument();
    expect(window.location.search).toContain('tab=equipment');
  });

  it('drops the tab param when returning to General', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingSettingsPage />);

    await user.click(within(settingsNav()).getByRole('button', { name: /Equipment/ }));
    await user.click(within(settingsNav()).getByRole('button', { name: /General/ }));

    expect(screen.getByText('section:general')).toBeInTheDocument();
    expect(window.location.search).not.toContain('tab=');
  });

  it('honours a ?tab= deep link', () => {
    window.history.replaceState({}, '', '/scheduling/settings?tab=notifications');

    renderWithRouter(<SchedulingSettingsPage />);

    expect(screen.getByText('section:notifications')).toBeInTheDocument();
  });

  it('falls back to General for a section the department has turned off', () => {
    window.history.replaceState({}, '', '/scheduling/settings?tab=platoons');

    renderWithRouter(<SchedulingSettingsPage />);

    expect(screen.getByText('section:general')).toBeInTheDocument();
  });

  it('hides Platoons until platoon scheduling is enabled', () => {
    const { unmount } = renderWithRouter(<SchedulingSettingsPage />);
    expect(within(settingsNav()).queryByRole('button', { name: /Platoons/ })).not.toBeInTheDocument();
    unmount();

    storeState.platoonsEnabled = true;
    renderWithRouter(<SchedulingSettingsPage />);
    expect(within(settingsNav()).getByRole('button', { name: /Platoons/ })).toBeInTheDocument();
  });
});
