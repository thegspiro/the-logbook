import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HeldOfflineItem } from '../utils/offlineQueueQuarantine';

const { mockList, mockSend, mockDiscard, mockDrain, mockRefresh } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockSend: vi.fn(),
  mockDiscard: vi.fn(),
  mockDrain: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('../utils/offlineQueueQuarantine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/offlineQueueQuarantine')>();
  return {
    HELD_ITEM_KIND_LABELS: actual.HELD_ITEM_KIND_LABELS,
    listHeldOfflineItems: () => mockList() as Promise<HeldOfflineItem[]>,
    sendHeldItemsAsMe: (...a: unknown[]) => mockSend(...a) as Promise<number>,
    discardHeldItems: (...a: unknown[]) => mockDiscard(...a) as Promise<void>,
  };
});
vi.mock('../hooks/useOfflineSyncEngine', () => ({
  triggerOfflineDrain: () => mockDrain() as Promise<void>,
}));
vi.mock('../stores/authStore', () => {
  const state = { user: { id: 'member-b', username: 'druiz', first_name: 'Dana', last_name: 'Ruiz' } };
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { usePendingSyncStore } from '../stores/pendingSyncStore';
import { renderWithRouter } from '../test/utils';
import { HeldOfflineItemsNotice } from './HeldOfflineItemsNotice';

const held: HeldOfflineItem[] = [
  { queue: 'check', id: 'q-1', kind: 'equipment-check', queuedAt: 1 },
  { queue: 'check', id: 'q-2', kind: 'equipment-check', queuedAt: 2 },
  { queue: 'generic', id: 'g-1', kind: 'event-rsvp', queuedAt: 3 },
];

describe('HeldOfflineItemsNotice', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockSend.mockReset();
    mockDiscard.mockReset();
    mockDrain.mockReset();
    mockRefresh.mockReset();
    mockList.mockResolvedValue(held);
    mockSend.mockResolvedValue(3);
    mockDiscard.mockResolvedValue(undefined);
    mockDrain.mockResolvedValue(undefined);
    mockRefresh.mockResolvedValue(undefined);
    usePendingSyncStore.setState({ heldCount: held.length, refresh: mockRefresh });
  });

  it('renders nothing while nothing is held', () => {
    usePendingSyncStore.setState({ heldCount: 0 });

    const { container } = renderWithRouter(<HeldOfflineItemsNotice />);

    expect(container).toBeEmptyDOMElement();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('says how many items are held and of what kind, without their contents', async () => {
    renderWithRouter(<HeldOfflineItemsNotice />);

    expect(await screen.findByRole('heading', { name: '3 offline items are on hold' })).toBeInTheDocument();
    expect(screen.getByText(/2 equipment checks, 1 event RSVP/)).toBeInTheDocument();
  });

  it('sends the held items as the signed-in member only once they confirm the consequence', async () => {
    renderWithRouter(<HeldOfflineItemsNotice />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send as me' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/sent under your name, Dana Ruiz/)).toBeInTheDocument();
    expect(within(dialog).getByText(/their work will be recorded as yours/)).toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Send as me' }));

    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(held));
    await waitFor(() => expect(mockDrain).toHaveBeenCalled());
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('keeps the items on hold when the member backs out', async () => {
    renderWithRouter(<HeldOfflineItemsNotice />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send as me' }));

    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep on hold' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('discards the held items once the member confirms', async () => {
    renderWithRouter(<HeldOfflineItemsNotice />);
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deleted from this device and never sent/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith(held));
    expect(mockSend).not.toHaveBeenCalled();
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
