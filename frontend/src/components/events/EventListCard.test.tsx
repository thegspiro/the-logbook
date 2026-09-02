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
      expect(screen.getByText('Tue, Sep 8 · 7:00 – 9:00 PM · 2h')).toBeInTheDocument();
    });

    it('renders the location', () => {
      renderCard(makeEvent({ location_name: 'Training Grounds' }));
      expect(screen.getByText('Training Grounds')).toBeInTheDocument();
    });

    it('renders credited hours with their category, as a ceiling', () => {
      // "up to", not "2.0": the figure is the scheduled length, while the
      // credit is the attended time settled at check-out. Stating the ceiling
      // as fact is how a member ends up short of a requirement they thought
      // they had met.
      renderCard(makeEvent({ credited_hours: 2, hour_category_label: 'drill' }));
      expect(screen.getByText(/Credits/)).toHaveTextContent('Credits up to 2 drill hours');
    });

    it('explains what the hours figure is based on', () => {
      renderCard(makeEvent({ credited_hours: 2, hour_category_label: 'drill' }));
      expect(screen.getByText(/Credits/).getAttribute('title')).toContain('attended time');
    });

    it('omits the hours row when the org maps no hours to this event', () => {
      renderCard(makeEvent());
      expect(screen.queryByText(/Credits/)).not.toBeInTheDocument();
    });

    it('reports roster progress when the event has a cap', () => {
      renderCard(makeEvent({ max_attendees: 14, going_count: 9, occupied_seats: 9 }));
      expect(screen.getByText('9 of 14 slots filled')).toBeInTheDocument();
    });

    it('counts guests against the cap, because the server does', () => {
      // max_attendees caps seats, not members. Eight members who brought two
      // guests fill a ten-seat event; reporting "8 of 10" promised room the
      // RSVP path would then refuse.
      renderCard(makeEvent({ max_attendees: 10, going_count: 8, occupied_seats: 10 }));
      expect(screen.getByText("Roster full — you'd be waitlisted")).toBeInTheDocument();
      expect(screen.queryByText('8 of 10 slots filled')).not.toBeInTheDocument();
    });

    it('falls back to the member count when no seat total was sent', () => {
      // Payloads predating the aggregate still have to render something sane.
      renderCard(makeEvent({ max_attendees: 14, going_count: 9 }));
      expect(screen.getByText('9 of 14 slots filled')).toBeInTheDocument();
    });

    it('warns that a full roster means the waitlist', () => {
      renderCard(makeEvent({ max_attendees: 14, going_count: 14, occupied_seats: 14 }));
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

    it('offers only the responses the event accepts', () => {
      // Hardcoding Going/Not Going rendered a button the API rejects
      // deterministically on an event configured for a narrower set.
      renderCard(makeEvent({ allowed_rsvp_statuses: ['going'] }));
      expect(screen.getByRole('button', { name: /^going$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /not going/i })).not.toBeInTheDocument();
    });

    it('falls back to no RSVP controls when it accepts neither', () => {
      // This card only ever submits going / not_going, so a 'maybe'-only event
      // has nothing here that can succeed.
      renderCard(makeEvent({ allowed_rsvp_statuses: ['maybe'] }));
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /not going/i })).not.toBeInTheDocument();
    });

    it('offers both when the payload names no statuses', () => {
      // Absent means the server default pair, not "nothing allowed".
      renderCard(makeEvent());
      expect(screen.getByRole('button', { name: /^going$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /not going/i })).toBeInTheDocument();
    });

    it('offers no RSVP controls on a draft', () => {
      // EventsPage includes drafts for managers, and the API refuses every
      // draft RSVP outright, so these controls could never succeed.
      renderCard(makeEvent({ is_draft: true, requires_rsvp: false }));
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
    });

    it('still offers RSVP controls when a response is not required', () => {
      // requires_rsvp means a response is *expected* — it drives the deadline
      // and the Needs You band. It does not mean responses are accepted, and
      // gating the controls on it left a member with nothing to do on the
      // majority of events, which never set the flag.
      renderCard(makeEvent({ requires_rsvp: false }));
      expect(screen.getByRole('button', { name: /^going$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /not going/i })).toBeInTheDocument();
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

  describe('memoization', () => {
    // The card is wrapped in React.memo so a keystroke in the search box stops
    // re-rendering all 25 cards. The risk that buys is a card that goes stale,
    // so these assert the props that must still get through.
    it('re-renders when its event changes', () => {
      const { rerender } = renderCard(makeEvent({ going_count: 4 }));
      expect(screen.getByText('4 going')).toBeInTheDocument();

      const updated = makeEvent({ going_count: 5 });
      rerender(
        <EventListCard
          event={updated}
          urgency={getEventUrgency(updated, NOW)}
          timezone="UTC"
          timezoneAbbr="UTC"
          now={NOW}
          canManage={false}
          selectionMode={false}
          isSelected={false}
          rsvpLoading={false}
          isChangingRsvp={false}
          {...handlers}
        />
      );

      expect(screen.getByText('5 going')).toBeInTheDocument();
    });

    it('re-renders when only its urgency changes', () => {
      // Same event object, different derived state — the case a comparator
      // keyed on the event alone would miss.
      const event = makeEvent({ is_mandatory: true });
      const { rerender } = renderCard(event, { urgency: 'routine' });
      expect(screen.queryByText('Response needed')).not.toBeInTheDocument();

      rerender(
        <EventListCard
          event={event}
          urgency="action"
          timezone="UTC"
          timezoneAbbr="UTC"
          now={NOW}
          canManage={false}
          selectionMode={false}
          isSelected={false}
          rsvpLoading={false}
          isChangingRsvp={false}
          {...handlers}
        />
      );

      expect(screen.getByText('Response needed')).toBeInTheDocument();
    });
  });

  it('keeps the card body linked to the detail page', () => {
    renderCard(makeEvent());
    const detailLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/events/evt-1');
    expect(detailLinks.length).toBeGreaterThan(0);
  });
});
