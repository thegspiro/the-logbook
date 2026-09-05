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
import { screen, waitFor } from '@testing-library/react';
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
    expect(mockGetShifts).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: '2026-08-06', end_date: '2026-09-05' })
    );
    vi.useRealTimers();
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
