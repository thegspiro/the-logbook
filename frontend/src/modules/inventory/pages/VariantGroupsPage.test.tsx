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
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
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
    await user.type(
      await screen.findByPlaceholderText('e.g. Class A Dress Uniform'),
      'New Group',
    );
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

  it('hides management actions without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetVariantGroups.mockResolvedValue([makeGroup()]);
    renderWithRouter(<VariantGroupsPage />);
    await screen.findByText('Class A Uniform');

    expect(screen.queryByRole('button', { name: /Add Group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Class A Uniform' })).not.toBeInTheDocument();
  });
});
