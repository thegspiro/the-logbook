import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MemberShiftHistory } from './MemberShiftHistory';
import type {
  ExternalAgency,
  ExternalShiftEntry,
  MemberDepartmentShift,
  MemberHoursMonth,
  MemberHoursYear,
} from '../../modules/scheduling/services/api';

// Resolves to `{ items, total }` — the outside entries for the year — and the
// mock below wraps it in the shift-history shape with `mockDepartmentShifts`.
const mockGetMine = vi.fn();
const mockGetMember = vi.fn();
let mockDepartmentShifts: MemberDepartmentShift[] = [];
const mockLog = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockOptions = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyShiftHistory: async (year: number) => {
      const { items, total } = (await mockGetMine(year)) as { items: ExternalShiftEntry[]; total: number };
      return { year, department_shifts: mockDepartmentShifts, external_shifts: items, external_total: total };
    },
    getMemberShiftHistory: async (userId: string, year: number) => {
      const { items, total } = (await mockGetMember(userId, year)) as { items: ExternalShiftEntry[]; total: number };
      return { year, department_shifts: mockDepartmentShifts, external_shifts: items, external_total: total };
    },
    logExternalShift: (...args: unknown[]) => mockLog(...args) as unknown,
    updateExternalShift: (...args: unknown[]) => mockUpdate(...args) as unknown,
    deleteExternalShift: (...args: unknown[]) => mockDelete(...args) as unknown,
    getExternalApparatusOptions: (...args: unknown[]) => mockOptions(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const entry = (over: Partial<ExternalShiftEntry> = {}): ExternalShiftEntry => ({
  id: 'e1',
  user_id: 'u1',
  member_name: 'Casey Reed',
  shift_date: '2026-03-04',
  hours: 12,
  start_at: null,
  end_at: null,
  external_apparatus_id: 'u-42',
  agency_name: 'Township Fire Company',
  apparatus_name: 'Engine 42',
  role: null,
  notes: 'Covered a sick call',
  status: 'counted',
  reviewed_by: null,
  reviewer_name: null,
  reviewed_at: null,
  rejection_reason: null,
  created_at: '2026-03-05T12:00:00Z',
  updated_at: '2026-03-05T12:00:00Z',
  ...over,
});

const agencies: ExternalAgency[] = [
  {
    id: 'a-township',
    name: 'Township Fire Company',
    is_active: true,
    evaluate_shifts: false,
    apparatus: [
      { id: 'u-42', agency_id: 'a-township', name: 'Engine 42', apparatus_type: 'engine', is_active: true },
      { id: 'u-7', agency_id: 'a-township', name: 'Tower 7', apparatus_type: null, is_active: true },
    ],
  },
  {
    id: 'a-county',
    name: 'County Rescue',
    is_active: true,
    evaluate_shifts: false,
    apparatus: [{ id: 'u-9', agency_id: 'a-county', name: 'Rescue 9', apparatus_type: null, is_active: true }],
  },
];

const month = (m: number, over: Partial<MemberHoursMonth> = {}): MemberHoursMonth => ({
  year: 2026,
  month: m,
  shifts: 0,
  hours: 0,
  calls: 0,
  pending_shifts: 0,
  pending_hours: 0,
  ...over,
});

const yearSummary = (year: number, overMonths: Record<number, Partial<MemberHoursMonth>> = {}): MemberHoursYear => {
  const months = Array.from({ length: 12 }, (_, i) => month(i + 1, { year, ...(overMonths[i + 1] ?? {}) }));
  return {
    year,
    months,
    totals: {
      shifts: months.reduce((n, m) => n + m.shifts, 0),
      hours: months.reduce((n, m) => n + m.hours, 0),
      calls: months.reduce((n, m) => n + m.calls, 0),
      pending_shifts: 0,
      pending_hours: months.reduce((n, m) => n + m.pending_hours, 0),
      external_shifts: months.reduce((n, m) => n + (m.external_shifts ?? 0), 0),
      external_hours: months.reduce((n, m) => n + (m.external_hours ?? 0), 0),
    },
  };
};

const departmentShift = (over: Partial<MemberDepartmentShift> = {}): MemberDepartmentShift => ({
  shift_id: 's1',
  shift_date: '2026-03-10',
  start_time: '2026-03-10T23:00:00Z',
  end_time: '2026-03-11T12:00:00Z',
  hours: 13,
  calls: 4,
  credited: true,
  on_call: false,
  unit: 'A101',
  template_name: 'Night shift',
  position: 'emt',
  ...over,
});

const defaultYears = [
  yearSummary(2026, { 3: { shifts: 1, hours: 13, calls: 4, external_shifts: 1, external_hours: 12 } }),
];

interface ListProps {
  years?: MemberHoursYear[];
  memberId?: string;
  highlightMonth?: number | null;
  showCalls?: boolean;
}

describe('MemberShiftHistory: outside shifts on My Hours', () => {
  const onChanged = vi.fn();
  const renderList = ({ years = defaultYears, memberId, highlightMonth = null, showCalls = true }: ListProps = {}) =>
    renderWithRouter(
      <MemberShiftHistory
        years={years}
        selectedYear={2026}
        departmentLabel="FCVFD"
        showCalls={showCalls}
        memberId={memberId}
        highlightMonth={highlightMonth}
        onChanged={onChanged}
      />
    );

  beforeEach(() => {
    mockGetMine.mockReset();
    mockLog.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockOptions.mockReset();
    onChanged.mockReset();
    mockDepartmentShifts = [];
    mockOptions.mockResolvedValue({ agencies });
    mockGetMine.mockResolvedValue({ items: [entry()], total: 1 });
    mockLog.mockResolvedValue(entry({ id: 'e2' }));
    mockUpdate.mockResolvedValue(entry());
    mockDelete.mockResolvedValue(undefined);
  });

  it('lists the member’s entries', async () => {
    renderList();

    expect(await screen.findByText('Township Fire Company')).toBeInTheDocument();
    expect(screen.getByText('Engine 42')).toBeInTheDocument();
    expect(screen.getByText('Mar 4')).toBeInTheDocument();
    expect(screen.getByText('12 h')).toBeInTheDocument();
    expect(mockGetMine).toHaveBeenCalledWith(2026);
  });

  it('logs a shift by its start and a +12 end, leaving blank optional fields out', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    // Picking a date alone starts the shift at 09:00, the picker's default.
    await user.type(screen.getByLabelText(/^Start \*$/), '2026-01-10');
    await user.click(screen.getByRole('button', { name: '+12 hours' }));
    expect(screen.getByText('12 hours')).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText(/^Department \*$/), 'a-county');
    await user.selectOptions(screen.getByLabelText(/^Apparatus \*$/), 'u-9');
    await user.click(screen.getByRole('button', { name: 'Log shift' }));

    await waitFor(() => expect(mockLog).toHaveBeenCalledTimes(1));
    // 09:00-21:00 in New York (EST, UTC-5), sent as UTC instants.
    const payload = mockLog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['end_at', 'external_apparatus_id', 'notes', 'role', 'start_at']);
    expect(payload.external_apparatus_id).toBe('u-9');
    expect(payload.role).toBeUndefined();
    expect(payload.notes).toBeUndefined();
    expect(new Date(payload.start_at as string).toISOString()).toBe('2026-01-10T14:00:00.000Z');
    expect(new Date(payload.end_at as string).toISOString()).toBe('2026-01-11T02:00:00.000Z');
    expect(onChanged).toHaveBeenCalled();
  });

  it('runs a +24 shift into the next day', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText(/^Start \*$/), '2026-01-10');
    await user.click(screen.getByRole('button', { name: '+24 hours' }));

    expect(screen.getByLabelText(/^End \*$/)).toHaveValue('2026-01-11');
    expect(screen.getByText('24 hours')).toBeInTheDocument();
  });

  it('offers no preset until there is a start to count from', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));

    expect(screen.getByRole('button', { name: '+12 hours' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+24 hours' })).toBeDisabled();
  });

  it('refuses an end before the start', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText(/^Start \*$/), '2026-01-10');
    const endDate = screen.getByLabelText(/^End \*$/);
    await user.clear(endDate);
    await user.type(endDate, '2026-01-09');
    await user.selectOptions(await screen.findByLabelText(/^Department \*$/), 'a-county');
    await user.selectOptions(screen.getByLabelText(/^Apparatus \*$/), 'u-9');

    // Stated on the End field, live, and still refused when Log shift is pressed.
    expect(endDate).toHaveAccessibleDescription('The shift must end after it starts');
    expect(endDate).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Log shift' }));
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('shows and re-sends the times of an entry that has them', async () => {
    mockGetMine.mockResolvedValue({
      items: [entry({ start_at: '2026-03-04T12:00:00Z', end_at: '2026-03-05T00:00:00Z' })],
      total: 1,
    });
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText('7:00 AM – 7:00 PM')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Apparatus \*$/)).toHaveValue('u-42'));
    expect(screen.getByLabelText(/^Start \*$/)).toHaveValue('2026-03-04');
    expect(screen.queryByLabelText('Hours')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(new Date(payload.start_at as string).toISOString()).toBe('2026-03-04T12:00:00.000Z');
    expect(new Date(payload.end_at as string).toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(payload).not.toHaveProperty('hours');
    expect(payload).not.toHaveProperty('shift_date');
  });

  it('lets an entry logged as date and hours be given times instead', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    expect(screen.getByLabelText(/^Hours \*$/)).toHaveValue(12);
    await user.click(screen.getByRole('button', { name: 'Enter start and end times instead' }));

    expect(screen.queryByLabelText('Hours')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Start \*$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+24 hours' })).toBeInTheDocument();
  });

  it('offers only the chosen department’s apparatus, and cannot save without one', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText(/^Start \*$/), '2026-01-10');
    await user.click(screen.getByRole('button', { name: '+12 hours' }));
    await user.selectOptions(await screen.findByLabelText(/^Department \*$/), 'a-township');

    const unitSelect = screen.getByLabelText(/^Apparatus \*$/);
    expect(within(unitSelect).getByRole('option', { name: 'Engine 42 (engine)' })).toBeInTheDocument();
    expect(within(unitSelect).getByRole('option', { name: 'Tower 7' })).toBeInTheDocument();
    expect(within(unitSelect).queryByRole('option', { name: 'Rescue 9' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log shift' }));
    expect(unitSelect).toHaveAccessibleDescription('Choose the apparatus.');
    await waitFor(() => expect(unitSelect).toHaveFocus());
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('puts a server refusal on the field it names and logs nothing', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    mockLog.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'role', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText(/^Start \*$/), '2026-01-10');
    await user.click(screen.getByRole('button', { name: '+12 hours' }));
    await user.selectOptions(await screen.findByLabelText(/^Department \*$/), 'a-county');
    await user.selectOptions(screen.getByLabelText(/^Apparatus \*$/), 'u-9');
    await user.type(screen.getByLabelText(/^Position/), 'Driver');
    await user.click(screen.getByRole('button', { name: 'Log shift' }));

    const position = screen.getByLabelText(/^Position/);
    await waitFor(() =>
      expect(position).toHaveAccessibleDescription('Position is too long — keep it to 100 characters.')
    );
    expect(position).toHaveAttribute('aria-invalid', 'true');
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Log a shift with another department' })).toBeInTheDocument();
  });

  it('asks before Escape discards a half-filled outside shift', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText(/^Position/), 'Driver');
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^Position/)).toHaveValue('Driver');
  });

  it('tells the member who can add a missing unit when the list is empty', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    mockOptions.mockResolvedValue({ agencies: [] });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));

    expect(
      await screen.findByText(/No outside apparatus has been set up yet\. Don't see it\? Ask a scheduling officer/)
    ).toBeInTheDocument();
  });

  it('sends null for an optional field the member cleared on edit', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Apparatus \*$/)).toHaveValue('u-42'));
    await user.clear(screen.getByLabelText(/Notes/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    // The unit is unchanged, so it stays off the wire.
    expect(mockUpdate).toHaveBeenCalledWith('e1', {
      shift_date: '2026-03-04',
      hours: 12,
      role: null,
      notes: null,
    });
  });

  it('sends the new unit when the member moves an entry to another one', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Apparatus \*$/)).toHaveValue('u-42'));
    await user.selectOptions(screen.getByLabelText(/^Apparatus \*$/), 'u-7');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ external_apparatus_id: 'u-7' }));
  });

  it('keeps a unit that has left the list as the entry’s current value', async () => {
    mockGetMine.mockResolvedValue({
      items: [entry({ external_apparatus_id: null, apparatus_name: 'Engine 1' })],
      total: 1,
    });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    expect(await screen.findByRole('option', { name: 'Engine 1 (no longer listed)' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Hours \*$/));
    await user.type(screen.getByLabelText(/^Hours \*$/), '9');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', {
      shift_date: '2026-03-04',
      hours: 9,
      role: null,
      notes: 'Covered a sick call',
    });
  });

  it('deletes only after the member confirms', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole('button', { name: /Delete shift with Township Fire Company/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shift?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete shift' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('e1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a rejected entry as not counted, with the reason and no actions', async () => {
    mockGetMine.mockResolvedValue({
      items: [entry({ status: 'rejected', rejection_reason: 'Not on the mutual aid roster' })],
      total: 1,
    });
    renderList();

    expect(await screen.findByText('Not counted')).toBeInTheDocument();
    expect(screen.getByText('Not on the mutual aid roster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete shift/ })).not.toBeInTheDocument();
  });

  it('marks an entry awaiting approval as not yet counting, and keeps it editable', async () => {
    mockGetMine.mockResolvedValue({ items: [entry({ status: 'pending' })], total: 1 });
    renderList();

    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText(/counts once a scheduling officer approves it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit shift/ })).toBeInTheDocument();
  });

  it('says when a shift is waiting on its evaluation, and when it is evaluated', async () => {
    mockGetMine.mockResolvedValue({
      items: [
        entry({ id: 'e-needed', evaluation_status: 'needed' }),
        entry({ id: 'e-done', evaluation_status: 'submitted' }),
        entry({ id: 'e-none', evaluation_status: null }),
      ],
      total: 3,
    });
    renderList();

    expect(await screen.findByText('Evaluation needed')).toBeInTheDocument();
    expect(screen.getByText('Evaluated')).toBeInTheDocument();
    expect(screen.getAllByText(/Evaluation needed|Evaluated|Evaluation started/)).toHaveLength(2);
  });

  it('offers a preceptor link only while a shift is waiting on its evaluation', async () => {
    mockGetMine.mockResolvedValue({
      items: [
        entry({ id: 'e-needed', evaluation_status: 'needed' }),
        entry({ id: 'e-done', evaluation_status: 'submitted' }),
        entry({ id: 'e-none', evaluation_status: null }),
      ],
      total: 3,
    });
    renderList();

    expect(await screen.findAllByRole('button', { name: /Preceptor link/ })).toHaveLength(1);
  });
});

describe('MemberShiftHistory: department and outside shifts together', () => {
  const onChanged = vi.fn();
  const renderList = ({ years = defaultYears, memberId, highlightMonth = null, showCalls = true }: ListProps = {}) =>
    renderWithRouter(
      <MemberShiftHistory
        years={years}
        selectedYear={2026}
        departmentLabel="FCVFD"
        showCalls={showCalls}
        memberId={memberId}
        highlightMonth={highlightMonth}
        onChanged={onChanged}
      />
    );

  beforeEach(() => {
    mockGetMine.mockReset();
    mockGetMember.mockReset();
    mockOptions.mockReset();
    onChanged.mockReset();
    mockOptions.mockResolvedValue({ agencies });
    mockDepartmentShifts = [departmentShift()];
    mockGetMine.mockResolvedValue({ items: [entry()], total: 1 });
    mockGetMember.mockResolvedValue({ items: [entry()], total: 1 });
  });

  it('lists both kinds of shift in one month, newest first, each labelled with where it was worked', async () => {
    renderList();

    const march = await screen.findByRole('region', { name: 'March 2026' });
    const rows = within(march).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // The department shift on the 10th precedes the outside one on the 4th.
    expect(within(rows[0] as HTMLElement).getByText('FCVFD')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Night shift · A101 · EMT')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('4 calls')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Township Fire Company')).toBeInTheDocument();
  });

  it('takes the month subtotal from the hours history, not from the rows', async () => {
    // The summary is what the chart and cards show; a row rounded to the
    // quarter hour must not be able to move the figure under its heading.
    renderList({ years: [yearSummary(2026, { 3: { hours: 13.25, external_hours: 12 } })] });

    const march = await screen.findByRole('region', { name: 'March 2026' });
    expect(within(march).getByText('25.25 hrs')).toBeInTheDocument();
  });

  it('marks a shift awaiting close-out, and gives it no call count', async () => {
    mockDepartmentShifts = [departmentShift({ credited: false, calls: null })];
    renderList();

    expect(await screen.findByText('Awaiting close-out')).toBeInTheDocument();
    expect(screen.queryByText(/calls?$/)).not.toBeInTheDocument();
  });

  it('heads a month whose only shift awaits close-out with its pending hours, not with zero', async () => {
    mockDepartmentShifts = [departmentShift({ credited: false, calls: null })];
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    renderList({ years: [yearSummary(2026, { 3: { pending_shifts: 1, pending_hours: 13 } })] });

    const march = await screen.findByRole('region', { name: 'March 2026' });
    expect(within(march).getByText('13 hrs awaiting close-out')).toBeInTheDocument();
  });

  it('leaves calls off when the department does not track them', async () => {
    renderList({ showCalls: false });

    await screen.findByText('Night shift · A101 · EMT');
    expect(screen.queryByText('4 calls')).not.toBeInTheDocument();
  });

  it('has no edit or delete on a department shift', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    renderList();

    await screen.findByText('Night shift · A101 · EMT');
    expect(screen.queryByRole('button', { name: /Edit shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete shift/ })).not.toBeInTheDocument();
  });

  it('filters to one kind of shift', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Township Fire Company');

    await user.click(screen.getByRole('button', { name: 'Other departments' }));
    expect(screen.getByRole('button', { name: 'Other departments' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Night shift · A101 · EMT')).not.toBeInTheDocument();
    expect(screen.getByText('Township Fire Company')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'FCVFD' }));
    expect(screen.getByText('Night shift · A101 · EMT')).toBeInTheDocument();
    expect(screen.queryByText('Township Fire Company')).not.toBeInTheDocument();
  });

  it('opens the selected year, and fetches another only when it is opened', async () => {
    const user = userEvent.setup();
    renderList({
      years: [
        defaultYears[0] as MemberHoursYear,
        yearSummary(2025, { 7: { external_shifts: 1, external_hours: 24.75 } }),
      ],
    });

    await screen.findByText('Township Fire Company');
    expect(mockGetMine).toHaveBeenCalledTimes(1);
    expect(mockGetMine).toHaveBeenCalledWith(2026);
    const heading2025 = screen.getByRole('button', { name: /^2025/ });
    expect(heading2025).toHaveAttribute('aria-expanded', 'false');
    expect(heading2025).toHaveTextContent('1 other dept.');
    expect(heading2025).toHaveTextContent('24.75 hrs');

    await user.click(heading2025);
    expect(heading2025).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(mockGetMine).toHaveBeenCalledWith(2025));
  });

  it('heads each year with its total of both kinds and the count of each', async () => {
    renderList();

    const heading = await screen.findByRole('button', { name: /^2026/ });
    expect(heading).toHaveTextContent('1 FCVFD · 1 other dept.');
    expect(heading).toHaveTextContent('25 hrs');
  });

  it('marks the month chosen on the chart', async () => {
    renderList({ highlightMonth: 3 });

    const march = await screen.findByRole('region', { name: 'March 2026' });
    for (const row of within(march).getAllByRole('listitem')) {
      expect(row).toHaveAttribute('data-highlighted', 'true');
    }
  });

  it('says when a year holds more outside entries than were returned', async () => {
    mockGetMine.mockResolvedValue({ items: [entry()], total: 3 });
    renderList();

    expect(
      await screen.findByText('Showing the 1 most recent shifts with other departments in 2026.')
    ).toBeInTheDocument();
  });

  it('says so when there is nothing to show', async () => {
    renderList({ years: [] });

    expect(screen.getByText("You haven't worked or logged any shifts yet.")).toBeInTheDocument();
    expect(mockGetMine).not.toHaveBeenCalled();
  });

  describe('on a member profile', () => {
    it("reads that member's shifts and offers none of the member's own actions", async () => {
      renderList({ memberId: 'u-77' });

      expect(await screen.findByText('Township Fire Company')).toBeInTheDocument();
      expect(mockGetMember).toHaveBeenCalledWith('u-77', 2026);
      expect(mockGetMine).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /Log outside shift/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Edit shift/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete shift/ })).not.toBeInTheDocument();
    });
  });
});
