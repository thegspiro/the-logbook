/**
 * fuel_date is a datetime column displayed with formatDate in the department's
 * zone. A bare "YYYY-MM-DD" was stored as midnight UTC, which is the previous
 * evening west of Greenwich, so every fill-up was listed a day early.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { FuelLogModal } from './FuelLogModal';

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
