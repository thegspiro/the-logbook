import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { NfcTagsCard } from './NfcTagsCard';

const {
  getItemNfcTags,
  linkItemNfcTag,
  getStorageAreaNfcTags,
  linkStorageAreaNfcTag,
  updateNfcTag,
  unlinkNfcTag,
  scanner,
  writer,
} = vi.hoisted(() => ({
  getItemNfcTags: vi.fn(),
  linkItemNfcTag: vi.fn(),
  getStorageAreaNfcTags: vi.fn(),
  linkStorageAreaNfcTag: vi.fn(),
  updateNfcTag: vi.fn(),
  unlinkNfcTag: vi.fn(),
  scanner: {
    onTag: null as ((tag: { serialNumber: string; payload: string | null }) => void) | null,
    supported: true,
    start: vi.fn(),
    stop: vi.fn(),
  },
  writer: { writeUrl: vi.fn(), cancel: vi.fn() },
}));

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItemNfcTags,
    linkItemNfcTag,
    getStorageAreaNfcTags,
    linkStorageAreaNfcTag,
    updateNfcTag,
    unlinkNfcTag,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: { serialNumber: string; payload: string | null }) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: scanner.supported,
      unavailableReason: null,
      scanning: false,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));
vi.mock('../../../hooks/useNfcWriter', () => ({
  useNfcWriter: () => ({
    supported: true,
    unavailableReason: null,
    status: 'idle',
    error: null,
    writeUrl: writer.writeUrl,
    writeText: vi.fn(),
    cancel: writer.cancel,
    reset: vi.fn(),
  }),
}));

const TAG = {
  id: 'tag-1',
  item_id: 'item-1',
  uid_preview: '1180',
  credential_type: 'serial',
  label: 'Left cuff',
  status: 'active',
  linked_by: 'u-1',
  linked_by_name: 'Pat Quartermaster',
  linked_at: '2026-09-20T12:00:00Z',
};

const renderCard = () => renderWithRouter(<NfcTagsCard targetKind="item" targetId="item-1" targetName="Helmet 12" />);

describe('NfcTagsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getItemNfcTags.mockReset();
    getItemNfcTags.mockResolvedValue({ items: [TAG], total: 1 });
    linkItemNfcTag.mockReset();
    linkItemNfcTag.mockResolvedValue(TAG);
    updateNfcTag.mockReset();
    updateNfcTag.mockResolvedValue(TAG);
    unlinkNfcTag.mockReset();
    unlinkNfcTag.mockResolvedValue(undefined);
    writer.writeUrl.mockReset();
    writer.writeUrl.mockResolvedValue(true);
    scanner.supported = true;
    scanner.onTag = null;
  });

  it('lists the linked tags without the identifier itself', async () => {
    renderCard();
    expect(await screen.findByText('Left cuff')).toBeInTheDocument();
    expect(screen.getByText('…1180')).toBeInTheDocument();
    expect(screen.getByText(/by Pat Quartermaster/)).toBeInTheDocument();
  });

  it('links a typed serial, normalized, with the optional label', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText('Left cuff');
    await user.type(screen.getByLabelText(/Where the new tag is/), 'Chin strap');
    await user.type(screen.getByLabelText('Tag serial number'), '04:a2:24:5b');
    await user.click(screen.getByRole('button', { name: /Link serial/ }));
    await waitFor(() =>
      expect(linkItemNfcTag).toHaveBeenCalledWith('item-1', {
        tag_uid: '04A2245B',
        credential_type: 'serial',
        label: 'Chin strap',
      })
    );
  });

  it('omits a blank label rather than sending an empty string', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText('Left cuff');
    await user.type(screen.getByLabelText('Tag serial number'), '04a2245b');
    await user.click(screen.getByRole('button', { name: /Link serial/ }));
    await waitFor(() =>
      expect(linkItemNfcTag).toHaveBeenCalledWith('item-1', {
        tag_uid: '04A2245B',
        credential_type: 'serial',
        label: undefined,
      })
    );
  });

  it('writes a tag link first, and links the same code only after the write succeeds', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: /Write a link to a blank tag/ }));
    await waitFor(() => expect(linkItemNfcTag).toHaveBeenCalled());
    const [url] = writer.writeUrl.mock.calls[0] as [string];
    const code = url.split('/inventory/tag/')[1];
    expect(code).toMatch(/^INVT[0-9A-F]{32}$/);
    expect(linkItemNfcTag).toHaveBeenCalledWith('item-1', {
      tag_uid: code,
      credential_type: 'written',
      label: undefined,
    });
  });

  it('does not link anything when the write fails', async () => {
    writer.writeUrl.mockResolvedValue(false);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: /Write a link to a blank tag/ }));
    await waitFor(() => expect(writer.writeUrl).toHaveBeenCalled());
    expect(linkItemNfcTag).not.toHaveBeenCalled();
  });

  it('links a read serial and disarms the reader after one tag', async () => {
    renderCard();
    await screen.findByText('Left cuff');
    scanner.onTag?.({ serialNumber: '04:a2:24:5b:7c:11:80', payload: null });
    await waitFor(() =>
      expect(linkItemNfcTag).toHaveBeenCalledWith('item-1', {
        tag_uid: '04A2245B7C1180',
        credential_type: 'serial',
        label: undefined,
      })
    );
    expect(scanner.stop).toHaveBeenCalled();
  });

  it('shows the server’s reason when a tag is already linked elsewhere', async () => {
    linkItemNfcTag.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 400, data: { detail: 'This tag is already linked to "Radio 1".' } },
      })
    );
    const user = userEvent.setup();
    renderCard();
    await screen.findByText('Left cuff');
    await user.type(screen.getByLabelText('Tag serial number'), '04a2245b');
    await user.click(screen.getByRole('button', { name: /Link serial/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already linked to "Radio 1"');
  });

  it('marks a tag lost', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Mark lost' }));
    await waitFor(() => expect(updateNfcTag).toHaveBeenCalledWith('tag-1', { status: 'lost' }));
  });

  it('asks before unlinking, and keeps the tag when told to', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Unlink tag …1180' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(unlinkNfcTag).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Unlink tag …1180' }));
    await user.click(await screen.findByRole('button', { name: 'Unlink tag' }));
    await waitFor(() => expect(unlinkNfcTag).toHaveBeenCalledWith('tag-1'));
  });

  it('offers only the typed field on a device without Web NFC', async () => {
    scanner.supported = false;
    renderCard();
    await screen.findByText('Left cuff');
    expect(screen.queryByRole('button', { name: /Write a link/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tag serial number')).toBeInTheDocument();
  });
});

describe('NfcTagsCard on a storage area', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStorageAreaNfcTags.mockReset();
    getStorageAreaNfcTags.mockResolvedValue({
      items: [{ ...TAG, item_id: null, storage_area_id: 'area-1', label: 'Front edge' }],
      total: 1,
    });
    linkStorageAreaNfcTag.mockReset();
    linkStorageAreaNfcTag.mockResolvedValue(TAG);
    getItemNfcTags.mockReset();
    linkItemNfcTag.mockReset();
    writer.writeUrl.mockReset();
    writer.writeUrl.mockResolvedValue(true);
    scanner.supported = true;
  });

  const renderShelf = () =>
    renderWithRouter(<NfcTagsCard targetKind="storage_area" targetId="area-1" targetName="Shelf B" />);

  it('lists the shelf’s tags through the storage-area endpoint', async () => {
    renderShelf();
    expect(await screen.findByText('Front edge')).toBeInTheDocument();
    expect(getStorageAreaNfcTags).toHaveBeenCalledWith('area-1');
    expect(getItemNfcTags).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Where the new tag is on the storage area/)).toBeInTheDocument();
  });

  it('links a written tag to the shelf, not to an item', async () => {
    const user = userEvent.setup();
    renderShelf();
    await user.click(await screen.findByRole('button', { name: /Write a link to a blank tag/ }));
    await waitFor(() => expect(linkStorageAreaNfcTag).toHaveBeenCalled());
    expect(linkItemNfcTag).not.toHaveBeenCalled();
    expect(linkStorageAreaNfcTag).toHaveBeenCalledWith(
      'area-1',
      expect.objectContaining({ credential_type: 'written' })
    );
  });
});
