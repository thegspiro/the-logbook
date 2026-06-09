import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InventoryItem } from '../types';

const mockGetItem = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItem: (...a: unknown[]) => mockGetItem(...a) as unknown,
    generateBarcodeLabels: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('jsbarcode', () => ({ default: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import InventoryBarcodePrintPage from './InventoryBarcodePrintPage';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'it-1',
  organization_id: 'org-1',
  name: 'Thermal Camera',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  barcode: 'INV-0001',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const renderPage = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/inventory/print-labels${query}`]}>
      <InventoryBarcodePrintPage />
    </MemoryRouter>,
  );

describe('InventoryBarcodePrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItem.mockResolvedValue(makeItem());
  });

  it('errors when no item ids are provided', async () => {
    renderPage('');
    expect(
      await screen.findByText(/No items specified/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Inventory/ })).toBeInTheDocument();
  });

  it('fetches and renders labels for the provided ids', async () => {
    mockGetItem.mockImplementation((id: string) =>
      Promise.resolve(makeItem({ id, name: id === 'it-2' ? 'Spare Radio' : 'Thermal Camera' })),
    );
    renderPage('?ids=it-1,it-2');

    await waitFor(() => expect(mockGetItem).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Thermal Camera')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spare Radio').length).toBeGreaterThan(0);
  });

  it('shows an error state when item loading fails', async () => {
    mockGetItem.mockRejectedValue(new Error('boom'));
    renderPage('?ids=it-1');
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Inventory/ })).toBeInTheDocument();
  });
});
