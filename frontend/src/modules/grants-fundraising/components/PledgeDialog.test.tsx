/**
 * Editing a pledge must not echo back the fulfilled amount and status the
 * dialog loaded with: a donation recorded against the pledge moves both on the
 * server, and resending stale values would undo it (owner decision 2026-11-01,
 * donations linked to pledges).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updatePledge = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    updatePledge: (...args: unknown[]) => updatePledge(...args) as unknown,
    createPledge: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { PledgeDialog } from './PledgeDialog';
import { PledgeStatus } from '../types';
import type { Pledge } from '../types';

const pledge: Pledge = {
  id: 'pledge-1',
  organizationId: 'org-1',
  campaignId: null,
  donorId: null,
  pledgedAmount: '500.00',
  fulfilledAmount: '100.00',
  pledgeDate: '2026-10-01',
  dueDate: null,
  status: PledgeStatus.PARTIAL,
  paymentSchedule: null,
  reminderEnabled: false,
  notes: null,
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const renderDialog = () =>
  render(<PledgeDialog pledge={pledge} donors={[]} campaigns={[]} onClose={vi.fn()} onSaved={vi.fn()} />);

describe('PledgeDialog editing', () => {
  beforeEach(() => {
    updatePledge.mockReset();
    updatePledge.mockResolvedValue(pledge);
  });

  it('leaves the fulfilled amount and status out when they were not changed', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save pledge' }));

    await waitFor(() => expect(updatePledge).toHaveBeenCalledTimes(1));
    const payload = updatePledge.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('fulfilledAmount');
    expect(payload).not.toHaveProperty('status');
    expect(payload.pledgedAmount).toBe('500.00');
  });

  it('sends the fulfilled amount when the user corrects it', async () => {
    const user = userEvent.setup();
    renderDialog();

    const fulfilled = screen.getByLabelText('Amount received so far');
    await user.clear(fulfilled);
    await user.type(fulfilled, '150');
    await user.click(screen.getByRole('button', { name: 'Save pledge' }));

    await waitFor(() => expect(updatePledge).toHaveBeenCalledTimes(1));
    const payload = updatePledge.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.fulfilledAmount).toBe('150.00');
    expect(payload).not.toHaveProperty('status');
  });
});
