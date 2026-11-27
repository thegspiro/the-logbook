import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { EventRSVPSection } from './EventRSVPSection';
import type { RSVP, RSVPHistory } from '../../types/event';

const entry = (overrides: Partial<RSVPHistory>): RSVPHistory => ({
  id: 'h1',
  rsvp_id: 'r1',
  event_id: 'e1',
  user_id: 'u1',
  old_status: null,
  new_status: 'going',
  changed_at: '2026-09-28T23:48:00Z',
  changed_by: null,
  is_automatic: false,
  user_name: 'Jordan Avery',
  changer_name: null,
  ...overrides,
});

const renderSection = (rsvpHistory: RSVPHistory[]) =>
  renderWithRouter(
    <EventRSVPSection
      rsvps={[]}
      rsvpHistory={rsvpHistory}
      timezone="America/Chicago"
      removeConfirmUserId={null}
      onSetRemoveConfirmUserId={vi.fn()}
      onCheckIn={vi.fn()}
      onOpenOverrideModal={vi.fn()}
      onRemoveAttendee={vi.fn()}
      onPrintRoster={vi.fn()}
      onExportCSV={vi.fn()}
    />
  );

describe('EventRSVPSection RSVP activity', () => {
  // The feed printed the stored values: "changed from going to not_going",
  // "RSVP'd as waitlisted" (workflow review W19).
  it('names each status the way the rest of the page does', async () => {
    const user = userEvent.setup();
    renderSection([
      entry({ id: 'h2', old_status: 'going', new_status: 'not_going' }),
      entry({ id: 'h1', user_name: 'Alex Brooks', new_status: 'waitlisted' }),
    ]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText('Not Going')).toBeInTheDocument();
    expect(screen.getByText('Waitlisted')).toBeInTheDocument();
    expect(screen.queryByText('not_going')).not.toBeInTheDocument();
    expect(screen.queryByText('waitlisted')).not.toBeInTheDocument();
  });

  // W19-3: an automatic waitlist promotion is recorded, and marked as the
  // system's doing rather than read as the member's own change.
  it('shows an automatic waitlist promotion as automatic', async () => {
    const user = userEvent.setup();
    renderSection([entry({ old_status: 'waitlisted', new_status: 'going', is_automatic: true })]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText(/was moved from/)).toBeInTheDocument();
    expect(screen.getByText('(automatically, when a spot opened up)')).toBeInTheDocument();
    expect(screen.queryByText(/changed from/)).not.toBeInTheDocument();
  });

  it("shows a member's own change without the automatic note", async () => {
    const user = userEvent.setup();
    renderSection([entry({ old_status: 'going', new_status: 'not_going' })]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText(/changed from/)).toBeInTheDocument();
    expect(screen.queryByText(/automatically/)).not.toBeInTheDocument();
  });

  it('shows an unrecognised stored value as it is rather than dropping it', async () => {
    const user = userEvent.setup();
    renderSection([entry({ new_status: 'tentative' })]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText('tentative')).toBeInTheDocument();
  });
});

const attendee = (n: number, overrides: Partial<RSVP> = {}): RSVP => ({
  id: `rsvp-${n}`,
  event_id: 'e1',
  user_id: `user-${n}`,
  status: 'going',
  guest_count: 0,
  responded_at: '2026-03-10T10:00:00Z',
  updated_at: '2026-03-10T10:00:00Z',
  checked_in: false,
  user_name: `Member ${n}`,
  user_email: `member${n}@example.com`,
  ...overrides,
});

const handlers = () => ({
  onSetRemoveConfirmUserId: vi.fn(),
  onCheckIn: vi.fn(),
  onOpenOverrideModal: vi.fn(),
  onRemoveAttendee: vi.fn(),
  onPrintRoster: vi.fn(),
  onExportCSV: vi.fn(),
});

const setupRoster = (
  rsvps: RSVP[],
  props: Partial<React.ComponentProps<typeof EventRSVPSection>> = {},
  spies = handlers()
) => {
  renderWithRouter(
    <EventRSVPSection
      rsvps={rsvps}
      rsvpHistory={[]}
      timezone="America/Chicago"
      removeConfirmUserId={null}
      {...spies}
      {...props}
    />
  );
  return spies;
};

describe('EventRSVPSection attendee rows', () => {
  it('keeps Check In on the row and the other actions behind the row menu', async () => {
    const user = userEvent.setup();
    const rsvp = attendee(1);
    const spies = setupRoster([rsvp]);

    expect(screen.getByRole('button', { name: 'Check In' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Times' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByText('member1@example.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for Member 1' }));
    expect(screen.getByText('member1@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Times' }));
    expect(spies.onOpenOverrideModal).toHaveBeenCalledWith(rsvp);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('asks before removing, naming the attendee', async () => {
    const user = userEvent.setup();
    const spies = setupRoster([attendee(1)]);

    await user.click(screen.getByRole('button', { name: 'Actions for Member 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(spies.onSetRemoveConfirmUserId).toHaveBeenCalledWith('user-1');
    expect(spies.onRemoveAttendee).not.toHaveBeenCalled();
  });

  it('removes only on the confirming Yes', async () => {
    const user = userEvent.setup();
    const spies = setupRoster([attendee(1)], { removeConfirmUserId: 'user-1' });

    expect(screen.getByText('Remove Member 1?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));

    expect(spies.onRemoveAttendee).toHaveBeenCalledWith('user-1');
  });

  it('closes the row menu on Escape', async () => {
    const user = userEvent.setup();
    setupRoster([attendee(1)]);

    await user.click(screen.getByRole('button', { name: 'Actions for Member 1' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('leaves a finalized roster its email and no writes', async () => {
    const user = userEvent.setup();
    setupRoster([attendee(1)], { attendanceFinalized: true });

    expect(screen.queryByRole('button', { name: 'Check In' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Member 1' }));

    expect(screen.getByText('member1@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Times' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('gives a row with no email and no writes no menu at all', () => {
    setupRoster([attendee(1, { user_email: null })], { readOnlyUserId: 'user-1' });

    expect(screen.getByText('Member 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for / })).not.toBeInTheDocument();
  });

  it('shows Checked In in place of Going, and keeps any other answer beside it', () => {
    setupRoster([
      attendee(1, { checked_in: true, checked_in_at: '2026-03-15T17:55:00Z' }),
      attendee(2, { status: 'maybe', checked_in: true, checked_in_at: '2026-03-15T17:56:00Z' }),
      attendee(3),
    ]);

    expect(screen.getAllByText('Checked In')).toHaveLength(2);
    expect(screen.getAllByText('Going')).toHaveLength(1);
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });
});

describe('EventRSVPSection search and filters', () => {
  const roster = Array.from({ length: 10 }, (_, i) =>
    attendee(i + 1, i < 3 ? { checked_in: true, checked_in_at: '2026-03-15T17:55:00Z' } : {})
  );

  it('offers no search on a roster short enough to read at a glance', () => {
    setupRoster(roster.slice(0, 8));

    expect(screen.queryByRole('searchbox', { name: 'Search attendees' })).not.toBeInTheDocument();
  });

  it('narrows a longer roster by name or email, leaving the heading count alone', async () => {
    const user = userEvent.setup();
    setupRoster(roster);

    await user.type(screen.getByRole('searchbox', { name: 'Search attendees' }), 'member10@');

    expect(screen.getByText('Member 10')).toBeInTheDocument();
    expect(screen.queryByText('Member 1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Attendance (10)' })).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    setupRoster(roster);

    await user.type(screen.getByRole('searchbox', { name: 'Search attendees' }), 'zzz');

    expect(screen.getByText('No attendees match.')).toBeInTheDocument();
  });

  it('filters to those not yet checked in', async () => {
    const user = userEvent.setup();
    setupRoster(roster);

    await user.click(screen.getByRole('button', { name: 'Not checked in (7)' }));

    expect(screen.getByRole('button', { name: 'Not checked in (7)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Member 1')).not.toBeInTheDocument();
    expect(screen.getByText('Member 4')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Check In' })).toHaveLength(7);
  });

  it('holds the filters back until somebody is checked in', () => {
    setupRoster(roster.map((r) => ({ ...r, checked_in: false })));

    expect(screen.queryByRole('button', { name: /^Not checked in/ })).not.toBeInTheDocument();
  });
});
