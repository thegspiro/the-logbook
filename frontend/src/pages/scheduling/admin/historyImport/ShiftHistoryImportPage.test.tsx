import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

const mockList = vi.fn();
const mockUpload = vi.fn();
const mockDiscard = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../../../modules/scheduling/services/historyImportApi', () => ({
  historyImportService: {
    listImports: (...a: unknown[]) => mockList(...a) as unknown,
    upload: (...a: unknown[]) => mockUpload(...a) as unknown,
    discard: (...a: unknown[]) => mockDiscard(...a) as unknown,
    downloadTemplate: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import ShiftHistoryImportPage from './ShiftHistoryImportPage';

const dropFile = (file: File) =>
  fireEvent.drop(screen.getByRole('button', { name: 'Drop a CSV here or click to browse' }), {
    dataTransfer: { files: [file] },
  });

const draft = {
  id: 'imp-draft',
  status: 'draft',
  source_filename: '2019-2021.csv',
  timezone: 'America/New_York',
  row_count: 812,
  created_at: '2026-10-09T12:00:00Z',
};
const committed = {
  id: 'imp-done',
  status: 'committed',
  source_filename: '2018.csv',
  timezone: 'America/New_York',
  row_count: 400,
  created_at: '2026-10-08T12:00:00Z',
  committed_at: '2026-10-08T13:00:00Z',
  summary: { shifts_created: 120, attendance_created: 380 },
};

describe('ShiftHistoryImportPage', () => {
  beforeEach(() => {
    for (const mock of [mockList, mockUpload, mockDiscard, mockNavigate]) mock.mockReset();
    mockList.mockResolvedValue([draft, committed]);
    mockDiscard.mockResolvedValue(undefined);
  });

  it('lists drafts to review and committed imports to view', async () => {
    renderWithRouter(<ShiftHistoryImportPage />);

    expect(await screen.findByText('2019-2021.csv')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/scheduling/admin/history-import/imp-draft'
    );
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/scheduling/admin/history-import/imp-done'
    );
    expect(screen.getByText(/120 shifts created/)).toBeInTheDocument();
    // A committed import is final and offers no discard.
    expect(screen.queryByRole('button', { name: 'Discard draft 2018.csv' })).not.toBeInTheDocument();
  });

  it('uploads with the chosen time zone and opens the review', async () => {
    mockUpload.mockResolvedValue({ ...draft, id: 'imp-new', row_count: 3, source_filename: 'h.csv' });
    const user = userEvent.setup();
    renderWithRouter(<ShiftHistoryImportPage />);
    await screen.findByText('2019-2021.csv');

    const upload = screen.getByRole('button', { name: 'Upload and review' });
    expect(upload).toBeDisabled();

    const file = new File(['member_name,unit\n'], 'h.csv', { type: 'text/csv' });
    dropFile(file);
    await user.selectOptions(screen.getByLabelText('Times in the file are in'), 'America/Chicago');
    await user.click(upload);

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file, 'America/Chicago'));
    expect(mockNavigate).toHaveBeenCalledWith('/scheduling/admin/history-import/imp-new');
  });

  it('defaults to the department time zone by sending none', async () => {
    mockUpload.mockResolvedValue({ ...draft, id: 'imp-new' });
    const user = userEvent.setup();
    renderWithRouter(<ShiftHistoryImportPage />);
    await screen.findByText('2019-2021.csv');

    const file = new File(['x'], 'h.csv', { type: 'text/csv' });
    dropFile(file);
    await user.click(screen.getByRole('button', { name: 'Upload and review' }));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file, undefined));
  });

  it('discards a draft only after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftHistoryImportPage />);
    await user.click(await screen.findByRole('button', { name: 'Discard draft 2019-2021.csv' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('imp-draft'));
    await waitFor(() => expect(screen.queryByText('2019-2021.csv')).not.toBeInTheDocument());
  });
});
