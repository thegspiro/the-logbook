import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import LocationKioskPage from './LocationKioskPage';

const mockFetch = vi.fn();

const event = {
  event_id: 'evt-1',
  event_name: 'Monthly Drill',
  start_datetime: '2026-10-03T18:00:00Z',
  end_datetime: '2026-10-03T20:00:00Z',
  check_in_start: '2026-10-03T17:30:00Z',
  check_in_end: '2026-10-03T20:00:00Z',
  is_valid: true,
};

const feed = (overrides: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      location_id: 'room-1',
      location_name: 'Training Room',
      current_events: [event],
      has_overlap: false,
      timezone: 'UTC',
      ...overrides,
    }),
});

const renderKiosk = () =>
  render(
    <MemoryRouter initialEntries={['/display/ROOM1CODE']}>
      <Routes>
        <Route path="/display/:code" element={<LocationKioskPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocationKioskPage badge reader', () => {
  it('offers the card reader in a room with badge check-in on', async () => {
    mockFetch.mockResolvedValue(feed({ badge_check_in_enabled: true }));
    renderKiosk();

    expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();
    expect(screen.getByText('Or tap your ID card here')).toBeInTheDocument();
  });

  it('shows no reader where the room has it off', async () => {
    mockFetch.mockResolvedValue(feed({ badge_check_in_enabled: false }));
    renderKiosk();

    expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();
    expect(screen.queryByText('Or tap your ID card here')).not.toBeInTheDocument();
  });

  it('shows no reader to an older server that does not report the flag', async () => {
    mockFetch.mockResolvedValue(feed({}));
    renderKiosk();

    expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();
    expect(screen.queryByText('Or tap your ID card here')).not.toBeInTheDocument();
  });

  it('shows no reader while nothing is open in the room', async () => {
    mockFetch.mockResolvedValue(feed({ badge_check_in_enabled: true, current_events: [] }));
    renderKiosk();

    expect(await screen.findByText('No Active Events')).toBeInTheDocument();
    expect(screen.queryByText('Or tap your ID card here')).not.toBeInTheDocument();
  });
});
