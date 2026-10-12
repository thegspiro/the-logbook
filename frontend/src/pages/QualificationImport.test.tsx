import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';
import type { QualificationImportResult } from '../types/user';

const mockImportCsv = vi.fn();
vi.mock('../services/api', () => ({
  memberQualificationService: {
    importCsv: (...args: unknown[]) => mockImportCsv(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

// Import AFTER mocks
import QualificationImport from './QualificationImport';

const CHECKED: QualificationImportResult = {
  dry_run: true,
  total_rows: 3,
  valid_rows: 1,
  imported: 0,
  rows: [
    {
      row: 2,
      user_id: 'u1',
      member_name: 'Pat Medic',
      qualification_code: 'emt',
      label: 'EMT',
      granted_on: '2019-05-01',
      expires_on: null,
      action: 'create',
    },
  ],
  errors: [
    { row: 3, message: "no member of this department matches 'OUT-1'" },
    { row: 4, message: "expiry date '2027-13-01' is not a date (use YYYY-MM-DD)" },
  ],
};

const csv = () => new File(['membership_number,qualification\nM-1,emt\n'], 'licences.csv', { type: 'text/csv' });

describe('QualificationImport', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockImportCsv.mockReset();
    mockImportCsv.mockImplementation((_file: File, dryRun: boolean) =>
      Promise.resolve(dryRun ? CHECKED : { ...CHECKED, dry_run: false, imported: 1 })
    );
  });

  it('checks the file first and lists every rejected row by line', async () => {
    const user = userEvent.setup();
    renderWithRouter(<QualificationImport />);

    const file = csv();
    await user.upload(screen.getByLabelText('Qualifications CSV file'), file);

    expect(await screen.findByText(/1 of 3 rows ready/)).toBeInTheDocument();
    expect(mockImportCsv).toHaveBeenCalledWith(file, true);
    const rejected = screen.getByRole('list', { name: 'Rejected rows' });
    expect(within(rejected).getByText(/Line 3: no member of this department/)).toBeInTheDocument();
    expect(within(rejected).getByText(/Line 4: expiry date/)).toBeInTheDocument();
    expect(screen.getByText('Pat Medic')).toBeInTheDocument();
  });

  it('writes the passing rows only when the officer imports them', async () => {
    const user = userEvent.setup();
    renderWithRouter(<QualificationImport />);

    const file = csv();
    await user.upload(screen.getByLabelText('Qualifications CSV file'), file);
    await user.click(await screen.findByRole('button', { name: 'Import 1 row' }));

    await waitFor(() => expect(mockImportCsv).toHaveBeenLastCalledWith(file, false));
    expect(mockImportCsv).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Recorded 1 qualification');
  });

  it('offers no import when no row passed', async () => {
    mockImportCsv.mockReset();
    mockImportCsv.mockResolvedValue({ ...CHECKED, valid_rows: 0, rows: [] });
    const user = userEvent.setup();
    renderWithRouter(<QualificationImport />);

    await user.upload(screen.getByLabelText('Qualifications CSV file'), csv());

    expect(await screen.findByRole('button', { name: 'Import 0 rows' })).toBeDisabled();
  });
});
