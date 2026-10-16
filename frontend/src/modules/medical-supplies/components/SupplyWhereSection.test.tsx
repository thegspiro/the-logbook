import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem } from '../../../services/eventServices';

const mockGetItemPlacements = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getItemPlacements: (...a: unknown[]) => mockGetItemPlacements(...a) as unknown,
  },
}));

import { SupplyWhereSection } from './SupplyWhereSection';
import { storageNote } from '../types';

const item = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'item-1',
    name: 'Gauze Pads',
    quantity: 0,
    storage_path: 'Supply Room › Cabinet B',
    storage_location: 'Left side',
    ...overrides,
  }) as unknown as InventoryItem;

const placement = (overrides: Record<string, unknown> = {}) => ({
  templateItemId: 'ti-1',
  itemName: 'Gauze',
  compartmentName: 'Jump Bag',
  apparatusName: 'Medic 1',
  isExpired: false,
  targetQuantity: 4,
  quantityOnTruck: 3,
  ...overrides,
});

describe('SupplyWhereSection', () => {
  beforeEach(() => {
    mockGetItemPlacements.mockReset();
    mockGetItemPlacements.mockResolvedValue([]);
  });

  it('shows the storage path with its note, and each apparatus with what is aboard', async () => {
    mockGetItemPlacements.mockResolvedValue([
      placement({ expirationDate: '2026-01-31', isExpired: true, compartmentPath: ['Main Compartment', 'Jump Bag'] }),
      placement({
        templateItemId: 'ti-2',
        apparatusName: null,
        apparatusType: 'ambulance',
        compartmentName: null,
        quantityOnTruck: null,
      }),
    ]);
    renderWithRouter(<SupplyWhereSection item={item()} />);

    expect(screen.getByText('Supply Room › Cabinet B')).toBeInTheDocument();
    expect(screen.getByText('Left side')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Apparatus that carry it' });
    const [medic, typeTemplate] = within(list).getAllByRole('listitem');
    // The whole nesting, as the checklist has it.
    expect(medic).toHaveTextContent('Medic 1 · Main Compartment › Jump Bag');
    expect(medic).toHaveTextContent('3 of 4 aboard');
    expect(medic).toHaveTextContent('Expired Jan 31, 2026');
    // Never counted: the target stands in, and says so.
    expect(typeTemplate).toHaveTextContent('Any ambulance');
    expect(typeTemplate).toHaveTextContent('4 of 4 aboard (not counted yet)');
    expect(mockGetItemPlacements).toHaveBeenCalledWith('item-1');
  });

  it('says when no apparatus carries it, and when nothing records where it is', async () => {
    renderWithRouter(<SupplyWhereSection item={item({ storage_path: null, storage_location: null })} />);

    expect(await screen.findByText(/Not on any apparatus checklist/)).toBeInTheDocument();
    expect(screen.getByText('No storage location recorded')).toBeInTheDocument();
  });

  it('shows a failed apparatus lookup rather than an empty list', async () => {
    mockGetItemPlacements.mockRejectedValue(new Error('Server unavailable'));
    renderWithRouter(<SupplyWhereSection item={item()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByText(/Not on any apparatus checklist/)).not.toBeInTheDocument();
  });
});

describe('storageNote', () => {
  it('drops a note that only repeats the area it is filed in', () => {
    expect(storageNote({ storage_location: ' Medical  cabinet ', storage_path: 'Room › Medical Cabinet' })).toBeNull();
  });

  it('keeps a note that adds something, or that stands alone', () => {
    expect(storageNote({ storage_location: 'Top drawer', storage_path: 'Room › Cabinet' })).toBe('Top drawer');
    expect(storageNote({ storage_location: 'Top drawer', storage_path: null })).toBe('Top drawer');
    expect(storageNote({ storage_location: '  ', storage_path: null })).toBeNull();
  });
});
