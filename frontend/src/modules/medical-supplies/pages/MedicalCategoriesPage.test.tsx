import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../../../test/utils';

const mockGetCategories = vi.fn();
const mockGetItems = vi.fn();
const mockDeleteCategory = vi.fn();
const mockCheckPermission = vi.fn();
const mockCreateCategory = vi.fn();
const mockUpdateCategory = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
    deleteCategory: (...args: unknown[]) => mockDeleteCategory(...args) as unknown,
    createCategory: (...args: unknown[]) => mockCreateCategory(...args) as unknown,
    updateCategory: (...args: unknown[]) => mockUpdateCategory(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MedicalCategoriesPage from './MedicalCategoriesPage';

const category = (id: string, name: string) => ({
  id,
  organization_id: 'org-1',
  name,
  item_type: 'medical',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  allow_self_checkout: false,
  self_checkout_loan_days: null,
  active: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const AIRWAY = category('cat-airway', 'Airway');
const TRAUMA = category('cat-trauma', 'Trauma');

const itemsPage = (total: number) => ({ items: [], total, skip: 0, limit: 1 });

const renderPage = async () => {
  renderWithRouter(<MedicalCategoriesPage />);
  await screen.findByText('Airway');
};

const openDelete = async (name: string) => {
  await userEvent.click(screen.getByRole('button', { name: `Delete ${name}` }));
  return screen.findByRole('dialog');
};

describe('MedicalCategoriesPage delete', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockGetItems.mockReset();
    mockDeleteCategory.mockReset();
    mockCheckPermission.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();

    mockGetCategories.mockResolvedValue([AIRWAY, TRAUMA]);
    mockGetItems.mockResolvedValue(itemsPage(0));
    mockDeleteCategory.mockResolvedValue({ category_name: 'Airway', items_moved: 0, moved_to_name: null });
    mockCheckPermission.mockImplementation((permission: string) => permission === 'inventory.manage_medical');
  });

  it('offers no delete button without manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);

    await renderPage();

    expect(screen.queryByRole('button', { name: 'Delete Airway' })).not.toBeInTheDocument();
  });

  it('asks about supplies in the category, retired ones included', async () => {
    await renderPage();
    await openDelete('Airway');

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenCalledWith({ category_id: 'cat-airway', active_only: false, limit: 1 })
    );
  });

  it('deletes an empty category without asking where to move anything', async () => {
    await renderPage();
    const dialog = await openDelete('Airway');

    expect(await screen.findByText('No supplies use this category.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Move supplies to/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(() => expect(mockDeleteCategory).toHaveBeenCalledWith('cat-airway', undefined));
    expect(toast.success).toHaveBeenCalledWith('Deleted "Airway"');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(mockGetCategories).toHaveBeenCalledTimes(2);
  });

  it('will not delete a category that holds supplies until a destination is chosen', async () => {
    mockGetItems.mockResolvedValue(itemsPage(3));
    await renderPage();
    await openDelete('Airway');

    expect(await screen.findByText(/3 supplies use this category/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Delete category' });
    expect(confirm).toBeDisabled();
    expect(mockDeleteCategory).not.toHaveBeenCalled();

    // The category being deleted is not offered as its own destination.
    const select = screen.getByLabelText(/Move supplies to/);
    expect(screen.queryByRole('option', { name: 'Airway' })).not.toBeInTheDocument();

    await userEvent.selectOptions(select, 'cat-trauma');
    expect(confirm).toBeEnabled();
  });

  it('moves the supplies and says how many moved', async () => {
    mockGetItems.mockResolvedValue(itemsPage(3));
    mockDeleteCategory.mockResolvedValue({ category_name: 'Airway', items_moved: 3, moved_to_name: 'Trauma' });
    await renderPage();
    await openDelete('Airway');
    await screen.findByText(/3 supplies use this category/);

    await userEvent.selectOptions(screen.getByLabelText(/Move supplies to/), 'cat-trauma');
    await userEvent.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(() => expect(mockDeleteCategory).toHaveBeenCalledWith('cat-airway', 'cat-trauma'));
    expect(toast.success).toHaveBeenCalledWith('Deleted "Airway" and moved 3 supplies to "Trauma"');
  });

  it('says so when there is nowhere to move the supplies', async () => {
    mockGetCategories.mockResolvedValue([AIRWAY]);
    mockGetItems.mockResolvedValue(itemsPage(1));
    await renderPage();
    await openDelete('Airway');

    expect(await screen.findByRole('alert')).toHaveTextContent('no other category');
    expect(screen.getByRole('button', { name: 'Delete category' })).toBeDisabled();
  });

  it('keeps the dialog open and re-checks the count when the server refuses', async () => {
    // Empty when the dialog opened; a supply was filed under it meanwhile.
    mockGetItems.mockResolvedValueOnce(itemsPage(0)).mockResolvedValue(itemsPage(2));
    mockDeleteCategory.mockRejectedValue(new Error('2 supplies use this category.'));
    await renderPage();
    await openDelete('Airway');
    await screen.findByText('No supplies use this category.');

    await userEvent.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(await screen.findByText(/2 supplies use this category/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Move supplies to/)).toBeInTheDocument();
  });

  it('closes the dialog and reports when the supply check itself fails', async () => {
    mockGetItems.mockRejectedValue(new Error('boom'));
    await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Airway' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDeleteCategory).not.toHaveBeenCalled();
  });
});

describe('MedicalCategoriesPage supplies per category', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockGetItems.mockReset();
    mockCheckPermission.mockReset();
    mockGetCategories.mockResolvedValue([AIRWAY, TRAUMA]);
    mockCheckPermission.mockReturnValue(false);
    mockGetItems.mockResolvedValue({
      items: [
        { id: 'item-1', name: 'Bag Valve Mask', size: 'Adult', quantity: 2 },
        { id: 'item-2', name: 'Nasal Cannula', quantity: 0, is_lot_stocked: true, lot_stock: 12 },
      ],
      total: 2,
      skip: 0,
      limit: 100,
    });
  });

  it('loads nothing until a category is opened', async () => {
    await renderPage();

    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it("lists a category's supplies, by name, with the stock each holds", async () => {
    await renderPage();

    const toggles = screen.getAllByRole('button', { name: 'Show supplies' });
    await userEvent.click(toggles[0] ?? document.body);

    const list = await screen.findByRole('list', { name: 'Supplies in Airway' });
    expect(list).toHaveTextContent('Bag Valve Mask — Adult');
    // Lot-stocked: the lots are the stock, not the stale column.
    expect(list).toHaveTextContent('12 on hand');
    expect(mockGetItems).toHaveBeenCalledWith({
      category_id: 'cat-airway',
      sort_by: 'name',
      sort_order: 'asc',
      limit: 100,
    });
    expect(screen.getAllByRole('button', { name: 'Hide supplies' })[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('says so when a category is empty', async () => {
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 100 });
    await renderPage();

    await userEvent.click(screen.getAllByRole('button', { name: 'Show supplies' })[1] ?? document.body);

    expect(await screen.findByText('No supplies in this category yet.')).toBeInTheDocument();
  });

  it('points to the full list when a category holds more than it shows', async () => {
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: 'Bag Valve Mask', quantity: 2 }],
      total: 150,
      skip: 0,
      limit: 100,
    });
    await renderPage();

    await userEvent.click(screen.getAllByRole('button', { name: 'Show supplies' })[0] ?? document.body);

    expect(await screen.findByText(/Showing 1 of 150/)).toBeInTheDocument();
  });

  it('shows an error rather than an empty list when the load fails', async () => {
    mockGetItems.mockRejectedValue(new Error('Server unavailable'));
    await renderPage();

    await userEvent.click(screen.getAllByRole('button', { name: 'Show supplies' })[0] ?? document.body);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByText('No supplies in this category yet.')).not.toBeInTheDocument();
  });
});

describe('MedicalCategoriesPage low stock threshold', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
  });

  it('says how many supplies a category holds before it is opened', async () => {
    mockGetCategories.mockResolvedValue([
      { ...AIRWAY, item_count: 3 },
      { ...TRAUMA, item_count: 1 },
    ]);
    renderWithRouter(<MedicalCategoriesPage />);

    const show = await screen.findByRole('button', { name: 'Show 3 supplies' });
    expect(screen.getByRole('button', { name: 'Show 1 supply' })).toBeInTheDocument();

    await userEvent.click(show);
    expect(screen.getByRole('button', { name: 'Hide 3 supplies' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('prints the threshold when set and nothing when the API sends null', async () => {
    mockGetCategories.mockResolvedValue([
      { ...AIRWAY, low_stock_threshold: null },
      { ...TRAUMA, low_stock_threshold: 4 },
    ]);
    renderWithRouter(<MedicalCategoriesPage />);
    await screen.findByText('Airway');

    expect(screen.getByText('Low stock at 4 or below')).toBeInTheDocument();
    expect(screen.getAllByText(/Low stock at/)).toHaveLength(1);
  });
});

describe('MedicalCategoriesPage duplicate names', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
  });

  it('flags a grandfathered duplicate so it can be renamed', async () => {
    mockGetCategories.mockResolvedValue([
      { ...AIRWAY, duplicate_name: true },
      { ...TRAUMA, duplicate_name: false },
    ]);
    renderWithRouter(<MedicalCategoriesPage />);
    await screen.findByText('Airway');

    const [airwayCard, traumaCard] = screen.getAllByRole('listitem');
    expect(airwayCard).toHaveTextContent('Airway');
    expect(airwayCard).toHaveTextContent('Duplicate name');
    expect(traumaCard).not.toHaveTextContent('Duplicate name');
  });
});

describe('MedicalCategoriesPage category form', () => {
  beforeEach(() => {
    mockGetCategories.mockReset();
    mockGetItems.mockReset();
    mockCreateCategory.mockReset();
    mockUpdateCategory.mockReset();
    mockCheckPermission.mockReset();
    mockGetCategories.mockResolvedValue([AIRWAY, TRAUMA]);
    mockGetItems.mockResolvedValue(itemsPage(0));
    mockCheckPermission.mockImplementation((permission: string) => permission === 'inventory.manage_medical');
  });

  it('names a missing name on its field and creates nothing', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /New category/ }));
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveAccessibleDescription('Give the category a name.');
    expect(mockCreateCategory).not.toHaveBeenCalled();
  });

  it('puts a 422 on the field it names', async () => {
    mockCreateCategory.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'description', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /New category/ }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Burns');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Description/ })).toHaveAccessibleDescription(
        expect.stringContaining('Value is too long.')
      )
    );
  });

  it('saves the rest of an edit and keeps a refused field flagged, open', async () => {
    mockUpdateCategory
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'name', message: 'That name is taken.' }] } },
      })
      .mockResolvedValueOnce(AIRWAY);
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Airway' }));
    await user.type(screen.getByRole('spinbutton', { name: /^Low stock threshold/ }), '4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdateCategory).toHaveBeenCalledTimes(2));
    expect(mockUpdateCategory.mock.calls[1]?.[1]).not.toHaveProperty('name');
    expect(mockUpdateCategory.mock.calls[1]?.[1]).toMatchObject({ low_stock_threshold: 4 });
    expect(screen.getByRole('alert')).toHaveTextContent('Category saved, except name.');
  });

  it('asks before Cancel discards a typed name', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /New category/ }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Burns');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Burns');
  });
});
