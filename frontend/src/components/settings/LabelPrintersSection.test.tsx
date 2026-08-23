import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockTest = vi.fn();
const mockStatus = vi.fn();
const mockProbe = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../../services/labelService', () => ({
  labelPrinterService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    create: (...a: unknown[]) => mockCreate(...a) as unknown,
    update: (...a: unknown[]) => mockUpdate(...a) as unknown,
    remove: (...a: unknown[]) => mockRemove(...a) as unknown,
    test: (...a: unknown[]) => mockTest(...a) as unknown,
    status: (...a: unknown[]) => mockStatus(...a) as unknown,
    probe: (...a: unknown[]) => mockProbe(...a) as unknown,
  },
  // Imported as values, not just types.
  PrinterLanguage: { ZPL: 'zpl', ESCPOS: 'escpos' },
  ESCPOS_PAPER_SIZES: [
    { id: 'escpos_80mm', name: '80mm roll (3.1")' },
    { id: 'escpos_58mm', name: '58mm roll (2.3")' },
  ],
}));

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import toast from 'react-hot-toast';
import LabelPrintersSection from './LabelPrintersSection';

const zebra = {
  id: 'p1',
  name: 'Quartermaster Zebra',
  location: 'Station 1',
  host: '192.168.1.50',
  port: 9100,
  language: 'zpl',
  dpi: 203,
  label_format: 'zebra_2x1',
  custom_width: null,
  custom_height: null,
  darkness: null,
  is_default: true,
  is_active: true,
};

describe('LabelPrintersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(zebra);
    mockUpdate.mockResolvedValue(zebra);
    mockRemove.mockResolvedValue(undefined);
    mockTest.mockResolvedValue({
      printer_id: 'p1',
      printer_name: 'Quartermaster Zebra',
      printer_errors: [],
      printer_warnings: [],
      status_known: true,
    });
    mockStatus.mockResolvedValue({
      printer_id: 'p1',
      printer_name: 'Quartermaster Zebra',
      configured_dpi: 203,
      responded: true,
      identified: true,
      model: 'ZTC ZD420-203dpi ZPL',
      firmware: 'V93.20.15Z',
      reported_dpi: 203,
      errors: [],
      warnings: [],
      status_available: true,
      language: 'zpl',
    });
    mockProbe.mockResolvedValue({
      responded: true,
      identified: true,
      model: 'ZTC ZD620-300dpi ZPL',
      firmware: 'V93.20.15Z',
      reported_dpi: 300,
      errors: [],
      warnings: [],
      status_available: true,
    });
    mockConfirm.mockResolvedValue(true);
  });

  it('says so when no printers are configured', async () => {
    render(<LabelPrintersSection />);
    expect(await screen.findByText(/No label printers yet/)).toBeInTheDocument();
  });

  it('lists a configured printer with its address and stock', async () => {
    mockList.mockResolvedValue([zebra]);
    render(<LabelPrintersSection />);
    expect(await screen.findByText('Quartermaster Zebra')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.50:9100/)).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('creates a printer from the form', async () => {
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText(/No label printers yet/);

    await user.click(screen.getByRole('button', { name: /Add a printer/ }));
    await user.type(screen.getByLabelText(/^Name$/), 'Bay Zebra');
    await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.42');
    await user.click(screen.getByRole('button', { name: /Add printer/ }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({
      name: 'Bay Zebra',
      host: '10.0.0.42',
      port: 9100,
      dpi: 203,
    });
  });

  it('omits a blank location rather than sending an empty string', async () => {
    // An empty string would reach a validator that expects a value or nothing
    // at all (CLAUDE.md pitfall 1).
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText(/No label printers yet/);

    await user.click(screen.getByRole('button', { name: /Add a printer/ }));
    await user.type(screen.getByLabelText(/^Name$/), 'Bay Zebra');
    await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.42');
    await user.click(screen.getByRole('button', { name: /Add printer/ }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ location: undefined });
  });

  it('clears a location with an explicit null on update', async () => {
    // On an update path an omitted key means "leave it alone", so clearing the
    // box has to send null or the old value survives behind a success toast.
    mockList.mockResolvedValue([{ ...zebra, location: 'Old room' }]);
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText('Quartermaster Zebra');

    await user.click(screen.getByRole('button', { name: /Edit Quartermaster Zebra/ }));
    await user.clear(screen.getByLabelText(/Location/));
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0]?.[1]).toMatchObject({ location: null });
  });

  it('requires a name and a host before saving', async () => {
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText(/No label printers yet/);

    await user.click(screen.getByRole('button', { name: /Add a printer/ }));
    expect(screen.getByRole('button', { name: /Add printer/ })).toBeDisabled();

    await user.type(screen.getByLabelText(/^Name$/), 'Bay Zebra');
    expect(screen.getByRole('button', { name: /Add printer/ })).toBeDisabled();

    await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.42');
    expect(screen.getByRole('button', { name: /Add printer/ })).toBeEnabled();
  });

  it('sends a test label', async () => {
    mockList.mockResolvedValue([zebra]);
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText('Quartermaster Zebra');

    await user.click(screen.getByRole('button', { name: /Send test label/ }));
    await waitFor(() => expect(mockTest).toHaveBeenCalledWith('p1'));
  });

  it('asks before removing a printer', async () => {
    mockList.mockResolvedValue([zebra]);
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText('Quartermaster Zebra');

    await user.click(screen.getByRole('button', { name: /Remove Quartermaster Zebra/ }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('p1'));
  });

  it('does not remove when the confirmation is declined', async () => {
    mockList.mockResolvedValue([zebra]);
    mockConfirm.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText('Quartermaster Zebra');

    await user.click(screen.getByRole('button', { name: /Remove Quartermaster Zebra/ }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  describe('knowing whether it can actually print', () => {
    it('shows what the printer said about itself', async () => {
      mockList.mockResolvedValue([zebra]);
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');

      await user.click(screen.getByRole('button', { name: /Check status/ }));

      await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('p1'));
      expect(await screen.findByText(/ZTC ZD420-203dpi ZPL/)).toBeInTheDocument();
    });

    it('surfaces a fault rather than reporting the printer as fine', async () => {
      mockList.mockResolvedValue([zebra]);
      mockStatus.mockResolvedValue({
        printer_id: 'p1',
        printer_name: 'Quartermaster Zebra',
        configured_dpi: 203,
        responded: true,
        identified: true,
        model: 'ZTC ZD420-203dpi ZPL',
        firmware: null,
        reported_dpi: 203,
        errors: ['Out of labels'],
        warnings: [],
        status_available: true,
      });
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');

      await user.click(screen.getByRole('button', { name: /Check status/ }));
      expect(await screen.findByText(/Out of labels/)).toBeInTheDocument();
    });

    it('does not call an unrecognised device ready', async () => {
      // Anything listening on the port answers something. Without an
      // identification or a readable status it is not a printer of this
      // language, and saving it would send command bytes to whatever it is.
      mockList.mockResolvedValue([zebra]);
      mockStatus.mockResolvedValue({
        printer_id: 'p1',
        printer_name: 'Quartermaster Zebra',
        configured_dpi: 203,
        language: 'zpl',
        responded: true,
        identified: false,
        model: null,
        firmware: null,
        reported_dpi: null,
        errors: [],
        warnings: [],
        status_available: false,
      });
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');

      await user.click(screen.getByRole('button', { name: /Check status/ }));

      expect(await screen.findByText(/did not identify itself/i)).toBeInTheDocument();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it('still reports a properly identified printer as ready', async () => {
      mockList.mockResolvedValue([zebra]);
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');

      await user.click(screen.getByRole('button', { name: /Check status/ }));
      await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    });

    it('calls out a device that connects but never answers', async () => {
      // A TCP connection succeeds against whatever holds the address, so
      // silence must not read as a healthy printer.
      mockList.mockResolvedValue([zebra]);
      mockStatus.mockResolvedValue({
        printer_id: 'p1',
        printer_name: 'Quartermaster Zebra',
        configured_dpi: 203,
        responded: false,
        identified: false,
        model: null,
        firmware: null,
        reported_dpi: null,
        errors: [],
        warnings: [],
        status_available: false,
      });
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');

      await user.click(screen.getByRole('button', { name: /Check status/ }));
      expect(await screen.findByText(/did not answer|nothing answered/i)).toBeInTheDocument();
    });
  });

  describe('setting a printer up', () => {
    it('checks an address before it is saved', async () => {
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);

      await user.click(screen.getByRole('button', { name: /Add a printer/ }));
      await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.42');
      await user.click(screen.getByRole('button', { name: /Test connection/ }));

      await waitFor(() => expect(mockProbe).toHaveBeenCalledWith('10.0.0.42', 9100, 'zpl'));
      expect(await screen.findByText(/ZTC ZD620-300dpi ZPL/)).toBeInTheDocument();
    });

    it('takes the resolution from the printer itself', async () => {
      // Wrong dpi silently prints the label at the wrong physical size, and it
      // is the field most likely to be set wrong by hand.
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);

      await user.click(screen.getByRole('button', { name: /Add a printer/ }));
      await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.42');
      expect(screen.getByLabelText(/Resolution/)).toHaveValue('203');

      await user.click(screen.getByRole('button', { name: /Test connection/ }));
      await waitFor(() => expect(screen.getByLabelText(/Resolution/)).toHaveValue('300'));
    });

    it('cannot test an address before one is typed', async () => {
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);
      await user.click(screen.getByRole('button', { name: /Add a printer/ }));
      expect(screen.getByRole('button', { name: /Test connection/ })).toBeDisabled();
    });
  });

  describe('printer languages', () => {
    it('shows the language on each printer', async () => {
      mockList.mockResolvedValue([zebra]);
      render(<LabelPrintersSection />);
      await screen.findByText('Quartermaster Zebra');
      // Scoped to the printer's own detail line: the intro banner names ZPL too.
      expect(screen.getByText(/192\.168\.1\.50:9100/).textContent).toContain('ZPL');
    });

    it('offers receipt paper widths once ESC/POS is chosen', async () => {
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);
      await user.click(screen.getByRole('button', { name: /Add a printer/ }));

      expect(screen.queryByRole('option', { name: /80mm roll/ })).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/Printer language/), 'escpos');

      expect(await screen.findByRole('option', { name: /80mm roll/ })).toBeInTheDocument();
      // Die-cut label sizes are not offered: receipt stock is continuous.
      expect(screen.queryByRole('option', { name: /Zebra 2/ })).not.toBeInTheDocument();
    });

    it('does not ask a receipt printer for a resolution', async () => {
      // ESC/POS printers size their output from the paper width, so a dpi
      // field here would imply a setting that does nothing.
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);
      await user.click(screen.getByRole('button', { name: /Add a printer/ }));
      expect(screen.getByLabelText(/Resolution/)).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText(/Printer language/), 'escpos');
      await waitFor(() => expect(screen.queryByLabelText(/Resolution/)).not.toBeInTheDocument());
    });

    it('sends the chosen language when creating and when probing', async () => {
      const user = userEvent.setup();
      render(<LabelPrintersSection />);
      await screen.findByText(/No label printers yet/);

      await user.click(screen.getByRole('button', { name: /Add a printer/ }));
      await user.selectOptions(screen.getByLabelText(/Printer language/), 'escpos');
      await user.type(screen.getByLabelText(/^Name$/), 'Watch Desk Epson');
      await user.type(screen.getByLabelText(/Hostname or IP/), '10.0.0.7');

      await user.click(screen.getByRole('button', { name: /Test connection/ }));
      await waitFor(() => expect(mockProbe).toHaveBeenCalledWith('10.0.0.7', 9100, 'escpos'));

      await user.click(screen.getByRole('button', { name: /Add printer/ }));
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({
        language: 'escpos',
        label_format: 'escpos_80mm',
      });
    });
  });

  it('does not offer paper sheet stock for a label printer', async () => {
    const user = userEvent.setup();
    render(<LabelPrintersSection />);
    await screen.findByText(/No label printers yet/);
    await user.click(screen.getByRole('button', { name: /Add a printer/ }));

    const stock = screen.getByLabelText(/Label stock loaded/);
    expect(stock).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Letter Paper/ })).not.toBeInTheDocument();
  });
});
