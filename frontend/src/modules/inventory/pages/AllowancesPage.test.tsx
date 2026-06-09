import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetAllowances = vi.fn();
const mockCreateAllowance = vi.fn();
const mockUpdateAllowance = vi.fn();
const mockDeleteAllowance = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRoles = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getAllowances: (...a: unknown[]) => mockGetAllowances(...a) as unknown,
    createAllowance: (...a: unknown[]) => mockCreateAllowance(...a) as unknown,
    updateAllowance: (...a: unknown[]) => mockUpdateAllowance(...a) as unknown,
    deleteAllowance: (...a: unknown[]) => mockDeleteAllowance(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
  },
}));

vi.mock('../../../services/userServices', () => ({
  roleService: {
    getRoles: (...a: unknown[]) => mockGetRoles(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import AllowancesPage from './AllowancesPage';

describe('AllowancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Polos' }]);
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Firefighter' }]);
    mockGetAllowances.mockResolvedValue([
      { id: 'a1', organization_id: 'o1', category_id: 'cat-1', role_id: 'role-1', max_quantity: 3, period_type: 'annual', is_active: true },
    ]);
  });

  it('lists allowances with resolved category and role names', async () => {
    renderWithRouter(<AllowancesPage />);
    await waitFor(() => {
      expect(screen.getByText('Polos')).toBeInTheDocument();
    });
    expect(screen.getByText(/Firefighter/)).toBeInTheDocument();
    expect(screen.getByText(/max/)).toBeInTheDocument();
  });

  it('creates a new allowance', async () => {
    const user = userEvent.setup();
    mockGetAllowances.mockResolvedValueOnce([]);
    mockCreateAllowance.mockResolvedValue({ id: 'a2' });
    renderWithRouter(<AllowancesPage />);

    await waitFor(() => {
      expect(screen.getByText('No Allowances Configured')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Create your first allowance'));

    await user.selectOptions(await screen.findByLabelText('Category'), 'cat-1');
    await user.clear(screen.getByLabelText('Max Quantity'));
    await user.type(screen.getByLabelText('Max Quantity'), '5');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateAllowance).toHaveBeenCalledWith({
        category_id: 'cat-1',
        role_id: undefined,
        max_quantity: 5,
        period_type: 'annual',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Allowance created');
  });

  it('deletes an allowance after confirmation', async () => {
    const user = userEvent.setup();
    mockDeleteAllowance.mockResolvedValue(undefined);
    renderWithRouter(<AllowancesPage />);

    await waitFor(() => {
      expect(screen.getByText('Polos')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Delete allowance'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteAllowance).toHaveBeenCalledWith('a1');
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Allowance deleted');
  });
});
