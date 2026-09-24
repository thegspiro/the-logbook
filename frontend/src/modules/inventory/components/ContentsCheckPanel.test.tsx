import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InventoryItem, StorageAreaResponse } from '../types';

const mockGetItems = vi.fn();
const mockLookupByCode = vi.fn();
const mockPutAwayItems = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    lookupByCode: (...a: unknown[]) => mockLookupByCode(...a) as unknown,
    putAwayItems: (...a: unknown[]) => mockPutAwayItems(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ContentsCheckPanel } from './ContentsCheckPanel';
import { containerAreaIds } from '../utils/containerAreas';

const area = (id: string, name: string, barcode: string, parent_id?: string): StorageAreaResponse => ({
  id,
  organization_id: 'org-1',
  name,
  storage_type: 'bin',
  barcode,
  sort_order: 0,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  children: [],
  ...(parent_id ? { parent_id } : {}),
});

const bag = area('bag', 'Medic Bag', 'SA-000010');
const pocket = area('pocket', 'Side Pocket', 'SA-000011', 'bag');
const shelf = area('shelf', 'Shelf 1', 'SA-000001');

const item = (id: string, name: string, barcode: string, storage_area_id: string, status = 'available') =>
  ({
    id,
    organization_id: 'org-1',
    name,
    barcode,
    status,
    condition: 'good',
    tracking_type: 'individual',
    quantity: 1,
    quantity_issued: 0,
    active: true,
    storage_area_id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as InventoryItem;

const bvm = item('it-bvm', 'BVM', 'INV-1', 'bag');
const tourniquet = item('it-tq', 'Tourniquet', 'INV-2', 'pocket');
const radio = item('it-radio', 'Radio', 'INV-3', 'bag', 'assigned');
const flashlight = item('it-light', 'Flashlight', 'INV-9', 'shelf');
const byCode: Record<string, InventoryItem> = {
  'INV-1': bvm,
  'INV-2': tourniquet,
  'INV-3': radio,
  'INV-9': flashlight,
};

describe('containerAreaIds', () => {
  it('takes the container and everything nested in it', () => {
    expect(containerAreaIds('bag', [bag, pocket, shelf])).toEqual(['bag', 'pocket']);
  });

  it('survives a cycle in parent ids', () => {
    const a = area('a', 'A', 'SA-1', 'b');
    const b = area('b', 'B', 'SA-2', 'a');
    expect(containerAreaIds('a', [a, b])).toEqual(['a', 'b']);
  });
});

describe('ContentsCheckPanel', () => {
  const onFiled = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    for (const m of [mockGetItems, mockLookupByCode, mockPutAwayItems, onFiled, onClose]) m.mockReset();
    mockGetItems.mockImplementation(({ storage_area_id }: { storage_area_id: string }) => {
      const items = [bvm, tourniquet, radio, flashlight].filter((i) => i.storage_area_id === storage_area_id);
      return Promise.resolve({ items, total: items.length, skip: 0, limit: 500 });
    });
    mockLookupByCode.mockImplementation((code: string) => {
      const found = byCode[code];
      return Promise.resolve({
        results: found ? [{ item: found, matched_field: 'barcode', matched_value: code }] : [],
        total: found ? 1 : 0,
      });
    });
    mockPutAwayItems.mockResolvedValue({
      storage_area_id: 'bag',
      moved: ['it-light'],
      already_here: [],
      skipped: [],
      not_found: 0,
    });
  });

  const open = (initialArea: StorageAreaResponse | null = null) =>
    render(
      <ContentsCheckPanel
        areas={[bag, pocket, shelf]}
        initialArea={initialArea}
        pathOf={(a) => a.name}
        onFiled={onFiled}
        onClose={onClose}
      />
    );

  const scan = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
    await user.type(screen.getByLabelText(/Scan or type a container or item barcode/), `${code}{Enter}`);
  };

  it('asks for the container first', async () => {
    const user = userEvent.setup();
    open();

    await scan(user, 'INV-1');

    expect(await screen.findByText(/Scan the container’s label first/)).toBeInTheDocument();
    expect(mockLookupByCode).not.toHaveBeenCalled();
  });

  it('loads the container and its pockets, and counts only what should be on hand', async () => {
    const user = userEvent.setup();
    open();

    await scan(user, 'SA-000010');

    expect(await screen.findByText('0 of 2 found')).toBeInTheDocument();
    expect(mockGetItems).toHaveBeenCalledWith({ storage_area_id: 'bag', skip: 0, limit: 500 });
    expect(mockGetItems).toHaveBeenCalledWith({ storage_area_id: 'pocket', skip: 0, limit: 500 });
    expect(screen.getByText(/Not counted: Radio \(assigned\)/)).toBeInTheDocument();
  });

  it('lists what is still missing, with the pocket it should be in', async () => {
    const user = userEvent.setup();
    open(bag);
    await screen.findByText('0 of 2 found');

    await scan(user, 'INV-1');

    expect(await screen.findByText('1 of 2 found')).toBeInTheDocument();
    expect(screen.getByText('Not scanned yet (1)')).toBeInTheDocument();
    expect(screen.getByText(/Tourniquet/)).toHaveTextContent('Tourniquet — Side Pocket');
  });

  it('flags a stray, says where it is recorded, and files it here on request', async () => {
    const user = userEvent.setup();
    open(bag);
    await screen.findByText('0 of 2 found');

    await scan(user, 'INV-9');

    expect(await screen.findByText('Flashlight is not recorded as being in here.')).toBeInTheDocument();
    expect(screen.getByText(/recorded in Shelf 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'File it here' }));

    expect(mockPutAwayItems).toHaveBeenCalledWith('bag', ['it-light']);
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(bag));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'File it here' })).not.toBeInTheDocument());
  });

  it('points out an item that is here although its record says otherwise', async () => {
    const user = userEvent.setup();
    open(bag);
    await screen.findByText('0 of 2 found');

    await scan(user, 'INV-3');

    expect(await screen.findByText('Radio: recorded as assigned')).toBeInTheDocument();
    expect(screen.queryByText(/Not counted/)).not.toBeInTheDocument();
  });

  it('does not judge an item before the contents have loaded', async () => {
    mockGetItems.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    open(bag);

    await scan(user, 'INV-9');

    expect(await screen.findByText(/Still loading what this container should hold/)).toBeInTheDocument();
    expect(screen.queryByText(/Doesn’t belong here/)).not.toBeInTheDocument();
  });

  it('will not switch container mid-check, and starts over on request', async () => {
    const user = userEvent.setup();
    open(bag);
    await screen.findByText('0 of 2 found');
    await scan(user, 'INV-1');
    await screen.findByText('1 of 2 found');

    await scan(user, 'SA-000001');
    expect(await screen.findByText(/Finish this check, or start over/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('0 of 2 found')).toBeInTheDocument();
  });
});
