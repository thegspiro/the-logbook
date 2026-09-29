import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { EventRecurrenceInfo } from './EventRecurrenceInfo';
import type { EventListItem } from '../../types/event';

const occurrence = (id: string, start: string) =>
  ({ id, title: 'Weekly Drill', start_datetime: start, end_datetime: start }) as unknown as EventListItem;

const series = [
  occurrence('a', '2026-10-13T00:00:00Z'),
  occurrence('b', '2026-10-20T00:00:00Z'),
  occurrence('c', '2026-10-27T00:00:00Z'),
];

const renderInfo = (eventId: string, seriesPosition: number | null) =>
  renderWithRouter(
    <EventRecurrenceInfo
      eventId={eventId}
      seriesEvents={series}
      seriesPosition={seriesPosition}
      seriesTotal={series.length}
      prevOccurrence={null}
      nextOccurrence={series[1] ?? null}
      showAllOccurrences={false}
      onToggleAllOccurrences={vi.fn()}
      timezone="America/Chicago"
    />
  );

describe('EventRecurrenceInfo', () => {
  it('says which occurrence this is', () => {
    renderInfo('a', 1);

    expect(screen.getByText('Occurrence 1 of 3')).toBeInTheDocument();
  });

  // A cancelled occurrence is not in the active series it is counted against,
  // and read "Occurrence of 3" (workflow review W18).
  it('does not claim a position for an occurrence outside the list', () => {
    renderInfo('cancelled', null);

    expect(screen.getByText('Series of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Occurrence\s+of/)).not.toBeInTheDocument();
  });
});
