import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { SettingsTab } from './schedulingSettingsSections';

const storeState = {
  platoonsEnabled: false,
  loadSettings: vi.fn(),
  setPlatoonsEnabled: vi.fn(),
};

vi.mock('../store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

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
    }),
    updateFeatureSettings: vi.fn().mockResolvedValue({}),
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
  });

  it('renders the requested section only', () => {
    renderPanel('eligibility');

    expect(screen.getByText('EligibilitySettingsCard')).toBeInTheDocument();
    expect(screen.queryByText('SchedulingNotificationsPanel')).not.toBeInTheDocument();
  });

  // The footer writes only the locally-stored settings object. It used to show
  // on every section, so switching to Notifications or Shift Reports offered a
  // Save button that flashed "Settings saved" without touching their values.
  describe.each<SettingsTab>(['general', 'apparatus', 'equipment'])('on the %s section', (tab) => {
    it('offers the Save/Reset footer', () => {
      renderPanel(tab);

      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    });
  });

  describe.each<SettingsTab>(['platoons', 'eligibility', 'notifications', 'shift-reports'])(
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
});
