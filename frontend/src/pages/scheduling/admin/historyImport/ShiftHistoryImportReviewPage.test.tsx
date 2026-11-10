import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../../contexts/ConfirmContext';
import { nth } from '../../../../test/utils';
import type {
  HistoryImportAttendance,
  HistoryImportDetail,
  HistoryImportIssue,
  HistoryImportRow,
} from '../../../../modules/scheduling/types/historyImport';

const mockGet = vi.fn();
const mockMappings = vi.fn();
const mockRow = vi.fn();
const mockSettings = vi.fn();
const mockCommit = vi.fn();
const mockDecideAll = vi.fn();

vi.mock('../../../../modules/scheduling/services/historyImportApi', () => ({
  historyImportService: {
    getImport: (...a: unknown[]) => mockGet(...a) as unknown,
    updateMappings: (...a: unknown[]) => mockMappings(...a) as unknown,
    updateRow: (...a: unknown[]) => mockRow(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockSettings(...a) as unknown,
    commit: (...a: unknown[]) => mockCommit(...a) as unknown,
    decideProbableMatches: (...a: unknown[]) => mockDecideAll(...a) as unknown,
    discard: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// positionLabel() reads the department's custom seats from here; the built-in
// seats these drafts use need nothing from it.
vi.mock('../../../../modules/scheduling/services/shiftSettingsApi', () => ({
  ensureShiftSettingsLoaded: () => Promise.resolve({}),
  getCachedShiftSettings: () => ({ customPositions: [] }),
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

const fileRow = (id: string, line: number, overrides: Partial<HistoryImportRow> = {}): HistoryImportRow => ({
  id,
  line_number: line,
  raw: { Member: `Member ${line}`, Unit: 'A106E' },
  values: { member_name: `Member ${line}`, unit: 'A106E' },
  excluded: false,
  keep_separate: false,
  errors: [],
  ...overrides,
});

/** A draft whose Rows tab holds these rows and these issues. */
const rowsDraft = (rows: HistoryImportRow[], issues: HistoryImportIssue[]): HistoryImportDetail =>
  draft({ rows, issues, blocking_issue_count: issues.length });

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
    for (const mock of [mockGet, mockMappings, mockRow, mockSettings, mockCommit, mockDecideAll]) mock.mockReset();
    mockGet.mockResolvedValue(draft());
    mockMappings.mockResolvedValue(draft());
    mockRow.mockResolvedValue(draft());
    mockDecideAll.mockResolvedValue(draft());
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
    await user.selectOptions(screen.getByLabelText('Who is Dana Former?'), 'Create as an archived former member');

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
  it('names seats the way the department does, not by their stored code', async () => {
    mockGet.mockResolvedValue(
      draft({
        shifts: [
          {
            key: 'r2',
            apparatus_id: 'app-1',
            shift_date: '2025-03-01',
            start: '2025-03-01T12:00:00Z',
            end: '2025-03-02T12:00:00Z',
            existing_status: 'none',
            attendances: [attendance({ seat: 'ems' })],
          },
        ],
        positions: [{ key: 'emt', source: 'EMT', status: 'matched', seat: 'ems', row_count: 1, remembered: false }],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));
    expect(screen.getByText(/· EMT ·/)).toBeInTheDocument();
    expect(screen.queryByText(/· ems ·/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Positions/ }));
    expect(screen.getByText(/seat: EMT/)).toBeInTheDocument();
  });

  it('dates the end of a shift that runs past midnight', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    // 07:00 on March 1 to 07:00 on March 2 in New York: the end needs its date,
    // or a 24-hour shift reads as one that ended as it began.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/Mar 1.*–\s*Mar 2/);
  });

  it('counts one shift and one outside-agency entry in the singular', async () => {
    mockGet.mockResolvedValue(
      draft({
        external: [
          attendance({ key: 'r9', row_ids: ['r9'], line_numbers: [9], unit_kind: 'external', unit_ref: 'ext-1' }),
        ],
        options: {
          members: [{ id: 'u-alice', name: 'Alice Ng', membership_number: '101', status: 'active' }],
          units: [
            { kind: 'own', id: 'app-1', name: 'A106E' },
            { kind: 'external', id: 'ext-1', name: 'A106', agency_name: 'County EMS' },
          ],
          seats: ['firefighter'],
        },
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    expect(screen.getByText(/^1 shift on this department's units/)).toBeInTheDocument();
    expect(screen.getByText(/^1 entry on other agencies' units/)).toBeInTheDocument();
  });

  it('counts one former member to be created in the singular', async () => {
    const [dana] = draft().analysis?.members ?? [];
    mockGet.mockResolvedValue(
      draft({
        can_commit: true,
        blocking_issue_count: 0,
        issues: [],
        members: dana ? [{ ...dana, status: 'create' }] : [],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Commit import' }));

    expect(
      within(await screen.findByRole('dialog')).getByText(/creating 1 archived former-member record\./)
    ).toBeInTheDocument();
  });

  it('answers every probable match at once', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    expect(screen.getByText(/1 member signed in up to two hours away/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All the same shift' }));

    expect(mockDecideAll).toHaveBeenCalledWith('imp-1', 'accept');
  });

  it('labels an on-call shift', async () => {
    const [shift] = draft().analysis?.shifts ?? [];
    mockGet.mockResolvedValue(draft({ shifts: shift ? [{ ...shift, duty_type: 'on_call' }] : [] }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Shifts/ }));

    expect(screen.getByText('On call (recall)')).toBeInTheDocument();
  });

  it('sets the position an ambulance crew takes when the file names none', async () => {
    mockGet.mockResolvedValue(
      draft({
        units: [
          {
            key: '|a102',
            unit: 'A102',
            agency: '',
            status: 'matched',
            target_kind: 'own',
            target_id: 'app-a102',
            candidates: [],
            new_agency_name: '',
            new_unit_name: '',
            row_count: 4,
            remembered: false,
          },
        ],
        options: {
          members: [],
          units: [{ kind: 'own', id: 'app-a102', name: 'A102', seats: ['driver', 'emt'] }],
          seats: ['driver', 'emt', 'firefighter'],
        },
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Units/ }));
    await user.selectOptions(
      screen.getByLabelText('Position for members on this unit when the file names none'),
      'emt'
    );

    expect(mockMappings).toHaveBeenCalledWith('imp-1', {
      units: { '|a102': { action: 'own', id: 'app-a102', default_seat: 'emt' } },
    });
  });

  describe('outside units', () => {
    const unmatchedM7 = {
      key: '|m7',
      unit: 'M7',
      agency: '',
      status: 'unmatched',
      candidates: [],
      new_agency_name: '',
      new_unit_name: '',
      row_count: 2,
      remembered: false,
    };
    const outsideDraft = () =>
      draft({
        units: [unmatchedM7],
        options: {
          members: [],
          units: [{ kind: 'external', id: 'ext-a106', name: 'A106', agency_name: 'County EMS', is_active: false }],
          agencies: [{ id: 'ag-county', name: 'County EMS', is_active: true }],
          seats: ['firefighter'],
        },
      });

    beforeEach(() => {
      mockGet.mockReset();
      mockGet.mockResolvedValue(outsideDraft());
    });

    it('adds a new unit under an agency picked from the list', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /Units/ }));
      await user.selectOptions(screen.getByLabelText('Which unit is M7?'), "Add as an outside agency's unit…");
      await user.selectOptions(screen.getByLabelText('Agency'), 'ag-county');

      expect(screen.queryByLabelText('New agency name')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Use this unit' }));

      expect(mockMappings).toHaveBeenCalledWith('imp-1', {
        units: {
          '|m7': { action: 'create_external', agency_id: 'ag-county', agency_name: 'County EMS', unit_name: 'M7' },
        },
      });
    });

    it('still lets a new agency be typed', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /Units/ }));
      await user.selectOptions(screen.getByLabelText('Which unit is M7?'), "Add as an outside agency's unit…");
      await user.type(screen.getByLabelText('New agency name'), 'Metro Fire');
      await user.click(screen.getByRole('button', { name: 'Use this unit' }));

      expect(mockMappings).toHaveBeenCalledWith('imp-1', {
        units: { '|m7': { action: 'create_external', agency_name: 'Metro Fire', unit_name: 'M7' } },
      });
    });

    it('sends a name to the catch-all Other unit', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /Units/ }));
      await user.selectOptions(screen.getByLabelText('Which unit is M7?'), 'Catch-all: Other');

      expect(mockMappings).toHaveBeenCalledWith('imp-1', {
        units: { '|m7': { action: 'create_external', agency_id: undefined, agency_name: 'Other', unit_name: 'Other' } },
      });
    });

    it('labels an own unit that is retired', async () => {
      mockGet.mockResolvedValue(
        draft({
          units: [unmatchedM7],
          options: {
            members: [],
            units: [
              { kind: 'own', id: 'app-e1', name: 'E1', is_active: false },
              { kind: 'own', id: 'app-e2', name: 'E2', is_active: true },
            ],
            seats: ['firefighter'],
          },
        })
      );
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /Units/ }));

      expect(screen.getByRole('option', { name: 'E1 — retired' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'E2' })).toBeInTheDocument();
    });

    it('labels an outside unit hidden from members', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('tab', { name: /Units/ }));

      expect(screen.getByRole('option', { name: 'A106 (County EMS) — hidden from members' })).toBeInTheDocument();
    });
  });

  it('names a former member the file knows only by number', async () => {
    mockGet.mockResolvedValue(
      draft({
        members: [
          {
            key: 'number:6178',
            display_name: '',
            first_name: '',
            last_name: '',
            membership_number: '6178',
            email: '',
            username: '',
            status: 'create',
            candidate_ids: [],
            reason: '',
            row_count: 12,
            remembered: false,
          },
        ],
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Members/ }));
    await user.click(screen.getByLabelText('Show settled'));

    expect(screen.getByText(/named "Former member 6178"/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('First name'), 'Pat');
    await user.type(screen.getByLabelText('Last name'), 'Lee');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(mockMappings).toHaveBeenCalledWith('imp-1', {
      members: { 'number:6178': { action: 'create', first_name: 'Pat', last_name: 'Lee' } },
    });
  });

  describe('Rows tab', () => {
    const probable: HistoryImportIssue = {
      code: 'probable_match',
      message: 'Line 3 is a 70% match for the shift starting with line 2.',
      blocking: true,
      row_ids: ['r3'],
      ref: 'r2',
    };
    const overlap: HistoryImportIssue = {
      code: 'overlapping_entries',
      message: 'Lines 4 and 5 put the same member on the same unit at overlapping times.',
      blocking: true,
      row_ids: ['r4', 'r5'],
    };
    const rows = [fileRow('r2', 2), fileRow('r3', 3), fileRow('r4', 4), fileRow('r5', 5)];

    const openRows = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole('tab', { name: /Rows/ }));
    };

    it('confirms a probable match from the row itself', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [probable]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      await user.click(screen.getByRole('button', { name: 'Same shift' }));
      expect(mockRow).toHaveBeenCalledWith('imp-1', 'r3', { match_decision: 'accept' });
    });

    it('keeps a probable match separate from the row itself', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [probable]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      await user.click(screen.getByRole('button', { name: 'Keep separate' }));
      expect(mockRow).toHaveBeenCalledWith('imp-1', 'r3', { match_decision: 'separate' });
    });

    it('answers every probable match at once without leaving the tab', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [probable]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      expect(screen.getByText(/1 row is a probable match/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Keep all separate' }));
      expect(mockDecideAll).toHaveBeenCalledWith('imp-1', 'separate');
    });

    it('keeps the later of two lines that list a member twice on its own shift', async () => {
      const twice: HistoryImportIssue = {
        code: 'duplicate_member_in_shift',
        message: 'Lines 4 and 5 put the same member on this shift twice.',
        blocking: true,
        row_ids: ['r4', 'r5'],
        ref: 'r2',
      };
      mockGet.mockResolvedValue(rowsDraft(rows, [twice]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      // Offered once, on line 5 — line 4 is the one the shift already holds.
      await user.click(screen.getByRole('button', { name: 'Keep this line separate' }));
      expect(mockRow).toHaveBeenCalledWith('imp-1', 'r5', { match_decision: 'separate' });
    });

    it('settles a match against a scheduled shift from the rows', async () => {
      const existing: HistoryImportIssue = {
        code: 'probable_existing_match',
        message: 'The shift starting with line 2 is a 75% match for a shift already on the schedule.',
        blocking: true,
        row_ids: ['r2'],
        ref: 'r2',
      };
      mockGet.mockResolvedValue(rowsDraft(rows, [existing]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      await user.click(screen.getByRole('button', { name: 'Add to the scheduled shift' }));
      expect(mockMappings).toHaveBeenCalledWith('imp-1', { existing_shifts: { r2: 'accept' } });
    });

    it('narrows the rows to one kind of issue', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [probable, overlap]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      expect(screen.getAllByRole('row')).toHaveLength(4); // header + lines 3, 4, 5
      await user.click(screen.getByRole('button', { name: 'Overlapping times (2)' }));

      const body = screen.getAllByRole('row').slice(1);
      expect(body.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['4', '5']);
    });

    it('opens the Rows tab on just the lines an issue names', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [overlap, probable]));
      const user = userEvent.setup();
      renderPage();
      await screen.findByText(overlap.message);
      await user.click(nth(screen.getAllByRole('button', { name: 'Resolve' }), 0));

      expect(screen.getByRole('tab', { name: /Rows/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText(/Showing lines 4, 5:/)).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(3);

      await user.click(screen.getByRole('button', { name: 'Show all rows' }));
      expect(screen.queryByText(/Showing lines/)).not.toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(4);
    });

    it('compares the lines of an overlap side by side', async () => {
      mockGet.mockResolvedValue(rowsDraft(rows, [probable, overlap]));
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      await user.click(nth(screen.getAllByRole('button', { name: 'Compare lines' }), 0));
      expect(screen.getByText(/Showing lines 4, 5:/)).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(3);
    });

    describe('fixing an overlap inline', () => {
      const timed = (rowList: HistoryImportRow[], issues: HistoryImportIssue[]): HistoryImportDetail => ({
        ...rowsDraft(rowList, issues),
        fields: ['member_name', 'unit', 'start_time', 'end_time'],
      });
      const timedRows = [
        fileRow('r3', 3),
        fileRow('r4', 4, { values: { member_name: 'Member 4', unit: 'A106E', start_time: '2330', end_time: '0115' } }),
        fileRow('r5', 5, { values: { member_name: 'Member 4', unit: 'A106E', start_time: '2330', end_time: '0000' } }),
      ];

      it('saves only the time that changed', async () => {
        mockGet.mockResolvedValue(timed(timedRows, [overlap, probable]));
        const user = userEvent.setup();
        renderPage();
        await openRows(user);

        const start = screen.getByRole('textbox', { name: 'Start time, line 5' });
        await user.clear(start);
        await user.type(start, '0115');
        await user.click(within(screen.getByRole('form', { name: 'Times for line 5' })).getByRole('button'));

        expect(mockRow).toHaveBeenCalledWith('imp-1', 'r5', { edits: { start_time: '0115' } });
      });

      it('offers nothing to save until a time changes', async () => {
        mockGet.mockResolvedValue(timed(timedRows, [overlap, probable]));
        const user = userEvent.setup();
        renderPage();
        await openRows(user);

        const form = screen.getByRole('form', { name: 'Times for line 4' });
        expect(within(form).getByRole('button', { name: 'Save times' })).toBeDisabled();
      });

      it('leaves times as text on a row that does not overlap', async () => {
        mockGet.mockResolvedValue(timed(timedRows, [overlap, probable]));
        const user = userEvent.setup();
        renderPage();
        await openRows(user);

        expect(screen.queryByRole('form', { name: 'Times for line 3' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('form')).toHaveLength(2);
      });

      it('offers no inputs when the file maps no time columns', async () => {
        mockGet.mockResolvedValue(rowsDraft(rows, [overlap]));
        const user = userEvent.setup();
        renderPage();
        await openRows(user);

        expect(screen.queryByRole('form', { name: /Times for line/ })).not.toBeInTheDocument();
      });
    });

    it('shows a row its issue, the other line involved and what the file said', async () => {
      const edited = fileRow('r4', 4, {
        values: { member_name: 'Member Four', unit: 'A106E' },
        edits: { member_name: 'Member Four' },
      });
      const withEdit = rowsDraft([nth(rows, 0), nth(rows, 1), edited, nth(rows, 3)], [overlap]);
      mockGet.mockResolvedValue(withEdit);
      mockRow.mockResolvedValue(withEdit);
      const user = userEvent.setup();
      renderPage();
      await openRows(user);

      await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(overlap.message)).toBeInTheDocument();
      expect(within(dialog).getByText('In the file: Member 4')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Exclude line 5' }));
      expect(mockRow).toHaveBeenCalledWith('imp-1', 'r5', { excluded: true });
      // A decision taken in the dialog leaves it open on the same row.
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });
});
