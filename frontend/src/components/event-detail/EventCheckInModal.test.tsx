import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import EventCheckInModal from './EventCheckInModal';

const members = [
  { id: 'u1', first_name: 'Alex', last_name: 'Brooks', email: 'alex@example.org' },
  { id: 'u2', first_name: 'Blair', last_name: 'Carter', email: null },
];

describe('EventCheckInModal (workflow review W20)', () => {
  // The search field's aria-label ("Search by name or email...") overrode its
  // visible "Search Members" label, and every row's button was named only
  // "Check In".
  it('names the search by its visible label and each button by its member', async () => {
    const onCheckIn = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(
      <EventCheckInModal
        eligibleMembers={members}
        organizerName={null}
        rsvps={[]}
        memberSearch=""
        onMemberSearchChange={vi.fn()}
        bulkAddLoading={false}
        onBulkAddAllEligible={vi.fn()}
        onCheckIn={onCheckIn}
        onClose={vi.fn()}
        timezone="America/Chicago"
      />
    );

    expect(screen.getByLabelText('Search Members')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check in Blair Carter' }));
    expect(onCheckIn).toHaveBeenCalledWith('u2');
  });

  it('lists the members who are going first, volunteers among them', () => {
    renderWithRouter(
      <EventCheckInModal
        eligibleMembers={[...members, { id: 'u3', first_name: 'Jordan', last_name: 'Avery', email: null }]}
        organizerName={null}
        rsvps={[
          {
            id: 'r3',
            event_id: 'e1',
            user_id: 'u3',
            status: 'going',
            guest_count: 0,
            checked_in: false,
            responded_at: '2026-11-20T00:00:00Z',
            updated_at: '2026-11-20T00:00:00Z',
          },
        ]}
        memberSearch=""
        onMemberSearchChange={vi.fn()}
        bulkAddLoading={false}
        onBulkAddAllEligible={vi.fn()}
        onCheckIn={vi.fn()}
        onClose={vi.fn()}
        timezone="America/Chicago"
      />
    );

    const names = screen.getAllByRole('button', { name: /^Check in / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Check in Jordan Avery', 'Check in Alex Brooks', 'Check in Blair Carter']);
  });
});
