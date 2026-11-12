import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetCategories = vi.fn();
const mockCreateCategory = vi.fn();
const mockUpdateCategory = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    createCategory: (...args: unknown[]) => mockCreateCategory(...args) as unknown,
    updateCategory: (...args: unknown[]) => mockUpdateCategory(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as unknown,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import InventoryCategoriesPage from './InventoryCategoriesPage';

const makeCategory = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  name: 'Turnout Gear',
  description: 'Bunker gear for firefighters',
  item_type: 'ppe',
  requires_serial_number: true,
  requires_maintenance: true,
  requires_assignment: true,
  nfpa_tracking_enabled: true,
  low_stock_threshold: 5,
  organization_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('InventoryCategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(true);
    mockGetCategories.mockResolvedValue([makeCategory()]);
  });

  it('renders page title and subtitle', async () => {
    renderWithRouter(<InventoryCategoriesPage />);
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText(/Organize inventory items by type/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetCategories).toHaveBeenCalledWith(undefined, true);
    });
  });

  it('loads and displays categories', async () => {
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    // PPE appears in both filter dropdown and category badge, use getAllByText
    expect(screen.getAllByText('PPE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Bunker gear for firefighters')).toBeInTheDocument();
  });

  it('shows tracking badges on category cards', async () => {
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    expect(screen.getByText('Serial #')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Assignment')).toBeInTheDocument();
    expect(screen.getByText('NFPA')).toBeInTheDocument();
  });

  it('shows low stock threshold', async () => {
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText(/Low stock alert at 5 items/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no categories', async () => {
    mockGetCategories.mockResolvedValue([]);
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText(/No categories yet/)).toBeInTheDocument();
    });
  });

  it('shows filtered empty state', async () => {
    const user = userEvent.setup();
    mockGetCategories.mockResolvedValue([]);
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText(/No categories yet/)).toBeInTheDocument();
    });
    const select = screen.getByLabelText('Filter by type:');
    await user.selectOptions(select, 'uniform');
    await waitFor(() => {
      expect(mockGetCategories).toHaveBeenCalledWith('uniform', true);
    });
  });

  it('shows Add Category button when user has permission', async () => {
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    expect(screen.getByText('Add Category')).toBeInTheDocument();
  });

  it('hides Add Category button when user lacks permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    expect(screen.queryByText('Add Category')).not.toBeInTheDocument();
  });

  it('opens create modal and submits new category', async () => {
    const user = userEvent.setup();
    mockCreateCategory.mockResolvedValue({ id: 'cat-new' });
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Category'));
    await waitFor(() => {
      expect(screen.getByText('Create Category')).toBeInTheDocument();
    });
    const nameInput = screen.getByPlaceholderText('e.g. Turnout Gear');
    await user.type(nameInput, 'Radios');
    await user.click(screen.getByText('Create Category'));
    await waitFor(() => {
      expect(mockCreateCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Radios' }));
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Category created');
  });

  it('opens edit modal with pre-filled data', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    const editButton = screen.getByLabelText('Edit Turnout Gear');
    await user.click(editButton);
    await waitFor(() => {
      expect(screen.getByText('Edit Category')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('e.g. Turnout Gear')).toHaveValue('Turnout Gear');
  });

  it('updates an existing category', async () => {
    const user = userEvent.setup();
    mockUpdateCategory.mockResolvedValue({});
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Edit Turnout Gear'));
    await waitFor(() => {
      expect(screen.getByText('Update Category')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Update Category'));
    await waitFor(() => {
      expect(mockUpdateCategory).toHaveBeenCalledWith('cat-1', expect.any(Object));
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Category updated');
  });

  it('handles create error', async () => {
    const user = userEvent.setup();
    mockCreateCategory.mockRejectedValue(new Error('Server error'));
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Category'));
    const nameInput = await screen.findByPlaceholderText('e.g. Turnout Gear');
    await user.type(nameInput, 'Test');
    await user.click(screen.getByText('Create Category'));
    // A server failure is shown inside the dialog, which stays open.
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    expect(mockToastError).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Test');
  });
});

describe('InventoryCategoriesPage add dialog validation', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockCreateCategory.mockReset();
    mockCheckPermission.mockReset();
    mockToastError.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetCategories.mockResolvedValue([makeCategory()]);
    mockCreateCategory.mockResolvedValue({ id: 'cat-new' });
  });

  const openAdd = async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await screen.findByText('Turnout Gear');
    await user.click(screen.getByText('Add Category'));
    await screen.findByText('Create Category');
    return user;
  };

  it('names the missing name under its field and sends nothing', async () => {
    const user = await openAdd();
    await user.click(screen.getByText('Create Category'));
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for the category.');
    expect(name).toHaveFocus();
    expect(mockCreateCategory).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('puts a 422 on the field it names', async () => {
    mockCreateCategory.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'name', message: 'Value is too long.' }] } },
    });
    const user = await openAdd();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Radios');
    await user.click(screen.getByText('Create Category'));
    expect(await screen.findByRole('textbox', { name: 'Name', description: 'Value is too long.' })).toHaveFocus();
  });
});

describe('InventoryCategoriesPage dialog: numbers, edits and discarding', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockCreateCategory.mockReset();
    mockUpdateCategory.mockReset();
    mockCheckPermission.mockReset();
    mockToastSuccess.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockGetCategories.mockResolvedValue([makeCategory()]);
    mockCreateCategory.mockResolvedValue({ id: 'cat-new' });
    mockUpdateCategory.mockResolvedValue({});
  });

  it('flags a negative threshold on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await screen.findByText('Turnout Gear');
    await user.click(screen.getByText('Add Category'));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Radios');
    await user.type(screen.getByRole('spinbutton', { name: 'Low Stock Threshold' }), '-3');
    await user.click(screen.getByText('Create Category'));

    expect(screen.getByRole('spinbutton', { name: 'Low Stock Threshold' })).toHaveAccessibleDescription(
      expect.stringContaining('Enter a whole number of 0 or more') as string
    );
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit and keeps a refused field flagged, open', async () => {
    mockUpdateCategory.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [{ field: 'low_stock_threshold', message: 'Input should be less than or equal to 2147483647' }],
        },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await screen.findByText('Turnout Gear');
    await user.click(screen.getByLabelText('Edit Turnout Gear'));
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.type(description, 'Structural gear');
    await user.click(screen.getByText('Update Category'));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(2));
    expect(mockUpdateCategory.mock.calls[1]?.[1]).not.toHaveProperty('low_stock_threshold');
    expect(mockUpdateCategory.mock.calls[1]?.[1]).toMatchObject({ description: 'Structural gear' });
    expect(screen.getByRole('spinbutton', { name: 'Low Stock Threshold' })).toHaveAccessibleDescription(
      expect.stringContaining('less than or equal to') as string
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Category saved, except low stock threshold.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('asks before Cancel discards what was typed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await screen.findByText('Turnout Gear');
    await user.click(screen.getByText('Add Category'));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Radios');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Radios');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByText('Create Category')).not.toBeInTheDocument());
  });
});

describe('InventoryCategoriesPage duplicate names', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
  });

  it('flags a grandfathered duplicate and leaves other cards alone', async () => {
    mockGetCategories.mockResolvedValue([
      makeCategory({ id: 'cat-a', name: 'Radios', duplicate_name: true }),
      makeCategory({ id: 'cat-b', name: 'radios', duplicate_name: true }),
      makeCategory({ id: 'cat-c', name: 'Turnout Gear', duplicate_name: false }),
    ]);
    renderWithRouter(<InventoryCategoriesPage />);
    await screen.findByText('Turnout Gear');

    // Three cards, two flagged: the unflagged Turnout Gear card carries none.
    expect(screen.getAllByText('Duplicate name')).toHaveLength(2);
  });
});
