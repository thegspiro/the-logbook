/**
 * Generating a compliance report can fail for reasons the officer can act on
 * (a 400 carries the reason, e.g. "A monthly report needs a month"), and it can
 * succeed without the email the officer asked for: the backend stores the
 * report first and only logs a failed send. The page used to toast "Failed to
 * generate report" for every rejection, and "Report generated" even when the
 * email never went out.
 *
 * These render the real page, press Generate and assert what the officer is
 * told for each outcome of the mocked service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { createMockApiError, renderWithRouter } from '../test/utils';
import type { ComplianceConfigData, ComplianceReportDetail } from '../types/training';

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
const mockGenerateReport = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    generateReport: (...args: unknown[]) => mockGenerateReport(...args) as unknown,
    updateConfig: vi.fn(),
    initializeConfig: vi.fn(),
    updateProfile: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    emailReport: vi.fn(),
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

const generated: ComplianceReportDetail = {
  id: 'report-2',
  organizationId: 'org-1',
  reportType: 'monthly',
  periodLabel: 'February 2026',
  periodYear: 2026,
  periodMonth: 2,
  status: 'completed',
  generatedAt: '2026-03-01T06:30:00Z',
};

async function renderReportsTab() {
  window.history.pushState({}, '', '/training/compliance-config');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Report History' }));
}

async function pressGenerate() {
  await userEvent.click(await screen.findByRole('button', { name: 'Generate Report' }));
}

describe('ComplianceRequirementsConfigPage — generating a report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReset();
    mockGetAvailableRequirements.mockReset();
    mockListReports.mockReset();
    mockGenerateReport.mockReset();
    mockGetConfig.mockResolvedValue(config);
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [] });
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
  });

  it("shows the server's reason when generation is refused", async () => {
    const reason = 'A monthly report needs a month';
    mockGenerateReport.mockRejectedValue(createMockApiError(reason, 400));
    await renderReportsTab();

    await pressGenerate();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says what failed and what to do when the server itself hit a problem', async () => {
    mockGenerateReport.mockRejectedValue(createMockApiError('An unexpected error occurred', 500));
    await renderReportsTab();

    await pressGenerate();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = vi.mocked(toast.error).mock.calls[0]?.[0] as string;
    expect(message).toMatch(/^Could not generate the report: the server hit a problem/);
    expect(message).not.toBe('An unexpected error occurred');
  });

  it('confirms a report that was not asked to be emailed', async () => {
    mockGenerateReport.mockResolvedValue(generated);
    await renderReportsTab();

    await pressGenerate();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Report generated'));
    expect(toast.error).not.toHaveBeenCalled();
    // The history is refreshed to show the new report.
    expect(mockListReports).toHaveBeenCalledTimes(2);
  });

  it('confirms a report whose email was delivered', async () => {
    mockGenerateReport.mockResolvedValue({
      ...generated,
      emailedTo: ['chief@dept.com'],
      emailedAt: '2026-03-01T06:31:00Z',
    });
    await renderReportsTab();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Email report' }));

    await pressGenerate();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Report generated'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not claim success when the requested email did not go out', async () => {
    mockGenerateReport.mockResolvedValue(generated);
    await renderReportsTab();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Email report' }));

    await pressGenerate();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Report generated, but it was not emailed. Check the recipients and the email settings.'
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
    // The report exists, so the history still refreshes to show it.
    expect(mockListReports).toHaveBeenCalledTimes(2);
  });
});
