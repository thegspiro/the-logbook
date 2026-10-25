/**
 * Emailing a stored compliance report can fail for reasons the officer can act
 * on: the backend answers 400 "The report could not be emailed. Check the email
 * settings and the recipient addresses." when no recipient was reached, and
 * "There is no recipient to email this report to" when none was given or
 * configured. The dialog used to swallow that and toast "Failed to email
 * report" for every failure, so the officer could not tell a bad address from a
 * mail outage.
 *
 * These render the real page, open the dialog from the report history and
 * assert what the officer is told when the mocked service rejects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { createMockApiError, renderWithRouter } from '../test/utils';
import type { ComplianceConfigData, ComplianceReportSummary } from '../types/training';

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
const mockGetAvailableRequirements = vi.fn();
const mockListReports = vi.fn();
const mockEmailReport = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    emailReport: (...args: unknown[]) => mockEmailReport(...args) as unknown,
    updateConfig: vi.fn(),
    initializeConfig: vi.fn(),
    updateProfile: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    generateReport: vi.fn(),
    deleteReport: vi.fn(),
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursCategoryService: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

import ComplianceRequirementsConfigPage from './ComplianceRequirementsConfigPage';

const config: ComplianceConfigData = {
  id: 'config-1',
  organizationId: 'org-1',
  thresholdType: 'percentage',
  compliantThreshold: 100,
  atRiskThreshold: 75,
  gracePeriodDays: 0,
  includeCurrentMonth: true,
  autoReportFrequency: 'monthly',
  reportEmailRecipients: [],
  reportDayOfMonth: 1,
  notifyNonCompliantMembers: false,
  notifyDaysBeforeDeadline: [30, 14, 7],
  profiles: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const report: ComplianceReportSummary = {
  id: 'report-1',
  organizationId: 'org-1',
  reportType: 'monthly',
  periodLabel: 'February 2026',
  periodYear: 2026,
  periodMonth: 2,
  status: 'completed',
  generatedAt: '2026-03-01T06:30:00Z',
};

async function openEmailDialog() {
  window.history.pushState({}, '', '/training/compliance-config');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Report History' }));
  await userEvent.click(await screen.findByTitle('Email report'));
  await userEvent.type(await screen.findByLabelText('Recipients'), 'chief@dept.com');
}

describe('ComplianceRequirementsConfigPage — emailing a report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReset();
    mockGetAvailableRequirements.mockReset();
    mockListReports.mockReset();
    mockEmailReport.mockReset();
    mockGetConfig.mockResolvedValue(config);
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [] });
    mockListReports.mockResolvedValue({ reports: [report], total: 1 });
  });

  it("shows the server's reason when the report could not be emailed", async () => {
    const reason = 'The report could not be emailed. Check the email settings and the recipient addresses.';
    mockEmailReport.mockRejectedValue(createMockApiError(reason, 400));
    await openEmailDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(mockEmailReport).toHaveBeenCalledWith('report-1', ['chief@dept.com']);
    expect(toast.success).not.toHaveBeenCalled();
    // The dialog stays open with what was typed, so the officer can correct it.
    expect(screen.getByLabelText('Recipients')).toHaveValue('chief@dept.com');
  });

  it('says what failed and what to do when the server itself hit a problem', async () => {
    mockEmailReport.mockRejectedValue(createMockApiError('An unexpected error occurred', 500));
    await openEmailDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = vi.mocked(toast.error).mock.calls[0]?.[0] as string;
    expect(message).toMatch(/^Could not email the report: the server hit a problem/);
    expect(message).not.toBe('An unexpected error occurred');
  });

  it('closes the dialog and confirms when the send goes out', async () => {
    mockEmailReport.mockResolvedValue(undefined);
    await openEmailDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Report emailed'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Recipients')).not.toBeInTheDocument();
  });
});
