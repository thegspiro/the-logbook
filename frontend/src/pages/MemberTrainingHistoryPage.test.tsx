import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { TrainingRecord } from '../types/training';

const mockGetRecords = vi.fn();
const mockVoidRecord = vi.fn();
const mockUpdateRecord = vi.fn();
const mockGetUser = vi.fn();
const mockExportReport = vi.fn();
let mockPermissions: string[] = [];

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useParams: () => ({ userId: 'member-1' }),
}));

vi.mock('../services/api', () => ({
  trainingService: {
    getRecords: (...args: unknown[]) => mockGetRecords(...args) as unknown,
    voidRecord: (...args: unknown[]) => mockVoidRecord(...args) as unknown,
    updateRecord: (...args: unknown[]) => mockUpdateRecord(...args) as unknown,
  },
  userService: {
    getUserWithRoles: (...args: unknown[]) => mockGetUser(...args) as unknown,
  },
  // The officer's requirements section loads on its own; these tests are
  // about the records below it.
  trainingModuleConfigService: {
    getMemberRequirements: () =>
      Promise.resolve({
        user_id: 'member-1',
        as_of: '2026-10-21',
        leave_month_rule: 'full_month',
        requirements_summary: { total_requirements: 0, met_requirements: 0, avg_compliance: null },
        requirements_detail: [],
        leaves_of_absence: [],
      }),
  },
}));

vi.mock('../services/trainingServices', () => ({
  reportExportService: { exportReport: (...args: unknown[]) => mockExportReport(...args) as unknown },
  documentService: {
    getRecordAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    getAttachmentDownloadUrl: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => mockPermissions.includes(p) }),
}));

// The page's period windows are measured from "today"; pin it so a record
// dated 2026-09-01 stays inside "This Year" whenever the suite runs.
vi.mock('../utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-11-06',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MemberTrainingHistoryPage from './MemberTrainingHistoryPage';

const record = (overrides: Partial<TrainingRecord> = {}): TrainingRecord => ({
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'member-1',
  course_name: 'HIPAA Awareness',
  training_type: 'continuing_education',
  completion_date: '2026-09-01',
  hours_completed: 1,
  credit_hours: 1,
  expiration_date: '2027-09-01',
  certification_number: 'C-1',
  status: 'completed',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('MemberTrainingHistoryPage officer corrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecords.mockReset();
    mockGetRecords.mockResolvedValue([record()]);
    mockVoidRecord.mockReset();
    mockVoidRecord.mockResolvedValue(undefined);
    mockUpdateRecord.mockReset();
    mockUpdateRecord.mockResolvedValue(record());
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ id: 'member-1', full_name: 'Pat Member', username: 'pat' });
    mockPermissions = ['training.manage'];
  });

  it('voids a record only with a reason, then reloads the history', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberTrainingHistoryPage />);

    await user.click(await screen.findByRole('button', { name: 'Void HIPAA Awareness' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Void record' }));
    expect(mockVoidRecord).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Completed by another member');
    await user.click(within(dialog).getByRole('button', { name: 'Void record' }));

    await waitFor(() => {
      expect(mockVoidRecord).toHaveBeenCalledWith('rec-1', 'Completed by another member');
    });
    await waitFor(() => {
      expect(mockGetRecords).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a voided record with its reason and offers no actions on it', async () => {
    mockGetRecords.mockResolvedValue([
      record({ status: 'cancelled', voided_at: '2026-10-07T20:00:00Z', void_reason: 'Completed by another member' }),
    ]);
    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('voided')).toBeInTheDocument();
    expect(screen.getByText('Reason: Completed by another member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void HIPAA Awareness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit HIPAA Awareness' })).not.toBeInTheDocument();
  });

  it('offers no corrections without training.manage', async () => {
    mockPermissions = [];
    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('HIPAA Awareness')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void HIPAA Awareness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('saves every field the form owns, clearing a blanked one, with the note to the member', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberTrainingHistoryPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit HIPAA Awareness' }));
    const dialog = screen.getByRole('dialog');
    const hours = within(dialog).getByLabelText('Hours completed');
    await user.clear(hours);
    await user.type(hours, '0.5');
    await user.clear(within(dialog).getByLabelText('Expiration date'));
    await user.type(within(dialog).getByLabelText(/Note to the member/), 'Provider credits half an hour');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockUpdateRecord).toHaveBeenCalledWith(
        'rec-1',
        {
          course_name: 'HIPAA Awareness',
          training_type: 'continuing_education',
          completion_date: '2026-09-01',
          hours_completed: 0.5,
          credit_hours: 1,
          expiration_date: null,
          certification_number: 'C-1',
        },
        'Provider credits half an hour'
      );
    });
  });
});

const statValue = (label: string): string | null | undefined =>
  screen.getByText(label, { selector: 'p' }).nextElementSibling?.textContent;

describe('MemberTrainingHistoryPage training period', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ id: 'member-1', full_name: 'Pat Member', username: 'pat' });
    mockExportReport.mockReset();
    mockExportReport.mockResolvedValue(new Blob(['x']));
    mockGetRecords.mockReset();
    mockGetRecords.mockResolvedValue([
      record({ id: 'r-2026', course_name: 'Pump Ops 2026', completion_date: '2026-01-10', hours_completed: 6 }),
      record({ id: 'r-dec', course_name: 'Ladders Dec 2025', completion_date: '2025-12-05', hours_completed: 6.5 }),
      record({ id: 'r-old', course_name: 'Hazmat 2019', completion_date: '2019-04-02', hours_completed: 92 }),
      record({
        id: 'r-next',
        course_name: 'Driver Course',
        status: 'scheduled',
        completion_date: undefined,
        scheduled_date: '2026-12-02',
        hours_completed: 0,
      }),
    ]);
    mockPermissions = [];
  });

  it('scopes the record list and hour totals to this year by default', async () => {
    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('Pump Ops 2026')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Training period' })).toHaveValue('year');
    expect(screen.queryByText('Ladders Dec 2025')).not.toBeInTheDocument();
    expect(screen.queryByText('Hazmat 2019')).not.toBeInTheDocument();
    // An upcoming class stays on the page even though it is after today.
    expect(screen.getByText('Driver Course')).toBeInTheDocument();
    expect(statValue('Total Hours')).toBe('6');
    expect(statValue('Completed')).toBe('1');
    expect(statValue('Total Records')).toBe('2');
  });

  it('matches the rolling requirement window with Last 12 Months', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberTrainingHistoryPage />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Training period' }), 'last_12_months');

    expect(screen.getByText('Ladders Dec 2025')).toBeInTheDocument();
    expect(screen.queryByText('Hazmat 2019')).not.toBeInTheDocument();
    expect(statValue('Total Hours')).toBe('12.5');
  });

  it('shows the lifetime total only under All Time', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberTrainingHistoryPage />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Training period' }), 'lifetime');

    expect(screen.getByText('Hazmat 2019')).toBeInTheDocument();
    expect(statValue('Total Hours')).toBe('104.5');
    expect(statValue('Total Records')).toBe('4');
  });

  it('finds an expired certificate from an earlier year under the Expired filter', async () => {
    const user = userEvent.setup();
    mockGetRecords.mockResolvedValue([
      record({ id: 'r-cpr', course_name: 'CPR 2022', completion_date: '2022-06-01', expiration_date: '2024-06-01' }),
    ]);
    renderWithRouter(<MemberTrainingHistoryPage />);

    expect(await screen.findByText('No training records found')).toBeInTheDocument();
    expect(statValue('Expired')).toBe('1');

    await user.selectOptions(screen.getByRole('combobox', { name: /Filter training records by status/ }), 'expired');

    expect(screen.getByText('CPR 2022')).toBeInTheDocument();
  });

  it('exports the period the page is showing', async () => {
    const user = userEvent.setup();
    // jsdom cannot follow the download link the export clicks.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithRouter(<MemberTrainingHistoryPage />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Training period' }), 'last_12_months');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(mockExportReport).toHaveBeenCalledWith({
        report_type: 'individual',
        format: 'csv',
        user_id: 'member-1',
        start_date: '2025-12-01',
        end_date: '2026-11-06',
      });
    });
    click.mockRestore();
  });
});
