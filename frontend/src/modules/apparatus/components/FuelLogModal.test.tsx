/**
 * fuel_date is a datetime column displayed with formatDate in the department's
 * zone. A bare "YYYY-MM-DD" was stored as midnight UTC, which is the previous
 * evening west of Greenwich, so every fill-up was listed a day early.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateFuelLog = vi.fn();

vi.mock('../services/api', () => ({
  apparatusFuelLogService: {
    createFuelLog: (...args: unknown[]) => mockCreateFuelLog(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/Los_Angeles',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { FuelLogModal } from './FuelLogModal';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

describe('FuelLogModal fill-up date', () => {
  beforeEach(() => {
    mockCreateFuelLog.mockReset();
    mockCreateFuelLog.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the chosen day at the department's local noon, as UTC", async () => {
    const user = userEvent.setup();
    render(<FuelLogModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" />);

    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-03-04' } });
    await user.type(screen.getByLabelText('Gallons *'), '25');
    await user.click(screen.getByRole('button', { name: 'Add Fuel Log' }));

    await waitFor(() => expect(mockCreateFuelLog).toHaveBeenCalledTimes(1));
    // Noon in Los Angeles on 4 March (PST, UTC-8) is 20:00 UTC the same day.
    expect(mockCreateFuelLog.mock.calls[0]?.[0]).toMatchObject({
      apparatusId: 'app-1',
      fuelDate: '2026-03-04T20:00:00.000Z',
      gallons: 25,
    });
  });

  it("defaults to today in the department's zone, worked out when the form opens", () => {
    // 05:00 UTC on 1 July is still 30 June in Los Angeles.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T05:00:00Z'));

    render(<FuelLogModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" />);

    expect(screen.getByLabelText('Date *')).toHaveValue('2026-06-30');
  });
});

describe('FuelLogModal errors and discarding', () => {
  beforeEach(() => {
    mockCreateFuelLog.mockReset();
    mockCreateFuelLog.mockResolvedValue({});
    vi.mocked(toast.error).mockClear();
  });

  it('puts a server refusal on the field it names, announced, instead of a toast naming the API field', async () => {
    mockCreateFuelLog.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'station_name', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    render(<FuelLogModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" />);

    await user.type(screen.getByLabelText('Gallons *'), '25');
    await user.type(screen.getByLabelText('Station Name'), 'Depot');
    await user.click(screen.getByRole('button', { name: 'Add Fuel Log' }));

    const station = screen.getByLabelText('Station Name');
    await waitFor(() =>
      expect(station).toHaveAccessibleDescription('Station name is too long — keep it to 200 characters.')
    );
    expect(station).toHaveAttribute('aria-invalid', 'true');
    expect(station).toHaveAttribute('maxLength', '200');
    expect(toast.error).toHaveBeenCalledWith('Fix the fields marked below, then save again.');
  });

  it('asks before Escape or Cancel discards what was typed, and closes a clean form at once', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(<FuelLogModal isOpen onClose={onClose} onSaved={vi.fn()} apparatusId="app-1" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    onClose.mockClear();

    render(<FuelLogModal isOpen onClose={onClose} onSaved={vi.fn()} apparatusId="app-1" />);
    await user.type(screen.getByLabelText('Gallons *'), '25');
    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
