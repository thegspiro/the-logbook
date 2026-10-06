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

describe('LocationKioskPage revocation', () => {
  // Rotating a display code is the documented way to revoke a leaked one, and
  // deactivating the room or the department has the same effect: the public
  // endpoint stops resolving that code and answers 404. A tablet already on
  // the wall only learns this on its next poll, so the 404 has to take the
  // display down — otherwise the revocation reaches the URL and never reaches
  // the screen it exists to clear.
  const notFound = { ok: false, status: 404, json: () => Promise.resolve({}) };

  it('stops showing a revoked room instead of serving its last payload forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetch.mockResolvedValueOnce(feed({})).mockResolvedValue(notFound);
      renderKiosk();

      expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();

      // One poll later the code no longer resolves.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await screen.findByText('Display Unavailable')).toBeInTheDocument();
      expect(screen.queryByText('Monthly Drill')).not.toBeInTheDocument();
      // Named for whoever walks past a wall-mounted tablet: "check the URL"
      // asks something of a reader who has no URL bar and no way to know a
      // code was rotated.
      expect(screen.getByText(/ask an officer for this room's current display link/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last payload through a transient failure, which is not a revocation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetch.mockResolvedValueOnce(feed({})).mockRejectedValue(new Error('network down'));
      renderKiosk();

      expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);

      // Still showing the room: a blip must not blank a working display.
      expect(screen.getByText('Monthly Drill')).toBeInTheDocument();
      expect(screen.queryByText('Display Unavailable')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
