/**
 * The "Months on leave" setting: how a month a leave of absence or training
 * waiver covers reduces a target (`leave_month_rule`). Renders the real page,
 * picks a rule the way an officer would, and asserts the saved payload.
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
const mockDeleteProfile = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args) as unknown,
    initializeConfig: (...args: unknown[]) => mockInitializeConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
    createProfile: vi.fn(),
    deleteProfile: (...args: unknown[]) => mockDeleteProfile(...args) as unknown,
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
    expect(
      screen.getByRole('heading', { level: 1, name: 'Compliance Requirements Configuration' })
    ).toBeInTheDocument();
  });
}

describe('ComplianceRequirementsConfigPage — months on leave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(baseConfig);
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [requirement] });
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
    mockListCategories.mockResolvedValue([]);
    mockUpdateConfig.mockResolvedValue(baseConfig);
    mockUpdateProfile.mockResolvedValue(profile);
  });

  it('reads a config without the setting as full month, the default', async () => {
    await renderLoaded();
    expect(screen.getByRole('radio', { name: /Full month \(default\)/ })).toBeChecked();
  });

  it('shows the stored rule', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, leaveMonthRule: 'proportional' });
    await renderLoaded();
    expect(screen.getByRole('radio', { name: /15-day rule: proportional/ })).toBeChecked();
  });

  it('saves the rule the officer picks', async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole('radio', { name: /15-day rule: half/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save Configuration/ }));
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledTimes(1));
    expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ leave_month_rule: 'half' }));
  });
});
