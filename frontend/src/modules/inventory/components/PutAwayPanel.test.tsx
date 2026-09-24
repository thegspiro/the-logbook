import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StorageAreaResponse } from '../types';

const mockLookupByCode = vi.fn();
const mockPutAwayItems = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    lookupByCode: (...a: unknown[]) => mockLookupByCode(...a) as unknown,
    putAwayItems: (...a: unknown[]) => mockPutAwayItems(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PutAwayPanel } from './PutAwayPanel';

const area = (id: string, name: string, barcode: string): StorageAreaResponse => ({
  id,
  organization_id: 'org-1',
  name,
  storage_type: 'shelf',
  barcode,
  sort_order: 0,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  children: [],
});

const shelf1 = area('shelf-1', 'Shelf 1', 'SA-000001');
const shelf2 = area('shelf-2', 'Shelf 2', 'SA-000002');
const itemsByCode: Record<string, { id: string; name: string }> = {
  'INV-1': { id: 'it-1', name: 'Gloves' },
  'INV-2': { id: 'it-2', name: 'Radio' },
};

describe('PutAwayPanel', () => {
  const onFiled = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    for (const m of [mockLookupByCode, mockPutAwayItems, onFiled, onClose]) m.mockReset();
    mockLookupByCode.mockImplementation((code: string) =>
      Promise.resolve({
        results: itemsByCode[code] ? [{ item: itemsByCode[code], matched_field: 'barcode', matched_value: code }] : [],
        total: itemsByCode[code] ? 1 : 0,
      })
    );
    mockPutAwayItems.mockResolvedValue({
      storage_area_id: 'shelf-1',
      moved: ['it-1'],
      already_here: [],
      skipped: [{ item_id: 'it-2', name: 'Radio', reason: 'assigned to a member — return it first' }],
      not_found: 0,
    });
  });

  const open = (initialArea: StorageAreaResponse | null = null) =>
    render(
      <PutAwayPanel
        areas={[shelf1, shelf2]}
        initialArea={initialArea}
        pathOf={(a) => `Rack A › ${a.name}`}
        onFiled={onFiled}
        onClose={onClose}
      />
    );

  const scan = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
    await user.type(screen.getByLabelText(/Scan or type a shelf or item barcode/), `${code}{Enter}`);
  };

  it('asks for the shelf before any item', async () => {
    const user = userEvent.setup();
    open();

    await scan(user, 'INV-1');

    expect(await screen.findByRole('status')).toHaveTextContent('Scan the shelf label first');
    expect(mockLookupByCode).not.toHaveBeenCalled();
  });

  it('files the scanned items on the scanned shelf and reports what was skipped', async () => {
    const user = userEvent.setup();
    open();

    await scan(user, 'sa-000001');
    expect(await screen.findByText('Rack A › Shelf 1')).toBeInTheDocument();
    await scan(user, 'INV-1');
    await scan(user, 'INV-2');
    expect(await screen.findByText('Radio')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'File 2 items on Shelf 1' }));

    expect(mockPutAwayItems).toHaveBeenCalledWith('shelf-1', ['it-1', 'it-2']);
    expect(await screen.findByText(/1 filed/)).toBeInTheDocument();
    expect(screen.getByText('Radio: assigned to a member — return it first')).toBeInTheDocument();
    expect(onFiled).toHaveBeenCalledWith(shelf1);
    expect(screen.getByRole('button', { name: 'File 0 items on Shelf 1' })).toBeDisabled();
  });

  it('starts on the shelf already in view', async () => {
    const user = userEvent.setup();
    open(shelf2);

    expect(screen.getByText('Rack A › Shelf 2')).toBeInTheDocument();
    await scan(user, 'INV-1');

    expect(await screen.findByRole('button', { name: 'File 1 item on Shelf 2' })).toBeEnabled();
  });

  it('will not switch shelf while items are waiting to be filed', async () => {
    const user = userEvent.setup();
    open(shelf1);
    await scan(user, 'INV-1');
    await screen.findByText('Gloves');

    await scan(user, 'SA-000002');

    expect(await screen.findByText(/File the 1 scanned items first, or clear them/)).toBeInTheDocument();
    expect(screen.getByText('Rack A › Shelf 1')).toBeInTheDocument();
  });

  it('refuses unknown codes and repeats without adding them', async () => {
    const user = userEvent.setup();
    open(shelf1);

    await scan(user, 'NOPE');
    expect(await screen.findByText('No item has the barcode NOPE.')).toBeInTheDocument();

    await scan(user, 'INV-1');
    await screen.findByText('Gloves');
    // Typed again after the camera repeat window, so it reaches the lookup.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await scan(user, 'INV-1');
    expect(await screen.findByText('Gloves is already in the list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File 1 item on Shelf 1' })).toBeInTheDocument();
  }, 10000);

  it('keeps the list when filing fails', async () => {
    mockPutAwayItems.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    open(shelf1);
    await scan(user, 'INV-1');
    await screen.findByText('Gloves');

    await user.click(screen.getByRole('button', { name: 'File 1 item on Shelf 1' }));

    await waitFor(() => expect(mockPutAwayItems).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Gloves')).toBeInTheDocument();
    expect(onFiled).not.toHaveBeenCalled();
  });
});
