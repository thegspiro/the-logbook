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

  // Call tracking is a radio group rather than a switch: three mutually
  // exclusive modes, one of which (`off`) the old two-state toggle could not
  // reach at all. It needs the same guarantee the switches above get — the
  // group is named, and every option announces a state rather than none.
  it('names the call-tracking group and gives every mode a state', async () => {
    renderPanel('general');
    await screen.findByRole('switch', { name: 'Enforce EVOC for drivers' });

    const group = screen.getByRole('radiogroup', { name: 'How calls are recorded' });
    expect(group).toBeInTheDocument();
    for (const name of ['Log individual calls', 'Record a call count at close-out', /Don.t track calls/]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('can select off, which the old two-state toggle could not reach', async () => {
    // The whole point of the radio group. `off` was a valid, documented mode
    // with backend readers from the day call tracking shipped; the toggle it
    // replaced only ever flipped detailed <-> count_only, so a department
    // that records calls in an RMS had no way to say so.
    const user = userEvent.setup();
    mockUpdateFeatureSettings.mockReset();
    mockUpdateFeatureSettings.mockResolvedValue({
      call_tracking: { mode: 'off', call_types: [] },
    });
    renderPanel('general');
    await screen.findByRole('switch', { name: 'Enforce EVOC for drivers' });

    await user.click(screen.getByRole('radio', { name: /Don.t track calls/ }));

    await waitFor(() =>
      expect(mockUpdateFeatureSettings).toHaveBeenCalledWith({
        call_tracking: { mode: 'off', call_types: [] },
      })
    );
  });

  it('reads an absent call_tracking setting as detailed, never off', async () => {
    // CLAUDE.md pitfall #19: absence means "what this department has always
    // done". Defaulting to `off` here would silently stop call logging for
    // every installation that has never opened this screen, and nobody
    // connects a missing year of call volume back to a deploy.
    renderPanel('general');
    await screen.findByRole('switch', { name: 'Enforce EVOC for drivers' });

    expect(screen.getByRole('radio', { name: 'Log individual calls' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Don.t track calls/ })).not.toBeChecked();
  });
});

describe('ShiftSettingsPanel call-tracking mode preserves the configured call types', () => {
  const TYPES = [
    { slug: 'fire', label: 'Fire', active: true },
    { slug: 'ems', label: 'EMS', active: true },
  ];

  beforeEach(() => {
    mockLoadShiftSettings.mockReset();
    mockLoadShiftSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    vi.mocked(schedulingService.getFeatureSettings).mockReset();
    vi.mocked(schedulingService.getFeatureSettings).mockResolvedValue({
      enforce_evoc: true,
      call_tracking: { mode: 'count_only', call_types: TYPES },
    } as unknown as SchedulingFeatureSettings);
    mockUpdateFeatureSettings.mockReset();
    mockUpdateFeatureSettings.mockResolvedValue({
      call_tracking: { mode: 'off', call_types: TYPES },
    });
  });

  it('sends the existing type list back when switching to off', async () => {
    // The payload replaces the whole call_tracking object, so omitting the
    // list would wipe every type the department has named. Under `off` they
    // are inert rather than gone, and have to come back intact the moment
    // count-only is selected again.
    const user = userEvent.setup();
    renderPanel('general');
    await screen.findByRole('switch', { name: 'Enforce EVOC for drivers' });

    await user.click(screen.getByRole('radio', { name: /Don.t track calls/ }));

    await waitFor(() =>
      expect(mockUpdateFeatureSettings).toHaveBeenCalledWith({
        call_tracking: { mode: 'off', call_types: TYPES },
      })
    );
  });
});
