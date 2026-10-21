import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MedicalExpiringStockRow } from '../types';

const mockSearchLots = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    searchLots: (...args: unknown[]) => mockSearchLots(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { timezone: 'UTC' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

import { LotRecallSearch } from './LotRecallSearch';

const row = (overrides: Partial<MedicalExpiringStockRow>): MedicalExpiringStockRow => ({
  key: 'lot:1',
  location: 'shelf',
  inventory_item_id: 'item-1',
  item_name: 'Gauze Pads',
  item_size: null,
  lot_id: 'lot-1',
  template_item_id: null,
  lot_number: 'GZ-24117',
  expiration_date: '2028-03-31',
  days_until_expiration: 500,
  quantity: 6,
  where: 'Supply Room › Cabinet B',
  ...overrides,
});

describe('LotRecallSearch', () => {
  beforeEach(() => {
    mockSearchLots.mockReset();
    mockSearchLots.mockResolvedValue([]);
  });

  it('lists every place the lot is held, on the shelf and on a truck', async () => {
    mockSearchLots.mockResolvedValue([
      row({}),
      row({
        key: 'deployed:9',
        location: 'apparatus',
        lot_id: null,
        template_item_id: 'ti-1',
        where: 'Medic 1 › Main Compartment › Jump Bag',
        quantity: 3,
        expiration_date: null,
        days_until_expiration: null,
      }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<LotRecallSearch />);

    await user.type(screen.getByLabelText('Find a lot'), ' gz-241 ');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(mockSearchLots).toHaveBeenCalledWith('gz-241');
    expect(await screen.findByText(/9 units in 2 places/)).toBeInTheDocument();
    const truck = screen.getByRole('row', { name: /Jump Bag/ });
    expect(within(truck).getByLabelText('On an apparatus')).toBeInTheDocument();
    const shelf = screen.getByRole('row', { name: /Cabinet B/ });
    expect(within(shelf).getByLabelText('In storage')).toBeInTheDocument();
  });

  it('says so when nothing carries the lot', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LotRecallSearch />);

    await user.type(screen.getByLabelText('Find a lot'), 'ZZ-0');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText(/No stock with a lot number containing/)).toHaveTextContent('ZZ-0');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('asks for two characters rather than searching on one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LotRecallSearch />);

    await user.type(screen.getByLabelText('Find a lot'), 'G');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(screen.getByRole('alert')).toHaveTextContent('at least 2 characters');
    expect(mockSearchLots).not.toHaveBeenCalled();
  });

  it('shows a failed search as a failure, not as "no stock"', async () => {
    mockSearchLots.mockRejectedValue(new Error('Server unavailable'));
    const user = userEvent.setup();
    renderWithRouter(<LotRecallSearch />);

    await user.type(screen.getByLabelText('Find a lot'), 'GZ-1');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByText(/No stock with a lot number/)).not.toBeInTheDocument();
  });
});
