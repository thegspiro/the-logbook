/**
 * The close-out workspace: what it lists, and what opening a row does.
 *
 * `closeoutQueue.test.ts` covers which shifts count as waiting. This is about
 * the screen — that a failed fetch says so rather than showing an empty queue,
 * and above all that the row opens the department's *own* close-out: the wizard
 * for a department recording a call count, and the shift itself for every other
 * department, whose close-out is the finalize checklist inside the shift panel.
 * Re-rendering that checklist here would be a second implementation of a flow
 * that decides what goes on a member's record.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

const mockGetShifts = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown,
  },
}));

const mockGetShiftChecklists = vi.fn();
vi.mock('../../../../modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getShiftChecklists: (...args: unknown[]) => mockGetShiftChecklists(...args) as unknown,
  },
}));

let departmentTimezone = 'UTC';
vi.mock('../../../../hooks/useTimezone', () => ({
  useTimezone: () => departmentTimezone,
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

// The wizard is the existing one; this screen's job is to open it on the right
// shift with the right blocking rule, not to reimplement its three steps.
vi.mock('../../ShiftCloseoutWizard', () => ({
  ShiftCloseoutWizard: (props: { shiftId: string; requireChecks: boolean; outstandingChecks: number }) => (
    <div data-testid="closeout-wizard">
      wizard for {props.shiftId} · {props.outstandingChecks} outstanding ·{' '}
      {props.requireChecks ? 'blocking' : 'not blocking'}
    </div>
  ),
}));

const storeState = {
  callTrackingMode: 'count_only',
  requireEndOfShiftChecks: true,
  settingsLoaded: true,
  loadSettings: vi.fn(() => Promise.resolve()),
  signupClosesMinutesBefore: 0,
  lateSignupGraceMinutes: 60,
  openEndedCushionHours: 12,
};
vi.mock('../../../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

import CloseoutQueueSection from './CloseoutQueueSection';

const yesterday = (hour: string) => {
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { day, iso: `${day}T${hour}:00:00Z` };
};

const ended = yesterday('08');
const unclosedShift = {
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: ended.day,
  start_time: ended.iso,
  end_time: `${ended.day}T20:00:00Z`,
  apparatus_unit_number: 'Engine 1',
  shift_officer_name: 'Alex Kim',
  attendee_count: 3,
  call_count: 0,
  is_finalized: false,
  created_at: `${ended.day}T00:00:00Z`,
};

describe('CloseoutQueueSection', () => {
  // The browser's calendar day and the department's are not the same day around
  // midnight. Deriving the default range from the browser's put a UTC viewer of
  // an America/Los_Angeles department on tomorrow, and the opposite offset drops
  // the department's own current day out of the range entirely.
  it('opens on the department\u2019s calendar day, not the browser\u2019s', async () => {
    // 04:00 UTC on the 6th is 21:00 on the 5th in Los Angeles: the browser has
    // rolled over to a day the department has not reached.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'));
    departmentTimezone = 'America/Los_Angeles';
    renderWithRouter(<CloseoutQueueSection />);

    await waitFor(() => expect(mockGetShifts).toHaveBeenCalled());
    // The subject is `end_date`: the department's calendar day, not the
    // browser's. `start_date` follows from it by the default lookback and moves
    // with that constant.
    expect(mockGetShifts).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: '2026-03-09', end_date: '2026-09-05' })
    );
    vi.useRealTimers();
  });

  // The wizard's blocking rule is `requireChecks && outstanding > 0`, and the
  // server enforces checks only when the department has enabled them. Making
  // the lookup fatal everywhere shut an officer out of a close-out the API
  // would have accepted — a worse failure than the fabricated zero it replaced.
  it('opens the wizard despite a failed lookup where checks do not block', async () => {
    storeState.requireEndOfShiftChecks = false;
    mockGetShiftChecklists.mockRejectedValue(new Error('403'));
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));

    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('not blocking');
    // Opening is right — the server does not consult these checks here — but
    // the row must not let an unread status read as zero outstanding, which is
    // the fabricated zero this whole path was fixed to stop reporting.
    expect(screen.getByText(/status could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/still outstanding/)).not.toBeInTheDocument();
  });

  // Cancel with a check outstanding, the crew finishes it, reopen: a cached
  // answer forces an override for work that has since been done.
  it('re-reads the checklists each time a row is opened', async () => {
    mockGetShiftChecklists.mockResolvedValueOnce([
      { templateId: 't1', templateName: 'End of shift', checkTiming: 'end_of_shift', isCompleted: false },
    ]);
    mockGetShiftChecklists.mockResolvedValueOnce([
      { templateId: 't1', templateName: 'End of shift', checkTiming: 'end_of_shift', isCompleted: true },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));
    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('1 outstanding');

    // The wizard's own cancel is mocked away, so drive the same state change
    // the officer's Refresh would: reload the range, which closes the row.
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    await user.click(await screen.findByRole('button', { name: /Close out/ }));

    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('0 outstanding');
    expect(mockGetShiftChecklists).toHaveBeenCalledTimes(2);
  });

  // `preparing` disables only the row that was clicked, so a second row can be
  // started while the first is still fetching — and the slower answer would
  // otherwise replace the wizard the officer most recently opened.
  it('does not let a slower row open replace the wizard the officer just opened', async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mockGetShifts.mockResolvedValue({
      shifts: [unclosedShift, { ...unclosedShift, id: 'shift-2', apparatus_unit_number: 'Engine 2' }],
      total: 2,
      skip: 0,
      limit: 200,
    });
    mockGetShiftChecklists
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        })
      )
      .mockResolvedValue([]);

    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    const rows = screen.getAllByRole('button', { name: /Close out/ });
    await user.click(rows[0] as HTMLElement);
    await user.click(rows[1] as HTMLElement);
    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('wizard for shift-2');

    // Released inside act so the late continuation actually runs before the
    // assertion; without that this passes whether or not the guard is there.
    await act(async () => {
      releaseFirst([
        { templateId: 't1', templateName: 'End of shift', checkTiming: 'end_of_shift', isCompleted: false },
      ]);
    });

    // Still the second row's wizard, not the first's arriving late.
    expect(screen.getByTestId('closeout-wizard')).toHaveTextContent('wizard for shift-2');
    expect(screen.getByTestId('closeout-wizard')).toHaveTextContent('0 outstanding');
  });

  // `useSignupWindow` re-renders on the clock but returns one identity across
  // ticks, so a useMemo keyed on it alone froze the queue at first render: a
  // shift whose end passed while the page stayed open never appeared.
  it('picks up a shift whose end passes while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const start = Date.parse('2026-09-06T04:00:00Z');
    vi.setSystemTime(start);
    // Ends two minutes from now — after the first render, before the tick.
    mockGetShifts.mockResolvedValue({
      shifts: [
        {
          ...unclosedShift,
          shift_date: '2026-09-06',
          start_time: '2026-09-05T20:00:00Z',
          end_time: '2026-09-06T04:02:00Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<CloseoutQueueSection />);
    expect(await screen.findByText(/Every shift in this range is closed out/)).toBeInTheDocument();

    await act(async () => {
      vi.setSystemTime(start + 3 * 60_000);
      // Past the clock's own 30-second bucket, so the tick fires.
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText(/1 shift waiting to be closed out/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  // The wizard renders nothing when its own state request fails — it reports the
  // error and returns null — and the row has already hidden the button that
  // opened it. Without this the officer is left an empty card whose only escape
  // is a range-level Refresh that does not look related to it.
  it('leaves an open row a way out even when the wizard renders nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));
    await screen.findByTestId('closeout-wizard');

    const escape = screen.getByRole('button', { name: 'Close this row' });
    await user.click(escape);

    expect(screen.queryByTestId('closeout-wizard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close out/ })).toBeInTheDocument();
  });

  // A checklist request still in flight would otherwise stay current and reopen
  // its wizard on top of the refreshed list.
  it('does not reopen a row whose preparation was still running when the range reloaded', async () => {
    let release: (value: unknown) => void = () => {};
    mockGetShiftChecklists.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    await screen.findByText(/Engine 1/);

    await act(async () => {
      release([]);
    });

    expect(screen.queryByTestId('closeout-wizard')).not.toBeInTheDocument();
  });

  // The wizard keeps the step being edited in local state until Next is pressed,
  // and switching rows unmounts it — so one click on another row silently threw
  // away typing. The open row's own exit is still there; switching just has to
  // be deliberate.
  it('will not let another row unmount an open wizard', async () => {
    mockGetShifts.mockResolvedValue({
      shifts: [unclosedShift, { ...unclosedShift, id: 'shift-2', apparatus_unit_number: 'Engine 2' }],
      total: 2,
      skip: 0,
      limit: 200,
    });
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getAllByRole('button', { name: /Close out/ })[0] as HTMLElement);
    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('wizard for shift-1');

    const other = screen.getByRole('button', { name: /Close out/ });
    expect(other).toBeDisabled();

    await user.click(other);
    expect(screen.getByTestId('closeout-wizard')).toHaveTextContent('wizard for shift-1');
  });

  // The other branch navigates away, so there is no unsaved state on this page
  // to protect and no reason to hold the row.
  it('does not hold the other rows when the row action only opens the shift', async () => {
    storeState.callTrackingMode = 'detailed';
    mockGetShifts.mockResolvedValue({
      shifts: [unclosedShift, { ...unclosedShift, id: 'shift-2', apparatus_unit_number: 'Engine 2' }],
      total: 2,
      skip: 0,
      limit: 200,
    });
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    for (const button of screen.getAllByRole('button', { name: /Open the shift to close it/ })) {
      expect(button).toBeEnabled();
    }
  });

  // A reversed range is not an empty range. The endpoint applies both bounds
  // and returns nothing, which this screen would present as an audit result.
  it('refuses to read a reversed range rather than calling it clear', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);
    mockGetShifts.mockClear();

    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2026-09-30');

    expect(await screen.findByRole('alert')).toHaveTextContent(/earlier than/);
    expect(screen.queryByText(/Every shift in this range is closed out/)).not.toBeInTheDocument();
    // Clearing the field first leaves `From` empty for a moment, which is a
    // legitimate open-ended lower bound and does load. The reversed pair never
    // reaches the endpoint.
    expect(mockGetShifts).not.toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-09-30' }));
  });

  // The endpoint orders by date ascending and finalization is filtered here
  // afterwards, so a busy range's first page can be entirely closed-out shifts
  // while the unclosed ones sit on a later one. Reading one page and then
  // announcing "every shift in this range is closed out" states the opposite of
  // the truth with total confidence.
  it('reads every page before it claims the range is clear', async () => {
    const page = (ids: string[], total: number) => ({
      shifts: ids.map((id) => ({ ...unclosedShift, id, is_finalized: id !== 'unclosed' })),
      total,
      skip: 0,
      limit: 200,
    });
    const first = Array.from({ length: 200 }, (unused, index) => `closed-${index}`);
    mockGetShifts.mockReset();
    mockGetShifts.mockResolvedValueOnce(page(first, 201)).mockResolvedValueOnce(page(['unclosed'], 201));

    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByText(/1 shift waiting to be closed out/)).toBeInTheDocument();
    expect(mockGetShifts).toHaveBeenCalledTimes(2);
    expect(mockGetShifts).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200 }));
    expect(screen.queryByText(/Every shift in this range is closed out/)).not.toBeInTheDocument();
  });

  // Two ranges in flight and the slower, older one lands last: the date
  // controls then describe one range while the queue describes another, and
  // nothing on screen says so.
  it('ignores a response that a newer range has already superseded', async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mockGetShifts.mockReset();
    mockGetShifts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        })
      )
      .mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });

    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2026-09-01');

    // The first range finally answers, with a shift the newer range excludes.
    releaseFirst({ shifts: [unclosedShift], total: 1, skip: 0, limit: 200 });

    expect(await screen.findByText(/Every shift in this range is closed out/)).toBeInTheDocument();
    expect(screen.queryByText(/Engine 1/)).not.toBeInTheDocument();
  });

  // The checklist endpoint wants an Inventory grant that scheduling.manage does
  // not imply, so this 403s for an ordinary scheduling officer. Reading that as
  // "nothing outstanding" opens the wizard with its override hidden and leaves
  // the finalize call refusing with nothing on screen to explain why.
  it('refuses to open the wizard on a failed checklist lookup, and offers a retry', async () => {
    mockGetShiftChecklists.mockRejectedValueOnce(new Error('403'));
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/equipment checks could not be read/);
    expect(screen.queryByTestId('closeout-wizard')).not.toBeInTheDocument();

    mockGetShiftChecklists.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('closeout-wizard')).toBeInTheDocument();
  });

  // The store leaves settingsLoaded false on a failed load rather than caching
  // a permissive fallback, so "not loaded" cannot be read as "still loading" —
  // it spins for ever and suppresses the shifts that did arrive.
  it('says the settings did not load rather than spinning for ever', async () => {
    storeState.settingsLoaded = false;
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/scheduling settings did not load/);
    // Not still "Checking…": the page has stopped claiming the answer is on
    // its way, which is what the endless spinner did.
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    // Reset each mock before installing its default rather than relying on
    // clearAllMocks, which keeps implementations (CLAUDE.md pitfall #28).
    mockGetShifts.mockReset();
    mockGetShiftChecklists.mockReset();
    mockNavigate.mockReset();
    storeState.callTrackingMode = 'count_only';
    storeState.requireEndOfShiftChecks = true;
    storeState.settingsLoaded = true;
    storeState.loadSettings = vi.fn(() => Promise.resolve());
    departmentTimezone = 'UTC';
    mockGetShifts.mockResolvedValue({ shifts: [unclosedShift], total: 1, skip: 0, limit: 200 });
    mockGetShiftChecklists.mockResolvedValue([]);
  });

  it('lists a shift that ended without being closed, and how long it has waited', async () => {
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByText(/Engine 1/)).toBeInTheDocument();
    expect(screen.getByText(/^waiting \d+ (hour|day)s?$/)).toBeInTheDocument();
    expect(screen.getByText(/1 shift waiting to be closed out/)).toBeInTheDocument();
  });

  it('opens the wizard on the row for a department recording a call count', async () => {
    mockGetShiftChecklists.mockResolvedValue([
      { templateId: 't1', templateName: 'End of shift', checkTiming: 'end_of_shift', isCompleted: false },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));

    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('wizard for shift-1');
    expect(screen.getByTestId('closeout-wizard')).toHaveTextContent('1 outstanding · blocking');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Against the previous ordering — open the row, then fetch — the wizard's
  // first render carried "0 outstanding", so for a department that blocks on
  // those checks the screen said the close-out was clear to run while the
  // server would have refused it.
  it('does not open the wizard until it knows what is outstanding', async () => {
    let release: (value: unknown) => void = () => {};
    mockGetShiftChecklists.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));
    expect(screen.queryByTestId('closeout-wizard')).not.toBeInTheDocument();

    release([{ templateId: 't1', templateName: 'End of shift', checkTiming: 'end_of_shift', isCompleted: false }]);

    expect(await screen.findByTestId('closeout-wizard')).toHaveTextContent('1 outstanding · blocking');
  });

  // Every other department's close-out is the finalize checklist inside the
  // shift panel, which reads that shift's attendance, equipment checks and
  // manual hours. There is one implementation of it, and it is not here.
  it('opens the shift itself when the wizard is not that department’s close-out', async () => {
    storeState.callTrackingMode = 'detailed';
    const user = userEvent.setup();
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Open the shift to close it/ }));

    expect(mockNavigate).toHaveBeenCalledWith('/scheduling?shift=shift-1');
    expect(screen.queryByTestId('closeout-wizard')).not.toBeInTheDocument();
  });

  // An empty queue and a failed load look identical, and one of them tells an
  // officer there is no work waiting.
  it('says the range did not load rather than showing an empty queue', async () => {
    mockGetShifts.mockRejectedValue(new Error('nope'));
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByText(/is closed out/)).not.toBeInTheDocument();
  });

  it('says so plainly when nothing is waiting', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByText(/Every shift in this range is closed out/)).toBeInTheDocument();
  });

  // The hub's To close out metric has no earliest date — it counts a shift left
  // unclosed three years ago — while this page reads a range. An officer who
  // follows a non-zero count here and finds nothing has to be told that only
  // the range was read, or the page contradicts the number that sent them.
  it('says which range it checked when it finds nothing', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });
    renderWithRouter(<CloseoutQueueSection />);

    await screen.findByText(/Every shift in this range is closed out/);
    expect(screen.getByText(/has no earliest date/)).toBeInTheDocument();
  });

  // A crew still out is not a backlog. The cushion is the department's own
  // number, read from the same settings the roster lock stands on.
  it('leaves an open-ended shift alone while it is still inside the cushion', async () => {
    const startedAnHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockGetShifts.mockResolvedValue({
      shifts: [{ ...unclosedShift, start_time: startedAnHourAgo, end_time: undefined }],
      total: 1,
      skip: 0,
      limit: 200,
    });
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByText(/Every shift in this range is closed out/)).toBeInTheDocument();
  });
});
