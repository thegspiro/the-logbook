/**
 * The Card Readers page.
 *
 * What each test protects:
 *  - the switch is offered only to whom the server will let flip it, and
 *    "turn on" is not offered while cards are off (turning off always is);
 *  - turning a reader on asks first, then calls the switch endpoint;
 *  - a room's taps load when opened, without member columns for a viewer the
 *    server will not name members to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { NfcReaderList } from '../modules/membership/types/idCard';

const mockListReaders = vi.fn();
const mockListRoomTaps = vi.fn();
const mockSetBadgeCheckIn = vi.fn();

vi.mock('../services/nfcActivityService', () => ({
  nfcActivityService: {
    listReaders: (...args: unknown[]) => mockListReaders(...args) as unknown,
    listRoomTaps: (...args: unknown[]) => mockListRoomTaps(...args) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  locationsService: {
    setBadgeCheckIn: (...args: unknown[]) => mockSetBadgeCheckIn(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CardReadersPage from './CardReadersPage';

const readers = (overrides: Partial<NfcReaderList> = {}): NfcReaderList => ({
  days: 7,
  cardsEnabled: true,
  canSwitch: true,
  canSeeMembers: false,
  items: [
    {
      locationId: 'room-1',
      name: 'Training Room',
      building: 'Station 1',
      readerEnabled: true,
      taps: 12,
      refusals: 2,
      lastTapAt: '2026-10-20T14:00:00Z',
    },
    { locationId: 'room-2', name: 'Bay', readerEnabled: false, taps: 0, refusals: 0, lastTapAt: null },
  ],
  ...overrides,
});

const renderPage = () => {
  window.history.pushState({}, '', '/locations/card-readers');
  return renderWithRouter(<CardReadersPage />);
};

describe('CardReadersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListReaders.mockReset();
    mockListReaders.mockResolvedValue(readers());
    mockListRoomTaps.mockReset();
    mockListRoomTaps.mockResolvedValue({
      items: [
        { id: 'tap-1', tappedAt: '2026-10-20T14:00:00Z', outcome: 'checked_in', source: 'kiosk', targetName: 'Drill' },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    mockSetBadgeCheckIn.mockReset();
    mockSetBadgeCheckIn.mockResolvedValue({ id: 'room-2', nfc_badge_check_in_enabled: true });
  });

  it('lists each room with its week of taps', async () => {
    renderPage();
    expect(await screen.findByText('Training Room · Station 1')).toBeInTheDocument();
    expect(screen.getByText(/12 taps · 2 refused/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 rooms have a reader turned on/)).toBeInTheDocument();
  });

  it('shows the state without a switch to someone who may not flip it', async () => {
    mockListReaders.mockResolvedValue(readers({ canSwitch: false }));
    renderPage();
    await screen.findByText('Bay');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Reader on')).toBeInTheDocument();
  });

  it('offers turning a reader off but not on while cards are turned off', async () => {
    mockListReaders.mockResolvedValue(readers({ cardsEnabled: false }));
    renderPage();
    await screen.findByText('Bay');
    expect(screen.getByRole('switch', { name: 'Badge check-in at Training Room' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Badge check-in at Bay' })).not.toBeInTheDocument();
    expect(screen.getByText(/NFC ID cards are turned off/)).toBeInTheDocument();
  });

  it('asks before turning a reader on, then switches it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Badge check-in at Bay' }));
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(mockSetBadgeCheckIn).toHaveBeenCalledWith('room-2', true));
    expect(screen.getByRole('switch', { name: 'Badge check-in at Bay' })).toHaveAttribute('aria-checked', 'true');
  });

  it('turns a reader off without asking', async () => {
    const user = userEvent.setup();
    mockSetBadgeCheckIn.mockResolvedValue({ id: 'room-1', nfc_badge_check_in_enabled: false });
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Badge check-in at Training Room' }));
    await waitFor(() => expect(mockSetBadgeCheckIn).toHaveBeenCalledWith('room-1', false));
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });

  it('loads a room’s taps without member columns for a viewer not shown members', async () => {
    const user = userEvent.setup();
    renderPage();
    const [firstToggle] = await screen.findAllByRole('button', { name: /Recent taps/ });
    await user.click(firstToggle as HTMLElement);
    await waitFor(() => expect(mockListRoomTaps).toHaveBeenCalledWith('room-1', {}, 25, 0));
    expect(await screen.findByText('Drill')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Member' })).not.toBeInTheDocument();
    expect(screen.getByText(/Who tapped is shown only to people who manage member ID cards/)).toBeInTheDocument();
  });

  it('adds member columns for a card administrator', async () => {
    const user = userEvent.setup();
    mockListReaders.mockResolvedValue(readers({ canSeeMembers: true }));
    renderPage();
    const [firstToggle] = await screen.findAllByRole('button', { name: /Recent taps/ });
    await user.click(firstToggle as HTMLElement);
    expect(await screen.findByRole('columnheader', { name: 'Member' })).toBeInTheDocument();
  });
});
