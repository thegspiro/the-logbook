/**
 * `PUT /config` and `PUT /config/profiles/{id}` are partial updates — the
 * backend dumps them with `exclude_unset`, so an omitted key means "leave
 * this alone" and only an explicit `null` clears a nullable column
 * (CLAUDE.md Pitfall #1; CMP-1/CMP-2 fixed the backend half of this on the
 * compliance module in security-review pass 1, PR #1902).
 *
 * Pass 1 was backend-only and never looked at this page. It turned out the
 * frontend had the mirror-image bug: every "blank box" field in both save
 * handlers coerced an empty value to `undefined`, which axios/JSON.stringify
 * drops from the request body — the same omission the backend fix exists to
 * catch. A compliance officer who cleared "Email Recipients" (or a profile's
 * threshold override, or its membership-type/requirement selections) and hit
 * Save saw a success toast while the old value silently survived. See
 * CMP2-2 in docs/security-review/CMP-20-compliance.md.
 *
 * These render the real page, clear each field the way an officer would, hit
 * Save, and assert the exact request body the mocked service received — not
 * a scan of the component source. A version of this page whose Save button
 * stopped calling the service (or started sending the old `undefined` form)
 * would fail every test below; the original source-matching version of this
 * file could not have caught either (Codex review on PR #2059, CMP2-2-A).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ComplianceConfigData, ComplianceProfile, AvailableRequirement } from '../types/training';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { timezone?: string } }) => unknown) =>
    selector({ checkPermission: () => true, user: { timezone: 'UTC' } }),
}));

const mockGetConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockInitializeConfig = vi.fn();
const mockGetAvailableRequirements = vi.fn();
const mockListReports = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args) as unknown,
    initializeConfig: (...args: unknown[]) => mockInitializeConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    generateReport: vi.fn(),
    deleteReport: vi.fn(),
    emailReport: vi.fn(),
  },
}));

const mockListCategories = vi.fn();

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursCategoryService: {
    list: (...args: unknown[]) => mockListCategories(...args) as unknown,
  },
}));

import ComplianceRequirementsConfigPage from './ComplianceRequirementsConfigPage';

const requirement: AvailableRequirement = {
  id: 'req-1',
  name: 'CPR Certification',
  requirement_type: 'certification',
  source: 'department',
  frequency: null,
};

const profile: ComplianceProfile = {
  id: 'profile-1',
  configId: 'config-1',
  name: 'Active Firefighter',
  description: 'Some description',
  membershipTypes: [],
  compliantThresholdOverride: 90,
  atRiskThresholdOverride: 70,
  requiredRequirementIds: ['req-1'],
  optionalRequirementIds: [],
  adminHoursRequirements: [],
  isActive: true,
  priority: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const baseConfig: ComplianceConfigData = {
  id: 'config-1',
  organizationId: 'org-1',
  thresholdType: 'percentage',
  compliantThreshold: 100,
  atRiskThreshold: 75,
  gracePeriodDays: 0,
  includeCurrentMonth: true,
  autoReportFrequency: 'monthly',
  reportEmailRecipients: ['chief@dept.com'],
  reportDayOfMonth: 1,
  notifyNonCompliantMembers: false,
  notifyDaysBeforeDeadline: [30, 14, 7],
  profiles: [profile],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function renderLoaded() {
  // The active tab is read from the URL (`?tab=`), and renderWithRouter uses
  // a real BrowserRouter over jsdom's actual window.history — which, unlike
  // component state, is not reset between tests. Without this, a `?tab=`
  // pushed by an earlier test's tab click leaks into the next test's initial
  // render.
  window.history.pushState({}, '', '/training/compliance-config');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await waitFor(() => {
    expect(screen.getByText('Compliance Requirements Configuration')).toBeInTheDocument();
  });
}

describe('ComplianceRequirementsConfigPage — clearing a field on update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(baseConfig);
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [requirement] });
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
    mockListCategories.mockResolvedValue([]);
    mockUpdateConfig.mockResolvedValue(baseConfig);
    mockUpdateProfile.mockResolvedValue(profile);
  });

  describe('config payload (handleSaveConfig)', () => {
    it('sends an explicit null for cleared reminder days, not undefined', async () => {
      await renderLoaded();

      // Thresholds is the default tab; "Reminder Days Before Deadline" lives
      // there, pre-filled from the loaded config.
      const daysInput = screen.getByPlaceholderText('30, 14, 7');
      expect(daysInput).toHaveValue('30, 14, 7');
      await userEvent.clear(daysInput);

      await userEvent.click(screen.getByRole('button', { name: /Save Configuration/ }));

      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
      expect(mockUpdateConfig).toHaveBeenCalledWith({
        threshold_type: 'percentage',
        compliant_threshold: 100,
        at_risk_threshold: 75,
        grace_period_days: 0,
        include_current_month: true,
        auto_report_frequency: 'monthly',
        report_email_recipients: ['chief@dept.com'],
        report_day_of_month: 1,
        notify_non_compliant_members: false,
        notify_days_before_deadline: null,
      });
    });

    it('sends an explicit null for cleared email recipients, not undefined', async () => {
      await renderLoaded();

      // Email Recipients lives on the Auto Reports (schedule) tab.
      await userEvent.click(screen.getByRole('button', { name: 'Auto Reports' }));
      const recipientsInput = screen.getByPlaceholderText('chief@dept.com, training@dept.com');
      expect(recipientsInput).toHaveValue('chief@dept.com');
      await userEvent.clear(recipientsInput);

      await userEvent.click(screen.getByRole('button', { name: /Save Schedule/ }));

      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
      expect(mockUpdateConfig).toHaveBeenCalledWith({
        threshold_type: 'percentage',
        compliant_threshold: 100,
        at_risk_threshold: 75,
        grace_period_days: 0,
        include_current_month: true,
        auto_report_frequency: 'monthly',
        report_email_recipients: null,
        report_day_of_month: 1,
        notify_non_compliant_members: false,
        notify_days_before_deadline: [30, 14, 7],
      });
    });
  });

  describe('profile payload (handleSaveProfile)', () => {
    async function openProfileEditForm() {
      await renderLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Profiles' }));
      await screen.findByText('Active Firefighter');
      await userEvent.click(screen.getByTitle('Edit'));
      await screen.findByRole('button', { name: 'Update Profile' });
    }

    it('sends an explicit null for a cleared description and threshold overrides, and an empty list for the last unchecked requirement — not undefined', async () => {
      await openProfileEditForm();

      const descriptionInput = screen.getByPlaceholderText('Description of this compliance profile');
      expect(descriptionInput).toHaveValue('Some description');
      await userEvent.clear(descriptionInput);

      const [compliantOverride, atRiskOverride] = screen.getAllByPlaceholderText('Use org default');
      expect(compliantOverride).toHaveValue(90);
      expect(atRiskOverride).toHaveValue(70);
      await userEvent.clear(compliantOverride);
      await userEvent.clear(atRiskOverride);

      const requirementCheckbox = screen.getByRole('checkbox', { name: /CPR Certification/ });
      expect(requirementCheckbox).toBeChecked();
      await userEvent.click(requirementCheckbox);
      expect(requirementCheckbox).not.toBeChecked();

      await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

      await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
      expect(mockUpdateProfile).toHaveBeenCalledWith('profile-1', {
        name: 'Active Firefighter',
        description: null,
        membership_types: [],
        required_requirement_ids: [],
        optional_requirement_ids: [],
        compliant_threshold_override: null,
        at_risk_threshold_override: null,
        admin_hours_requirements: [],
        priority: 0,
      });
    });
  });
});

describe('ComplianceRequirementsConfigPage — reading a cleared field back after reload (CMP2-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [requirement] });
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
    mockListCategories.mockResolvedValue([]);
  });

  it('renders an explicitly cleared reminder-days list as empty, not the suggested default', async () => {
    // '30, 14, 7' is the pre-save placeholder shown before a config has ever
    // been saved (the field's initial useState). Once a saved config comes
    // back from the API with notifyDaysBeforeDeadline: null — the officer
    // cleared and saved the box — loadConfig must render that as empty, not
    // fall back to the placeholder text: that would put the old-looking
    // value right back in the box immediately after every reload, even
    // though the database correctly holds no reminder schedule.
    mockGetConfig.mockResolvedValue({ ...baseConfig, notifyDaysBeforeDeadline: null });

    await renderLoaded();

    expect(screen.getByPlaceholderText('30, 14, 7')).toHaveValue('');
  });

  it('still shows a configured reminder-days list after reload', async () => {
    // The other direction, so the test above cannot pass by rendering every
    // list as empty regardless of what the API returned.
    mockGetConfig.mockResolvedValue(baseConfig);

    await renderLoaded();

    expect(screen.getByPlaceholderText('30, 14, 7')).toHaveValue('30, 14, 7');
  });

  it('renders explicitly cleared email recipients as empty, not a stale value', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, reportEmailRecipients: null });

    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Auto Reports' }));

    expect(screen.getByPlaceholderText('chief@dept.com, training@dept.com')).toHaveValue('');
  });
});

describe('ComplianceRequirementsConfigPage — unwired notification settings (CMP2-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(baseConfig);
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [requirement] });
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
    mockListCategories.mockResolvedValue([]);
  });

  it('tells the officer these settings do not send anything yet', async () => {
    // `notify_non_compliant_members` / `notify_days_before_deadline` are
    // stored by this page but read by no scheduled task or sender anywhere
    // in the backend (verified: `grep -rn notify_days_before_deadline
    // backend/app` outside schemas/models returns nothing). CLAUDE.md
    // Pitfall #19: a config switch must have a reader before a UI, or the UI
    // must say so. This asserts the honest label actually renders next to
    // the settings it describes, rather than merely existing somewhere in
    // the source. It does not (and cannot) verify a reader exists — that is
    // CMP2-1's open half.
    await renderLoaded();

    expect(
      screen.getByText(
        /Not yet active: these settings are saved, but no reminder is sent yet\. Members are not notified when they become non-compliant\./
      )
    ).toBeInTheDocument();
  });
});
