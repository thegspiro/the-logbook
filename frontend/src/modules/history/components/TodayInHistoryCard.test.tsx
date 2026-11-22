import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TimelineEntry } from '../types';

const mockToday = vi.fn();

vi.mock('../services/api', () => ({
  historyTimelineService: {
    today: (...args: unknown[]) => mockToday(...args) as unknown,
  },
}));

import { TodayInHistoryCard } from './TodayInHistoryCard';

const entry: TimelineEntry = {
  key: 'line_of_duty:p1',
  kind: 'line_of_duty',
  date: '1923-02-03',
  precision: 'day',
  circa: false,
  end_date: null,
  end_precision: null,
  end_circa: false,
  label: 'Robert Doyle died in the line of duty',
  detail: null,
  record_type: 'member',
  record_id: 'p1',
  event_type_id: null,
  event_type_name: null,
  publication_level: 'members',
};

const renderCard = (hideWhenEmpty: boolean) =>
  render(
    <MemoryRouter>
      <TodayInHistoryCard hideWhenEmpty={hideWhenEmpty} />
    </MemoryRouter>
  );

describe('TodayInHistoryCard', () => {
  beforeEach(() => {
    mockToday.mockReset();
  });

  it('lists what happened on this day, by year, linking to each record', async () => {
    mockToday.mockResolvedValue([entry]);
    renderCard(false);
    expect(await screen.findByRole('link', { name: 'Robert Doyle died in the line of duty' })).toHaveAttribute(
      'href',
      '/history/people/p1'
    );
    expect(screen.getByText('1923')).toBeInTheDocument();
  });

  it('says so on the History home when nothing happened on this day', async () => {
    mockToday.mockResolvedValue([]);
    renderCard(false);
    expect(await screen.findByText('Nothing in the archive happened on this day.')).toBeInTheDocument();
  });

  it('takes no room on the Dashboard on a day with nothing to show', async () => {
    mockToday.mockResolvedValue([]);
    const { container } = renderCard(true);
    await waitFor(() => expect(mockToday).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Today in history' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
