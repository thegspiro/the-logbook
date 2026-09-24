import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { InventoryItem } from '../types';

const mockGetItem = vi.fn();
const mockGenerateLabels = vi.fn();
const mockGetLabelPreset = vi.fn();
const mockSetLabelPreset = vi.fn();
const mockPrefersPdf = vi.fn(() => false);
const mockGetItems = vi.fn();
const mockGetCategories = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockGetLocations = vi.fn();
const mockMarkLabelsPrinted = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItem: (...a: unknown[]) => mockGetItem(...a) as unknown,
    generateBarcodeLabels: (...a: unknown[]) => mockGenerateLabels(...a) as unknown,
    getLabelPreset: (...a: unknown[]) => mockGetLabelPreset(...a) as unknown,
    setLabelPreset: (...a: unknown[]) => mockSetLabelPreset(...a) as unknown,
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    markLabelsPrinted: (...a: unknown[]) => mockMarkLabelsPrinted(...a) as unknown,
  },
  locationsService: {
    getLocations: (...a: unknown[]) => mockGetLocations(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../utils/printEnvironment', () => ({ prefersPdfOverBrowserPrint: () => mockPrefersPdf() }));
vi.mock('jsbarcode', () => ({ default: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import InventoryBarcodePrintPage from './InventoryBarcodePrintPage';
import JsBarcode from 'jsbarcode';

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
    </MemoryRouter>
  );

describe('InventoryBarcodePrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetItem.mockResolvedValue(makeItem());
    mockGenerateLabels.mockResolvedValue({ blob: new Blob(['pdf']), autoPopulated: 0 });
    mockGetLabelPreset.mockResolvedValue({ preset: null });
    mockSetLabelPreset.mockResolvedValue({ preset: null });
    mockPrefersPdf.mockReturnValue(false);
    for (const m of [mockGetItems, mockGetCategories, mockGetStorageAreas, mockGetLocations, mockMarkLabelsPrinted])
      m.mockReset();
    mockMarkLabelsPrinted.mockResolvedValue({ marked: 1 });
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1, skip: 0, limit: 500 });
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Radios' }]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([{ id: 'loc-1', name: 'Station 1' }]);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    // The PDF download clicks a temporary <a download> — stub it so jsdom
    // doesn't emit a "navigation not implemented" warning.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('offers a filter picker instead of an error when nothing is selected', async () => {
    mockGetItems.mockResolvedValue({ items: [], total: 12, skip: 0, limit: 1 });
    renderPage('');

    expect(await screen.findByRole('heading', { name: 'Print barcode labels' })).toBeInTheDocument();
    expect(await screen.findByText('12 items match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare 12 labels' })).toBeEnabled();
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('loads the batch the picker chose, by filter, in one request', async () => {
    const user = userEvent.setup();
    mockGetItems.mockImplementation((params: { limit?: number }) =>
      Promise.resolve(
        params.limit === 1
          ? { items: [], total: 2, skip: 0, limit: 1 }
          : {
              items: [makeItem({ id: 'it-1' }), makeItem({ id: 'it-2', name: 'Spare Radio' })],
              total: 2,
              skip: 0,
              limit: 500,
            }
      )
    );
    renderPage('');
    await screen.findByRole('option', { name: 'Radios' });

    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith({ category_id: 'cat-1', skip: 0, limit: 1 }));
    await user.click(await screen.findByRole('button', { name: 'Prepare 2 labels' }));

    expect((await screen.findAllByText('Spare Radio')).length).toBeGreaterThan(0);
    expect(mockGetItems).toHaveBeenLastCalledWith({ category_id: 'cat-1', skip: 0, limit: 500 });
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('narrows the picker to items that still need a label', async () => {
    const user = userEvent.setup();
    renderPage('');
    await screen.findByRole('heading', { name: 'Print barcode labels' });

    await user.click(screen.getByRole('checkbox', { name: /Only items that still need a label/ }));

    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith({ label_printed: false, skip: 0, limit: 1 }));
    await user.click(await screen.findByRole('button', { name: 'Prepare 1 label' }));
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith({ label_printed: false, skip: 0, limit: 500 }));
  });

  it('blocks the picker when more items match than one batch holds', async () => {
    mockGetItems.mockResolvedValue({ items: [], total: 501, skip: 0, limit: 1 });
    renderPage('');

    expect(await screen.findByText(/501 items match. One batch holds at most 500/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare labels' })).toBeDisabled();
  });

  it('prints every item matching the filters in the URL', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 'it-9', name: 'Hose Adapter' })],
      total: 1,
      skip: 0,
      limit: 500,
    });
    renderPage('?all=1&location_id=loc-1&sort_by=name&sort_order=asc');

    expect((await screen.findAllByText('Hose Adapter')).length).toBeGreaterThan(0);
    expect(mockGetItems).toHaveBeenCalledWith({
      location_id: 'loc-1',
      sort_by: 'name',
      sort_order: 'asc',
      skip: 0,
      limit: 500,
    });
  });

  it('refuses a filter batch larger than the label API limit', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 750, skip: 0, limit: 500 });
    renderPage('?all=1');

    expect(await screen.findByText(/750 items match. A maximum of 500 inventory items/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Choose different items/ })).toBeInTheDocument();
  });

  it('says so when no items match the filters', async () => {
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 500 });
    renderPage('?all=1&category_id=cat-1');

    expect(await screen.findByText('No active items match these filters.')).toBeInTheDocument();
  });

  it('fetches and renders labels for the provided ids', async () => {
    mockGetItem.mockImplementation((id: string) =>
      Promise.resolve(makeItem({ id, name: id === 'it-2' ? 'Spare Radio' : 'Thermal Camera' }))
    );
    renderPage('?ids=it-1,it-2');

    await waitFor(() => expect(mockGetItem).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Thermal Camera')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spare Radio').length).toBeGreaterThan(0);
  });

  it('falls back without truncating a partially unencodable legacy barcode', async () => {
    mockGetItem.mockResolvedValue(makeItem({ barcode: 'INV-12火', asset_tag: 'ASSET-42' }));
    renderPage('?ids=it-1');

    await screen.findAllByText('Thermal Camera');
    await waitFor(() =>
      expect(JsBarcode).toHaveBeenCalledWith(
        expect.any(SVGSVGElement),
        'ASSET-42',
        expect.objectContaining({ format: 'CODE128' })
      )
    );
  });

  it('shows an error state when item loading fails', async () => {
    mockGetItem.mockRejectedValue(new Error('boom'));
    renderPage('?ids=it-1');
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Inventory/ })).toBeInTheDocument();
  });

  it('rejects batches larger than the label API limit before loading items', async () => {
    renderPage(`?ids=${Array.from({ length: 501 }, (_, index) => `it-${index}`).join(',')}`);

    expect(await screen.findByText(/maximum of 500 inventory items/)).toBeInTheDocument();
    expect(mockGetItem).not.toHaveBeenCalled();
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

  it('includes the selected number of copies in the PDF batch', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    const copies = screen.getByLabelText(/Copies per item/);
    fireEvent.change(copies, { target: { value: '3' } });
    await user.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    expect(mockGenerateLabels.mock.calls[0]?.[0]).toEqual(['it-1', 'it-1', 'it-1']);
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

  it('applies the preset saved for the position over the local default', async () => {
    // Local default is Dymo, but the position remembers Rollo 4x6.
    localStorage.setItem('inventory:labelPreset', 'dymo_30252');
    mockGetLabelPreset.mockResolvedValue({ preset: 'rollo_4x6' });
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');
    await waitFor(() => expect(mockGetLabelPreset).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    expect(mockGenerateLabels.mock.calls[0]?.[1]).toBe('rollo_4x6');
  });

  it('saves a changed preset to the position', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(screen.getByRole('button', { name: /Rollo 4/ }));

    // The change is debounced (~500ms) then saved to the position.
    await waitFor(() => expect(mockSetLabelPreset).toHaveBeenCalledWith({ preset: 'rollo_4x6' }), { timeout: 2000 });
  });

  it('downloads a one-item PDF for a test label with the selected printer settings', async () => {
    const user = userEvent.setup();
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Settings/ }));
    await user.click(screen.getByRole('button', { name: /Download Test Label/ }));

    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    expect(mockGenerateLabels).toHaveBeenCalledWith(['it-1'], 'dymo_30252', undefined, undefined, false, []);
  });

  it('uses the canonicalizing PDF path when printing an item without a stored identifier', async () => {
    const user = userEvent.setup();
    mockGetItem.mockResolvedValue(makeItem({ barcode: undefined, asset_tag: undefined, serial_number: undefined }));
    renderPage('?ids=it-1');
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Print Labels/ }));

    await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    expect(mockGenerateLabels.mock.calls[0]?.[0]).toEqual(['it-1']);
  });

  describe('confirming the labels printed', () => {
    const downloadPdf = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findAllByText('Thermal Camera');
      await user.click(screen.getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));
    };

    it('asks after a print and marks each item once, whatever the copy count', async () => {
      const user = userEvent.setup();
      renderPage('?ids=it-1');
      await screen.findAllByText('Thermal Camera');
      await user.click(screen.getByRole('button', { name: /Settings/ }));
      fireEvent.change(screen.getByLabelText(/Copies per item/), { target: { value: '3' } });
      await downloadPdf(user);

      expect(await screen.findByText(/Did the labels print correctly/)).toBeInTheDocument();
      expect(mockMarkLabelsPrinted).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Mark 1 item as labelled' }));

      expect(mockMarkLabelsPrinted).toHaveBeenCalledWith(['it-1']);
      expect(await screen.findByText('1 item marked as labelled.')).toBeInTheDocument();
    });

    it('marks nothing when the member says the labels did not print', async () => {
      const user = userEvent.setup();
      renderPage('?ids=it-1');
      await downloadPdf(user);

      await user.click(await screen.findByRole('button', { name: 'Not yet' }));

      expect(screen.queryByText(/Did the labels print correctly/)).not.toBeInTheDocument();
      expect(mockMarkLabelsPrinted).not.toHaveBeenCalled();
    });

    it('keeps asking when recording the confirmation fails', async () => {
      mockMarkLabelsPrinted.mockRejectedValue(new Error('offline'));
      const user = userEvent.setup();
      renderPage('?ids=it-1');
      await downloadPdf(user);

      await user.click(await screen.findByRole('button', { name: 'Mark 1 item as labelled' }));

      expect(await screen.findByRole('button', { name: 'Mark 1 item as labelled' })).toBeEnabled();
      expect(screen.queryByText(/marked as labelled\./)).not.toBeInTheDocument();
    });

    it('does not ask after a test label', async () => {
      const user = userEvent.setup();
      renderPage('?ids=it-1');
      await screen.findAllByText('Thermal Camera');
      await user.click(screen.getByRole('button', { name: /Settings/ }));
      await user.click(screen.getByRole('button', { name: /Download Test Label/ }));
      await waitFor(() => expect(mockGenerateLabels).toHaveBeenCalledTimes(1));

      expect(screen.queryByText(/Did the labels print correctly/)).not.toBeInTheDocument();
    });
  });
});
