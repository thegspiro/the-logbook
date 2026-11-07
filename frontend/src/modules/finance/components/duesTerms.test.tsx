/**
 * Owner decisions of 2026-11-01 on the Treasurer's dues dialogs.
 *
 * "Build them": the schedule form offers the grace period, late fee, fiscal
 * year and membership types it stores, and says so before a schedule saved
 * earlier has them applied. "Show the name": the payment history names who
 * recorded each payment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DuesSchedule, MemberDues } from '../types';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const createSchedule = vi.fn();
const updateSchedule = vi.fn();
const membershipTypeOptions = vi.fn();
const listPayments = vi.fn();
const yearOptions = vi.fn();
vi.mock('../services/api', () => ({
  duesService: {
    createSchedule: (...args: unknown[]) => createSchedule(...args) as unknown,
    updateSchedule: (...args: unknown[]) => updateSchedule(...args) as unknown,
    membershipTypeOptions: (...args: unknown[]) => membershipTypeOptions(...args) as unknown,
    listPayments: (...args: unknown[]) => listPayments(...args) as unknown,
  },
  fiscalYearService: {
    options: (...args: unknown[]) => yearOptions(...args) as unknown,
  },
}));

import { DuesScheduleDialog } from './DuesScheduleDialog';
import { DuesLedgerDialog } from './DuesLedgerDialog';

const schedule = (overrides: Partial<DuesSchedule> = {}): DuesSchedule => ({
  id: 'sch-1',
  organizationId: 'org',
  name: '2027 annual dues',
  amount: '120.00',
  frequency: 'annual',
  dueDate: '2027-03-01T00:00:00Z',
  gracePeriodDays: 30,
  isActive: true,
  termsEffectiveAt: '2026-11-06T00:00:00Z',
  createdBy: 'u-t',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  for (const m of [createSchedule, updateSchedule, membershipTypeOptions, listPayments, yearOptions]) {
    m.mockReset();
  }
  membershipTypeOptions.mockResolvedValue([
    { id: 'active', name: 'Active' },
    { id: 'life', name: 'Life' },
  ]);
  yearOptions.mockResolvedValue([{ id: 'fy-27', name: 'FY 2027', status: 'active' }]);
  createSchedule.mockResolvedValue(schedule());
  updateSchedule.mockResolvedValue(schedule());
});

describe('the schedule form', () => {
  it('sends the grace period, late fee, fiscal year and membership types', async () => {
    const user = userEvent.setup();
    render(<DuesScheduleDialog onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Life assessment');
    await user.type(within(dialog).getByLabelText('Amount per member'), '50');
    await user.type(within(dialog).getByLabelText('Due date'), '2027-03-01');
    await user.clear(within(dialog).getByLabelText('Grace period (days)'));
    await user.type(within(dialog).getByLabelText('Grace period (days)'), '14');
    await user.type(within(dialog).getByLabelText(/Late fee/), '15');
    await within(dialog).findByRole('option', { name: 'FY 2027' });
    await user.selectOptions(within(dialog).getByLabelText(/Fiscal year/), 'fy-27');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Life' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        gracePeriodDays: 14,
        lateFeeAmount: '15.00',
        fiscalYearId: 'fy-27',
        appliesToMembershipTypes: ['life'],
      })
    );
  });

  it('omits the optional terms on create when left blank, so everyone is billed', async () => {
    const user = userEvent.setup();
    render(<DuesScheduleDialog onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Annual');
    await user.type(within(dialog).getByLabelText('Amount per member'), '100');
    await user.type(within(dialog).getByLabelText('Due date'), '2027-03-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() =>
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          gracePeriodDays: 30,
          lateFeeAmount: undefined,
          fiscalYearId: undefined,
          appliesToMembershipTypes: undefined,
        })
      )
    );
  });

  it('clears the terms on update with explicit nulls', async () => {
    const user = userEvent.setup();
    render(
      <DuesScheduleDialog
        schedule={schedule({ lateFeeAmount: '10.00', appliesToMembershipTypes: ['life'], fiscalYearId: 'fy-27' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Late fee/));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Life' }));
    await user.selectOptions(within(dialog).getByLabelText(/Fiscal year/), 'None');
    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith(
        'sch-1',
        expect.objectContaining({
          gracePeriodDays: 30,
          lateFeeAmount: null,
          fiscalYearId: null,
          appliesToMembershipTypes: null,
        })
      )
    );
  });

  it('warns that saving a schedule from before the decision applies its terms', () => {
    render(<DuesScheduleDialog schedule={schedule({ termsEffectiveAt: null })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent(/saving it applies the values below/i);
  });

  it('does not warn for a schedule whose terms already apply', () => {
    render(<DuesScheduleDialog schedule={schedule()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('refuses a blank grace period rather than guessing one', async () => {
    const user = userEvent.setup();
    render(<DuesScheduleDialog schedule={schedule()} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Grace period (days)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(screen.getByText(/whole number of days/i)).toBeInTheDocument();
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});

describe('the payment history', () => {
  const dues: MemberDues = {
    id: 'd-1',
    organizationId: 'org',
    duesScheduleId: 'sch-1',
    userId: 'u-terry',
    amountDue: '120.00',
    amountPaid: '40.00',
    status: 'partial',
    dueDate: '2027-03-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  const payment = {
    id: 'p1',
    organizationId: 'org',
    memberDuesId: 'd-1',
    amount: '40.00',
    paymentMethod: 'cash',
    receivedAt: '2026-10-02T15:00:00Z',
    createdAt: '2026-10-02T15:00:00Z',
    updatedAt: '2026-10-02T15:00:00Z',
  };

  it('names who recorded each payment', async () => {
    listPayments.mockResolvedValue([{ ...payment, recordedBy: 'u-tess', recordedByName: 'Tess Treasurer' }]);
    render(<DuesLedgerDialog dues={dues} memberLabel="Terry" onClose={vi.fn()} />);
    expect(await screen.findByText('Recorded by Tess Treasurer')).toBeInTheDocument();
  });

  it('says so when the recorder has since left', async () => {
    listPayments.mockResolvedValue([{ ...payment, recordedBy: 'u-gone', recordedByName: null }]);
    render(<DuesLedgerDialog dues={dues} memberLabel="Terry" onClose={vi.fn()} />);
    expect(await screen.findByText('Recorded by a former member')).toBeInTheDocument();
  });
});
