import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockPreview = vi.fn();
const mockGetPreset = vi.fn();
const mockSetPreset = vi.fn();
const mockGenerate = vi.fn();
const mockListPrinters = vi.fn();
const mockPrint = vi.fn();

vi.mock('../../services/labelService', () => ({
  labelService: {
    preview: (...a: unknown[]) => mockPreview(...a) as unknown,
    getPreset: (...a: unknown[]) => mockGetPreset(...a) as unknown,
    setPreset: (...a: unknown[]) => mockSetPreset(...a) as unknown,
    generate: (...a: unknown[]) => mockGenerate(...a) as unknown,
  },
  labelPrinterService: {
    list: (...a: unknown[]) => mockListPrinters(...a) as unknown,
    print: (...a: unknown[]) => mockPrint(...a) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('jsbarcode', () => ({ default: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { LabelPrintPage } from './LabelPrintPage';

const renderPage = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/apparatus/print-labels${query}`]}>
      <LabelPrintPage module="apparatus" title="Print Apparatus Labels" backTo="/apparatus" />
    </MemoryRouter>
  );

describe('LabelPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPreview.mockResolvedValue({
      items: [{ name: 'Engine 5', barcode_value: 'E5', subtitle: 'Unit 5' }],
    });
    mockGetPreset.mockResolvedValue({ preset: null });
    mockSetPreset.mockResolvedValue({ preset: null });
    mockGenerate.mockResolvedValue({ blob: new Blob(['pdf']), autoPopulated: 0 });
    // Most tests describe an organization with no network printer, which is
    // the state every installation starts in.
    mockListPrinters.mockResolvedValue([]);
    mockPrint.mockResolvedValue({
      printer_id: 'p1',
      printer_name: 'Quartermaster Zebra',
      labels_sent: 1,
      auto_populated: 0,
    });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('errors when no ids are provided', async () => {
    renderPage('');
    expect(await screen.findByText(/No records specified/)).toBeInTheDocument();
  });

  it('loads the preview for the module and renders the records', async () => {
    renderPage('?ids=a1,a2');
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('apparatus', ['a1', 'a2']));
    expect((await screen.findAllByText('Engine 5')).length).toBeGreaterThan(0);
  });

  it('generates a PDF for the module', async () => {
    const user = userEvent.setup();
    renderPage('?ids=a1');
    await screen.findAllByText('Engine 5');

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    expect(mockGenerate.mock.calls[0]?.[0]).toBe('apparatus');
    expect(mockGenerate.mock.calls[0]?.[1]).toEqual(['a1']);
  });

  it('applies and saves the module preset', async () => {
    // Position remembers Rollo for apparatus.
    mockGetPreset.mockResolvedValue({ preset: 'rollo_4x6' });
    const user = userEvent.setup();
    renderPage('?ids=a1');
    await screen.findAllByText('Engine 5');
    await waitFor(() => expect(mockGetPreset).toHaveBeenCalledWith('apparatus'));

    // Generating uses the remembered Rollo preset.
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() =>
      expect(mockGenerate.mock.calls[0]?.[2]).toMatchObject({
        label_format: 'rollo_4x6',
      })
    );
  });

  describe('direct printing', () => {
    const zebra = {
      id: 'p1',
      name: 'Quartermaster Zebra',
      location: 'Station 1',
      host: '192.168.1.50',
      port: 9100,
      dpi: 203,
      label_format: 'zebra_2x1',
      custom_width: null,
      custom_height: null,
      darkness: null,
      is_default: true,
      is_active: true,
    };

    it('offers no printer button when the organization has none', async () => {
      renderPage('?ids=a1');
      await screen.findAllByText('Engine 5');
      expect(screen.queryByRole('button', { name: /Printer$/ })).not.toBeInTheDocument();
    });

    it('sends the labels to the default printer', async () => {
      mockListPrinters.mockResolvedValue([zebra]);
      mockGetPreset.mockResolvedValue({ preset: 'zebra_2x1' });
      const user = userEvent.setup();
      renderPage('?ids=a1');
      await screen.findAllByText('Engine 5');

      const button = await screen.findByRole('button', { name: /Printer$/ });
      await user.click(button);

      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      expect(mockPrint.mock.calls[0]?.[0]).toBe('apparatus');
      expect(mockPrint.mock.calls[0]?.[1]).toEqual(['a1']);
      expect(mockPrint.mock.calls[0]?.[2]).toMatchObject({
        printer_id: 'p1',
        label_format: 'zebra_2x1',
        copies: 1,
      });
    });

    it('disables the printer button for a paper sheet layout', async () => {
      // An Avery grid has no meaning on a roll-fed printer, and the backend
      // rejects it — so the button says so rather than offering a failure.
      mockListPrinters.mockResolvedValue([zebra]);
      mockGetPreset.mockResolvedValue({ preset: 'letter' });
      renderPage('?ids=a1');
      await screen.findAllByText('Engine 5');

      const button = await screen.findByRole('button', { name: /Printer$/ });
      await waitFor(() => expect(button).toBeDisabled());
    });

    it('keeps working when the printer list cannot be loaded', async () => {
      // Direct printing is optional; losing it must not take the PDF path down.
      mockListPrinters.mockRejectedValue(new Error('boom'));
      const user = userEvent.setup();
      renderPage('?ids=a1');
      await screen.findAllByText('Engine 5');

      await user.click(screen.getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    });
  });
});
