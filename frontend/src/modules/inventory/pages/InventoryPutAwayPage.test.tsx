import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryPutAwayPage } from './InventoryPutAwayPage';

type Tag = { serialNumber: string; payload: string | null };

const { getNfcSettings, getStorageAreas, resolveAnyNfcTag, putAwayItem, scanner } = vi.hoisted(() => ({
  getNfcSettings: vi.fn(),
  getStorageAreas: vi.fn(),
  resolveAnyNfcTag: vi.fn(),
  putAwayItem: vi.fn(),
  scanner: { onTag: null as ((tag: Tag) => void) | null, start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../../services/api', () => ({
  inventoryService: { getNfcSettings, getStorageAreas, resolveAnyNfcTag, putAwayItem },
}));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: true,
      unavailableReason: null,
      scanning: false,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));

const SHELF = { id: 'area-1', name: 'Shelf B', label: null, location_id: null };
const tagFor = (serial: string): Tag => ({ serialNumber: serial, payload: null });

/** The server's answer for each serial the tests tap. */
const RESOLVES: Record<string, unknown> = {
  SHELF1: { kind: 'storage_area', tag_id: 't-s', tag_uid_preview: 'ELF1', item: null, storage_area: SHELF },
  ITEM1: {
    kind: 'item',
    tag_id: 't-1',
    tag_uid_preview: 'TEM1',
    item: { id: 'item-1', name: 'Helmet' },
    storage_area: null,
  },
  ITEM2: {
    kind: 'item',
    tag_id: 't-2',
    tag_uid_preview: 'TEM2',
    item: { id: 'item-2', name: 'Radio' },
    storage_area: null,
  },
};

async function tap(serial: string) {
  await act(async () => {
    scanner.onTag?.(tagFor(serial));
    await Promise.resolve();
  });
}

describe('InventoryPutAwayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/inventory/put-away');
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: true });
    getStorageAreas.mockReset();
    getStorageAreas.mockResolvedValue([
      { ...SHELF, is_active: true, location_name: 'Bay 1' },
      { id: 'area-9', name: 'Retired shelf', is_active: false },
    ]);
    resolveAnyNfcTag.mockReset();
    resolveAnyNfcTag.mockImplementation((body: { serial_number?: string }) =>
      Promise.resolve(RESOLVES[body.serial_number ?? ''])
    );
    putAwayItem.mockReset();
    putAwayItem.mockImplementation((body: { item_id: string }) =>
      Promise.resolve({
        item_id: body.item_id,
        item_name: body.item_id === 'item-1' ? 'Helmet' : 'Radio',
        storage_area_id: 'area-1',
        storage_area_name: 'Shelf B',
        from_storage_area_id: null,
        from_storage_area_name: null,
        moved: true,
      })
    );
    scanner.onTag = null;
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('says so when NFC tracking is off', async () => {
    getNfcSettings.mockResolvedValue({ enabled: false });
    renderWithRouter(<InventoryPutAwayPage />);
    expect(await screen.findByText(/NFC tag tracking is turned off/)).toBeInTheDocument();
  });

  it('shelf first: every item tapped afterwards goes onto that shelf', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByText(/No shelf open/);
    await tap('SHELF1');
    expect(await screen.findByText('Shelf B', { selector: 'strong' })).toBeInTheDocument();
    await tap('ITEM1');
    await tap('ITEM2');
    await waitFor(() => expect(putAwayItem).toHaveBeenCalledTimes(2));
    expect(putAwayItem).toHaveBeenNthCalledWith(1, {
      item_id: 'item-1',
      storage_area_id: 'area-1',
      item_tag_id: 't-1',
    });
    expect(putAwayItem).toHaveBeenNthCalledWith(2, {
      item_id: 'item-2',
      storage_area_id: 'area-1',
      item_tag_id: 't-2',
    });
  });

  it('asks the server not to log a lookup beside the move', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByText(/No shelf open/);
    await tap('ITEM1');
    await waitFor(() => expect(resolveAnyNfcTag).toHaveBeenCalledWith(expect.objectContaining({ record: false })));
  });

  it('item first: a one-off move that leaves no shelf open', async () => {
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByText(/No shelf open/);
    await tap('ITEM1');
    expect(await screen.findByText(/now tap the shelf it goes on/)).toBeInTheDocument();
    await tap('SHELF1');
    await waitFor(() =>
      expect(putAwayItem).toHaveBeenCalledWith({ item_id: 'item-1', storage_area_id: 'area-1', item_tag_id: 't-1' })
    );
    expect(screen.getByText(/No shelf open/)).toBeInTheDocument();

    // The next item waits for its own shelf rather than following the last one.
    await tap('ITEM2');
    expect(await screen.findByText(/now tap the shelf it goes on/)).toBeInTheDocument();
    expect(putAwayItem).toHaveBeenCalledTimes(1);
  });

  it('offers only active shelves to pick, and picking one opens it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryPutAwayPage />);
    const select = await screen.findByLabelText('Or pick a shelf');
    expect(await screen.findByRole('option', { name: 'Shelf B (Bay 1)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Retired shelf/ })).not.toBeInTheDocument();
    await user.selectOptions(select, 'area-1');
    expect(await screen.findByText('Shelf B', { selector: 'strong' })).toBeInTheDocument();
  });

  it('opens the shelf named in the link a shelf tag carries', async () => {
    window.history.pushState({}, '', '/inventory/put-away?area=area-1');
    renderWithRouter(<InventoryPutAwayPage />);
    expect(await screen.findByText('Shelf B', { selector: 'strong' })).toBeInTheDocument();
  });

  it('shows the server’s reason when an item cannot be put away', async () => {
    putAwayItem.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: {
          status: 400,
          data: { detail: '"Helmet" is issued to a member. Return it before putting it away.' },
        },
      })
    );
    renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByText(/No shelf open/);
    await tap('SHELF1');
    await tap('ITEM1');
    expect(await screen.findByRole('alert')).toHaveTextContent('issued to a member');
  });

  it('disarms the reader on leaving the page', async () => {
    const { unmount } = renderWithRouter(<InventoryPutAwayPage />);
    await screen.findByText(/No shelf open/);
    scanner.stop.mockClear();
    unmount();
    expect(scanner.stop).toHaveBeenCalled();
  });
});
