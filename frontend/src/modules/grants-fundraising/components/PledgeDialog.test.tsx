/**
 * Editing a pledge must not echo back the fulfilled amount and status the
 * dialog loaded with: a donation recorded against the pledge moves both on the
 * server, and resending stale values would undo it (owner decision 2026-11-01,
 * donations linked to pledges).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import userEvent from '@testing-library/user-event';

const updatePledge = vi.fn();
const createPledge = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    updatePledge: (...args: unknown[]) => updatePledge(...args) as unknown,
    createPledge: (...args: unknown[]) => createPledge(...args) as unknown,
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
  // The dialog asks before discarding a changed form, so it needs the provider the app shell mounts.
  render(<PledgeDialog pledge={pledge} donors={[]} campaigns={[]} onClose={vi.fn()} onSaved={vi.fn()} />, {
    wrapper: ConfirmProvider,
  });

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

describe('PledgeDialog server refusals and discarding', () => {
  const refusal = (field: string, message: string) => ({
    response: { status: 422, data: { detail: [{ field, message }] } },
  });

  beforeEach(() => {
    updatePledge.mockReset();
    createPledge.mockReset();
  });

  it("puts a new pledge's refused amount under the amount and records nothing", async () => {
    createPledge.mockRejectedValue(refusal('pledgedAmount', 'Value is outside the allowed range.'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PledgeDialog donors={[]} campaigns={[]} onClose={vi.fn()} onSaved={onSaved} />, {
      wrapper: ConfirmProvider,
    });
    await user.type(screen.getByLabelText(/^Amount pledged/), '1000');
    await user.click(screen.getByRole('button', { name: 'Record pledge' }));

    const amount = screen.getByLabelText(/^Amount pledged/);
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(amount).toHaveAccessibleDescription('Value is outside the allowed range.');
    expect(amount).toHaveFocus();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws away a changed form', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PledgeDialog pledge={pledge} donors={[]} campaigns={[]} onClose={onClose} onSaved={vi.fn()} />, {
      wrapper: ConfirmProvider,
    });
    await user.type(screen.getByLabelText(/^Notes/), 'Called the donor');

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
