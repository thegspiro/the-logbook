import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ItemVariantGroup } from '../types';

const mockGetVariantGroups = vi.fn();
const mockGetVariantGroup = vi.fn();
const mockGetCategories = vi.fn();
const mockCreateVariantGroup = vi.fn();
const mockUpdateVariantGroup = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getVariantGroups: (...a: unknown[]) => mockGetVariantGroups(...a) as unknown,
    getVariantGroup: (...a: unknown[]) => mockGetVariantGroup(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    createVariantGroup: (...a: unknown[]) => mockCreateVariantGroup(...a) as unknown,
    updateVariantGroup: (...a: unknown[]) => mockUpdateVariantGroup(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import VariantGroupsPage from './VariantGroupsPage';

const makeGroup = (overrides: Partial<ItemVariantGroup> = {}): ItemVariantGroup => ({
  id: 'g-1',
  organization_id: 'org-1',
  name: 'Class A Uniform',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('VariantGroupsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVariantGroups.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockCreateVariantGroup.mockResolvedValue({});
    mockUpdateVariantGroup.mockResolvedValue({});
    mockGetVariantGroup.mockResolvedValue(makeGroup());
    mockCheckPermission.mockReturnValue(true);
  });

  it('shows the empty state when there are no groups', async () => {
    renderWithRouter(<VariantGroupsPage />);
    expect(await screen.findByText(/No active variant groups yet/)).toBeInTheDocument();
    expect(mockGetVariantGroups).toHaveBeenCalledWith(true);
  });

  it('shows an error toast when groups fail to load', async () => {
    mockGetVariantGroups.mockRejectedValue(new Error('boom'));
    renderWithRouter(<VariantGroupsPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders group cards', async () => {
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    renderWithRouter(<VariantGroupsPage />);
    expect(await screen.findByText('Class A Uniform')).toBeInTheDocument();
  });

  it('reloads with inactive groups when the toggle is checked', async () => {
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText(/No active variant groups yet/);

    await userEvent.click(screen.getByLabelText('Show inactive'));
    await waitFor(() => expect(mockGetVariantGroups).toHaveBeenCalledWith(false));
  });

  it('creates a group', async () => {
    // Load an existing group so only the header "Add Group" button is present
    // (the empty state renders its own duplicate button).
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: /Add Group/ }));
    await user.type(await screen.findByPlaceholderText('e.g. Class A Dress Uniform'), 'New Group');
    await user.click(screen.getByRole('button', { name: 'Create Group' }));

    await waitFor(() => expect(mockCreateVariantGroup).toHaveBeenCalledTimes(1));
    expect(mockCreateVariantGroup.mock.calls[0]?.[0]).toMatchObject({ name: 'New Group' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Variant group created');
  });

  it('edits an existing group', async () => {
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: 'Edit Class A Uniform' }));
    expect(await screen.findByText('Edit Variant Group')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update Group' }));

    await waitFor(() => expect(mockUpdateVariantGroup).toHaveBeenCalledTimes(1));
    expect(mockUpdateVariantGroup.mock.calls[0]?.[0]).toBe('g-1');
  });

  it('toggles a group active state', async () => {
    mockGetVariantGroups.mockResolvedValue([makeGroup({ active: true })]);
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: 'Deactivate Class A Uniform' }));
    await waitFor(() => expect(mockUpdateVariantGroup).toHaveBeenCalledWith('g-1', { active: false }));
  });

  it('opens the detail modal and fetches the full group', async () => {
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    mockGetVariantGroup.mockResolvedValue(makeGroup({ items: [] }));
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: 'View Class A Uniform' }));
    await waitFor(() => expect(mockGetVariantGroup).toHaveBeenCalledWith('g-1'));
    expect(await screen.findByText(/Stock Matrix/)).toBeInTheDocument();
  });

  // It once told the quartermaster to "assign them to this group" when no form
  // could; the item form's Variant Group picker now does (W40-7).
  it('points an empty group at the item form picker', async () => {
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    mockGetVariantGroup.mockResolvedValue(makeGroup({ items: [] }));
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: 'View Class A Uniform' }));

    expect(await screen.findByText(/choosing this group under Variant Group/)).toBeInTheDocument();
    expect(screen.queryByText(/assign them to this group/)).not.toBeInTheDocument();
  });

  it('orders stock matrix rows by size, not by the order items arrive in', async () => {
    // The API returns variants in no particular order; the rows are built from
    // a Set, so without an explicit sort the grid reads S, L, XL, M.
    const variant = (size: string, quantity: number) => ({
      id: `i-${size}`,
      organization_id: 'org-1',
      name: `Class A Uniform — ${size.toUpperCase()}`,
      standard_size: size,
      color: 'Navy',
      quantity,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    mockGetVariantGroup.mockResolvedValue(
      makeGroup({
        items: [variant('l', 4), variant('xs', 1), variant('xl', 5), variant('m', 3)] as never,
      })
    );
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    await user.click(screen.getByRole('button', { name: 'View Class A Uniform' }));
    await screen.findByText(/Stock Matrix/);

    // Row text is the size run together with its quantity ("xs1"); the size is
    // upper-cased in CSS, so compare against the stored codes.
    const sizes = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => (row.textContent ?? '').replace(/[\d\s]/g, ''));
    expect(sizes).toEqual(['xs', 'm', 'l', 'xl']);
  });

  it('hides management actions without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    expect(screen.queryByRole('button', { name: /Add Group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Class A Uniform' })).not.toBeInTheDocument();
  });
});

describe('VariantGroupsPage add dialog validation', () => {
  beforeEach(() => {
    mockGetVariantGroups.mockReset();
    mockGetCategories.mockReset();
    mockCreateVariantGroup.mockReset();
    mockCheckPermission.mockReset();
    mockToastError.mockReset();
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    mockGetCategories.mockResolvedValue([]);
    mockCreateVariantGroup.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(true);
  });

  const openAdd = async () => {
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');
    await user.click(screen.getByRole('button', { name: /Add Group/ }));
    await screen.findByText('Add Variant Group');
    return user;
  };

  it('names the missing name under its field and sends nothing', async () => {
    const user = await openAdd();
    await user.click(screen.getByRole('button', { name: 'Create Group' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for the group.');
    expect(name).toHaveFocus();
    expect(mockCreateVariantGroup).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('puts a 422 on the field it names', async () => {
    mockCreateVariantGroup.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'unit_of_measure', message: 'Value is too long.' }] } },
    });
    const user = await openAdd();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Dress Shirts');
    await user.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(
      await screen.findByRole('textbox', { name: 'Unit of Measure', description: 'Value is too long.' })
    ).toHaveFocus();
  });

  it('shows a server failure inside the dialog, not as a toast', async () => {
    mockCreateVariantGroup.mockRejectedValue(new Error('Database unavailable'));
    const user = await openAdd();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Dress Shirts');
    await user.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(mockToastError).not.toHaveBeenCalled();
    expect(screen.getByText('Add Variant Group')).toBeInTheDocument();
  });
});

describe('VariantGroupsPage dialog: amounts, edits and discarding', () => {
  beforeEach(() => {
    mockGetVariantGroups.mockReset();
    mockGetCategories.mockReset();
    mockCreateVariantGroup.mockReset();
    mockUpdateVariantGroup.mockReset();
    mockCheckPermission.mockReset();
    mockToastSuccess.mockReset();
    mockGetVariantGroups.mockResolvedValue([makeGroup({ base_price: 40 })]);
    mockGetCategories.mockResolvedValue([]);
    mockCreateVariantGroup.mockResolvedValue({});
    mockUpdateVariantGroup.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(true);
  });

  it('flags a negative price on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');
    await user.click(screen.getByRole('button', { name: /Add Group/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Dress Shirts');
    await user.type(screen.getByRole('spinbutton', { name: 'Base Price' }), '-5');
    await user.click(screen.getByRole('button', { name: 'Create Group' }));

    expect(screen.getByRole('spinbutton', { name: 'Base Price' })).toHaveAccessibleDescription(
      'Enter an amount of 0 or more, or leave it empty.'
    );
    expect(mockCreateVariantGroup).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit and keeps a refused field flagged, open', async () => {
    mockUpdateVariantGroup.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'base_price', message: 'Input should be less than 1000000' }] },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');
    await user.click(screen.getByRole('button', { name: 'Edit Class A Uniform' }));
    await user.type(await screen.findByRole('textbox', { name: 'Unit of Measure' }), 'each');
    await user.click(screen.getByRole('button', { name: 'Update Group' }));

    await waitFor(() => expect(mockUpdateVariantGroup).toHaveBeenCalledTimes(2));
    expect(mockUpdateVariantGroup.mock.calls[1]?.[1]).not.toHaveProperty('base_price');
    expect(mockUpdateVariantGroup.mock.calls[1]?.[1]).toMatchObject({ unit_of_measure: 'each' });
    expect(screen.getByRole('alert')).toHaveTextContent('Variant group saved, except base price.');
    expect(screen.getByRole('spinbutton', { name: 'Base Price' })).toHaveAccessibleDescription(
      'Input should be less than 1000000.'
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('asks before Cancel discards what was typed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');
    await user.click(screen.getByRole('button', { name: /Add Group/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Dress Shirts');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Dress Shirts');
  });
});
