import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock JsBarcode
vi.mock('jsbarcode', () => ({
  default: vi.fn(),
}));

// Mock inventoryService
const mockGetItem = vi.fn();
vi.mock('../../services/api', () => ({
  inventoryService: {
    getItem: (...args: unknown[]) => mockGetItem(...args) as unknown,
  },
}));

import InventoryBarcodePrintPage from './InventoryBarcodePrintPage';

const mockItem = {
  id: 'item-1',
  organization_id: 'org-1',
  name: 'SCBA Mask',
  description: 'Scott AV-3000',
  serial_number: 'SN-12345',
  asset_tag: 'AT-001',
  barcode: 'INV-ABC123',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockItem2 = {
  ...mockItem,
  id: 'item-2',
  name: 'Turnout Coat',
  serial_number: 'SN-67890',
  asset_tag: 'AT-002',
  barcode: 'INV-DEF456',
};

function renderPage(search = '?ids=item-1') {
  return render(
    <MemoryRouter initialEntries={[`/inventory/print-labels${search}`]}>
      <Routes>
        <Route path="/inventory/print-labels" element={<InventoryBarcodePrintPage />} />
        <Route path="/inventory" element={<div>Inventory Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('InventoryBarcodePrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItem.mockImplementation((id: string) => {
      if (id === 'item-1') return Promise.resolve(mockItem);
      if (id === 'item-2') return Promise.resolve(mockItem2);
      return Promise.reject(new Error('Not found'));
    });
  });

  it('renders loading state initially', () => {
    // Make the getItem hang so we see loading
    mockGetItem.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading items...')).toBeInTheDocument();
  });

  it('renders error when no ids provided', async () => {
    renderPage('');
    expect(await screen.findByText(/No items specified/)).toBeInTheDocument();
  });

  it('renders item barcode labels after loading', async () => {
    renderPage('?ids=item-1');
    expect(await screen.findByText('SCBA Mask')).toBeInTheDocument();
    expect(screen.getByText('Print Barcode Labels')).toBeInTheDocument();
    expect(screen.getByText(/1 item/)).toBeInTheDocument();
  });

  it('renders multiple items', async () => {
    renderPage('?ids=item-1,item-2');
    expect(await screen.findByText('SCBA Mask')).toBeInTheDocument();
    expect(screen.getByText('Turnout Coat')).toBeInTheDocument();
    expect(screen.getByText(/2 items/)).toBeInTheDocument();
  });

  it('shows settings panel when Settings button is clicked', async () => {
    const user = userEvent.setup();
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');

    await user.click(screen.getByText('Settings'));
    expect(screen.getByText('Label Settings')).toBeInTheDocument();
    expect(screen.getByText('Dymo 30252')).toBeInTheDocument();
    expect(screen.getByText('Dymo 30336')).toBeInTheDocument();
    expect(screen.getByText(/Thermal 1" x 1"/)).toBeInTheDocument();
    expect(screen.getByText('Letter Paper (Grid)')).toBeInTheDocument();
  });

  it('allows changing label preset', async () => {
    const user = userEvent.setup();
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');

    await user.click(screen.getByText('Settings'));
    await user.click(screen.getByText('Dymo 30336'));

    // The preset button should be visually selected (has ring class)
    const presetBtn = screen.getByText('Dymo 30336').closest('button');
    expect(presetBtn?.className).toContain('ring-emerald-500');
  });

  it('allows changing copies count', async () => {
    const user = userEvent.setup();
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');

    await user.click(screen.getByText('Settings'));

    const copiesInput = screen.getByLabelText('Copies per item');
    await user.clear(copiesInput);
    await user.type(copiesInput, '3');

    // Should now show "3 labels total"
    expect(screen.getByText(/3 labels total/)).toBeInTheDocument();
  });

  it('calls window.print when Print Labels button is clicked', async () => {
    const user = userEvent.setup();
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');

    await user.click(screen.getByText('Print Labels'));
    expect(window.print).toHaveBeenCalled();
  });

  it('shows asset tag as subtitle when available', async () => {
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');
    expect(screen.getByText('AT: AT-001')).toBeInTheDocument();
  });

  it('displays back to inventory link', async () => {
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');
    expect(screen.getByText('Back to Inventory')).toBeInTheDocument();
  });

  it('shows printer tips for thermal label presets', async () => {
    const user = userEvent.setup();
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');

    await user.click(screen.getByText('Settings'));
    expect(screen.getByText('Printer Tips')).toBeInTheDocument();
    expect(screen.getByText(/Dymo Print Utility/)).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    mockGetItem.mockRejectedValue(new Error('Network error'));
    renderPage('?ids=item-1');
    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it('shows preview section', async () => {
    renderPage('?ids=item-1');
    await screen.findByText('SCBA Mask');
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});
