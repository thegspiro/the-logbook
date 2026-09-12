import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { ShiftSettingsPanel } from './ShiftSettingsPanel';
import { schedulingService } from '../services/api';
import type { SchedulingFeatureSettings } from '../services/api';

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

// A response that omits the feature flags. The declared type says this cannot
// happen — every one of them is `boolean`, not `boolean | undefined` — but the
// type is an assertion about a wire format rather than a check of one, and the
// panel is what an officer reads a department's configuration off.
//
// Asserted here rather than left to the axe pass on purpose. axe caught these
// only because the E2E fixture happens to omit the fields; the day that fixture
// gains them, the pass goes green over a screen that still announces nothing.
describe('ShiftSettingsPanel switches with the flags absent from the response', () => {
  const SWITCH_NAMES = [
    'Platoon scheduling',
    'Automatic shift generation',
    'Require end-of-shift equipment checks',
    'Record a call count at close-out',
    'Enforce EVOC for drivers',
    'Restrict check-in to assigned members',
  ];

  // `mockReset()` before each default, per CLAUDE.md: an unconsumed
  // `mockResolvedValueOnce` survives `vi.clearAllMocks()` and is handed out
  // ahead of a later `mockResolvedValue`, so a block that only sets the fallback
  // runs on whatever the previous test happened to queue. This block's whole
  // point is the *shape* of the feature response, which makes it precisely the
  // block that must not inherit somebody else's — and resetting also stops its
  // own `{}` leaking forward into a later one.
  beforeEach(() => {
    mockLoadShiftSettings.mockReset();
    mockLoadShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.mocked(schedulingService.getFeatureSettings).mockReset();
    vi.mocked(schedulingService.getFeatureSettings).mockResolvedValue({} as unknown as SchedulingFeatureSettings);
  });

  it('names every switch and gives every switch a state', async () => {
    renderPanel('general');
    // The close-out card only renders once the feature response resolves.
    await screen.findByRole('switch', { name: 'Enforce EVOC for drivers' });

    for (const name of SWITCH_NAMES) {
      // `role="switch"` with no aria-checked is not announced as off — it is
      // announced with no state at all, while the track beside it paints a
      // confident "off" from the same undefined.
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
    }
  });
});

/**
 * A refused write says what the server said.
 *
 * Both settings endpoints refuse with a sentence naming the cause — a call
 * type a filed shift report still refers to, a list past the cap. Four
 * handlers here caught those with a bare `catch` and printed a fixed string,
 * which leaves an officer holding a refusal with nothing to act on and no way
 * to tell which value is blocking the save.
 */
describe('ShiftSettingsPanel when the server refuses a write', () => {
  const refusal = (detail: string) => ({ response: { status: 400, data: { detail } } });

  const BASE_FEATURE: SchedulingFeatureSettings = {
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
  };

  beforeEach(() => {
    mockLoadShiftSettings.mockReset();
    mockLoadShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockSaveShiftSettings.mockReset();
    mockSaveShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockResetShiftSettings.mockReset();
    mockResetShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mockUpdateFeatureSettings.mockReset();
    mockUpdateFeatureSettings.mockResolvedValue(BASE_FEATURE);
    vi.mocked(schedulingService.getFeatureSettings).mockReset();
    vi.mocked(schedulingService.getFeatureSettings).mockResolvedValue(BASE_FEATURE);
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    vi.mocked(schedulingService.getFeatureSettings).mockReset();
    vi.mocked(schedulingService.getFeatureSettings).mockResolvedValue(BASE_FEATURE);
  });

  it('names the call type the server refused to drop', async () => {
    const user = userEvent.setup();
    const detail = 'Cannot delete a call type that history still refers to: Structure Fire';
    vi.mocked(schedulingService.getFeatureSettings).mockResolvedValue({
      ...BASE_FEATURE,
      call_tracking: {
        mode: 'detailed',
        call_types: [
          { slug: 'structure_fire', label: 'Structure Fire', active: true },
          { slug: 'ems', label: 'EMS', active: true },
        ],
      },
      // Empty on purpose. This is the stale snapshot the server exists to
      // re-check: the editor offers the delete precisely because the browser's
      // copy of `call_type_locked` predates the report that now names the type.
      call_type_locked: [],
      call_type_usage: {},
    });
    mockUpdateFeatureSettings.mockRejectedValue(refusal(detail));

    renderPanel('general');

    await user.click(await screen.findByRole('button', { name: 'Delete Structure Fire' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  });

  it('reports why the platoon toggle was refused', async () => {
    const user = userEvent.setup();
    const detail = 'Platoon scheduling cannot be switched off while shifts are assigned to a platoon.';
    mockUpdateFeatureSettings.mockRejectedValue(refusal(detail));

    renderPanel('general');

    await user.click(await screen.findByRole('switch', { name: 'Platoon scheduling' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  });

  it('reports why the Save Settings footer was refused', async () => {
    const user = userEvent.setup();
    const detail = 'A shift cannot default to longer than 24 hours.';
    mockSaveShiftSettings.mockRejectedValue(refusal(detail));

    renderPanel('general');

    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  });

  it('reports why a reset to defaults was refused', async () => {
    const user = userEvent.setup();
    const detail = 'Default shift settings cannot be reset while a generation run is in progress.';
    mockResetShiftSettings.mockRejectedValue(refusal(detail));

    renderPanel('general');

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(detail));
  });

  it('still falls back to a fixed string when the failure carries no message', async () => {
    const user = userEvent.setup();
    // A request that never got an answer has nothing to report but the action
    // that failed, so the fallback has to survive the change.
    mockSaveShiftSettings.mockRejectedValue(new Error(''));

    renderPanel('general');

    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save settings'));
  });
});
