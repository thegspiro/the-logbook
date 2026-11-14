import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockList = vi.fn();
const mockUpload = vi.fn();
const mockDiscard = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    listImports: (...a: unknown[]) => mockList(...a) as unknown,
    upload: (...a: unknown[]) => mockUpload(...a) as unknown,
    discard: (...a: unknown[]) => mockDiscard(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import HistoricalImportPage from './HistoricalImportPage';

const dropFile = (file: File) =>
  fireEvent.drop(screen.getByRole('button', { name: 'Drop a CSV here or click to browse' }), {
    dataTransfer: { files: [file] },
  });

const earlier = {
  id: 'hist-1',
  status: 'routed',
  source_filename: 'FCVFDHours.csv',
  source_system: 'Hours database',
  timezone: 'America/New_York',
  row_count: 77506,
  created_at: '2026-11-03T12:00:00Z',
};

describe('HistoricalImportPage', () => {
  beforeEach(() => {
    for (const mock of [mockList, mockUpload, mockDiscard, mockNavigate]) mock.mockReset();
    mockList.mockResolvedValue([earlier]);
    mockDiscard.mockResolvedValue(undefined);
  });

  it('lists earlier imports and offers the source system they used', async () => {
    renderWithRouter(<HistoricalImportPage />);

    expect(await screen.findByText('FCVFDHours.csv')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/integrations/historical-import/hist-1'
    );
    // A re-import must name the same system to be recognised.
    expect(screen.getByLabelText('Which system is this from?')).toHaveValue('Hours database');
  });

  it('needs a file and a source system before it uploads', async () => {
    mockList.mockResolvedValue([]);
    mockUpload.mockResolvedValue({ ...earlier, id: 'hist-new', row_count: 3, source_filename: 'h.csv' });
    const user = userEvent.setup();
    renderWithRouter(<HistoricalImportPage />);
    await screen.findByText('No imports yet');

    const upload = screen.getByRole('button', { name: 'Upload and review' });
    const file = new File(['VID,Date\n'], 'h.csv', { type: 'text/csv' });
    dropFile(file);
    expect(upload).toBeDisabled();

    await user.type(screen.getByLabelText('Which system is this from?'), 'Old hours');
    await user.click(upload);

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(file, 'Old hours', undefined));
    expect(mockNavigate).toHaveBeenCalledWith('/integrations/historical-import/hist-new');
  });

  it('discards an import only after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<HistoricalImportPage />);
    await user.click(await screen.findByRole('button', { name: 'Discard import FCVFDHours.csv' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard import' }));

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('hist-1'));
    await waitFor(() => expect(screen.queryByText('FCVFDHours.csv')).not.toBeInTheDocument());
  });
});
