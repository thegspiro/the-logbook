import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockListPrinters = vi.fn();
const mockPreview = vi.fn();
const mockPrint = vi.fn();

vi.mock('../services/labelService', () => ({
  labelPrinterService: {
    list: (...a: unknown[]) => mockListPrinters(...a) as unknown,
  },
  PrinterLanguage: { ZPL: 'zpl', ESCPOS: 'escpos' },
}));

vi.mock('../services/stationDocumentService', () => ({
  stationDocumentService: {
    preview: (...a: unknown[]) => mockPreview(...a) as unknown,
    print: (...a: unknown[]) => mockPrint(...a) as unknown,
  },
  StationDocument: { SHIFT_ROSTER: 'shift_roster', APPARATUS_CHECK_SHEET: 'apparatus_check_sheet' },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import toast from 'react-hot-toast';
import { PrintDocumentButton } from './PrintDocumentButton';

const epson = {
  id: 'p1',
  name: 'Watch Desk Epson',
  location: 'Station 1',
  host: '10.0.0.7',
  port: 9100,
  language: 'escpos',
  dpi: 203,
  label_format: 'escpos_80mm',
  custom_width: null,
  custom_height: null,
  darkness: null,
  is_default: true,
  is_active: true,
};

const zebra = { ...epson, id: 'p2', name: 'Quartermaster Zebra', language: 'zpl' };

const PREVIEW = {
  title: 'Shift Roster',
  subtitle: 'Mon 25 Aug 2026 | 08:00-20:00',
  footer: 'Printed 25 Aug 07:12',
  sections: [
    {
      heading: 'Crew (2)',
      rows: [
        { left: 'Ada Rivera', right: 'CAPTAIN', emphasis: false, checkbox: false, indent: 0 },
        { left: 'Jon Okafor', right: 'DRIVER', emphasis: false, checkbox: false, indent: 0 },
      ],
    },
  ],
};

const renderButton = () =>
  render(<PrintDocumentButton document="shift_roster" recordId="shift-1" label="Print roster" />);

describe('PrintDocumentButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPrinters.mockResolvedValue([epson]);
    mockPreview.mockResolvedValue(PREVIEW);
    mockPrint.mockResolvedValue({
      printer_id: 'p1',
      printer_name: 'Watch Desk Epson',
      document: 'shift_roster',
      title: 'Shift Roster',
      printer_errors: [],
      printer_warnings: [],
      status_known: true,
    });
  });

  it('shows nothing when no receipt printer is configured', async () => {
    // Most departments have a label printer and no receipt printer; a button
    // that could only explain why it will not work is worse than none.
    mockListPrinters.mockResolvedValue([]);
    renderButton();
    await waitFor(() => expect(mockListPrinters).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Print roster/ })).not.toBeInTheDocument();
  });

  it('ignores label printers when deciding whether to appear', async () => {
    // A die-cut label printer has nowhere to put a column of text.
    mockListPrinters.mockResolvedValue([zebra]);
    renderButton();
    await waitFor(() => expect(mockListPrinters).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Print roster/ })).not.toBeInTheDocument();
  });

  it('appears once a receipt printer exists', async () => {
    renderButton();
    expect(await screen.findByRole('button', { name: /Print roster/ })).toBeInTheDocument();
  });

  it('previews the document before printing anything', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('shift_roster', 'shift-1'));
    expect(await screen.findByText('Shift Roster')).toBeInTheDocument();
    expect(screen.getByText(/Ada Rivera/)).toBeInTheDocument();
    // Nothing has been sent yet.
    expect(mockPrint).not.toHaveBeenCalled();
  });

  it('sends to the printer on confirm', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));
    await screen.findByText('Shift Roster');

    await user.click(screen.getByRole('button', { name: /^Print$/ }));
    await waitFor(() => expect(mockPrint).toHaveBeenCalledWith('shift_roster', 'shift-1', 'p1'));
  });

  it('reports a fault the printer named rather than a bare success', async () => {
    // A printer out of paper accepts the job and prints nothing.
    mockPrint.mockResolvedValue({
      printer_id: 'p1',
      printer_name: 'Watch Desk Epson',
      document: 'shift_roster',
      title: 'Shift Roster',
      printer_errors: ['Out of paper'],
      printer_warnings: [],
      status_known: true,
    });
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));
    await screen.findByText('Shift Roster');
    await user.click(screen.getByRole('button', { name: /^Print$/ }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain('Out of paper');
  });

  it('offers a choice when more than one receipt printer exists', async () => {
    mockListPrinters.mockResolvedValue([epson, { ...epson, id: 'p3', name: 'Bay Epson', is_default: false }]);
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));
    expect(await screen.findByLabelText(/Printer/)).toBeInTheDocument();
  });

  it('does not offer a choice when there is only one', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));
    await screen.findByText('Shift Roster');
    expect(screen.queryByLabelText(/^Printer$/)).not.toBeInTheDocument();
  });

  it('closes without printing when the document cannot be built', async () => {
    mockPreview.mockRejectedValue(new Error('gone'));
    const user = userEvent.setup();
    renderButton();
    await user.click(await screen.findByRole('button', { name: /Print roster/ }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(mockPrint).not.toHaveBeenCalled();
  });
});
