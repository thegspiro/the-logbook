import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import { CheckNfcTap } from './CheckNfcTap';
import { buildInventoryTagUrl, generateInventoryTagCode } from '../../../constants/nfc';
import type { InventoryNfcResolveCheckResponse } from '../types/nfc';

const { resolveCheckNfcTag, scanner } = vi.hoisted(() => ({
  resolveCheckNfcTag: vi.fn(),
  scanner: {
    onTag: null as ((tag: { serialNumber: string; payload: string | null }) => void) | null,
    supported: true,
    scanning: false,
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('../../../services/api', () => ({
  inventoryService: { resolveCheckNfcTag },
}));
vi.mock('../../../hooks/useNfcScanner', () => ({
  useNfcScanner: (options: { onTag?: (tag: { serialNumber: string; payload: string | null }) => void }) => {
    scanner.onTag = options.onTag ?? null;
    return {
      supported: scanner.supported,
      unavailableReason: null,
      scanning: scanner.scanning,
      error: null,
      start: scanner.start,
      stop: scanner.stop,
    };
  },
}));

const COMPARTMENT_TAP: InventoryNfcResolveCheckResponse = {
  kind: 'compartment',
  tag_id: 'tag-1',
  compartment_id: 'comp-1',
  compartment_name: 'Driver side 1',
  item_name: null,
  template_item_ids: [],
};

// Async so the queued resolve that a tap starts gets its first turn.
const tap = (serialNumber: string, payload: string | null = null) =>
  act(async () => {
    scanner.onTag?.({ serialNumber, payload });
    await Promise.resolve();
  });

describe('CheckNfcTap', () => {
  const onResolved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resolveCheckNfcTag.mockReset();
    resolveCheckNfcTag.mockResolvedValue(COMPARTMENT_TAP);
    onResolved.mockReset();
    onResolved.mockReturnValue('Driver side 1.');
    scanner.supported = true;
    scanner.scanning = false;
    scanner.onTag = null;
  });

  const renderTap = () => renderWithRouter(<CheckNfcTap templateId="tmpl-1" onResolved={onResolved} />);

  it('renders nothing where Web NFC is unavailable', () => {
    scanner.supported = false;
    renderTap();
    expect(screen.queryByRole('button', { name: /Tap NFC tags/ })).not.toBeInTheDocument();
  });

  it('arms the reader from the button', async () => {
    const user = userEvent.setup();
    renderTap();
    await user.click(screen.getByRole('button', { name: 'Tap NFC tags' }));
    expect(scanner.start).toHaveBeenCalled();
  });

  it('resolves a tap against this check’s template and shows what the form made of it', async () => {
    renderTap();
    await tap('04:a2:24:5b');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Driver side 1.'));
    expect(resolveCheckNfcTag).toHaveBeenCalledWith({
      template_id: 'tmpl-1',
      code: undefined,
      serial_number: '04a2245b',
    });
    expect(onResolved).toHaveBeenCalledWith(COMPARTMENT_TAP);
  });

  it('sends the written code when the tag carries one', async () => {
    const code = generateInventoryTagCode();
    renderTap();
    await tap('04a2245b', buildInventoryTagUrl(code));
    await waitFor(() =>
      expect(resolveCheckNfcTag).toHaveBeenCalledWith({
        template_id: 'tmpl-1',
        code,
        serial_number: '04a2245b',
      })
    );
  });

  it('shows the server’s reason for a refused tap', async () => {
    resolveCheckNfcTag.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { detail: 'Portable radio 7 is not on this checklist.' } },
    });
    renderTap();
    await tap('04a2245b');
    expect(await screen.findByRole('alert')).toHaveTextContent('Portable radio 7 is not on this checklist.');
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('resolves taps one at a time, in the order they were made', async () => {
    let releaseFirst: (value: InventoryNfcResolveCheckResponse) => void = () => undefined;
    resolveCheckNfcTag
      .mockImplementationOnce(
        () =>
          new Promise<InventoryNfcResolveCheckResponse>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ ...COMPARTMENT_TAP, compartment_id: 'comp-2' });
    renderTap();
    await tap('04a2245b');
    await tap('04b3356c');
    // The second is not sent until the first has answered.
    expect(resolveCheckNfcTag).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseFirst(COMPARTMENT_TAP);
      await Promise.resolve();
    });
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(2));
    expect(onResolved.mock.calls.map((call) => (call[0] as InventoryNfcResolveCheckResponse).compartment_id)).toEqual([
      'comp-1',
      'comp-2',
    ]);
  });

  it('asks for another try when nothing could be read off the tag', async () => {
    renderTap();
    await tap('');
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/);
    expect(resolveCheckNfcTag).not.toHaveBeenCalled();
  });
});
