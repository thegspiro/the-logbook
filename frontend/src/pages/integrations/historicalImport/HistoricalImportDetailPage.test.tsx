import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { HistoricalImportDetail } from '../../../modules/integrations/types/historicalImport';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockBatches = vi.fn();
const mockDiscardBatches = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getImport: (...a: unknown[]) => mockGet(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown,
    createShiftBatches: (...a: unknown[]) => mockBatches(...a) as unknown,
    discardOpenBatches: (...a: unknown[]) => mockDiscardBatches(...a) as unknown,
    downloadLog: vi.fn(),
    discard: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import HistoricalImportDetailPage from './HistoricalImportDetailPage';

const detail = (overrides: Partial<HistoricalImportDetail> = {}): HistoricalImportDetail => ({
  import: {
    id: 'hist-1',
    status: 'draft',
    source_filename: 'FCVFDHours.csv',
    source_system: 'Hours database',
    timezone: 'America/New_York',
    row_count: 77506,
    created_at: '2026-11-03T12:00:00Z',
  },
  headers: ['VID', 'Date', 'Standby', 'Recall', 'EMSCalls', 'Notes'],
  column_mapping: { membership_number: 'VID', date: 'Date' },
  hour_columns: { Standby: 'shift', Recall: 'on_call' },
  call_columns: { EMSCalls: 'ems' },
  fields: ['membership_number', 'date', 'unit'],
  record_types: ['shift', 'on_call', 'training', 'admin', 'ignore'],
  importable_types: ['shift', 'on_call'],
  call_types: [
    { slug: 'ems', label: 'EMS' },
    { slug: 'fire', label: 'Fire' },
  ],
  routing: {
    rows: 77506,
    skipped: 3,
    with_errors: 0,
    errors: [],
    notes: { past_midnight: { count: 979, examples: [{ line_number: 9, message: 'End time 2445 read as 0045.' }] } },
    types: {
      shift: { records: 10088, hours: 101562, first_date: '2004-08-01', last_date: '2026-10-30' },
      on_call: { records: 1689, hours: 20631.5, first_date: '2005-01-01', last_date: '2026-10-01' },
      training: { records: 29621, hours: 101759.25 },
      admin: { records: 36105, hours: 79718.25 },
    },
  },
  rows_imported: 0,
  batches: [],
  settings_locked: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/integrations/historical-import/hist-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/integrations/historical-import/:importId" element={<HistoricalImportDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('HistoricalImportDetailPage', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockUpdate, mockBatches, mockDiscardBatches]) mock.mockReset();
    mockGet.mockResolvedValue(detail());
    mockUpdate.mockImplementation(() => Promise.resolve(detail()));
    mockBatches.mockResolvedValue([]);
    mockDiscardBatches.mockResolvedValue(1);
  });

  it('shows how every kind of hour sorted and what was cleaned up', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'FCVFDHours.csv' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('hist-1');
    expect(screen.getByRole('cell', { name: 'On-call hours (recall)' })).toBeInTheDocument();
    expect(screen.getByText('10,088')).toBeInTheDocument();
    expect(screen.getByText(/Time written past 2400, read as the next day: 979/)).toBeInTheDocument();
    expect(screen.queryByText('A later step')).not.toBeInTheDocument();
    expect(screen.getByText('Admin Hours, below')).toBeInTheDocument();
    expect(screen.getByText('Training, below')).toBeInTheDocument();
  });

  it('saves a column as hours or calls by what it holds', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'FCVFDHours.csv' });

    await user.selectOptions(screen.getByLabelText('Recall'), 'hours:shift');
    await user.selectOptions(screen.getByLabelText('Notes'), 'calls:fire');
    await user.click(screen.getByRole('button', { name: 'Save and re-sort' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [importId, payload] = mockUpdate.mock.calls[0] as [string, Record<string, Record<string, unknown>>];
    expect(importId).toBe('hist-1');
    expect(payload.column_mapping).toEqual({ membership_number: 'VID', date: 'Date', unit: null });
    expect(payload.hour_columns).toMatchObject({ Standby: 'shift', Recall: 'shift', Notes: null, EMSCalls: null });
    expect(payload.call_columns).toMatchObject({ EMSCalls: 'ems', Notes: 'fire', Standby: null });
    expect(payload).not.toHaveProperty('source_system');
  });

  it('sends shifts to review only after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Send to shift review' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('11,777 shift and on-call rows');
    await user.click(within(dialog).getByRole('button', { name: 'Send to review' }));

    await waitFor(() => expect(mockBatches).toHaveBeenCalledWith('hist-1'));
  });

  it('locks the settings and links each batch while one is in review', async () => {
    mockGet.mockResolvedValue(
      detail({
        settings_locked: true,
        batches: [
          {
            id: 'batch-1',
            status: 'draft',
            source_filename: 'FCVFDHours.csv (shifts 2004-08 to 2011-05)',
            row_count: 4955,
          },
        ],
      })
    );
    renderPage();

    expect(await screen.findByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/scheduling/admin/history-import/batch-1'
    );
    expect(screen.getByRole('button', { name: 'Save and re-sort' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send to shift review' })).toBeDisabled();
    expect(screen.getByLabelText('Source system')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard batches in review' })).toBeEnabled();
  });
});
