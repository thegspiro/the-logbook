import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiftRecord } from '../../../modules/scheduling';
import { toDateKey } from '../../../modules/scheduling/utils/shiftBoard';
import ShiftSeatList from './ShiftSeatList';

const ME = 'me-1';

const seat = (userId: string, position: string, name: string) => ({
  assignment_id: `a-${userId}`,
  user_id: userId,
  user_name: name,
  position,
  status: 'assigned',
});

// ShiftSeatList reads the real clock: it renders the claim controls only while
// `isShiftOpen` holds, and that closes the day after the shift runs. A
// hardcoded date here is a time bomb — see the matching note in
// modules/scheduling/utils/shiftBoard.test.ts.
const TODAY_KEY = toDateKey(new Date());
const TOMORROW_KEY = toDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

// The default fixture's start must be an *instant* in the future, not a fixed
// wall-clock time: `memberSignupClosedReason` compares it against `Date.now()`,
// so a literal `T22:00:00Z` would close every default-fixture shift after 22:00
// UTC and take this file and ShiftSeatList's red on a commit that touched
// neither — the same time-bomb class the comment above describes, one level
// down.
const FUTURE_START = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

const shift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's1',
  organization_id: 'org',
  shift_date: TODAY_KEY,
  start_time: FUTURE_START,
  end_time: `${TOMORROW_KEY}T10:00:00Z`,
  positions: [
    { position: 'officer', required: true },
    { position: 'driver', required: true },
    { position: 'firefighter', required: true },
    { position: 'firefighter', required: true },
  ],
  attendee_count: 0,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  roster: [],
  ...overrides,
});

const onClaim = vi.fn();
const onRelease = vi.fn();

const renderList = (props: Partial<React.ComponentProps<typeof ShiftSeatList>> = {}) =>
  render(
    <ShiftSeatList
      shift={shift()}
      currentUserId={ME}
      timezone="America/New_York"
      eligiblePositions={['firefighter']}
      onClaim={onClaim}
      onRelease={onRelease}
      {...props}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ShiftSeatList', () => {
  it('shows how short the crew is', () => {
    renderList({ shift: shift({ roster: [seat('u1', 'officer', 'Dana Ruiz')], attendee_count: 1 }) });
    expect(screen.getByText('3 of 4 seats open')).toBeInTheDocument();
  });

  it('names the crew already on the shift', () => {
    renderList({ shift: shift({ roster: [seat('u1', 'officer', 'Dana Ruiz')], attendee_count: 1 }) });
    expect(screen.getByText('Dana Ruiz')).toBeInTheDocument();
    expect(screen.getAllByText('Open seat')).not.toHaveLength(0);
  });

  it('claims the first seat the member is cleared for, in one tap', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: /take a seat on this shift/i }));
    // Not the officer or driver seat: the member is only cleared to ride.
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'firefighter');
  });

  it('lets a member take a specific open seat from the roster', async () => {
    const user = userEvent.setup();
    renderList({ eligiblePositions: ['driver', 'firefighter'] });
    // The seat is named the way the template that created it names it —
    // "Driver/Operator", not the stored `driver` token.
    await user.click(screen.getByRole('button', { name: /take the Driver\/Operator seat/i }));
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'driver');
  });

  it('names a seat the way the template that created it does', () => {
    // A template with two EMT seats listed them as "EMS" on the board: the
    // stored token was printed where the label belonged.
    renderList({
      shift: shift({
        positions: [
          { position: 'ems', required: true },
          { position: 'ems', required: true },
        ],
      }),
    });
    expect(screen.getAllByText('EMT')).toHaveLength(2);
    expect(screen.queryByText('ems')).not.toBeInTheDocument();
  });

  it('does not offer a seat the member is not cleared for', () => {
    renderList({ eligiblePositions: ['firefighter'] });
    const officerSeat = screen.getByRole('button', { name: /officer seat — you are not cleared for it/i });
    expect(officerSeat).toBeDisabled();
  });

  it('explains itself rather than showing a dead button', () => {
    // A greyed-out control with no reason reads as a broken page.
    renderList({ eligiblePositions: [] });
    expect(screen.getByText(/not cleared for any seat/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /take a seat/i })).not.toBeInTheDocument();
  });

  it('offers to give up a shift the member already holds', async () => {
    const user = userEvent.setup();
    const mine = shift({ roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({ shift: mine });
    expect(screen.getByText("You're on it")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /give up this shift/i }));
    expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('says there is nothing to claim on a full crew', () => {
    const full = shift({
      roster: [
        seat('u1', 'officer', 'A'),
        seat('u2', 'driver', 'B'),
        seat('u3', 'firefighter', 'C'),
        seat('u4', 'firefighter', 'D'),
      ],
      attendee_count: 4,
    });
    renderList({ shift: full });
    expect(screen.getByText('Fully staffed')).toBeInTheDocument();
    expect(screen.getByText(/this crew is full/i)).toBeInTheDocument();
  });

  it('blocks a second tap while a claim is in flight', () => {
    renderList({ pending: true });
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
  });
});

describe('a shift nobody can sign up for', () => {
  it('offers no claim on a cancelled shift', () => {
    // The server refuses self-signup outright, so a claim button here can
    // only ever produce an error toast.
    renderList({ shift: shift({ status: 'cancelled' }) });
    expect(screen.getByText(/this shift was cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /take a seat on this shift/i })).not.toBeInTheDocument();
  });

  it('offers no claim on a finalized shift', () => {
    renderList({ shift: shift({ is_finalized: true }) });
    expect(screen.getByText(/has been finalized/i)).toBeInTheDocument();
  });

  it('offers no claim on a shift that has already run', () => {
    renderList({ shift: shift({ shift_date: '2000-01-01' }) });
    expect(screen.getByText(/has already run/i)).toBeInTheDocument();
  });

  it('does not offer to give up a shift that has already run', () => {
    const past = shift({ shift_date: '2000-01-01', roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({ shift: past });
    expect(screen.queryByRole('button', { name: /give up this shift/i })).not.toBeInTheDocument();
  });

  it('counts a cancelled shift as no shortage', () => {
    // Four empty seats nobody can fill is not a staffing gap; counting it is
    // how a quiet day reads as urgent.
    renderList({ shift: shift({ status: 'cancelled' }) });
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText(/seats open/i)).not.toBeInTheDocument();
  });
});

describe('a pending offer of this seat', () => {
  const onAnswerOffer = vi.fn();
  const onCancelOffer = vi.fn();

  const offer = (overrides = {}) =>
    ({
      id: 'sw1',
      offering_shift_id: 's1',
      requesting_user_id: 'u2',
      requesting_user_name: 'Dana Ruiz',
      target_user_id: ME,
      target_user_name: 'You',
      status: 'pending',
      created_at: '2026-08-20T00:00:00Z',
      ...overrides,
    }) as never;

  it('tells the member an offer is waiting on them', () => {
    renderList({ offerToMe: offer(), onAnswerOffer });
    expect(screen.getByText(/Dana Ruiz offered you this seat/i)).toBeInTheDocument();
  });

  it('accepts the offer', async () => {
    const user = userEvent.setup();
    renderList({ offerToMe: offer(), onAnswerOffer });
    await user.click(screen.getByRole('button', { name: /take the shift/i }));
    expect(onAnswerOffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sw1' }), true);
  });

  it('declines the offer', async () => {
    const user = userEvent.setup();
    renderList({ offerToMe: offer(), onAnswerOffer });
    await user.click(screen.getByRole('button', { name: /decline/i }));
    expect(onAnswerOffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sw1' }), false);
  });

  it('says the shift is still yours while your own offer stands', () => {
    // The whole promise of offering rather than releasing: the seat is never
    // left empty, so the member has to be able to see that it is still theirs.
    const mine = shift({ roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({
      shift: mine,
      offerFromMe: offer({ requesting_user_id: ME, target_user_id: 'u9', target_user_name: 'T. Nguyen' }),
      onCancelOffer,
    });
    expect(screen.getByText(/Offered to T\. Nguyen/i)).toBeInTheDocument();
    expect(screen.getByText(/still yours until they accept/i)).toBeInTheDocument();
  });

  it("hides give-up while the member's own offer is still standing", async () => {
    // Releasing the seat, or offering it to somebody else, would leave the
    // first recipient holding an offer that can no longer be honoured — and
    // two members each told the seat is theirs to accept.
    const mine = shift({ roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({
      shift: mine,
      offerFromMe: offer({ requesting_user_id: ME, target_user_id: 'u9' }),
      onCancelOffer,
    });
    expect(screen.queryByRole('button', { name: /give up this shift/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw the offer/i })).toBeInTheDocument();
  });

  it('offers give-up again once no offer stands', () => {
    const mine = shift({ roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({ shift: mine });
    expect(screen.getByRole('button', { name: /give up this shift/i })).toBeInTheDocument();
  });

  it('lets the offerer withdraw it', async () => {
    const user = userEvent.setup();
    const mine = shift({ roster: [seat(ME, 'driver', 'You')], attendee_count: 1 });
    renderList({
      shift: mine,
      offerFromMe: offer({ requesting_user_id: ME, target_user_id: 'u9' }),
      onCancelOffer,
    });
    await user.click(screen.getByRole('button', { name: /withdraw the offer/i }));
    expect(onCancelOffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sw1' }));
  });

  it('shows no banner when nothing is pending', () => {
    renderList();
    expect(screen.queryByText(/offered you this seat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/offered to/i)).not.toBeInTheDocument();
  });
});

describe('a shift that has already started', () => {
  const started = () => shift({ start_time: new Date(Date.now() - 60 * 60_000).toISOString() });

  it('says it has started rather than that it has already run', () => {
    render(
      <ShiftSeatList
        shift={started()}
        currentUserId={ME}
        timezone="UTC"
        eligiblePositions={['firefighter']}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
      />
    );
    expect(screen.getByText('This shift has already started.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /take a seat on this shift/i })).not.toBeInTheDocument();
  });

  it('still says cancelled when the shift was cancelled', () => {
    // Cancelled is the more informative answer, and it is the precedence the
    // backend rule uses too — its window check defers to the mutability check.
    render(
      <ShiftSeatList
        shift={{ ...started(), status: 'cancelled' }}
        currentUserId={ME}
        timezone="UTC"
        eligiblePositions={['firefighter']}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
      />
    );
    expect(screen.getByText('This shift was cancelled.')).toBeInTheDocument();
  });

  it('offers the seats again inside a late-signup window', () => {
    render(
      <ShiftSeatList
        shift={{ ...started(), late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString() }}
        currentUserId={ME}
        timezone="UTC"
        eligiblePositions={['firefighter']}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /take a seat on this shift/i })).toBeInTheDocument();
  });

  it("prefers the server's own reason when the detail response supplied one", () => {
    render(
      <ShiftSeatList
        shift={{ ...started(), signup_closed_reason: 'Late signup for this shift has closed.' }}
        currentUserId={ME}
        timezone="UTC"
        eligiblePositions={['firefighter']}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
      />
    );
    expect(screen.getByText('Late signup for this shift has closed.')).toBeInTheDocument();
  });
});
