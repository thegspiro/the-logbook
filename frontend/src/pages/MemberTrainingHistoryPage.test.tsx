import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { TrainingRecord } from '../types/training';

const mockGetRecords = vi.fn();
const mockVoidRecord = vi.fn();
const mockUpdateRecord = vi.fn();
const mockGetUser = vi.fn();
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
}));

vi.mock('../services/trainingServices', () => ({
  reportExportService: { exportReport: vi.fn() },
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
