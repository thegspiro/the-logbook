import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockTest = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../../services/labelService', () => ({
  labelPrinterService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    create: (...a: unknown[]) => mockCreate(...a) as unknown,
    update: (...a: unknown[]) => mockUpdate(...a) as unknown,
    remove: (...a: unknown[]) => mockRemove(...a) as unknown,
    test: (...a: unknown[]) => mockTest(...a) as unknown,
  },
}));

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LabelPrintersSection from './LabelPrintersSection';

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

describe('LabelPrintersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(zebra);
    mockUpdate.mockResolvedValue(zebra);
    mockRemove.mockResolvedValue(undefined);
    mockTest.mockResolvedValue({ printer_id: 'p1', printer_name: 'Quartermaster Zebra' });
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
