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
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

const mockGetBacklog = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShiftsNeedingCloseout: (...args: unknown[]) => mockGetBacklog(...args) as unknown,
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

  // Which shifts are waiting is the server's answer and it only answers when
  // asked, so a shift ending while the officer watches the queue used to appear
  // only because the client re-filtered a date range it already held. Reading
  // the backlog endpoint took that away; polling on the clock the badges
  // already run on is what puts it back. The old test could only pass by
  // mocking the endpoint returning a shift that had not ended — a response it
  // is defined never to give.
  it('picks up a shift that starts waiting while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse('2026-09-06T04:00:00Z'));
    mockGetBacklog.mockReset();
    mockGetBacklog
      .mockResolvedValueOnce({ shifts: [], total: 0, skip: 0, limit: 200 })
      .mockResolvedValue({ shifts: [unclosedShift], total: 1, skip: 0, limit: 200 });

    renderWithRouter(<CloseoutQueueSection />);
    expect(await screen.findByText(/Every shift is closed out/)).toBeInTheDocument();

    await act(async () => {
      // Past the clock's own 30-second bucket, so the tick fires.
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText(/1 shift waiting to be closed out/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  // The poll must not take the page out from under an officer mid-close-out:
  // `load` clears `openRow`, so an unattended refresh would unmount a wizard
  // holding attendance times and call counts that are not saved until Next.
  it('does not poll while a wizard is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await user.click(screen.getByRole('button', { name: /Close out/ }));
    await screen.findByTestId('closeout-wizard');
    const callsBefore = mockGetBacklog.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(mockGetBacklog.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId('closeout-wizard')).toBeInTheDocument();
    vi.useRealTimers();
  });

  // A poll that fails is not evidence the queue is empty. Blanking a correct
  // list because one background request lost the network would be the poll
  // doing harm nobody asked for; the next tick tries again.
  it('leaves the last good queue alone when a poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetBacklog.mockReset();
    mockGetBacklog
      .mockResolvedValueOnce({ shifts: [unclosedShift], total: 1, skip: 0, limit: 200 })
      .mockRejectedValue(new Error('nope'));

    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByText(/Engine 1/)).toBeInTheDocument();
    expect(screen.queryByText(/did not load/)).not.toBeInTheDocument();
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
  it('does not reopen a row whose preparation was still running when the queue reloaded', async () => {
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
    mockGetBacklog.mockResolvedValue({
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
    mockGetBacklog.mockResolvedValue({
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

  // Two contradictory descriptions of the same queue, one screen apart. The
  // rows are gated on the settings; the cap notice counting them was not, so a
  // settings failure printed "The oldest 1 of 412 shifts waiting are listed"
  // directly beneath an alert saying nothing is listed.
  it('does not count listed rows while the settings failure says none are', async () => {
    storeState.settingsLoaded = false;
    mockGetBacklog.mockResolvedValue({ shifts: [unclosedShift], total: 412, skip: 0, limit: 200 });
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/scheduling settings did not load/);
    expect(screen.queryByText(/are listed/)).not.toBeInTheDocument();
  });

  beforeEach(() => {
    // Reset each mock before installing its default rather than relying on
    // clearAllMocks, which keeps implementations (CLAUDE.md pitfall #28).
    mockGetBacklog.mockReset();
    mockGetShiftChecklists.mockReset();
    mockNavigate.mockReset();
    storeState.callTrackingMode = 'count_only';
    storeState.requireEndOfShiftChecks = true;
    storeState.settingsLoaded = true;
    storeState.loadSettings = vi.fn(() => Promise.resolve());
    departmentTimezone = 'UTC';
    mockGetBacklog.mockResolvedValue({ shifts: [unclosedShift], total: 1, skip: 0, limit: 200 });
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
  it('says the queue did not load rather than showing an empty one', async () => {
    mockGetBacklog.mockRejectedValue(new Error('nope'));
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByText(/is closed out/)).not.toBeInTheDocument();
  });

  it('says so plainly when nothing is waiting', async () => {
    mockGetBacklog.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });
    renderWithRouter(<CloseoutQueueSection />);

    expect(await screen.findByText(/Every shift is closed out/)).toBeInTheDocument();
  });

  // The whole point of the change. This page and the hub's To close out count
  // described different populations because the page picked a date range and
  // the metric has none; asking for the backlog itself is what makes them one.
  // A date parameter creeping back in is the regression, so it is the assertion.
  it('asks the server for the backlog rather than a range of its own choosing', async () => {
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    expect(mockGetBacklog).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
    const [params] = mockGetBacklog.mock.calls[0] as [Record<string, unknown>];
    expect(params).not.toHaveProperty('start_date');
    expect(params).not.toHaveProperty('end_date');
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
  });

  // One page, and the officer is told it is one page. Left unsaid, the cap
  // reads as the end of the work — and the hub's count, which is the whole
  // backlog, would then look wrong to the officer who just cleared the screen.
  it('says how much of the backlog it is showing when there is more', async () => {
    mockGetBacklog.mockResolvedValue({
      shifts: [unclosedShift],
      total: 412,
      skip: 0,
      limit: 200,
    });
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    expect(screen.getByText(/oldest 1 of 412 shifts waiting/)).toBeInTheDocument();
  });

  it('says nothing about a cap when the whole backlog fits', async () => {
    renderWithRouter(<CloseoutQueueSection />);
    await screen.findByText(/Engine 1/);

    expect(screen.queryByText(/oldest/)).not.toBeInTheDocument();
  });
});
