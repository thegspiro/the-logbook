/**
 * A budget owner's "Who can charge your lines" section on My Budgets.
 *
 * Which categories appear, and the rule each is under, are the backend's; the
 * section words them and saves the owner's choice as one whole setting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetCategory, ChargeAccessSettings } from '../types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const chargeAccessSettings = vi.fn();
const setChargeAccess = vi.fn();
vi.mock('../services/api', () => ({
  budgetCategoryService: {
    chargeAccessSettings: () => chargeAccessSettings() as unknown,
    setChargeAccess: (...args: unknown[]) => setChargeAccess(...args) as unknown,
  },
}));

import { ChargeAccessSection } from './ChargeAccessSection';

const cat = (overrides: Partial<BudgetCategory>): BudgetCategory => ({
  id: 'cat',
  organizationId: 'org',
  name: 'Category',
  sortOrder: 0,
  isActive: true,
  effectiveChargeAccess: 'open',
  chargePositionIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const settings: ChargeAccessSettings = {
  categories: [
    cat({ id: 'qm', name: 'Quartermaster', path: ['Quartermaster'] }),
    cat({
      id: 'boots',
      name: 'Boot reimbursement',
      parentCategoryId: 'qm',
      chargeAccess: 'open',
      path: ['Quartermaster', 'Boot reimbursement'],
    }),
    cat({
      id: 'brass',
      name: 'Officer brass',
      parentCategoryId: 'qm',
      chargeAccess: 'restricted',
      effectiveChargeAccess: 'restricted',
      chargePositionIds: ['pos-sup'],
      path: ['Quartermaster', 'Officer brass'],
    }),
  ],
  positions: [
    { id: 'pos-qm', name: 'Quartermaster' },
    { id: 'pos-sup', name: 'Support Chief' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  chargeAccessSettings.mockReset();
  setChargeAccess.mockReset();
  chargeAccessSettings.mockResolvedValue(settings);
});

describe('ChargeAccessSection', () => {
  it('renders nothing for a member who owns no categories', async () => {
    chargeAccessSettings.mockResolvedValue({ categories: [], positions: [] });
    const { container } = render(<ChargeAccessSection />);
    await waitFor(() => expect(chargeAccessSettings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the owner’s categories by path with the rule each is under', async () => {
    render(<ChargeAccessSection />);

    expect(await screen.findByText('Quartermaster › Officer brass')).toBeInTheDocument();
    expect(screen.getByText('Restricted to the owner and Support Chief')).toBeInTheDocument();
    expect(screen.getByText('Quartermaster › Boot reimbursement')).toBeInTheDocument();
    expect(screen.getAllByText('Anyone can charge')).toHaveLength(2);
  });

  it('adds a position to a restricted line and saves the whole setting', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockResolvedValue(settings.categories[2]);
    render(<ChargeAccessSection />);

    await user.click(
      await screen.findByRole('button', { name: 'Change who can charge Quartermaster › Officer brass' })
    );
    expect(screen.getByLabelText('Support Chief')).toBeChecked();
    await user.click(screen.getByLabelText('Quartermaster'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setChargeAccess).toHaveBeenCalledWith('brass', {
        chargeAccess: 'restricted',
        chargePositionIds: ['pos-sup', 'pos-qm'],
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Saved');
    // Reloaded, so the list shows what the backend now enforces.
    await waitFor(() => expect(chargeAccessSettings).toHaveBeenCalledTimes(2));
  });

  it('sets a sub-line back to its parent’s rule with null', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockResolvedValue(settings.categories[1]);
    render(<ChargeAccessSection />);

    await user.click(
      await screen.findByRole('button', { name: 'Change who can charge Quartermaster › Boot reimbursement' })
    );
    await user.selectOptions(screen.getByLabelText('Who can charge these lines'), '');
    expect(
      screen.getByText('Quartermaster is open to anyone who submits requests, so these lines are too.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setChargeAccess).toHaveBeenCalledWith('boots', { chargeAccess: null, chargePositionIds: [] })
    );
  });

  it('shows the backend’s refusal and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockRejectedValue(new Error('Position not found'));
    render(<ChargeAccessSection />);

    await user.click(await screen.findByRole('button', { name: 'Change who can charge Quartermaster' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Position not found'));
    expect(screen.getByLabelText('Who can charge these lines')).toBeInTheDocument();
  });
});
