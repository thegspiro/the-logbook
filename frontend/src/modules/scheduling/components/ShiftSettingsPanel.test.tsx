import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { DEFAULT_SETTINGS } from '../types/shiftSettings';
import type { SettingsTab } from './schedulingSettingsSections';

// Department-wide settings are backend-backed (services/shiftSettingsApi);
// the panel must load/save/reset through that service, never localStorage.
const mockLoadShiftSettings = vi.fn();
const mockSaveShiftSettings = vi.fn();
const mockResetShiftSettings = vi.fn();

vi.mock('../services/shiftSettingsApi', () => ({
  loadShiftSettings: (...args: unknown[]) => mockLoadShiftSettings(...args) as unknown,
  getCachedShiftSettings: () => ({ ...DEFAULT_SETTINGS }),
  shiftSettingsService: {
    saveShiftSettings: (...args: unknown[]) => mockSaveShiftSettings(...args) as unknown,
    resetShiftSettings: (...args: unknown[]) => mockResetShiftSettings(...args) as unknown,
  },
}));

const storeState = {
  platoonsEnabled: false,
  loadSettings: vi.fn(),
  setPlatoonsEnabled: vi.fn(),
};

vi.mock('../store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

const mockUpdateFeatureSettings = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    getFeatureSettings: vi.fn().mockResolvedValue({
      platoons_enabled: false,
      max_hours_per_window: 0,
      hours_window_days: 7,
      auto_generate_enabled: false,
      auto_generate_weeks: 4,
      require_end_of_shift_checks: false,
      restrict_checkin_to_assigned: false,
      enforce_evoc: true,
    }),
    // Arrow-deferred so the hoisted factory can reference the const below it.
    updateFeatureSettings: (...a: unknown[]) => mockUpdateFeatureSettings(...a) as unknown,
  },
}));

// The section bodies each own their data loading; this test is about which
// chrome the panel wraps them in, so stub them out. Each factory is inlined
// because vi.mock is hoisted above any shared helper.
vi.mock('./SchedulingNotificationsPanel', () => ({
  SchedulingNotificationsPanel: () => <div>SchedulingNotificationsPanel</div>,
}));
vi.mock('./TemplatesOverviewCard', () => ({ TemplatesOverviewCard: () => <div>TemplatesOverviewCard</div> }));
vi.mock('./ApparatusTypeDefaultsCard', () => ({
  ApparatusTypeDefaultsCard: () => <div>ApparatusTypeDefaultsCard</div>,
}));
vi.mock('./ResourceTypeDefaultsCard', () => ({ ResourceTypeDefaultsCard: () => <div>ResourceTypeDefaultsCard</div> }));
vi.mock('./DepartmentDefaultsCard', () => ({ DepartmentDefaultsCard: () => <div>DepartmentDefaultsCard</div> }));
vi.mock('./PositionNamesCard', () => ({ PositionNamesCard: () => <div>PositionNamesCard</div> }));
vi.mock('./EquipmentCheckTemplateList', () => ({
  EquipmentCheckTemplateList: () => <div>EquipmentCheckTemplateList</div>,
}));
vi.mock('./EligibilitySettingsCard', () => ({ EligibilitySettingsCard: () => <div>EligibilitySettingsCard</div> }));
vi.mock('./ShiftReportsSettingsPanel', () => ({
  ShiftReportsSettingsPanel: () => <div>ShiftReportsSettingsPanel</div>,
}));
vi.mock('./PlatoonRosterPanel', () => ({ PlatoonRosterPanel: () => <div>PlatoonRosterPanel</div> }));

import { ShiftSettingsPanel } from './ShiftSettingsPanel';

const renderPanel = (activeTab: SettingsTab) =>
  renderWithRouter(
    <ShiftSettingsPanel
      templates={[]}
      apparatusList={[]}
      onNavigateToTemplates={vi.fn()}
      activeTab={activeTab}
      onTabChange={vi.fn()}
    />
  );

describe('ShiftSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLoadShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockSaveShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockResetShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockUpdateFeatureSettings.mockResolvedValue({});
  });

  it('renders the requested section only', () => {
    renderPanel('eligibility');

    expect(screen.getByText('EligibilitySettingsCard')).toBeInTheDocument();
    expect(screen.queryByText('SchedulingNotificationsPanel')).not.toBeInTheDocument();
  });

  // The footer writes only the locally-stored settings object. It used to show
  // on every section, so switching to Notifications or Shift Reports offered a
  // Save button that flashed "Settings saved" without touching their values.
  describe.each<SettingsTab>(['general', 'apparatus'])('on the %s section', (tab) => {
    it('offers the Save/Reset footer', () => {
      renderPanel(tab);

      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    });
  });

  // 'equipment' belongs in this list, not the one above: its four settings were
  // stored and read by nothing, so they were deleted and the section is now a
  // signpost to Inventory. A Save button there would write nothing.
  describe.each<SettingsTab>(['platoons', 'eligibility', 'notifications', 'shift-reports', 'equipment'])(
    'on the %s section',
    (tab) => {
      it('hides the Save/Reset footer it would not act on', () => {
        renderPanel(tab);

        expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument();
      });
    }
  );

  it('no longer renders its own heading — the page owns the title', () => {
    renderPanel('general');

    expect(screen.queryByRole('heading', { name: /Shift Settings/i })).not.toBeInTheDocument();
  });

  it('loads the department settings from the backend on mount, migrating any local copy', async () => {
    renderPanel('general');

    await waitFor(() => {
      expect(mockLoadShiftSettings).toHaveBeenCalledWith({ migrateLocal: true });
    });
  });

  it('saves through the backend service and confirms', async () => {
    const user = userEvent.setup();
    renderPanel('general');

    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(mockSaveShiftSettings).toHaveBeenCalledWith(
      expect.objectContaining({ defaultDurationHours: DEFAULT_SETTINGS.defaultDurationHours })
    );
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('resets through the backend service', async () => {
    const user = userEvent.setup();
    renderPanel('general');

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => {
      expect(mockResetShiftSettings).toHaveBeenCalledTimes(1);
    });
  });

  it('shows EVOC driver enforcement as on, matching the backend default', async () => {
    renderPanel('general');
    const toggle = await screen.findByRole('switch', { name: /enforce evoc for drivers/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('turns EVOC driver enforcement off through the backend', async () => {
    const user = userEvent.setup();
    renderPanel('general');
    const toggle = await screen.findByRole('switch', { name: /enforce evoc for drivers/i });

    await user.click(toggle);

    await waitFor(() => expect(mockUpdateFeatureSettings).toHaveBeenCalledWith({ enforce_evoc: false }));
  });
});
