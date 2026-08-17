import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockGetSummary = vi.fn();
const mockGetItems = vi.fn();
const mockGetCategories = vi.fn();
const mockGetExpiringLots = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getExpiringLots: (...args: unknown[]) => mockGetExpiringLots(...args) as unknown,
  },
}));

// Both call forms, because both are used against this store: the page
// destructures (`useAuthStore()`), and useTimezone passes a selector
// (`useAuthStore((s) => s.user?.timezone)`). A mock that honours only the
// destructuring form hands the selector call the whole state object, which
// then reaches Intl as a timezone and throws.
vi.mock('../../../stores/authStore', () => {
  const state = {
    user: { timezone: 'America/New_York' },
    checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
  };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MedicalSuppliesPage from './MedicalSuppliesPage';

const summary = {
  total_items: 12,
  expiring_soon: 3,
  expired: 1,
  low_stock: 2,
  expiring_within_days: 30,
};

const expiringLot = (overrides: Record<string, unknown> = {}) => ({
  id: 'lot-1',
  organization_id: 'org-1',
  inventory_item_id: 'item-1',
  item_name: '4x4 Gauze',
  lot_number: 'LOT-77',
  expiration_date: '2026-09-01',
  days_until_expiration: 16,
  quantity: 24,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

describe('MedicalSuppliesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
    mockGetSummary.mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 200 });
    mockGetCategories.mockResolvedValue([]);
    mockGetExpiringLots.mockResolvedValue([expiringLot()]);
  });

  it('names the page for the domain it holds', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('heading', { name: /Medical Supplies/i })).toBeInTheDocument();
  });

  it('points at the gear page rather than implying it holds gear too', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    const gearLink = await screen.findByRole('link', { name: /Gear & Uniforms/i });
    expect(gearLink).toHaveAttribute('href', '/inventory');
  });

  it('opens on expiring stock, which is what goes wrong quietly', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
    expect(screen.getByText('16d left')).toBeInTheDocument();
  });

  it('calls out an already-expired lot rather than showing a negative countdown', async () => {
    mockGetExpiringLots.mockResolvedValue([expiringLot({ days_until_expiration: -4 })]);

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('Expired 4d ago')).toBeInTheDocument();
  });

  it('hides the management actions from a member who can only view', async () => {
    renderWithRouter(<MedicalSuppliesPage />);
    await screen.findByRole('heading', { name: /Medical Supplies/i });

    expect(screen.queryByRole('button', { name: /Add supply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive delivery/i })).not.toBeInTheDocument();
  });

  it('shows the management actions to a medical-only supply officer', async () => {
    // Holds inventory.manage_medical but not the broad inventory.manage.
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('button', { name: /Add supply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receive delivery/i })).toBeInTheDocument();
  });

  it('shows the management actions to a quartermaster holding only the broad grant', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage');

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('button', { name: /Add supply/i })).toBeInTheDocument();
  });

  it('never asks the API for an item type — the domain is the server’s to pin', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    // The exact filter object, so a future item_type sneaking into the payload
    // fails here rather than quietly letting the client choose its own domain.
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenCalledWith({
        search: undefined,
        category_id: undefined,
        limit: 200,
      })
    );
  });

  it('reports the expiry window it actually queried', async () => {
    renderWithRouter(<MedicalSuppliesPage />);
    await waitFor(() => expect(mockGetExpiringLots).toHaveBeenCalledWith(30));

    expect(await screen.findByText(/Expiring within 30d/i)).toBeInTheDocument();
  });
});
