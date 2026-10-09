import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../../contexts/ConfirmContext';
import { nth } from '../../../../test/utils';
import type { HistoryImportAttendance, HistoryImportDetail } from '../../../../modules/scheduling/types/historyImport';

const mockGet = vi.fn();
const mockMappings = vi.fn();
const mockRow = vi.fn();
const mockSettings = vi.fn();
const mockCommit = vi.fn();

vi.mock('../../../../modules/scheduling/services/historyImportApi', () => ({
  historyImportService: {
    getImport: (...a: unknown[]) => mockGet(...a) as unknown,
    updateMappings: (...a: unknown[]) => mockMappings(...a) as unknown,
    updateRow: (...a: unknown[]) => mockRow(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockSettings(...a) as unknown,
    commit: (...a: unknown[]) => mockCommit(...a) as unknown,
    discard: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import ShiftHistoryImportReviewPage from './ShiftHistoryImportReviewPage';

const attendance = (overrides: Partial<HistoryImportAttendance> = {}): HistoryImportAttendance => ({
  key: 'r2',
  row_ids: ['r2'],
  line_numbers: [2],
  member_ref: 'u-alice',
  unit_kind: 'own',
  unit_ref: 'app-1',
  seat: 'firefighter',
  role: '',
  start: '2025-03-01T12:00:00Z',
  end: '2025-03-02T12:00:00Z',
  local_date: '2025-03-01',
  minutes: 1440,
  call_count: null,
  joined: false,
  confidence: 100,
  needs_confirmation: false,
  duplicate_existing: false,
  ...overrides,
});

const draft = (overrides: Partial<NonNullable<HistoryImportDetail['analysis']>> = {}): HistoryImportDetail => ({
  import: {
    id: 'imp-1',
    status: 'draft',
    source_filename: 'history.csv',
    timezone: 'America/New_York',
    row_count: 3,
  },
  headers: ['Member', 'Unit'],
  column_mapping: { member_name: 'Member', unit: 'Unit' },
  fields: ['member_name', 'unit'],
  member_mappings: {},
  unit_mappings: {},
  position_mappings: {},
  existing_shift_decisions: {},
  analysis: {
    can_commit: false,
    blocking_issue_count: 2,
    counts: {
      rows: 3,
      excluded: 0,
      skipped: 0,
      with_errors: 0,
      new_shifts: 1,
      existing_shifts: 0,
      attendances: 2,
      external_entries: 0,
      duplicates: 0,
    },
    rows: [],
    members: [
      {
        key: 'name:dana former',
        display_name: 'Dana Former',
        first_name: 'Dana',
        last_name: 'Former',
        membership_number: '',
        email: '',
        username: '',
        status: 'unmatched',
        candidate_ids: [],
        reason: '',
        row_count: 1,
        remembered: false,
      },
    ],
    units: [],
    positions: [],
    shifts: [
      {
        key: 'r2',
        apparatus_id: 'app-1',
        shift_date: '2025-03-01',
        start: '2025-03-01T12:00:00Z',
        end: '2025-03-02T12:00:00Z',
        existing_status: 'none',
        attendances: [
          attendance(),
          attendance({
            key: 'r3',
            row_ids: ['r3'],
            line_numbers: [3],
            member_ref: 'u-bob',
            start: '2025-03-01T13:00:00Z',
            confidence: 70,
            needs_confirmation: true,
          }),
        ],
      },
    ],
    external: [],
    issues: [
      {
        code: 'member_unmatched',
        message: "No member matches 'Dana Former'.",
        blocking: true,
        row_ids: ['r4'],
        ref: 'name:dana former',
      },
      { code: 'probable_match', message: 'Line 3 is a 70% match.', blocking: true, row_ids: ['r3'], ref: 'r2' },
    ],
    options: {
      members: [
        { id: 'u-alice', name: 'Alice Ng', membership_number: '101', status: 'active' },
        { id: 'u-bob', name: 'Bob Diaz', membership_number: '102', status: 'active' },
      ],
      units: [{ kind: 'own', id: 'app-1', name: 'A106E' }],
      seats: ['firefighter'],
    },
    ...overrides,
  },
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/scheduling/admin/history-import/imp-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/scheduling/admin/history-import/:importId" element={<ShiftHistoryImportReviewPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('ShiftHistoryImportReviewPage', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockMappings, mockRow, mockSettings, mockCommit]) mock.mockReset();
    mockGet.mockResolvedValue(draft());
    mockMappings.mockResolvedValue(draft());
    mockRow.mockResolvedValue(draft());
  });

  it('loads the draft named in the URL and lists what blocks it', async () => {
    renderPage();
    expect(await screen.findByText("No member matches 'Dana Former'.")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('imp-1');
    expect(screen.getByRole('button', { name: 'Commit import' })).toBeDisabled();
    expect(screen.getByText(/2 issues to resolve/)).toBeInTheDocument();
  });

  it('takes the reviewer from an issue to the tab that settles it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No member matches 'Dana Former'.");
    // Issues render in the order the backend reports them; the member's is first.
    await user.click(nth(screen.getAllByRole('button', { name: 'Resolve' }), 0));

    expect(screen.getByRole('tab', { name: /Members/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Dana Former')).toBeInTheDocument();
  });

  it('saves a decision to create a former member', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Members/ }));
    await user.selectOptions(screen.getByLabelText('Who is Dana Former?'), 'Create as an inactive member');

    expect(mockMappings).toHaveBeenCalledWith('imp-1', {
      members: { 'name:dana former': { action: 'create' } },
    });
  });

  it('confirms a probable match against the row that raised it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    expect(screen.getByText('70% match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Same shift' }));

    expect(mockRow).toHaveBeenCalledWith('imp-1', 'r3', { match_decision: 'accept' });
  });

  it('commits only after the reviewer confirms, then shows what was written', async () => {
    const ready = draft({ can_commit: true, blocking_issue_count: 0, issues: [] });
    mockGet.mockResolvedValueOnce(ready);
    mockCommit.mockResolvedValue({ ...ready.import, status: 'committed', summary: { attendance_created: 2 } });
    mockGet.mockResolvedValueOnce({
      ...ready,
      import: {
        ...ready.import,
        status: 'committed',
        committed_at: '2026-10-09T15:00:00Z',
        summary: { shifts_created: 1, attendance_created: 2 },
      },
      analysis: null,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Commit import' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone as a batch/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Commit import' }));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledWith('imp-1'));
    expect(await screen.findByText(/This import is final/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Attendance records' })).toHaveTextContent('2');
  });

  it('does not commit when the reviewer backs out', async () => {
    mockGet.mockResolvedValue(draft({ can_commit: true, blocking_issue_count: 0, issues: [] }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Commit import' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep reviewing' }));

    expect(mockCommit).not.toHaveBeenCalled();
  });
  it('splits a joined entry by keeping every later row apart', async () => {
    const joined = attendance({
      key: 'r5',
      row_ids: ['r5', 'r6'],
      line_numbers: [5, 6],
      minutes: 1530,
      joined: true,
    });
    mockGet.mockResolvedValue(
      draft({
        shifts: [
          {
            key: 'r5',
            apparatus_id: 'app-1',
            shift_date: '2025-10-09',
            start: '2025-10-09T10:00:00Z',
            end: '2025-10-10T11:30:00Z',
            existing_status: 'none',
            attendances: [joined],
          },
        ],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    expect(screen.getByText('Joined from 2 entries')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Split apart' }));

    await waitFor(() => expect(mockRow).toHaveBeenCalledWith('imp-1', 'r6', { keep_separate: true }));
    expect(mockRow).not.toHaveBeenCalledWith('imp-1', 'r5', expect.anything());
  });

  it('marks a decision remembered from an earlier import', async () => {
    mockGet.mockResolvedValue(
      draft({
        members: [
          {
            key: 'name:a. ng',
            display_name: 'A. Ng',
            first_name: 'A.',
            last_name: 'Ng',
            membership_number: '',
            email: '',
            username: '',
            status: 'mapped',
            user_id: 'u-alice',
            candidate_ids: [],
            reason: '',
            row_count: 1,
            remembered: true,
          },
        ],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Members/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Show settled' }));

    expect(screen.getByText('Remembered')).toBeInTheDocument();
    expect(screen.getByText('Recorded as Alice Ng')).toBeInTheDocument();
  });
});
