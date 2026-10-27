import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRecordPayment = vi.fn();
vi.mock('../services/api', () => ({
  duesService: {
    recordPayment: (...args: unknown[]) => mockRecordPayment(...args) as unknown,
  },
}));

import { renderWithRouter } from '../../../test/utils';
import { DuesPaymentDialog } from './DuesPaymentDialog';
import { DuesStatus } from '../types';
import type { MemberDues } from '../types';

const dues = (amountPaid = '50.00'): MemberDues => ({
  id: 'dues-1',
  organizationId: 'org-1',
  duesScheduleId: 'sched-1',
  userId: 'member-1',
  amountDue: '120.00',
  amountPaid,
  status: DuesStatus.PARTIAL,
  dueDate: '2026-12-01',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const renderDialog = (record = dues()) => {
  const onSaved = vi.fn();
  renderWithRouter(<DuesPaymentDialog dues={record} memberLabel="Dana Member" onClose={vi.fn()} onSaved={onSaved} />);
  return onSaved;
};

const enterAmount = async (amount: string) => {
  const user = userEvent.setup();
  const input = screen.getByLabelText('Amount received');
  await user.clear(input);
  await user.type(input, amount);
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  return user;
};

// W66-3: an overpayment is confirmed first, and the extra becomes a donation.
describe('DuesPaymentDialog overpayment', () => {
  beforeEach(() => {
    mockRecordPayment.mockReset();
    mockRecordPayment.mockResolvedValue({});
  });

  it('records the outstanding amount without asking', async () => {
    renderDialog();
    await enterAmount('70');

    await waitFor(() => expect(mockRecordPayment).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Record the extra as a donation?')).not.toBeInTheDocument();
    expect(mockRecordPayment).toHaveBeenCalledWith('dues-1', expect.not.objectContaining({ excessAsDonation: true }));
  });

  it('asks before an overpayment and sends the confirmation with it', async () => {
    renderDialog();
    const user = await enterAmount('75');

    expect(await screen.findByText(/\$5\.00 more than the \$70\.00 Dana Member still owes/)).toBeInTheDocument();
    expect(mockRecordPayment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Record with donation' }));

    await waitFor(() =>
      expect(mockRecordPayment).toHaveBeenCalledWith('dues-1', {
        amountPaid: '75.00',
        paymentMethod: undefined,
        transactionReference: undefined,
        notes: undefined,
        excessAsDonation: true,
      })
    );
  });

  it('sends nothing when the officer goes back to change the amount', async () => {
    renderDialog();
    const user = await enterAmount('75');

    await user.click(await screen.findByRole('button', { name: 'Change the amount' }));

    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it('says the whole amount is a donation when the dues are already paid', async () => {
    renderDialog(dues('120.00'));
    await enterAmount('20');

    expect(
      await screen.findByText(/already paid\. The whole \$20\.00 will be recorded as a donation/)
    ).toBeInTheDocument();
  });
});
