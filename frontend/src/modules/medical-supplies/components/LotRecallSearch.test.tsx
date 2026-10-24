import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MedicalExpiringStockRow } from '../types';

const mockSearchLots = vi.fn();
const mockRecordRecall = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    searchLots: (...args: unknown[]) => mockSearchLots(...args) as unknown,
    recordRecall: (...args: unknown[]) => mockRecordRecall(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
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
    mockRecordRecall.mockReset();
    mockSearchLots.mockResolvedValue([]);
    mockRecordRecall.mockResolvedValue({});
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

  describe('recording a recall', () => {
    const search = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText('Find a lot'), 'GZ-24');
      await user.click(screen.getByRole('button', { name: 'Find' }));
    };

    beforeEach(() => {
      // The shelf lot and the same lot aboard a truck: one recall covers both.
      mockSearchLots.mockResolvedValue([
        row({}),
        row({ key: 'deployed:9', location: 'apparatus', lot_id: null, lot_number: 'gz-24117 ' }),
      ]);
    });

    it('offers one recall per supply and lot, and records it with the reason', async () => {
      const onRecalled = vi.fn();
      const user = userEvent.setup();
      renderWithRouter(<LotRecallSearch canRecall onRecalled={onRecalled} />);
      await search(user);

      const buttons = await screen.findAllByRole('button', { name: /^Recall lot/ });
      expect(buttons).toHaveLength(1);
      await user.click(buttons[0] ?? document.body);
      await user.type(screen.getByLabelText('Reason (optional)', { exact: false }), 'FDA notice 2026-117');
      await user.click(screen.getByRole('button', { name: 'Recall lot' }));

      await waitFor(() =>
        expect(mockRecordRecall).toHaveBeenCalledWith({
          inventory_item_id: 'item-1',
          lot_number: 'GZ-24117',
          reason: 'FDA notice 2026-117',
        })
      );
      expect(onRecalled).toHaveBeenCalled();
      // The rows are read again, so their flags are current.
      expect(mockSearchLots).toHaveBeenCalledTimes(2);
    });

    it('does not offer to recall a lot that already is', async () => {
      mockSearchLots.mockResolvedValue([row({ recalled: true })]);
      const user = userEvent.setup();
      renderWithRouter(<LotRecallSearch canRecall />);
      await search(user);

      const shelf = await screen.findByRole('row', { name: /Cabinet B/ });
      expect(within(shelf).getByText('Recalled')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Recall lot/ })).not.toBeInTheDocument();
    });

    it('offers nothing to a viewer who cannot manage stock', async () => {
      const user = userEvent.setup();
      renderWithRouter(<LotRecallSearch />);
      await search(user);

      await screen.findAllByRole('row', { name: /Cabinet B/ });
      expect(screen.queryByRole('button', { name: /^Recall lot/ })).not.toBeInTheDocument();
    });
  });
});
