import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { EventListCard } from './EventListCard';
import { getEventUrgency } from '../../utils/eventHelpers';
import type { EventListItem } from '../../types/event';

const NOW = new Date('2026-09-02T18:00:00.000Z');

const hoursFromNow = (hours: number): string => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const makeEvent = (overrides: Partial<EventListItem> = {}): EventListItem => ({
  id: 'evt-1',
  title: 'Ladder Company Drill',
  event_type: 'training',
  start_datetime: hoursFromNow(24),
  end_datetime: hoursFromNow(26),
  requires_rsvp: true,
  is_mandatory: false,
  is_cancelled: false,
  ...overrides,
});

const handlers = {
  onToggleSelect: vi.fn(),
  onDuplicate: vi.fn(),
  onQuickRSVP: vi.fn(),
  onStartChangeRsvp: vi.fn(),
  onCancelChangeRsvp: vi.fn(),
};

const renderCard = (event: EventListItem, overrides: Partial<React.ComponentProps<typeof EventListCard>> = {}) =>
  renderWithRouter(
    <EventListCard
      event={event}
      urgency={getEventUrgency(event, NOW)}
      timezone="UTC"
      timezoneAbbr="UTC"
      now={NOW}
      canManage={false}
      selectionMode={false}
      isSelected={false}
      rsvpLoading={false}
      isChangingRsvp={false}
      {...handlers}
      {...overrides}
    />
  );

describe('EventListCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('status strip', () => {
    it('shows no strip for a routine event', () => {
      renderCard(makeEvent());
      expect(screen.queryByText(/response needed|happening now|you're going/i)).not.toBeInTheDocument();
    });

    it('names the state in text, never colour alone', () => {
      renderCard(makeEvent({ is_mandatory: true }));
      expect(screen.getByText('Response needed')).toBeInTheDocument();
    });

    it('labels a live event and offers check-in', () => {
      const event = makeEvent({
        start_datetime: hoursFromNow(-1),
        end_datetime: hoursFromNow(1),
        check_in_opens_at: hoursFromNow(-2),
        check_in_closes_at: hoursFromNow(1),
      });
      renderCard(event);
      expect(screen.getByText('Happening now')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /check in/i })).toHaveAttribute('href', '/events/evt-1/check-in');
    });

    it('acknowledges a confirmed RSVP', () => {
      renderCard(makeEvent({ user_rsvp_status: 'going', going_count: 18 }));
      expect(screen.getByText("You're going")).toBeInTheDocument();
    });

    it('labels a declined RSVP', () => {
      renderCard(makeEvent({ user_rsvp_status: 'not_going' }));
      expect(screen.getByText('You marked Not Going')).toBeInTheDocument();
    });

    it('falls back to a badge for a status the strip does not cover', () => {
      // "Maybe" is a real answer with no strip of its own; without the badge
      // it would appear nowhere on the card.
      renderCard(makeEvent({ user_rsvp_status: 'maybe' }));
      expect(screen.getByText('Maybe')).toBeInTheDocument();
    });

    it('does not repeat a status the strip already states', () => {
      renderCard(makeEvent({ user_rsvp_status: 'going' }));
      expect(screen.queryByText('Going')).not.toBeInTheDocument();
    });
  });

  describe('body rows', () => {
    it('renders the time range with its duration', () => {
      renderCard(makeEvent({ start_datetime: '2026-09-08T19:00:00Z', end_datetime: '2026-09-08T21:00:00Z' }));
      expect(screen.getByText('Tue, Sep 8 · 7:00 PM – 9:00 PM · 2h')).toBeInTheDocument();
    });

    it('renders the location', () => {
      renderCard(makeEvent({ location_name: 'Training Grounds' }));
      expect(screen.getByText('Training Grounds')).toBeInTheDocument();
    });

    it('renders credited hours with their category', () => {
      renderCard(makeEvent({ credited_hours: 2, hour_category_label: 'drill' }));
      expect(screen.getByText(/Credits/)).toHaveTextContent('Credits 2.0 drill hours');
    });

    it('omits the hours row when the org maps no hours to this event', () => {
      renderCard(makeEvent());
      expect(screen.queryByText(/Credits/)).not.toBeInTheDocument();
    });

    it('reports roster progress when the event has a cap', () => {
      renderCard(makeEvent({ max_attendees: 14, going_count: 9 }));
      expect(screen.getByText('9 of 14 slots filled')).toBeInTheDocument();
    });

    it('warns that a full roster means the waitlist', () => {
      renderCard(makeEvent({ max_attendees: 14, going_count: 14 }));
      expect(screen.getByText("Roster full — you'd be waitlisted")).toBeInTheDocument();
    });
  });

  describe('footer actions', () => {
    it('offers Going and Not Going when no RSVP has been given', async () => {
      const user = userEvent.setup();
      renderCard(makeEvent());

      await user.click(screen.getByRole('button', { name: /^going$/i }));
      expect(handlers.onQuickRSVP).toHaveBeenCalledWith('evt-1', 'going');

      await user.click(screen.getByRole('button', { name: /not going/i }));
      expect(handlers.onQuickRSVP).toHaveBeenCalledWith('evt-1', 'not_going');
    });

    it('collapses to Change RSVP once answered', async () => {
      const user = userEvent.setup();
      renderCard(makeEvent({ user_rsvp_status: 'going' }));

      const change = screen.getByRole('button', { name: /change rsvp/i });
      await user.click(change);
      expect(handlers.onStartChangeRsvp).toHaveBeenCalledWith('evt-1');
    });

    it('reveals the pair again while changing an RSVP', () => {
      renderCard(makeEvent({ user_rsvp_status: 'going' }), { isChangingRsvp: true });
      expect(screen.getByRole('button', { name: /^going$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    it('offers the waitlist instead of Going when the roster is full', () => {
      renderCard(makeEvent({ max_attendees: 14, going_count: 14 }));
      expect(screen.getByRole('button', { name: /join waitlist/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
    });

    it('lets a waitlisted member withdraw', async () => {
      const user = userEvent.setup();
      renderCard(makeEvent({ user_rsvp_status: 'waitlisted' }));

      await user.click(screen.getByRole('button', { name: /leave waitlist/i }));
      expect(handlers.onQuickRSVP).toHaveBeenCalledWith('evt-1', 'not_going');
    });

    it('offers no RSVP controls on a cancelled event', () => {
      renderCard(makeEvent({ is_cancelled: true }));
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /change rsvp/i })).not.toBeInTheDocument();
    });

    it('offers no RSVP controls on an event that takes none', () => {
      renderCard(makeEvent({ requires_rsvp: false }));
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
    });

    it('disables both RSVP buttons while a response is in flight', () => {
      renderCard(makeEvent(), { rsvpLoading: true });
      expect(screen.getByRole('button', { name: /^going$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /not going/i })).toBeDisabled();
    });

    it('always offers a labelled add-to-calendar button', () => {
      renderCard(makeEvent());
      expect(screen.getByRole('button', { name: 'Add Ladder Company Drill to calendar' })).toBeInTheDocument();
    });

    it('points a missed event at its attendance record', () => {
      const event = makeEvent({
        is_mandatory: true,
        start_datetime: hoursFromNow(-30),
        end_datetime: hoursFromNow(-28),
        user_attended: false,
      });
      renderCard(event);
      expect(screen.getByText('No check-in recorded')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /view attendance/i })).toHaveAttribute('href', '/events/evt-1');
    });
  });

  describe('manager affordances', () => {
    it('hides Edit and Duplicate from a member', () => {
      renderCard(makeEvent());
      expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
    });

    it('offers Edit and Duplicate to a manager', async () => {
      const user = userEvent.setup();
      renderCard(makeEvent(), { canManage: true });

      expect(screen.getByRole('link', { name: 'Edit Ladder Company Drill' })).toHaveAttribute(
        'href',
        '/events/evt-1/edit'
      );
      await user.click(screen.getByRole('button', { name: 'Duplicate Ladder Company Drill' }));
      expect(handlers.onDuplicate).toHaveBeenCalledWith('evt-1');
    });

    it('offers a selection toggle in selection mode', async () => {
      const user = userEvent.setup();
      renderCard(makeEvent(), { canManage: true, selectionMode: true });

      await user.click(screen.getByRole('button', { name: 'Select Ladder Company Drill' }));
      expect(handlers.onToggleSelect).toHaveBeenCalledWith('evt-1');
    });
  });

  it('keeps the card body linked to the detail page', () => {
    renderCard(makeEvent());
    const detailLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/events/evt-1');
    expect(detailLinks.length).toBeGreaterThan(0);
  });
});
