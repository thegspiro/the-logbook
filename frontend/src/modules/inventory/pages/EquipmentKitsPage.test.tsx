import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { EquipmentKit } from '../types';

const mockGetEquipmentKits = vi.fn();
const mockGetEquipmentKit = vi.fn();
const mockGetItems = vi.fn();
const mockGetCategories = vi.fn();
const mockCreateEquipmentKit = vi.fn();
const mockUpdateEquipmentKit = vi.fn();
const mockIssueKitToMember = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getEquipmentKits: (...a: unknown[]) => mockGetEquipmentKits(...a) as unknown,
    getEquipmentKit: (...a: unknown[]) => mockGetEquipmentKit(...a) as unknown,
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    createEquipmentKit: (...a: unknown[]) => mockCreateEquipmentKit(...a) as unknown,
    updateEquipmentKit: (...a: unknown[]) => mockUpdateEquipmentKit(...a) as unknown,
    issueKitToMember: (...a: unknown[]) => mockIssueKitToMember(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

// Stub the member picker (it pulls in a camera scanner) with a select button.
vi.mock('../../../components/MemberPickerModal', () => ({
  MemberPickerModal: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean;
    onSelect: (m: { userId: string; memberName: string }) => void;
  }) =>
    isOpen ? (
      <button type="button" onClick={() => onSelect({ userId: 'u-9', memberName: 'Picked' })}>
        pick-member
      </button>
    ) : null,
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
  },
}));

import EquipmentKitsPage from './EquipmentKitsPage';

const makeKit = (overrides: Partial<EquipmentKit> = {}): EquipmentKit => ({
  id: 'k-1',
  organization_id: 'org-1',
  name: 'Recruit Kit',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  line_items: [],
  ...overrides,
});

describe('EquipmentKitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEquipmentKits.mockResolvedValue([]);
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetCategories.mockResolvedValue([]);
    mockGetEquipmentKit.mockResolvedValue(makeKit());
    mockCreateEquipmentKit.mockResolvedValue({});
    mockUpdateEquipmentKit.mockResolvedValue({});
    mockIssueKitToMember.mockResolvedValue({ message: 'ok', items_issued: 3 });
    mockCheckPermission.mockReturnValue(true);
  });

  it('shows the empty state when there are no kits', async () => {
    renderWithRouter(<EquipmentKitsPage />);
    expect(await screen.findByText(/No active kits yet/)).toBeInTheDocument();
    expect(mockGetEquipmentKits).toHaveBeenCalledWith(true);
  });

  it('shows an error toast when kits fail to load', async () => {
    mockGetEquipmentKits.mockRejectedValue(new Error('boom'));
    renderWithRouter(<EquipmentKitsPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders kit cards', async () => {
    mockGetEquipmentKits.mockResolvedValue([makeKit()]);
    renderWithRouter(<EquipmentKitsPage />);
    expect(await screen.findByText('Recruit Kit')).toBeInTheDocument();
  });

  it('reloads including inactive kits when toggled', async () => {
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText(/No active kits yet/);
    await userEvent.click(screen.getByLabelText('Show inactive'));
    await waitFor(() => expect(mockGetEquipmentKits).toHaveBeenCalledWith(false));
  });

  it('creates a kit with a custom line item', async () => {
    mockGetEquipmentKits.mockResolvedValue([makeKit()]);
    const user = userEvent.setup();
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText('Recruit Kit');

    await user.click(screen.getByRole('button', { name: /Add Kit/ }));
    await user.type(await screen.findByPlaceholderText('e.g. New Recruit Kit'), 'Officer Kit');
    await user.type(screen.getByPlaceholderText('Custom item name'), 'Helmet');
    await user.click(screen.getByRole('button', { name: 'Create Kit' }));

    await waitFor(() => expect(mockCreateEquipmentKit).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentKit.mock.calls[0]?.[0]).toMatchObject({ name: 'Officer Kit' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Kit created');
  });

  it('edits a kit (fetches full detail first)', async () => {
    mockGetEquipmentKits.mockResolvedValue([makeKit()]);
    mockGetEquipmentKit.mockResolvedValue(
      makeKit({
        line_items: [
          {
            id: 'li-1',
            kit_id: 'k-1',
            item_name: 'Helmet',
            quantity: 1,
            size_selectable: false,
            sort_order: 0,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText('Recruit Kit');

    await user.click(screen.getByRole('button', { name: 'Edit Recruit Kit' }));
    await waitFor(() => expect(mockGetEquipmentKit).toHaveBeenCalledWith('k-1'));
    expect(await screen.findByText('Edit Kit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update Kit' }));

    await waitFor(() => expect(mockUpdateEquipmentKit).toHaveBeenCalledTimes(1));
    expect(mockUpdateEquipmentKit.mock.calls[0]?.[0]).toBe('k-1');
  });

  it('toggles a kit active state', async () => {
    mockGetEquipmentKits.mockResolvedValue([makeKit({ active: true })]);
    const user = userEvent.setup();
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText('Recruit Kit');

    await user.click(screen.getByRole('button', { name: 'Deactivate Recruit Kit' }));
    await waitFor(() => expect(mockUpdateEquipmentKit).toHaveBeenCalledWith('k-1', { active: false }));
  });

  it('issues a kit to a selected member', async () => {
    mockGetEquipmentKits.mockResolvedValue([makeKit({ active: true })]);
    const user = userEvent.setup();
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText('Recruit Kit');

    await user.click(screen.getByRole('button', { name: 'Issue Recruit Kit to a member' }));
    await user.click(await screen.findByRole('button', { name: 'pick-member' }));

    await waitFor(() => expect(mockIssueKitToMember).toHaveBeenCalledWith('k-1', 'u-9'));
    expect(mockToastSuccess).toHaveBeenCalledWith('Issued 3 items from "Recruit Kit"');
  });

  it('hides management actions without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetEquipmentKits.mockResolvedValue([makeKit()]);
    renderWithRouter(<EquipmentKitsPage />);
    await screen.findByText('Recruit Kit');

    expect(screen.queryByRole('button', { name: /Add Kit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Recruit Kit' })).not.toBeInTheDocument();
  });
});
