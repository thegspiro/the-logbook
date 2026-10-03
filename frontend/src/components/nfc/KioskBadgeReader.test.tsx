import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KioskBadgeReader } from './KioskBadgeReader';

const mockFetch = vi.fn();

/** What a USB reader does: the serial typed in one burst, then Enter. */
const swipe = (serial: string) => {
  for (const key of serial) fireEvent.keyDown(window, { key });
  fireEvent.keyDown(window, { key: 'Enter' });
};

const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const checkedIn = {
  status: 'checked_in',
  message: 'Checked in to Monthly Drill.',
  targetName: 'Monthly Drill',
  memberDisplayName: 'Alex T.',
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(reply(200, checkedIn));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { NDEFReader?: unknown }).NDEFReader;
});

describe('KioskBadgeReader', () => {
  it('posts a USB reader swipe to the room and shows who was checked in', async () => {
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);

    swipe('04:a2:24:5b');

    expect(await screen.findByText('Alex T.')).toBeInTheDocument();
    expect(screen.getByText('Checked in to Monthly Drill.')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/public/v1/display/ROOM1CODE/badge-tap',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag_uid: '04A2245B' }) })
    );
  });

  it('drops the second read of a card held a beat too long', async () => {
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);

    swipe('04A2245B');
    await screen.findByText('Alex T.');
    swipe('04A2245B');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a burst too short to be a card', () => {
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);
    swipe('ab');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Turned off since the page loaded: stop offering the reader rather than
  // refusing every member who walks up.
  it('reports a room that no longer accepts taps', async () => {
    mockFetch.mockResolvedValue(reply(403, { detail: 'Badge check-in is not turned on for this room.' }));
    const onDisabled = vi.fn();
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={onDisabled} />);

    swipe('04A2245B');

    await waitFor(() => {
      expect(onDisabled).toHaveBeenCalledTimes(1);
    });
  });

  it('points the member at their phone when the kiosk is rate limited', async () => {
    mockFetch.mockResolvedValue(reply(429));
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);

    swipe('04A2245B');

    expect(await screen.findByText(/Too many taps just now/)).toBeInTheDocument();
  });

  it('says the tap was not recorded when the network fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);

    swipe('04A2245B');

    expect(await screen.findByText(/could not be recorded/)).toBeInTheDocument();
  });

  it('shows a refusal without a member name', async () => {
    mockFetch.mockResolvedValue(
      reply(200, { status: 'unknown_card', message: 'This card is not registered.', memberDisplayName: null })
    );
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);

    swipe('04A2245B');

    expect(await screen.findByText('This card is not registered.')).toBeInTheDocument();
    expect(screen.queryByText('Alex T.')).not.toBeInTheDocument();
  });

  it('offers to start the phone reader only where Web NFC exists', () => {
    const { unmount } = render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Start card reader' })).not.toBeInTheDocument();
    unmount();

    (window as { NDEFReader?: unknown }).NDEFReader = class {
      scan() {
        return Promise.resolve();
      }
      addEventListener() {}
      removeEventListener() {}
    };
    render(<KioskBadgeReader displayCode="ROOM1CODE" onDisabled={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start card reader' })).toBeInTheDocument();
  });
});
