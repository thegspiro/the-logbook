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
      signup_closes_minutes_before: 0,
      late_signup_grace_minutes: 60,
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

// The Equipment section is a signpost into Inventory, and each of its links is
// gated on the grant its destination requires. Defaults to granting nothing,
// which is what the real store yields here anyway — the block that cares
// installs its own grants.
const mockCheckPermission = vi.fn();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (...a: unknown[]) => mockCheckPermission(...a) as boolean,
  }),
}));

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

  /**
   * Both links here point into Inventory, and a scheduling officer does not
   * automatically hold either grant. Showing one to somebody the destination
   * refuses turns a signpost into a dead end — which is what "Manage equipment
   * checklists" was, while its sibling "Checklist settings" had been gated
   * from the start.
   */
  describe('the Equipment signpost links', () => {
    // Reset before installing the default, so a grant set from one test cannot
    // survive into the next (CLAUDE.md pitfall #28).
    beforeEach(() => {
      mockCheckPermission.mockReset();
      mockCheckPermission.mockReturnValue(false);
    });

    const grant = (...held: string[]) =>
      mockCheckPermission.mockImplementation((p: unknown) => held.includes(p as string));

    it('explains where checklists live even when neither link is offered', () => {
      renderPanel('equipment');

      expect(screen.getByText(/Checklists are managed in Inventory/i)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Manage equipment checklists/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /Checklist settings/i })).toBeNull();
    });

    it('offers the authoring link only to a holder of inventory.check_manage', () => {
      grant('inventory.check_manage');
      renderPanel('equipment');

      expect(screen.getByRole('link', { name: /Manage equipment checklists/i })).toHaveAttribute(
        'href',
        '/inventory/admin/checklists'
      );
      // A separate grant, so it stays hidden.
      expect(screen.queryByRole('link', { name: /Checklist settings/i })).toBeNull();
    });

    it('offers the settings link only to a holder of the department-settings grant', () => {
      grant('settings.manage');
      renderPanel('equipment');

      expect(screen.getByRole('link', { name: /Checklist settings/i })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Manage equipment checklists/i })).toBeNull();
    });

    it('offers both to somebody holding both', () => {
      grant('inventory.check_manage', 'organization.update_settings');
      renderPanel('equipment');

      expect(screen.getByRole('link', { name: /Manage equipment checklists/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Checklist settings/i })).toBeInTheDocument();
    });
  });
});

describe('ShiftSettingsPanel signup window', () => {
  beforeEach(() => {
    mockUpdateFeatureSettings.mockReset();
    mockUpdateFeatureSettings.mockResolvedValue({
      platoons_enabled: false,
      max_hours_per_window: 0,
      hours_window_days: 7,
      auto_generate_enabled: false,
      auto_generate_weeks: 4,
      require_end_of_shift_checks: false,
      restrict_checkin_to_assigned: false,
      signup_closes_minutes_before: 0,
      late_signup_grace_minutes: 60,
      enforce_evoc: true,
    });
    mockLoadShiftSettings.mockReset();
    mockLoadShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  });

  const renderEligibility = () => renderPanel('eligibility');

  it('renders both window controls on the eligibility section', async () => {
    renderEligibility();

    expect(await screen.findByLabelText('Members can sign up until')).toBeInTheDocument();
    expect(screen.getByLabelText('Officers can add members until')).toBeInTheDocument();
  });

  it('saves the member lead time as a single-key patch', async () => {
    const user = userEvent.setup();
    renderEligibility();

    await user.selectOptions(await screen.findByLabelText('Members can sign up until'), '30');

    // A single key, so the backend's model_fields_set guard leaves every
    // sibling setting alone.
    await waitFor(() => expect(mockUpdateFeatureSettings).toHaveBeenCalledWith({ signup_closes_minutes_before: 30 }));
  });

  it('saves a zero grace rather than dropping it as falsy', async () => {
    const user = userEvent.setup();
    renderEligibility();

    await user.selectOptions(await screen.findByLabelText('Officers can add members until'), '0');

    // 0 means "closes exactly at the start" and must survive the round trip;
    // it is the value a `||` would silently replace with the default.
    await waitFor(() => expect(mockUpdateFeatureSettings).toHaveBeenCalledWith({ late_signup_grace_minutes: 0 }));
  });
});
