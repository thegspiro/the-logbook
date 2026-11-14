/**
 * My Dues — a member's own dues (owner decision 2026-11-01, "My dues view").
 *
 * The page shows what the backend reports: owed, paid, still owed, the due
 * date, a late fee charged or still to come, and the payments. It computes no
 * status of its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MyDues } from '../types';

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const listMine = vi.fn();
vi.mock('../services/api', () => ({
  duesService: { listMine: (...args: unknown[]) => listMine(...args) as unknown },
}));

import MyDuesPage from './MyDuesPage';

const row = (overrides: Partial<MyDues> = {}): MyDues => ({
  id: 'd-1',
  scheduleName: '2027 annual dues',
  amountDue: '120.00',
  amountPaid: '40.00',
  balance: '80.00',
  status: 'partial',
  dueDate: '2027-03-01T00:00:00Z',
  payments: [{ id: 'p-1', amount: '40.00', paymentMethod: 'cash', receivedAt: '2027-01-10T15:00:00Z' }],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/finance/my-dues']}>
      <MyDuesPage />
    </MemoryRouter>
  );

beforeEach(() => {
  listMine.mockReset();
});

describe('My Dues', () => {
  it('shows what is owed, what is paid and the payments', async () => {
    listMine.mockResolvedValue([row()]);
    renderPage();
    expect(await screen.findByText('2027 annual dues')).toBeInTheDocument();
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
    expect(screen.getByText('Total still owed: $80.00')).toBeInTheDocument();
    expect(screen.getByText(/\$40\.00 · Cash/)).toBeInTheDocument();
    expect(listMine).toHaveBeenCalledTimes(1);
  });

  it('warns of a late fee still to come, and when', async () => {
    listMine.mockResolvedValue([row({ lateFeeAmount: '15.00', lateFeeAfter: '2027-03-31T00:00:00Z' })]);
    renderPage();
    expect(
      await screen.findByText(/A late fee of \$15\.00 is added if the balance is still unpaid after/)
    ).toHaveTextContent(/March 31, 2027|3\/31\/2027|Mar 31, 2027/);
  });

  it('says when a late fee has been charged', async () => {
    listMine.mockResolvedValue([
      row({ status: 'overdue', amountDue: '135.00', balance: '95.00', lateFeeApplied: '15.00' }),
    ]);
    renderPage();
    expect(await screen.findByText('Includes a late fee of $15.00.')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('tells a member with no dues so', async () => {
    listMine.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('You have no dues')).toBeInTheDocument();
  });

  it('shows a failure to load rather than an empty page', async () => {
    listMine.mockRejectedValue(new Error('Network down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});
