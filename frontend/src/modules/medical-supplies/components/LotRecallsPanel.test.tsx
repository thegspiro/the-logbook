import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MedicalLotRecall } from '../types';

const mockGetRecalls = vi.fn();
const mockLiftRecall = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getRecalls: (...args: unknown[]) => mockGetRecalls(...args) as unknown,
    liftRecall: (...args: unknown[]) => mockLiftRecall(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { timezone: 'UTC' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { LotRecallsPanel } from './LotRecallsPanel';

const recall: MedicalLotRecall = {
  id: 'r-1',
  inventory_item_id: 'item-1',
  item_name: 'Oxygen Mask',
  item_size: 'Pediatric',
  lot_number: 'OM-7',
  reason: null,
  recalled_at: '2026-10-20T12:00:00Z',
  units_on_shelf: 4,
  units_aboard: 2,
};

describe('LotRecallsPanel', () => {
  beforeEach(() => {
    mockGetRecalls.mockReset();
    mockLiftRecall.mockReset();
    mockGetRecalls.mockResolvedValue([recall]);
    mockLiftRecall.mockResolvedValue({ ...recall, lifted_at: '2026-10-23T12:00:00Z' });
  });

  it('shows nothing when no recall is in force', async () => {
    mockGetRecalls.mockResolvedValue([]);
    renderWithRouter(<LotRecallsPanel canManage version={0} onChanged={vi.fn()} />);

    await waitFor(() => expect(mockGetRecalls).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Recalled lots' })).not.toBeInTheDocument();
  });

  it('lifts a recall with the reason given, then reloads', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<LotRecallsPanel canManage version={0} onChanged={onChanged} />);

    await user.click(
      await screen.findByRole('button', { name: 'Lift the recall of lot OM-7 of Oxygen Mask — Pediatric' })
    );
    await user.type(screen.getByLabelText('Why is it lifted?'), 'Entered in error');
    await user.click(screen.getByRole('button', { name: 'Lift recall' }));

    await waitFor(() => expect(mockLiftRecall).toHaveBeenCalledWith('r-1', 'Entered in error'));
    expect(onChanged).toHaveBeenCalled();
    expect(mockGetRecalls).toHaveBeenCalledTimes(2);
  });

  it('reports a response that is not a list as a failed load', async () => {
    mockGetRecalls.mockResolvedValue('<html>Sign in to the station Wi-Fi</html>');
    renderWithRouter(<LotRecallsPanel canManage version={0} onChanged={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  });

  it('offers no Lift to a viewer who cannot manage stock', async () => {
    renderWithRouter(<LotRecallsPanel canManage={false} version={0} onChanged={vi.fn()} />);

    await screen.findByRole('region', { name: 'Recalled lots' });
    expect(screen.queryByRole('button', { name: /Lift/ })).not.toBeInTheDocument();
  });

  it('reloads when the page says a recall was recorded', async () => {
    const { rerender } = renderWithRouter(<LotRecallsPanel canManage version={0} onChanged={vi.fn()} />);
    await screen.findByRole('region', { name: 'Recalled lots' });

    rerender(<LotRecallsPanel canManage version={1} onChanged={vi.fn()} />);

    await waitFor(() => expect(mockGetRecalls).toHaveBeenCalledTimes(2));
  });
});
