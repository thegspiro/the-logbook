import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetCurrentCheckIns = vi.fn();
vi.mock('../services/api', () => ({
  locationsService: {
    getCurrentCheckIns: (...a: unknown[]) => mockGetCurrentCheckIns(...a) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import RoomCheckInPage from './RoomCheckInPage';

const event = (id: string, name: string) => ({
  event_id: id,
  event_name: name,
  start_datetime: '2026-10-02T23:00:00Z',
  end_datetime: '2026-10-03T01:00:00Z',
  check_in_start: '2026-10-02T22:30:00Z',
  check_in_end: '2026-10-03T01:00:00Z',
  is_valid: true,
  can_check_in: true,
});

const room = (events: ReturnType<typeof event>[]) => ({
  location_id: 'room-7',
  location_name: 'Training Room',
  current_events: events,
  has_overlap: events.length > 1,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/locations/room-7/check-in']}>
      <Routes>
        <Route path="/locations/:locationId/check-in" element={<RoomCheckInPage />} />
        <Route path="/events/:id/check-in" element={<p>Event check-in page</p>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  mockGetCurrentCheckIns.mockReset();
});

describe('RoomCheckInPage', () => {
  it('asks the server about the room named in the URL', async () => {
    mockGetCurrentCheckIns.mockResolvedValue(room([]));
    renderPage();
    await screen.findByText('Nothing to check in to');
    expect(mockGetCurrentCheckIns).toHaveBeenCalledWith('room-7');
  });

  it('goes straight to the event when exactly one is open', async () => {
    mockGetCurrentCheckIns.mockResolvedValue(room([event('evt-1', 'Monthly Drill')]));
    renderPage();
    expect(await screen.findByText('Event check-in page')).toBeInTheDocument();
  });

  // Two events in one room: guessing would file attendance on the wrong one.
  it('asks which event when several are open, and does not pick one', async () => {
    mockGetCurrentCheckIns.mockResolvedValue(
      room([event('evt-1', 'Monthly Drill'), event('evt-2', 'Officers Meeting')])
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Which event are you here for?' })).toBeInTheDocument();
    expect(screen.queryByText('Event check-in page')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /Officers Meeting/ }));
    expect(await screen.findByText('Event check-in page')).toBeInTheDocument();
  });

  it('says so when nothing is open, and can check again', async () => {
    mockGetCurrentCheckIns.mockResolvedValueOnce(room([]));
    mockGetCurrentCheckIns.mockResolvedValueOnce(room([event('evt-1', 'Monthly Drill')]));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/No event in/)).toHaveTextContent('Training Room');
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Event check-in page')).toBeInTheDocument();
    expect(mockGetCurrentCheckIns).toHaveBeenCalledTimes(2);
  });

  it('explains a tag whose room no longer exists', async () => {
    mockGetCurrentCheckIns.mockRejectedValue(
      Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404, data: {} } })
    );
    renderPage();
    expect(await screen.findByText(/room that no longer exists/)).toBeInTheDocument();
  });

  it('shows the server message for any other failure', async () => {
    mockGetCurrentCheckIns.mockRejectedValue(new Error('Network down'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Room unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});
