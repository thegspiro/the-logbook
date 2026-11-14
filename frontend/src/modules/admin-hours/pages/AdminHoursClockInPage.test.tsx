/**
 * Lead W70-5: scanning one category's code while clocked in to another was
 * refused with no way out. The page now names the running session and offers
 * its Clock Out, then this category's Clock In; one scan never ends one
 * session and starts another.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const { getQRData, getActiveSession, clockIn, clockOut, clockOutByCategory } = vi.hoisted(() => ({
  getQRData: vi.fn(),
  getActiveSession: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  clockOutByCategory: vi.fn(),
}));
vi.mock('../services/api', () => ({
  adminHoursCategoryService: { getQRData: (...a: unknown[]) => getQRData(...a) as unknown },
  adminHoursClockService: {
    getActiveSession: (...a: unknown[]) => getActiveSession(...a) as unknown,
    clockIn: (...a: unknown[]) => clockIn(...a) as unknown,
    clockOut: (...a: unknown[]) => clockOut(...a) as unknown,
    clockOutByCategory: (...a: unknown[]) => clockOutByCategory(...a) as unknown,
  },
}));

import AdminHoursClockInPage from './AdminHoursClockInPage';

const RADIO_ROOM = {
  categoryId: 'cat-radio',
  categoryName: 'Radio room',
  categoryDescription: null,
  categoryColor: '#123456',
  organizationName: 'Oakville FD',
};

const TRUCK_CHECK_SESSION = {
  id: 'entry-truck',
  categoryId: 'cat-truck',
  categoryName: 'Truck check',
  categoryColor: '#654321',
  clockInAt: '2026-11-06T09:00:00Z',
  elapsedMinutes: 75,
  maxSessionMinutes: null,
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin-hours/clock/cat-radio']}>
      <Routes>
        <Route path="/admin-hours/clock/:categoryId" element={<AdminHoursClockInPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('AdminHoursClockInPage with a session in another category (W70-5)', () => {
  beforeEach(() => {
    for (const fn of [getQRData, getActiveSession, clockIn, clockOut, clockOutByCategory]) fn.mockReset();
    getQRData.mockResolvedValue(RADIO_ROOM);
    getActiveSession.mockResolvedValue(TRUCK_CHECK_SESSION);
    clockOut.mockResolvedValue({
      id: 'entry-truck',
      categoryId: 'cat-truck',
      categoryName: 'Truck check',
      clockInAt: '2026-11-06T09:00:00Z',
      clockOutAt: '2026-11-06T10:15:00Z',
      durationMinutes: 75,
      status: 'pending',
      message: 'Clocked out',
    });
    clockIn.mockResolvedValue({});
  });

  it('names the running session and holds Clock In until it ends', async () => {
    renderPage();

    expect(await screen.findByText("You're still clocked in to Truck check")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeDisabled();
  });

  it('clocks out of the other session by its own id, then allows this one', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Clock out of Truck check' }));

    await waitFor(() => expect(clockOut).toHaveBeenCalledWith('entry-truck'));
    expect(clockOutByCategory).not.toHaveBeenCalled();
    expect(await screen.findByText('Clocked out of Truck check after 1h 15m.')).toBeInTheDocument();
    expect(clockIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clock In' }));
    await waitFor(() => expect(clockIn).toHaveBeenCalledWith('cat-radio'));
  });

  it('names a session started elsewhere after the page loaded', async () => {
    const user = userEvent.setup();
    getActiveSession.mockReset();
    getActiveSession.mockResolvedValueOnce(null).mockResolvedValue(TRUCK_CHECK_SESSION);
    clockIn.mockReset();
    clockIn.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'You already have an active session.' } },
      message: 'Request failed',
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Clock In' }));

    expect(await screen.findByText("You're still clocked in to Truck check")).toBeInTheDocument();
  });
});
