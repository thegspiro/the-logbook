import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { TimelineEntry } from '../types';

const mockDecades = vi.fn();
const mockDecade = vi.fn();
const mockListEntries = vi.fn();

vi.mock('../services/api', () => ({
  historyTimelineService: {
    decades: (...args: unknown[]) => mockDecades(...args) as unknown,
    decade: (...args: unknown[]) => mockDecade(...args) as unknown,
  },
  historyListService: {
    list: (...args: unknown[]) => mockListEntries(...args) as unknown,
  },
}));

import HistoryTimelinePage from './HistoryTimelinePage';

const fire: TimelineEntry = {
  key: 'event:e1',
  kind: 'event',
  date: '1911-03-04',
  precision: 'day',
  circa: false,
  end_date: null,
  end_precision: null,
  end_circa: false,
  label: 'Mill fire',
  detail: 'Mill Street',
  record_type: 'event',
  record_id: 'e1',
  event_type_id: 't1',
  event_type_name: 'Fire or incident',
  publication_level: 'members',
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryTimelinePage />
    </MemoryRouter>
  );

describe('HistoryTimelinePage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDecades.mockReset();
    mockDecade.mockReset();
    mockListEntries.mockReset();
    mockListEntries.mockResolvedValue([]);
    mockDecades.mockResolvedValue([
      { decade: 1910, count: 1 },
      { decade: 1950, count: 4 },
    ]);
    mockDecade.mockResolvedValue([fire]);
  });

  it('opens the latest decade and loads another only when it is opened', async () => {
    renderPage();
    await waitFor(() => expect(mockDecade).toHaveBeenCalledTimes(1));
    expect(mockDecade).toHaveBeenCalledWith(1950, expect.anything());
    expect(await screen.findByRole('link', { name: 'Mill fire' })).toHaveAttribute('href', '/history/events/e1');

    await userEvent.click(screen.getByRole('button', { name: /1910s/ }));
    await waitFor(() => expect(mockDecade).toHaveBeenCalledWith(1910, expect.anything()));
  });

  it('shows events alone when milestones are switched off, and remembers it', async () => {
    renderPage();
    await waitFor(() => expect(mockDecades).toHaveBeenCalled());
    expect(mockDecades.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ kinds: ['event', 'apparatus_in', 'apparatus_out', 'line_of_duty', 'title'] })
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Show milestones as well as events' }));
    await waitFor(() => expect(mockDecades).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['event'] })));
    expect(JSON.parse(window.localStorage.getItem('history.timeline.filters') ?? '{}')).toEqual(
      expect.objectContaining({ milestones: false })
    );
  });

  it('says so when nothing is on the timeline yet', async () => {
    mockDecades.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nothing on the timeline yet')).toBeInTheDocument();
    expect(mockDecade).not.toHaveBeenCalled();
  });
});
