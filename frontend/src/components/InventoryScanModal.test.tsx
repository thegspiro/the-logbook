import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryScanModal } from './InventoryScanModal';

const { lookupByCode, distributeItems, transferItem, getNfcSettings, resolveNfcTag, nfcScanner } = vi.hoisted(() => ({
  lookupByCode: vi.fn(),
  distributeItems: vi.fn(),
  transferItem: vi.fn(),
  getNfcSettings: vi.fn(),
  resolveNfcTag: vi.fn(),
  // What the modal handed useNfcScanner, so a test can play a tap through it.
  nfcScanner: {
    onTag: null as ((tag: { serialNumber: string; payload: string | null }) => void) | null,
    supported: true,
    start: vi.fn(),
    stop: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({
  inventoryService: { lookupByCode, distributeItems, transferItem, getNfcSettings, resolveNfcTag },
}));
vi.mock('../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: { serialNumber: string; payload: string | null }) => void }) => {
    nfcScanner.onTag = options.onTag ?? null;
    return {
      supported: nfcScanner.supported,
      unavailableReason: null,
      scanning: false,
      error: null,
      start: nfcScanner.start,
      stop: nfcScanner.stop,
    };
  },
}));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: object) => unknown) => selector({ checkPermission: () => true }),
}));

/** First element of a query result, asserted present. Keeps the guard out of
 *  the test body (vitest/no-conditional-in-test) and avoids indexing into a
 *  possibly-undefined slot (noUncheckedIndexedAccess). */
function firstOf(elements: HTMLElement[]): HTMLElement {
  const [head] = elements;
  if (!head) throw new Error('expected at least one matching element');
  return head;
}

describe('InventoryScanModal custody conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: false });
  });

  it('blocks silent reassignment and requires explicit transfer confirmation', async () => {
    lookupByCode.mockResolvedValue({
      total: 1,
      results: [
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-1',
          item: { id: 'item-1', name: 'Helmet', status: 'assigned', tracking_type: 'individual' },
        },
      ],
    });
    distributeItems.mockResolvedValue({
      user_id: 'new-member',
      total_scanned: 1,
      successful: 0,
      failed: 1,
      results: [
        {
          code: 'HELMET-1',
          item_id: 'item-1',
          item_name: 'Helmet',
          action: 'none',
          success: false,
          error: 'Item is not available',
          conflict: {
            holder_id: 'old-member',
            holder_name: 'Alex Holder',
            holding_type: 'assignment',
            record_id: 'holding-1',
            held_since: '2026-08-01T12:00:00Z',
          },
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <InventoryScanModal isOpen onClose={vi.fn()} mode="distribute" userId="new-member" memberName="New Member" />
    );
    const input = screen.getByPlaceholderText(/Search by name/);
    await user.type(input, 'HELMET-1');
    await waitFor(() => expect(lookupByCode).toHaveBeenCalled());
    await user.click(await screen.findByText('Helmet'));
    // #1885 made the operation explicit; the review step stays disabled until
    // one is chosen, so the conflict path is unreachable without it.
    await user.click(screen.getByRole('radio', { name: 'Ongoing assignment' }));
    await user.click(screen.getByRole('button', { name: /Review 1 Item/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/standard assignment was blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Alex Holder/)).toBeInTheDocument();
    expect(transferItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Transfer item' }));
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });

  it('clears the holder attestation between two conflicting items', async () => {
    const conflictResult = (id: string, name: string, holder: string) => ({
      code: id,
      item_id: id,
      item_name: name,
      action: 'none',
      success: false,
      error: 'Item is not available',
      conflict: {
        holder_id: `${id}-holder`,
        holder_name: holder,
        holding_type: 'assignment',
        record_id: `holding-${id}`,
        held_since: '2026-08-01T12:00:00Z',
      },
    });
    lookupByCode.mockResolvedValue({
      total: 2,
      results: [
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-1',
          item: { id: 'item-1', name: 'Helmet', status: 'assigned', tracking_type: 'individual' },
        },
        {
          matched_field: 'barcode',
          matched_value: 'HELMET-2',
          item: { id: 'item-2', name: 'Spare Helmet', status: 'assigned', tracking_type: 'individual' },
        },
      ],
    });
    distributeItems.mockResolvedValue({
      user_id: 'new-member',
      total_scanned: 2,
      successful: 0,
      failed: 2,
      results: [
        conflictResult('item-1', 'Helmet', 'Dana Reyes'),
        conflictResult('item-2', 'Spare Helmet', 'Chris Baker'),
      ],
    });
    transferItem.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(
      <InventoryScanModal isOpen onClose={vi.fn()} mode="distribute" userId="new-member" memberName="New Member" />
    );
    await user.type(screen.getByPlaceholderText(/Search by name/), 'HELMET');
    await waitFor(() => expect(lookupByCode).toHaveBeenCalled());
    await user.click(await screen.findByText('Helmet'));
    await user.click(screen.getByRole('radio', { name: 'Ongoing assignment' }));
    await user.click(screen.getByRole('button', { name: /Review/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Transfer the first conflicting item, attesting to ITS holder.
    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Transfer item' })));
    // Scoped to the checkbox's own label: the holder name also appears in the
    // results list behind the dialog.
    await user.click(screen.getByRole('checkbox', { name: /Dana Reyes/ }));
    await user.type(screen.getByRole('textbox', { name: /Transfer reason/ }), 'Reassigned to new member');
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    await waitFor(() => expect(transferItem).toHaveBeenCalledTimes(1));

    // Now the SECOND item, whose holder the quartermaster has not yet seen.
    // Carrying the tick and reason over would present an attestation about
    // Chris Baker already agreed to, one click from being filed.
    // The transferred row loses its conflict, so only the second item's button
    // remains.
    await user.click(firstOf(await screen.findAllByRole('button', { name: 'Transfer item' })));
    expect(screen.getByRole('checkbox', { name: /Chris Baker/ })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /Transfer reason/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });
});

describe('InventoryScanModal NFC tags', () => {
  const helmet = {
    matched_field: 'nfc_tag',
    matched_value: 'NFC tag …1180',
    item: { id: 'item-1', name: 'Helmet', status: 'available', tracking_type: 'individual' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getNfcSettings.mockReset();
    getNfcSettings.mockResolvedValue({ enabled: true });
    resolveNfcTag.mockReset();
    resolveNfcTag.mockResolvedValue(helmet);
    nfcScanner.supported = true;
    nfcScanner.onTag = null;
  });

  const renderModal = () =>
    render(<InventoryScanModal isOpen onClose={vi.fn()} mode="distribute" userId="m-1" memberName="Member One" />);

  it('offers Tap NFC only once the organization has it switched on', async () => {
    getNfcSettings.mockResolvedValue({ enabled: false });
    renderModal();
    await waitFor(() => expect(getNfcSettings).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Tap NFC/ })).not.toBeInTheDocument();
  });

  it('hides Tap NFC on a browser without Web NFC even when switched on', async () => {
    nfcScanner.supported = false;
    renderModal();
    await waitFor(() => expect(getNfcSettings).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Tap NFC/ })).not.toBeInTheDocument();
  });

  it('starts the reader from the click', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: /Tap NFC/ }));
    expect(nfcScanner.start).toHaveBeenCalled();
  });

  it('adds the tapped item, resolving the written code before the serial', async () => {
    renderModal();
    await screen.findByRole('button', { name: /Tap NFC/ });
    nfcScanner.onTag?.({
      serialNumber: '04:a2:24:5b:7c:11:80',
      payload: `${window.location.origin}/inventory/tag/INVTABC123`,
    });
    expect(await screen.findByText('Helmet')).toBeInTheDocument();
    // Separators stripped; case is left to the server, which normalizes it.
    expect(resolveNfcTag).toHaveBeenCalledWith({ code: 'INVTABC123', serial_number: '04a2245b7c1180' });
    // Exact match only — never the partial barcode search.
    expect(lookupByCode).not.toHaveBeenCalled();
  });

  it("sends only the serial for a tag carrying someone else's link", async () => {
    renderModal();
    await screen.findByRole('button', { name: /Tap NFC/ });
    nfcScanner.onTag?.({ serialNumber: '04a2245b', payload: 'https://evil.example.com/inventory/tag/INVTABC123' });
    await waitFor(() => expect(resolveNfcTag).toHaveBeenCalledWith({ code: undefined, serial_number: '04a2245b' }));
  });

  it('shows why a tag found nothing', async () => {
    resolveNfcTag.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 404, data: { detail: 'This tag is not linked to any item.' } },
      })
    );
    renderModal();
    await screen.findByRole('button', { name: /Tap NFC/ });
    nfcScanner.onTag?.({ serialNumber: '04a2245b', payload: null });
    expect(await screen.findByText('This tag is not linked to any item.')).toBeInTheDocument();
  });

  it('disarms the reader when the dialog closes', async () => {
    const { rerender } = renderModal();
    await screen.findByRole('button', { name: /Tap NFC/ });
    nfcScanner.stop.mockClear();
    rerender(
      <InventoryScanModal isOpen={false} onClose={vi.fn()} mode="distribute" userId="m-1" memberName="Member One" />
    );
    expect(nfcScanner.stop).toHaveBeenCalled();
  });
});
