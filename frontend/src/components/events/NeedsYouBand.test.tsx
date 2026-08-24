import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { NeedsYouBand } from './NeedsYouBand';
import type { EventListItem } from '../../types/event';

const NOW = new Date('2026-09-02T18:00:00.000Z');

const hoursFromNow = (hours: number): string => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const makeEvent = (overrides: Partial<EventListItem> & { id: string; title: string }): EventListItem => ({
  event_type: 'training',
  start_datetime: hoursFromNow(24),
  end_datetime: hoursFromNow(26),
  requires_rsvp: true,
  is_mandatory: false,
  is_cancelled: false,
  ...overrides,
});

const liveEvent = makeEvent({
  id: 'live-1',
  title: 'Ladder Company Drill',
  start_datetime: hoursFromNow(-1),
  end_datetime: hoursFromNow(1),
  check_in_opens_at: hoursFromNow(-2),
  check_in_closes_at: hoursFromNow(1),
  location_name: 'Training Grounds',
  credited_hours: 2,
  hour_category_label: 'drill',
});

const actionEvent = makeEvent({
  id: 'action-1',
  title: 'Monthly Business Meeting',
  is_mandatory: true,
  rsvp_deadline: hoursFromNow(20),
});

const missedEvent = makeEvent({
  id: 'missed-1',
  title: 'Standpipe Drill',
  is_mandatory: true,
  start_datetime: hoursFromNow(-500),
  end_datetime: hoursFromNow(-498),
  user_attended: false,
  credited_hours: 2,
});

const routineEvent = makeEvent({ id: 'routine-1', title: 'Pancake Breakfast' });

const onQuickRSVP = vi.fn();
const onShowAll = vi.fn();

const renderBand = (props: Partial<React.ComponentProps<typeof NeedsYouBand>> = {}) =>
  renderWithRouter(
    <NeedsYouBand
      events={[]}
      pastMandatoryEvents={[]}
      timezone="UTC"
      now={NOW}
      rsvpLoading={{}}
      onQuickRSVP={onQuickRSVP}
      onShowAll={onShowAll}
      {...props}
    />
  );

describe('NeedsYouBand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no event needs a response', () => {
    renderBand({ events: [routineEvent] });
    expect(screen.queryByTestId('needs-you-band')).not.toBeInTheDocument();
  });

  it('renders nothing at all rather than an empty state', () => {
    const { container } = renderBand();
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes itself as a labelled region', () => {
    renderBand({ events: [actionEvent] });
    expect(screen.getByRole('region', { name: 'Events needing your response' })).toBeInTheDocument();
  });

  it('counts the rows in the header pill', () => {
    renderBand({ events: [liveEvent, actionEvent, routineEvent], pastMandatoryEvents: [missedEvent] });
    const band = screen.getByTestId('needs-you-band');
    expect(within(band).getByText('3')).toBeInTheDocument();
  });

  it('leaves routine events out of the band', () => {
    renderBand({ events: [actionEvent, routineEvent] });
    expect(screen.queryByText(/Pancake Breakfast/)).not.toBeInTheDocument();
  });

  it('orders live before action before missed', () => {
    renderBand({ events: [actionEvent, liveEvent], pastMandatoryEvents: [missedEvent] });
    const headings = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(headings[0]).toContain('Ladder Company Drill is happening now');
    expect(headings[1]).toContain("Monthly Business Meeting is mandatory and you haven't responded");
    expect(headings[2]).toContain('No check-in recorded for Standpipe Drill');
  });

  it('gives a live row a check-in link', () => {
    // The announcement itself is not here: a live region that enters the DOM
    // with its text is not reliably announced, so EventsPage owns a persistent
    // one. See its "Live event announcement" tests.
    renderBand({ events: [liveEvent] });
    const row = screen.getByRole('listitem');
    expect(within(row).getByRole('link', { name: /check in/i })).toHaveAttribute('href', '/events/live-1/check-in');
    expect(row).toHaveTextContent('Training Grounds');
    expect(row).toHaveTextContent('Credits up to 2 drill hours');
  });

  it('wires the action row buttons to the RSVP handler', async () => {
    const user = userEvent.setup();
    renderBand({ events: [actionEvent] });

    await user.click(screen.getByRole('button', { name: /^going$/i }));
    expect(onQuickRSVP).toHaveBeenCalledWith('action-1', 'going');

    await user.click(screen.getByRole('button', { name: /not going/i }));
    expect(onQuickRSVP).toHaveBeenCalledWith('action-1', 'not_going');
  });

  it('disables the action row while its RSVP is in flight', () => {
    renderBand({ events: [actionEvent], rsvpLoading: { 'action-1': true } });
    expect(screen.getByRole('button', { name: /^going$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not going/i })).toBeDisabled();
  });

  it('phrases a non-mandatory deadline row as a closing RSVP', () => {
    const closingSoon = makeEvent({ id: 'soon-1', title: 'Open House', rsvp_deadline: hoursFromNow(6) });
    renderBand({ events: [closingSoon] });
    expect(screen.getByText('RSVP for Open House closes soon')).toBeInTheDocument();
  });

  it('does not list the same event twice when both sources carry it', () => {
    renderBand({ events: [missedEvent], pastMandatoryEvents: [missedEvent] });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('caps the list at five rows and offers the rest behind a link', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      makeEvent({
        id: `mandatory-${i}`,
        title: `Drill ${i}`,
        is_mandatory: true,
        start_datetime: hoursFromNow(24 + i),
        end_datetime: hoursFromNow(26 + i),
      })
    );
    const user = userEvent.setup();
    renderBand({ events: many });

    // Five event rows plus the overflow row.
    expect(screen.getAllByRole('listitem')).toHaveLength(6);

    const overflow = screen.getByRole('button', { name: '+2 more need a response' });
    await user.click(overflow);
    expect(onShowAll).toHaveBeenCalled();
  });
});
