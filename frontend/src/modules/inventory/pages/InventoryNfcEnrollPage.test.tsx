import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { InventoryNfcEnrollPage } from './InventoryNfcEnrollPage';

type Tag = { serialNumber: string; payload: string | null };

const { service, scanner, writer } = vi.hoisted(() => ({
  service: { getNfcSettings: vi.fn(), getUntaggedItems: vi.fn(), linkItemNfcTag: vi.fn() },
  scanner: { onTag: null as ((tag: Tag) => void) | null, start: vi.fn(), stop: vi.fn() },
  writer: { supported: true, writeUrl: vi.fn(), cancel: vi.fn() },
}));

vi.mock('../../../services/api', () => ({ inventoryService: service }));
vi.mock('../../../components/ux', () => ({ Breadcrumbs: () => null }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: Tag) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: true,
      unavailableReason: null,
      scanning: true,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));
vi.mock('../../../hooks/useNfcWriter', () => ({
  useNfcWriter: () => ({
    supported: writer.supported,
    unavailableReason: null,
    status: 'idle',
    error: null,
    writeUrl: writer.writeUrl,
    writeText: vi.fn(),
    cancel: writer.cancel,
    reset: vi.fn(),
  }),
}));

const ITEMS = [
  {
    id: 'item-1',
    name: 'Helmet',
    serial_number: 'H-1',
    asset_tag: null,
    category_name: 'PPE',
    storage_area_name: null,
  },
  {
    id: 'item-2',
    name: 'Radio',
    serial_number: null,
    asset_tag: 'A-2',
    category_name: null,
    storage_area_name: 'Shelf A',
  },
];

async function tap(serial: string) {
  await act(async () => {
    scanner.onTag?.({ serialNumber: serial, payload: null });
    await Promise.resolve();
  });
}

describe('InventoryNfcEnrollPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writer.supported = true;
    service.getNfcSettings.mockReset();
    service.getNfcSettings.mockResolvedValue({ enabled: true });
    service.getUntaggedItems.mockReset();
    service.getUntaggedItems.mockResolvedValue({ items: ITEMS, total: 2 });
    service.linkItemNfcTag.mockReset();
    service.linkItemNfcTag.mockResolvedValue({});
    writer.writeUrl.mockReset();
    writer.writeUrl.mockResolvedValue(true);
    scanner.onTag = null;
  });

  it('writes a link to the current item, then moves to the next', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcEnrollPage />);
    await user.click(await screen.findByRole('button', { name: 'Write a tag for Helmet' }));
    await waitFor(() => expect(service.linkItemNfcTag).toHaveBeenCalledTimes(1));
    const [itemId, payload] = service.linkItemNfcTag.mock.calls[0] as [
      string,
      { tag_uid: string; credential_type: string },
    ];
    expect(itemId).toBe('item-1');
    expect(payload.credential_type).toBe('written');
    // The code written is the code linked.
    expect(writer.writeUrl).toHaveBeenCalledWith(expect.stringContaining(`/inventory/tag/${payload.tag_uid}`));
    expect(await screen.findByRole('button', { name: 'Write a tag for Radio' })).toBeInTheDocument();
    expect(screen.getByText(/1 tagged this session/)).toBeInTheDocument();
  });

  it('does not link when the write did not land', async () => {
    const user = userEvent.setup();
    writer.writeUrl.mockResolvedValue(false);
    renderWithRouter(<InventoryNfcEnrollPage />);
    await user.click(await screen.findByRole('button', { name: 'Write a tag for Helmet' }));
    await waitFor(() => expect(writer.writeUrl).toHaveBeenCalled());
    expect(service.linkItemNfcTag).not.toHaveBeenCalled();
  });

  it('reads serials in turn, ignoring the same tag read twice', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcEnrollPage />);
    await user.click(await screen.findByRole('button', { name: /Read serials/ }));
    await tap('04:A2:24:5B');
    await waitFor(() => expect(service.linkItemNfcTag).toHaveBeenCalledTimes(1));
    await tap('04:A2:24:5B');
    await tap('04:99:88:77');
    await waitFor(() => expect(service.linkItemNfcTag).toHaveBeenCalledTimes(2));
    expect(service.linkItemNfcTag).toHaveBeenNthCalledWith(1, 'item-1', {
      tag_uid: '04A2245B',
      credential_type: 'serial',
    });
    expect(service.linkItemNfcTag).toHaveBeenNthCalledWith(2, 'item-2', {
      tag_uid: '04998877',
      credential_type: 'serial',
    });
    expect(await screen.findByText('End of the list.')).toBeInTheDocument();
  });

  it('stays on the item when the link is refused, and says why', async () => {
    const user = userEvent.setup();
    service.linkItemNfcTag.mockRejectedValue(new Error('This tag is already linked to "Radio".'));
    renderWithRouter(<InventoryNfcEnrollPage />);
    await user.type(await screen.findByLabelText('Tag serial number'), '04A2245B');
    await user.click(screen.getByRole('button', { name: 'Link serial' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already linked/);
    expect(screen.getByText('Helmet')).toBeInTheDocument();
  });

  it('can skip an item', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcEnrollPage />);
    await user.click(await screen.findByRole('button', { name: /Skip this item/ }));
    expect(await screen.findByText('Radio')).toBeInTheDocument();
    expect(service.linkItemNfcTag).not.toHaveBeenCalled();
  });

  it('searches the untagged list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryNfcEnrollPage />);
    await screen.findByText('Helmet');
    await user.type(screen.getByLabelText('Which items'), 'rad');
    await user.click(screen.getByRole('button', { name: /Find items/ }));
    await waitFor(() => expect(service.getUntaggedItems).toHaveBeenLastCalledWith({ search: 'rad', limit: 200 }));
  });
});
