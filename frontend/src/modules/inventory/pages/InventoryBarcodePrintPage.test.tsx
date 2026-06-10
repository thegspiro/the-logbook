import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InventoryItem } from '../types';

const mockGetItem = vi.fn();
const mockGenerateLabels = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItem: (...a: unknown[]) => mockGetItem(...a) as unknown,
    generateBarcodeLabels: (...a: unknown[]) => mockGenerateLabels(...a) as unknown,
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
    localStorage.clear();
    mockGetItem.mockResolvedValue(makeItem());
    mockGenerateLabels.mockResolvedValue({ blob: new Blob(['pdf']), autoPopulated: 0 });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    // The PDF download clicks a temporary <a download> — stub it so jsdom
    // doesn't emit a "navigation not implemented" warning.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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

  it('generates a PDF at the entered custom label size', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(screen.getByRole('button', { name: /Custom size/ }));

    const width = screen.getByLabelText(/Width \(in\)/);
    const height = screen.getByLabelText(/Height \(in\)/);
    await user.clear(width);
    await user.type(width, '1.5');
    await user.clear(height);
    await user.type(height, '0.5');

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    const args = mockGenerateLabels.mock.calls[0];
    expect(args?.[0]).toEqual(['it-1']); // item ids
    expect(args?.[1]).toBe('custom'); // backend format key
    expect(args?.[2]).toBe(1.5); // custom width
    expect(args?.[3]).toBe(0.5); // custom height
  });

  it('disables the PDF button when custom dimensions are out of range', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(screen.getByRole('button', { name: /Custom size/ }));

    const width = screen.getByLabelText(/Width \(in\)/);
    await user.clear(width);
    await user.type(width, '99'); // exceeds the 8" max

    expect(screen.getByText(/Enter a width of 0.5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });

  it('remembers the selected Rollo preset across visits', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(screen.getByRole('button', { name: /Rollo 4/ }));

    // Persisted so the next visit defaults to the same printer.
    expect(localStorage.getItem('inventory:labelPreset')).toBe('rollo_4x6');
  });

  it('defaults to the stored preset on a fresh visit', async () => {
    localStorage.setItem('inventory:labelPreset', 'rollo_2x1');
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    // Without touching Settings, generating uses the remembered Rollo preset.
    await user.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    expect(mockGenerateLabels.mock.calls[0]?.[1]).toBe('rollo_2x1');
  });
});
