import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetOpenSwaps = vi.fn();
const mockPickUp = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getOpenSwaps: (...a: unknown[]) => mockGetOpenSwaps(...a) as unknown,
    pickUpOpenSwap: (...a: unknown[]) => mockPickUp(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import toast from 'react-hot-toast';
import { OpenSwapPickups } from './OpenSwapPickups';

const swap = {
  swap_request_id: 'sw1',
  shift_id: 'sh1',
  shift_date: '2026-10-09',
  start_time: '2026-10-09T07:00:00Z',
  end_time: '2026-10-09T19:00:00Z',
  position: 'driver',
  requesting_user_name: 'Dana Ruiz',
  apparatus_label: 'Engine 5',
  reason: 'Family commitment',
};

describe('OpenSwapPickups', () => {
  beforeEach(() => {
    mockGetOpenSwaps.mockReset();
    mockPickUp.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockGetOpenSwaps.mockResolvedValue([swap]);
    mockPickUp.mockResolvedValue({ id: 'sw1' });
  });

  it('lists an open swap the member is cleared for', async () => {
    renderWithRouter(<OpenSwapPickups onPickedUp={vi.fn()} />);
    expect(await screen.findByText('Open shifts you can pick up')).toBeInTheDocument();
    expect(screen.getByText(/Engine 5/)).toBeInTheDocument();
    expect(screen.getByText(/from Dana Ruiz/)).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to pick up', async () => {
    mockGetOpenSwaps.mockResolvedValue([]);
    renderWithRouter(<OpenSwapPickups onPickedUp={vi.fn()} />);
    await waitFor(() => {
      expect(mockGetOpenSwaps).toHaveBeenCalled();
    });
    expect(screen.queryByText('Open shifts you can pick up')).not.toBeInTheDocument();
  });

  it('picks the shift up only after the member confirms', async () => {
    const user = userEvent.setup();
    const onPickedUp = vi.fn();
    renderWithRouter(<OpenSwapPickups onPickedUp={onPickedUp} />);
    await user.click(await screen.findByRole('button', { name: /Pick up .* from Dana Ruiz/ }));
    expect(mockPickUp).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Pick it up' }));

    await waitFor(() => {
      expect(mockPickUp).toHaveBeenCalledWith('sw1');
    });
    expect(onPickedUp).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('The shift is yours');
  });

  it('says why a pickup was refused and reloads the list', async () => {
    const user = userEvent.setup();
    mockPickUp.mockRejectedValue(new Error('Member has approved time off for this date'));
    renderWithRouter(<OpenSwapPickups onPickedUp={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Pick up .* from Dana Ruiz/ }));
    await user.click(await screen.findByRole('button', { name: 'Pick it up' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Member has approved time off for this date');
    });
    expect(mockGetOpenSwaps).toHaveBeenCalledTimes(2);
  });
});
