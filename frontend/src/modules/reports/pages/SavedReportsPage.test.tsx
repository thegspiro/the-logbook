/**
 * The saved-reports screen (RPT2-29-2): lists, runs, and — for
 * `reports.manage` — saves and schedules reports. Which types may be chosen,
 * and who a member-data report may be emailed to, are the server's decisions;
 * the screen offers `/reports/available` and shows the server's refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { SavedReportConfig } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let canManage = true;
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => (p === 'reports.manage' ? canManage : true) }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const runNow = vi.fn();
const getAvailable = vi.fn();
vi.mock('../services/api', () => ({
  reportsApiService: {
    getAvailableReports: (...a: unknown[]) => getAvailable(...a) as unknown,
    generateReport: vi.fn(),
  },
  savedReportsService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    update: (...a: unknown[]) => update(...a) as unknown,
    delete: (...a: unknown[]) => remove(...a) as unknown,
    runNow: (...a: unknown[]) => runNow(...a) as unknown,
  },
}));

import SavedReportsPage from './SavedReportsPage';
import { useReportsStore } from '../store/reportsStore';

function saved(overrides: Partial<SavedReportConfig> = {}): SavedReportConfig {
  return {
    id: 'sr-1',
    name: 'Monthly program progress',
    report_type: 'compliance_status',
    filters: { period: 'previous_month' },
    is_scheduled: true,
    schedule_frequency: 'monthly',
    schedule_day: 1,
    email_recipients: ['chief@dept.org', 'training@dept.org'],
    last_run_at: null,
    next_run_at: '2026-11-01',
    enforced: true,
    created_by: 'u1',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('SavedReportsPage', () => {
  beforeEach(() => {
    canManage = true;
    for (const m of [list, create, update, remove, runNow, getAvailable, navigate]) m.mockReset();
    getAvailable.mockResolvedValue({
      available_reports: [
        {
          id: 'compliance_status',
          title: 'Program Requirement Progress',
          description: '',
          category: 'compliance',
          available: true,
        },
        {
          id: 'apparatus_status',
          title: 'Fleet / Apparatus Status',
          description: '',
          category: 'operations',
          available: true,
        },
      ],
    });
    list.mockResolvedValue([saved()]);
    useReportsStore.setState({ savedReports: [], availableReports: [], error: null, generatingReportType: null });
  });

  it('lists a scheduled report with its schedule and next email', async () => {
    renderWithRouter(<SavedReportsPage />);

    expect(await screen.findByText('Monthly program progress')).toBeInTheDocument();
    expect(await screen.findByText(/Program Requirement Progress · Previous month/)).toBeInTheDocument();
    expect(screen.getByText('Monthly on day 1')).toBeInTheDocument();
    expect(screen.getByText('Nov 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not offer Run on a report the viewer cannot run', async () => {
    list.mockResolvedValue([saved({ report_type: 'member_roster', name: 'Roster' })]);
    renderWithRouter(<SavedReportsPage />);

    expect(await screen.findByText(/A report you do not have access to run/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run/i })).not.toBeInTheDocument();
  });

  it('hides saving and editing from a view-only member', async () => {
    canManage = false;
    renderWithRouter(<SavedReportsPage />);

    await screen.findByText('Monthly program progress');
    expect(screen.queryByRole('button', { name: /new saved report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('runs a report and opens it on the Reports page', async () => {
    runNow.mockResolvedValue({ report_type: 'compliance_status', entries: [] });
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /run/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/reports'));
    expect(runNow).toHaveBeenCalledWith('sr-1');
    expect(useReportsStore.getState().activeReportLabel).toBe('Monthly program progress');
  });

  it('saves a schedule and shows the server refusing a recipient', async () => {
    list.mockResolvedValue([]);
    create.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Not allowed: county@example.org' } },
      message: 'Request failed',
    });
    create.mockResolvedValueOnce(saved({ id: 'sr-2', name: 'Fleet weekly', report_type: 'apparatus_status' }));
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /new saved report/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Fleet weekly');
    await userEvent.selectOptions(within(dialog).getByLabelText('Report'), 'apparatus_status');
    await userEvent.selectOptions(within(dialog).getByLabelText('Reporting period'), 'previous_month');
    await userEvent.click(within(dialog).getByLabelText('Email this report on a schedule'));
    await userEvent.selectOptions(within(dialog).getByLabelText('Day of the week'), '3');
    await userEvent.type(within(dialog).getByLabelText('Email to'), 'county@example.org, chief@dept.org');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save report' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('county@example.org');
    expect(create).toHaveBeenCalledWith({
      name: 'Fleet weekly',
      report_type: 'apparatus_status',
      filters: { period: 'previous_month' },
      is_scheduled: true,
      schedule_frequency: 'weekly',
      schedule_day: 3,
      email_recipients: ['county@example.org', 'chief@dept.org'],
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save report' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('turning a schedule off sends explicit nulls', async () => {
    update.mockResolvedValue(saved({ is_scheduled: false }));
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Email this report on a schedule'));
    await userEvent.clear(within(dialog).getByLabelText('Description (optional)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      description: null,
      is_scheduled: false,
      schedule_frequency: null,
      schedule_day: null,
    });
  });

  it('switching monthly to weekly sends the weekday on screen, not the old day of the month', async () => {
    list.mockResolvedValue([saved({ schedule_day: 15 })]);
    update.mockResolvedValue(saved({ schedule_frequency: 'weekly', schedule_day: 1 }));
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Day of the month')).toHaveValue('15');
    await userEvent.selectOptions(within(dialog).getByLabelText('How often'), 'weekly');
    expect(within(dialog).getByLabelText('Day of the week')).toHaveValue('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({ schedule_frequency: 'weekly', schedule_day: 1 });
  });

  it('keeps a day that is still valid when the frequency changes', async () => {
    list.mockResolvedValue([saved({ schedule_day: 5 })]);
    update.mockResolvedValue(saved({ schedule_frequency: 'weekly', schedule_day: 5 }));
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('How often'), 'weekly');
    expect(within(dialog).getByLabelText('Day of the week')).toHaveValue('5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({ schedule_frequency: 'weekly', schedule_day: 5 });
  });

  it('clamps a stored day that is out of range for the stored frequency', async () => {
    list.mockResolvedValue([saved({ schedule_frequency: 'weekly', schedule_day: 15 })]);
    update.mockResolvedValue(saved({ schedule_frequency: 'weekly', schedule_day: 1 }));
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Day of the week')).toHaveValue('1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[1]).toMatchObject({ schedule_frequency: 'weekly', schedule_day: 1 });
  });

  it('asks before deleting', async () => {
    remove.mockResolvedValue(undefined);
    renderWithRouter(<SavedReportsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Monthly program progress' }));
    expect(await screen.findByText(/its scheduled emails will stop/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete report' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('sr-1'));
  });
});
