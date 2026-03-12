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
      expect(mockGetCategories).toHaveBeenCalledWith();
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
      expect(mockCreateCategory).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Radios' }),
      );
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
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith();
    });
  });

  it('validates that category name is required', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryCategoriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Category'));
    await user.click(await screen.findByText('Create Category'));
    // The form uses HTML required attribute, so the browser prevents submission
    // and createCategory should NOT be called
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });
});
