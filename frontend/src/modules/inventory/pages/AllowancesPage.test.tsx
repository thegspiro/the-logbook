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
    for (const mock of [
      mockGetAllowances,
      mockCreateAllowance,
      mockUpdateAllowance,
      mockDeleteAllowance,
      mockGetCategories,
      mockGetRoles,
      mockToastSuccess,
      mockToastError,
    ]) {
      mock.mockReset();
    }
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Polos' }]);
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Firefighter' }]);
    mockGetAllowances.mockResolvedValue([
      {
        id: 'a1',
        organization_id: 'o1',
        category_id: 'cat-1',
        role_id: 'role-1',
        max_quantity: 3,
        period_type: 'annual',
        is_active: true,
      },
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

    await user.selectOptions(await screen.findByLabelText(/^Category/), 'cat-1');
    await user.clear(screen.getByLabelText(/^Max Quantity/));
    await user.type(screen.getByLabelText(/^Max Quantity/), '5');
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

  // 0 is a real setting ("none may be issued"); an emptied box is not 0.
  const openCreateForm = async (user: ReturnType<typeof userEvent.setup>) => {
    mockGetAllowances.mockResolvedValueOnce([]);
    mockCreateAllowance.mockResolvedValue({ id: 'a2' });
    renderWithRouter(<AllowancesPage />);
    await user.click(await screen.findByText('Create your first allowance'));
    await user.selectOptions(await screen.findByLabelText(/^Category/), 'cat-1');
    await user.clear(screen.getByLabelText(/^Max Quantity/));
  };

  it('accepts a maximum of 0', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    await user.type(screen.getByLabelText(/^Max Quantity/), '0');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateAllowance).toHaveBeenCalledWith({
        category_id: 'cat-1',
        role_id: undefined,
        max_quantity: 0,
        period_type: 'annual',
      });
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('refuses a blank maximum with a message', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    // Said on the field now rather than in a toast (forms review F-3/F-4).
    expect(screen.getByLabelText(/^Max Quantity/)).toHaveAccessibleDescription('Enter a whole number of 0 or more.');
    expect(mockCreateAllowance).not.toHaveBeenCalled();
  });

  it('puts a refused maximum on its field when creating', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    mockCreateAllowance.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'max_quantity', message: 'Input should be less than or equal to 2147483647' }] },
      },
    });
    await user.type(screen.getByLabelText(/^Max Quantity/), '9');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/^Max Quantity/)).toHaveAccessibleDescription(
        'Input should be less than or equal to 2147483647'
      )
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('saves the period on an edit whose maximum is refused, and stays open', async () => {
    const user = userEvent.setup();
    mockUpdateAllowance
      .mockRejectedValueOnce({
        response: {
          status: 422,
          data: { detail: [{ field: 'max_quantity', message: 'Input should be greater than or equal to 0' }] },
        },
      })
      .mockResolvedValueOnce({});
    renderWithRouter(<AllowancesPage />);
    await user.click(await screen.findByLabelText('Edit allowance'));
    await user.selectOptions(screen.getByLabelText('Period'), 'career');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateAllowance).toHaveBeenCalledTimes(2));
    expect(mockUpdateAllowance.mock.calls[1]?.[1]).toEqual({ period_type: 'career' });
    expect(screen.getByRole('alert')).toHaveTextContent('Allowance saved, except max quantity.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('asks before Cancel discards a typed maximum', async () => {
    const user = userEvent.setup();
    await openCreateForm(user);
    await user.type(screen.getByLabelText(/^Max Quantity/), '4');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^Max Quantity/)).toHaveValue(4);
  });

  it('says a zero allowance permits none', async () => {
    mockGetAllowances.mockResolvedValue([
      {
        id: 'a1',
        organization_id: 'o1',
        category_id: 'cat-1',
        role_id: 'role-1',
        max_quantity: 0,
        period_type: 'annual',
        is_active: true,
      },
    ]);
    renderWithRouter(<AllowancesPage />);

    expect(await screen.findByText('none may be issued')).toBeInTheDocument();
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
