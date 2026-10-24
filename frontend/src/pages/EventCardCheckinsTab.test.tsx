/**
 * Events hub → Card Check-ins, and the event page's Card taps section.
 *
 * What each test protects:
 *  - the hub tab asks for event taps across all events with the filters shown;
 *  - the event section asks for this event only, and stays out of the way on
 *    a department that never used cards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockListEventTaps = vi.fn();
const mockIsConnected = vi.fn();

vi.mock('../services/nfcActivityService', () => ({
  nfcActivityService: {
    listEventTaps: (...args: unknown[]) => mockListEventTaps(...args) as unknown,
  },
}));

vi.mock('../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => mockIsConnected(type) as boolean,
  }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import EventCardCheckinsTab from './EventCardCheckinsTab';
import { EventCardTapsCard } from '../components/event-detail/EventCardTapsCard';

const tap = {
  id: 'tap-1',
  tappedAt: '2026-10-20T14:00:00Z',
  outcome: 'checked_in',
  source: 'station',
  userId: 'u-1',
  memberName: 'Dana Ruiz',
  targetName: 'Monthly Drill',
};

describe('EventCardCheckinsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected.mockReset();
    mockIsConnected.mockReturnValue(true);
    mockListEventTaps.mockReset();
    mockListEventTaps.mockResolvedValue({ items: [tap], total: 1, limit: 50, offset: 0 });
  });

  it('lists taps across events and filters by outcome', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventCardCheckinsTab />);
    expect(await screen.findByText('Monthly Drill')).toBeInTheDocument();
    expect(screen.getByText('Dana Ruiz')).toBeInTheDocument();
    expect(mockListEventTaps).toHaveBeenCalledWith(undefined, expect.objectContaining({ outcome: undefined }), 50, 0);

    await user.selectOptions(screen.getByLabelText('Outcome'), 'unknown_card');
    await waitFor(() =>
      expect(mockListEventTaps).toHaveBeenLastCalledWith(
        undefined,
        expect.objectContaining({ outcome: 'unknown_card' }),
        50,
        0
      )
    );
  });

  it('says new taps are not being recorded while cards are off', async () => {
    mockIsConnected.mockReturnValue(false);
    renderWithRouter(<EventCardCheckinsTab />);
    expect(await screen.findByText(/no new taps are being recorded/)).toBeInTheDocument();
  });
});

describe('EventCardTapsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEventTaps.mockReset();
    mockListEventTaps.mockResolvedValue({ items: [tap], total: 1, limit: 25, offset: 0 });
  });

  it('lists this event’s taps by name', async () => {
    renderWithRouter(<EventCardTapsCard eventId="evt-1" tz="America/New_York" cardsEnabled />);
    expect(await screen.findByText('Dana Ruiz')).toBeInTheDocument();
    expect(mockListEventTaps).toHaveBeenCalledWith('evt-1', {}, 25, 0);
  });

  it('renders nothing for a department without cards and an event without taps', async () => {
    mockListEventTaps.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderWithRouter(<EventCardTapsCard eventId="evt-1" tz="America/New_York" cardsEnabled={false} />);
    await waitFor(() => expect(mockListEventTaps).toHaveBeenCalledWith('evt-1', {}, 25, 0));
    await waitFor(() => expect(screen.queryByText('Card taps')).not.toBeInTheDocument());
  });

  it('keeps an empty section while cards are on, so a manager knows where taps will appear', async () => {
    mockListEventTaps.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderWithRouter(<EventCardTapsCard eventId="evt-1" tz="America/New_York" cardsEnabled />);
    expect(await screen.findByText(/No ID card has been tapped for this event yet/)).toBeInTheDocument();
  });
});
