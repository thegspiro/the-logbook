import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InventoryItem } from '../types';

const mockLookupByCode = vi.fn();
const mockStartScanner = vi.fn();
const mockStopScanner = vi.fn();
let capturedOnScan: ((text: string) => void) | null = null;

vi.mock('../../../services/api', () => ({
  inventoryService: {
    lookupByCode: (...a: unknown[]) => mockLookupByCode(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useHtml5Scanner', () => ({
  useHtml5Scanner: ({ onScan }: { onScan: (text: string) => void }) => {
    capturedOnScan = onScan;
    return {
      scanning: false,
      startScanner: mockStartScanner,
      stopScanner: mockStopScanner,
      flashlightSupported: false,
      flashlightOn: false,
      toggleFlashlight: vi.fn(),
    };
  },
}));

import { LabelScanConfirm } from './LabelScanConfirm';

const makeItem = (id: string, name: string, barcode: string): InventoryItem => ({
  id,
  organization_id: 'org-1',
  name,
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  barcode,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const items = [makeItem('it-1', 'Thermal Camera', 'INV-0001'), makeItem('it-2', 'Spare Radio', 'INV-0002')];
const labelValueOf = (item: InventoryItem) => item.barcode ?? null;

describe('LabelScanConfirm', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    for (const m of [mockLookupByCode, mockStartScanner, mockStopScanner, onConfirm, onCancel]) m.mockReset();
    mockLookupByCode.mockResolvedValue({ results: [], total: 0 });
    mockStartScanner.mockResolvedValue(undefined);
    mockStopScanner.mockResolvedValue(undefined);
    onConfirm.mockResolvedValue(undefined);
    capturedOnScan = null;
  });

  const open = () =>
    render(<LabelScanConfirm items={items} labelValueOf={labelValueOf} onConfirm={onConfirm} onCancel={onCancel} />);

  const typeCode = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
    await user.type(screen.getByLabelText(/Scan or type a label/), `${code}{Enter}`);
  };

  it('ticks off a label that belongs to the batch and records only what was scanned', async () => {
    const user = userEvent.setup();
    open();

    await typeCode(user, 'INV-0002');

    expect(await screen.findByText('Spare Radio — confirmed')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 labels scanned')).toBeInTheDocument();
    expect(mockLookupByCode).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Mark 1 scanned item as labelled' }));
    expect(onConfirm).toHaveBeenCalledWith(['it-2']);
  });

  it('says so when a label is scanned twice, and counts it once', async () => {
    const user = userEvent.setup();
    open();

    await typeCode(user, 'INV-0001');
    await screen.findByText('Thermal Camera — confirmed');
    // A handheld scanner re-reading a label outside the camera's repeat window.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    await typeCode(user, 'INV-0001');

    expect(await screen.findByText('Thermal Camera was already scanned')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 labels scanned')).toBeInTheDocument();
  }, 10000);

  it('asks the server about a code this page did not render', async () => {
    // The PDF path can assign a barcode at print time, after this page loaded.
    mockLookupByCode.mockResolvedValue({
      results: [{ item: { id: 'it-1' }, matched_field: 'barcode', matched_value: 'INV-9999' }],
      total: 1,
    });
    const user = userEvent.setup();
    open();

    await typeCode(user, 'INV-9999');

    expect(mockLookupByCode).toHaveBeenCalledWith('INV-9999');
    expect(await screen.findByText('Thermal Camera — confirmed')).toBeInTheDocument();
  });

  it('rejects a label from outside the batch', async () => {
    mockLookupByCode.mockResolvedValue({
      results: [{ item: { id: 'someone-else' }, matched_field: 'barcode', matched_value: 'INV-7777' }],
      total: 1,
    });
    const user = userEvent.setup();
    open();

    await typeCode(user, 'INV-7777');

    expect(await screen.findByText('INV-7777 is not one of the labels in this batch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark 0 scanned items as labelled' })).toBeDisabled();
  });

  it('accepts camera scans, ignoring the repeats of one label in view', async () => {
    open();

    await act(async () => {
      capturedOnScan?.('INV-0001');
      capturedOnScan?.('INV-0001');
      capturedOnScan?.('INV-0001');
    });

    expect(await screen.findByText('Thermal Camera — confirmed')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 labels scanned')).toBeInTheDocument();
  });

  it('keeps every scan when saving fails', async () => {
    onConfirm.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    open();
    await typeCode(user, 'INV-0001');
    await screen.findByText('Thermal Camera — confirmed');

    await user.click(screen.getByRole('button', { name: 'Mark 1 scanned item as labelled' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Mark 1 scanned item as labelled' })).toBeEnabled();
    expect(screen.getByText('1 of 2 labels scanned')).toBeInTheDocument();
  });

  it('goes back without recording anything', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
