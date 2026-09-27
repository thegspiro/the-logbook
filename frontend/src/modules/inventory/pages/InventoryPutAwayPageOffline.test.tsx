/**
 * Put Away by NFC without signal: taps are kept as raw reads in one held
 * session, in order, and sent when signal returns. The online behaviour is
 * in InventoryPutAwayPage.test.tsx.
 */

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { GenericQueuedItem } from '../../../utils/genericOfflineQueue';
import type { InventoryNfcPutAwayReplayRequest } from '../types/nfc';

type Tag = { serialNumber: string; payload: string | null };

const { getNfcSettings, getStorageAreas, resolveAnyNfcTag, putAwayItem, scanner, net, queue, drain } = vi.hoisted(
  () => ({
    getNfcSettings: vi.fn(),
    getStorageAreas: vi.fn(),
    resolveAnyNfcTag: vi.fn(),
    putAwayItem: vi.fn(),
    scanner: { onTag: null as ((tag: Tag) => void) | null },
    net: { online: true, listeners: new Set<(online: boolean) => void>() },
    queue: new Map<string, GenericQueuedItem>(),
    drain: vi.fn(),
  })
);

vi.mock('../../../services/api', () => ({
  inventoryService: { getNfcSettings, getStorageAreas, resolveAnyNfcTag, putAwayItem },
}));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return { supported: true, unavailableReason: null, scanning: false, error: null, start: vi.fn(), stop: vi.fn() };
  },
}));
vi.mock('../../../utils/genericOfflineQueue', () => ({
  getGenericItem: (id: string) => Promise.resolve(queue.get(id) ?? null),
  putGenericItem: (item: GenericQueuedItem) => {
    queue.set(item.id, structuredClone(item));
    return Promise.resolve();
  },
}));
vi.mock('../../../hooks/useOfflineSyncEngine', () => ({
  triggerOfflineDrain: () => drain() as Promise<void>,
}));
vi.mock('../../../stores/pendingSyncStore', () => ({
  usePendingSyncStore: { getState: () => ({ refresh: vi.fn() }) },
}));
vi.mock('../../../hooks/useOnlineStatus', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useOnlineStatus: () => {
      const [online, setOnline] = useState(net.online);
      useEffect(() => {
        net.listeners.add(setOnline);
        return () => {
          net.listeners.delete(setOnline);
        };
      }, []);
      return online;
    },
  };
});

import { InventoryPutAwayPage } from './InventoryPutAwayPage';

const SHELF = { id: 'area-1', name: 'Shelf B', label: null, location_id: null };
const HELMET = { kind: 'item', tag_id: 't-1', tag_uid_preview: 'TEM1', item: { id: 'item-1', name: 'Helmet' } };

async function tap(serial: string) {
  await act(async () => {
    scanner.onTag?.({ serialNumber: serial, payload: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setOnline(online: boolean) {
  net.online = online;
  await act(async () => {
    net.listeners.forEach((listener) => listener(online));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function pickShelf(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: 'Shelf B' });
  await user.selectOptions(screen.getByLabelText('Or pick a shelf'), 'area-1');
  expect(await screen.findByText(/Items tapped now go on/)).toBeInTheDocument();
}

const sessions = () => [...queue.values()].filter((item) => item.kind === 'nfc-put-away');
const bodyOf = (item: GenericQueuedItem | undefined) => item?.body as InventoryNfcPutAwayReplayRequest;

describe('InventoryPutAwayPage without signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue.clear();
    net.online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => net.online);
    window.history.pushState({}, '', '/inventory/put-away');
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: true });
    getStorageAreas.mockReset();
    getStorageAreas.mockResolvedValue([{ ...SHELF, is_active: true, location_name: null }]);
    resolveAnyNfcTag.mockReset();
    resolveAnyNfcTag.mockResolvedValue(HELMET);
    putAwayItem.mockReset();
    putAwayItem.mockResolvedValue({
      item_id: 'item-1',
      item_name: 'Helmet',
      storage_area_id: 'area-1',
      storage_area_name: 'Shelf B',
      from_storage_area_id: null,
      from_storage_area_name: null,
      moved: true,
    });
    // By default the sync engine sends whatever is not held.
    drain.mockReset();
    drain.mockImplementation(() => {
      for (const [id, item] of queue) if (!item.held) queue.delete(id);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps offline taps as raw reads in one held session, starting from the open shelf', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryPutAwayPage />);
    await pickShelf(user);

    await setOnline(false);
    await tap('04A1');
    await tap('04B2');

    expect(resolveAnyNfcTag).not.toHaveBeenCalled();
    expect(sessions()).toHaveLength(1);
    const session = sessions()[0];
    expect(session?.held).toBe(true);
    expect(bodyOf(session)).toEqual({
      open_storage_area_id: 'area-1',
      held_item_id: undefined,
      held_item_tag_id: undefined,
      taps: [
        { code: undefined, serial_number: '04A1' },
        { code: undefined, serial_number: '04B2' },
      ],
    });
    expect(screen.getByText(/2 taps saved on this phone/)).toBeInTheDocument();
    // Closing the shelf is not a tap, so it cannot be carried offline.
    expect(screen.queryByRole('button', { name: 'Close shelf' })).not.toBeInTheDocument();
  });

  it('sends the session when signal returns and closes the shelf', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByLabelText('Or pick a shelf');
    await setOnline(false);
    await tap('04A1');

    await setOnline(true);

    await waitFor(() => expect(sessions()).toHaveLength(0));
    expect(drain).toHaveBeenCalled();
    expect(await screen.findByText(/offline taps have been sent/)).toBeInTheDocument();
    expect(screen.getByText(/No shelf open/)).toBeInTheDocument();
  });

  it('starts a session from before a tap that lost signal mid-request', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryPutAwayPage />);
    await pickShelf(user);
    resolveAnyNfcTag.mockRejectedValueOnce({ request: {}, message: 'Network Error' });

    await tap('04A1');

    expect(putAwayItem).not.toHaveBeenCalled();
    expect(bodyOf(sessions()[0])).toMatchObject({
      open_storage_area_id: 'area-1',
      taps: [{ serial_number: '04A1' }],
    });
    // The browser still thinks it is online, so sending is offered by hand.
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
  });

  it('never lets a later tap reach the server before unsent offline taps', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByLabelText('Or pick a shelf');
    await setOnline(false);
    await tap('04A1');

    // Signal returns but the send does not get through.
    drain.mockImplementation(() => Promise.resolve());
    await setOnline(true);
    await tap('04B2');

    expect(resolveAnyNfcTag).not.toHaveBeenCalled();
    const [first, second] = sessions().sort((a, b) => a.queuedAt - b.queuedAt);
    expect(first?.held).toBe(false);
    expect(bodyOf(first).taps).toEqual([{ code: undefined, serial_number: '04A1' }]);
    // The new session cannot know what the first left open, so starts closed.
    expect(bodyOf(second)).toMatchObject({ open_storage_area_id: undefined, taps: [{ serial_number: '04B2' }] });
  });

  it('goes back to tapping online once the offline taps are sent', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByLabelText('Or pick a shelf');
    await setOnline(false);
    await tap('04A1');
    await setOnline(true);
    await waitFor(() => expect(sessions()).toHaveLength(0));

    await tap('04B2');

    expect(resolveAnyNfcTag).toHaveBeenCalledTimes(1);
    expect(sessions()).toHaveLength(0);
  });
});
