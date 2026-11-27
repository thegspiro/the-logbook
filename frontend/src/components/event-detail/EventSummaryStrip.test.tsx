import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventSummaryStrip, type EventSummaryStripProps } from './EventSummaryStrip';
import type { EventStats } from '../../types/event';

const stats: EventStats = {
  event_id: 'evt-1',
  total_rsvps: 14,
  going_count: 11,
  not_going_count: 2,
  maybe_count: 1,
  checked_in_count: 0,
  total_guests: 0,
};

const baseProps: EventSummaryStripProps = {
  stats: null,
  requiresRsvp: false,
  rsvpDeadline: null,
  maxAttendees: null,
  occupiedSeats: 0,
  allowGuests: false,
  hasStarted: false,
  timezone: 'America/New_York',
};

const renderStrip = (overrides: Partial<EventSummaryStripProps> = {}) =>
  render(<EventSummaryStrip {...baseProps} {...overrides} />);

describe('EventSummaryStrip', () => {
  it('draws nothing for a member when the event has nothing to say', () => {
    const { container } = renderStrip();

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a manager the tally, and only the answers somebody gave', () => {
    renderStrip({ stats: { ...stats, maybe_count: 0 } });

    expect(screen.getByText('Responses')).toBeInTheDocument();
    expect(screen.getByText('11 going')).toBeInTheDocument();
    expect(screen.getByText('2 not going')).toBeInTheDocument();
    expect(screen.queryByText(/maybe/)).not.toBeInTheDocument();
  });

  it('says so when nobody has answered, rather than listing zeros', () => {
    renderStrip({ stats: { ...stats, total_rsvps: 0, going_count: 0, not_going_count: 0, maybe_count: 0 } });

    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
  });

  it('holds Checked In back before the event starts', () => {
    renderStrip({ stats });

    expect(screen.queryByText('Checked In')).not.toBeInTheDocument();
  });

  it('shows Checked In at zero once the event has started', () => {
    renderStrip({ stats, hasStarted: true });

    expect(screen.getByText('Checked In')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows Checked In early when somebody has already been checked in', () => {
    renderStrip({ stats: { ...stats, checked_in_count: 4 } });

    expect(screen.getByText('Checked In')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('counts seats against the cap and flags a full event', () => {
    renderStrip({ maxAttendees: 12, occupiedSeats: 14 });

    expect(screen.getByText('14 / 12 spots filled')).toBeInTheDocument();
    expect(screen.getByText('Event Full')).toBeInTheDocument();
  });

  it('does not flag an event with room left', () => {
    renderStrip({ maxAttendees: 12, occupiedSeats: 5 });

    expect(screen.getByText('5 / 12 spots filled')).toBeInTheDocument();
    expect(screen.queryByText('Event Full')).not.toBeInTheDocument();
  });

  it('gives the deadline with the RSVP requirement', () => {
    renderStrip({ requiresRsvp: true, rsvpDeadline: '2030-04-14T18:00:00Z' });

    expect(screen.getByText('RSVP Required')).toBeInTheDocument();
    expect(screen.getByText(/^By Apr 14, 2:00 PM$/)).toBeInTheDocument();
  });

  it('answers Yes when an RSVP is required with no deadline', () => {
    renderStrip({ requiresRsvp: true });

    expect(screen.getByText('RSVP Required')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('notes that guests are allowed', () => {
    renderStrip({ allowGuests: true });

    expect(screen.getByText('Guests Allowed')).toBeInTheDocument();
  });
});
