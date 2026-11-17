/**
 * A budget owner's "Who can charge your lines" section on My Budgets.
 *
 * Which categories appear, and the rule each is under, are the backend's; the
 * section words them and saves the owner's choice as one whole setting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

import { renderWithRouter } from '@/test/utils';
import { ChargeAccessSection } from './ChargeAccessSection';

// renderWithRouter supplies the app root's ConfirmProvider, which the dialog
// needs to ask before discarding a changed choice.

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
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('ChargeAccessSection', () => {
  it('renders nothing for a member who owns no categories', async () => {
    chargeAccessSettings.mockResolvedValue({ categories: [], positions: [] });
    const { container } = renderWithRouter(<ChargeAccessSection />);
    await waitFor(() => expect(chargeAccessSettings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the owner’s categories by path with the rule each is under', async () => {
    renderWithRouter(<ChargeAccessSection />);

    expect(await screen.findByText('Quartermaster › Officer brass')).toBeInTheDocument();
    expect(screen.getByText('Restricted to the owner and Support Chief')).toBeInTheDocument();
    expect(screen.getByText('Quartermaster › Boot reimbursement')).toBeInTheDocument();
    expect(screen.getAllByText('Anyone can charge')).toHaveLength(2);
  });

  it('adds a position to a restricted line and saves the whole setting', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockResolvedValue(settings.categories[2]);
    renderWithRouter(<ChargeAccessSection />);

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
    renderWithRouter(<ChargeAccessSection />);

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
    renderWithRouter(<ChargeAccessSection />);

    await user.click(await screen.findByRole('button', { name: 'Change who can charge Quartermaster' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Position not found'));
    expect(screen.getByLabelText('Who can charge these lines')).toBeInTheDocument();
    // Said in the dialog too, where it stays after the toast fades.
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Position not found');
  });

  it('puts a 422 on the part of the setting it names', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'charge_position_ids', message: 'List should have at most 200 items' }] },
      },
    });
    renderWithRouter(<ChargeAccessSection />);

    await user.click(
      await screen.findByRole('button', { name: 'Change who can charge Quartermaster › Officer brass' })
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const positions = await screen.findByRole('group', { name: 'Also allow these positions' });
    await waitFor(() => expect(positions).toHaveAccessibleDescription('List should have at most 200 items'));
    expect(positions).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('puts a refused rule on the select', async () => {
    const user = userEvent.setup();
    setChargeAccess.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'charge_access', message: "Input should be 'open' or 'restricted'" }] },
      },
    });
    renderWithRouter(<ChargeAccessSection />);

    await user.click(await screen.findByRole('button', { name: 'Change who can charge Quartermaster' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const select = screen.getByLabelText('Who can charge these lines');
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(select).toHaveAccessibleDescription(expect.stringContaining("Input should be 'open' or 'restricted'"));
    expect(select).toHaveFocus();
  });

  it('asks before Cancel throws a changed choice away', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChargeAccessSection />);

    await user.click(
      await screen.findByRole('button', { name: 'Change who can charge Quartermaster › Officer brass' })
    );
    await user.click(screen.getByLabelText('Quartermaster'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const ask = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    expect(within(ask).getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Who can charge these lines')).toBeInTheDocument();
  });

  it('closes on Cancel without asking when nothing changed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChargeAccessSection />);

    await user.click(await screen.findByRole('button', { name: 'Change who can charge Quartermaster' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('Who can charge these lines')).not.toBeInTheDocument());
  });
});
