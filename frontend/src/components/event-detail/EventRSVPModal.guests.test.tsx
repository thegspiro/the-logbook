/**
 * Clearing the guest box means no guests. It used to report NaN, which is
 * sent as null and refused by the server, so the RSVP could not be saved.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import Modal from './EventRSVPModal';
import type { Event } from '../../types/event';

const event: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Monthly Business Meeting',
  description: 'Regular monthly meeting to discuss department updates.',
  event_type: 'business_meeting',
  location: 'Station 1 Conference Room',
  start_datetime: '2030-04-15T18:00:00Z',
  end_datetime: '2030-04-15T20:00:00Z',
  requires_rsvp: true,
  rsvp_deadline: '2030-04-14T18:00:00Z',
  max_attendees: 50,
  allowed_rsvp_statuses: ['going', 'not_going'],
  is_mandatory: false,
  allow_guests: true,
  send_reminders: true,
  reminder_target: 'all',
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

describe('EventRSVPModal guests', () => {
  it('reports a cleared box as no guests', () => {
    const onGuestCountChange = vi.fn();
    renderWithRouter(
      <Modal
        event={{ ...event, allow_guests: true }}
        rsvpStatus="going"
        onRsvpStatusChange={vi.fn()}
        guestCount={2}
        onGuestCountChange={onGuestCountChange}
        rsvpNotes=""
        onRsvpNotesChange={vi.fn()}
        rsvpDietaryRestrictions=""
        onRsvpDietaryRestrictionsChange={vi.fn()}
        rsvpAccessibilityNeeds=""
        onRsvpAccessibilityNeedsChange={vi.fn()}
        rsvpApplyToSeries={false}
        onRsvpApplyToSeriesChange={vi.fn()}
        submitting={false}
        submitError={null}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Number of Guests'), { target: { value: '' } });

    expect(onGuestCountChange).toHaveBeenLastCalledWith(0);
  });
});
