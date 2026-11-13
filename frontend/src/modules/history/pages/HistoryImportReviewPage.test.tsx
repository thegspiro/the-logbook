import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { ImportDetail, ImportRow } from '../types';

const mockGetImport = vi.fn();
const mockListTitles = vi.fn();
const mockUpdateRow = vi.fn();
const mockAccept = vi.fn();
const mockCommit = vi.fn();
const mockRemove = vi.fn();
const mockSetTitles = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    getImport: (...args: unknown[]) => mockGetImport(...args) as unknown,
    listTitles: (...args: unknown[]) => mockListTitles(...args) as unknown,
    updateImportRow: (...args: unknown[]) => mockUpdateRow(...args) as unknown,
    acceptSuggestions: (...args: unknown[]) => mockAccept(...args) as unknown,
    commitImport: (...args: unknown[]) => mockCommit(...args) as unknown,
    removeImportRecords: (...args: unknown[]) => mockRemove(...args) as unknown,
    setImportTitles: (...args: unknown[]) => mockSetTitles(...args) as unknown,
    listPeople: vi.fn(),
    discardImport: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryImportReviewPage from './HistoryImportReviewPage';

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  id: 'r1',
  line_number: 2,
  values: { last_name: 'Smith', first_name: 'John', joined: '1951', left: '1962' },
  edited_fields: [],
  problems: [],
  decision: null,
  target_member_id: null,
  target_user_id: null,
  target_row_id: null,
  target_label: null,
  suggestions: [],
  ...overrides,
});

const draft = (overrides: Partial<ImportDetail> = {}): ImportDetail => ({
  id: 'imp1',
  status: 'draft',
  source_filename: 'roster.csv',
  row_count: 1,
  column_mapping: {},
  summary: null,
  expires_at: '2026-12-13T00:00:00Z',
  created_at: '2026-11-13T00:00:00Z',
  committed_at: null,
  rows: [row()],
  titles: [],
  ready: false,
  blockers: ['1 row(s) still need a decision'],
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/import/imp1']}>
        <Routes>
          <Route path="/history/import/:importId" element={<HistoryImportReviewPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryImportReviewPage', () => {
  beforeEach(() => {
    for (const mock of [
      mockGetImport,
      mockListTitles,
      mockUpdateRow,
      mockAccept,
      mockCommit,
      mockRemove,
      mockSetTitles,
    ]) {
      mock.mockReset();
    }
    mockListTitles.mockResolvedValue([]);
  });

  it('shows what the server says still blocks the import, and holds the button', async () => {
    mockGetImport.mockResolvedValue(draft());
    renderPage();
    expect(await screen.findByText('1 row(s) still need a decision')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('decides a row from a suggestion, sending the suggested record', async () => {
    mockGetImport.mockResolvedValue(
      draft({
        rows: [
          row({ suggestions: [{ kind: 'match', id: 'p9', strength: 'strong', label: 'John Smith (1951–1962)' }] }),
        ],
      })
    );
    mockUpdateRow.mockResolvedValue(draft({ ready: true, blockers: [] }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add to John Smith/ }));
    expect(mockUpdateRow).toHaveBeenCalledWith('imp1', 'r1', { decision: 'match', target_member_id: 'p9' });
    expect(await screen.findByText('Ready to import.')).toBeInTheDocument();
  });

  it('marks a weak suggestion as only possible', async () => {
    mockGetImport.mockResolvedValue(
      draft({
        rows: [row({ suggestions: [{ kind: 'match', id: 'p9', strength: 'weak', label: 'John Smith' }] })],
      })
    );
    renderPage();
    const button = await screen.findByRole('button', { name: /Add to John Smith/ });
    expect(within(button).getByText('(possible)')).toBeInTheDocument();
  });

  it('lists a row’s problems', async () => {
    mockGetImport.mockResolvedValue(
      draft({ rows: [row({ decision: 'create', problems: ['Left is before Joined'] })] })
    );
    renderPage();
    const problems = await screen.findByRole('list', { name: 'Problems' });
    expect(within(problems).getByText('Left is before Joined')).toBeInTheDocument();
  });

  it('asks before importing, then shows what was written', async () => {
    mockGetImport.mockResolvedValueOnce(draft({ ready: true, blockers: [] }));
    mockCommit.mockResolvedValue({});
    mockGetImport.mockResolvedValueOnce(
      draft({
        status: 'committed',
        committed_at: '2026-11-13T01:00:00Z',
        summary: { created: 3, matched: 1, skipped: 2 },
        rows: [],
      })
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import' }));
    expect(mockCommit).toHaveBeenCalledWith('imp1');
    expect(await screen.findByText('3 new records')).toBeInTheDocument();
    expect(screen.getByText('1 existing records added to')).toBeInTheDocument();
  });

  it('names each record kept when removing an import’s records', async () => {
    mockGetImport.mockResolvedValue(
      draft({ status: 'committed', committed_at: '2026-11-13T01:00:00Z', summary: { created: 2 }, rows: [] })
    );
    mockRemove.mockResolvedValue({
      removed: 1,
      kept: [{ id: 'p2', display_name: 'Bea Baker', reason: 'Published' }],
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Remove this import/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove records' }));
    expect(await screen.findByText(/1 record removed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bea Baker' })).toHaveAttribute('href', '/history/people/p2');
  });

  it('answers an unfamiliar title', async () => {
    mockGetImport.mockResolvedValue(draft({ titles: [{ text: 'Hose Man', key: 'hose man', status: 'unresolved' }] }));
    mockSetTitles.mockResolvedValue(draft());
    renderPage();
    await userEvent.selectOptions(await screen.findByLabelText(/What “Hose Man” is/), 'create');
    await userEvent.click(screen.getByRole('button', { name: 'Save title answers' }));
    expect(mockSetTitles).toHaveBeenCalledWith('imp1', [{ text: 'Hose Man', action: 'create' }]);
  });

  it('keeps an unsaved title answer when a row decision reloads the draft', async () => {
    const withTitle = draft({
      rows: [row({ suggestions: [{ kind: 'match', id: 'p9', strength: 'strong', label: 'John Smith' }] })],
      titles: [{ text: 'Hose Man', key: 'hose man', status: 'unresolved' }],
    });
    mockGetImport.mockResolvedValue(withTitle);
    // A fresh titles array, as every response from the server is.
    mockUpdateRow.mockResolvedValue({
      ...withTitle,
      rows: [row({ decision: 'match' })],
      titles: [{ text: 'Hose Man', key: 'hose man', status: 'unresolved' }],
    });
    renderPage();
    const select = await screen.findByLabelText(/What “Hose Man” is/);
    await userEvent.selectOptions(select, 'create');
    await userEvent.click(screen.getByRole('button', { name: /Add to John Smith/ }));
    expect(await screen.findByText('Add to an existing record')).toBeInTheDocument();
    expect(screen.getByLabelText(/What “Hose Man” is/)).toHaveValue('create');
  });

  it('says an expired draft is gone', async () => {
    mockGetImport.mockResolvedValue(draft({ status: 'expired', rows: [] }));
    renderPage();
    expect(await screen.findByText(/went untouched for 30 days/)).toBeInTheDocument();
  });
});
