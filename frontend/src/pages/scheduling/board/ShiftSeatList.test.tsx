import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiftRecord } from '../../../modules/scheduling';
import ShiftSeatList from './ShiftSeatList';

const ME = 'me-1';

const seat = (userId: string, position: string, name: string) => ({
  assignment_id: `a-${userId}`,
  user_id: userId,
  user_name: name,
  position,
  status: 'assigned',
});

const shift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's1',
  organization_id: 'org',
  shift_date: '2026-08-25',
  start_time: '2026-08-25T22:00:00Z',
  end_time: '2026-08-26T10:00:00Z',
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
    await user.click(screen.getByRole('button', { name: /take the driver seat/i }));
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'driver');
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
