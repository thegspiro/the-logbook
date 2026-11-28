import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ShiftReportPage from './ShiftReportPage';

const mockGetUsers = vi.fn();
const mockByOfficer = vi.fn();
const mockMine = vi.fn();
const mockStats = vi.fn();
const mockAcknowledge = vi.fn();

vi.mock('../services/api', () => ({
  userService: { getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown },
  shiftCompletionService: {
    getReportsByOfficer: (...a: unknown[]) => mockByOfficer(...a) as unknown,
    getMyReports: (...a: unknown[]) => mockMine(...a) as unknown,
    getMyStats: (...a: unknown[]) => mockStats(...a) as unknown,
    acknowledgeReport: (...a: unknown[]) => mockAcknowledge(...a) as unknown,
  },
}));

vi.mock('../services/userServices', () => ({
  organizationService: { isModuleEnabled: vi.fn().mockResolvedValue(true) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
    error: (...a: unknown[]) => toastError(...a) as unknown,
  },
}));

const REPORT = {
  id: 'r1',
  organization_id: 'org',
  officer_id: 'o1',
  trainee_id: 'me',
  shift_date: '2026-11-20',
  hours_on_shift: 12,
  calls_responded: 2,
  trainee_acknowledged: false,
  created_at: '2026-11-20T20:00:00Z',
  updated_at: '2026-11-20T20:00:00Z',
};

// App-review SCH3-F5: a failed request read as "No shift reports about you
// yet", and a double tap on Acknowledge reported success and then failure.
describe('ShiftReportPage', () => {
  beforeEach(() => {
    for (const mock of [mockGetUsers, mockByOfficer, mockMine, mockStats, mockAcknowledge]) mock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    mockGetUsers.mockResolvedValue([]);
    mockByOfficer.mockResolvedValue([]);
    mockMine.mockResolvedValue([]);
    mockStats.mockResolvedValue(null);
  });

  it('says a failed load failed, and offers Retry', async () => {
    mockMine.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportPage />);
    await user.click(await screen.findByRole('button', { name: /My Reports/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network Error');
    expect(screen.queryByText('No shift reports about you yet.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No shift reports about you yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reads a refused filed list as empty, not as a failure', async () => {
    mockByOfficer.mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { detail: 'No' } } });
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportPage />);
    await user.click(await screen.findByRole('button', { name: /Filed/ }));

    expect(await screen.findByText('No reports filed yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('acknowledges once however fast it is tapped', async () => {
    mockMine.mockResolvedValue([REPORT]);
    let finish: () => void = () => {};
    mockAcknowledge.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderWithRouter(<ShiftReportPage />);
    await user.click(await screen.findByRole('button', { name: /My Reports/ }));
    const acknowledge = await screen.findByRole('button', { name: 'Acknowledge' });

    await user.click(acknowledge);
    await user.click(acknowledge);
    finish();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });
});
