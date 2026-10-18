import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock('../../services/securityAlertsService', () => ({
  securityAlertsService: {
    getWeeklyReport: (...a: unknown[]) => mockGet(...a) as unknown,
    setWeeklyReport: (...a: unknown[]) => mockSet(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { WeeklySecurityReportCard } from './WeeklySecurityReportCard';

const settings = {
  enabled: true,
  weekday: 0,
  hour: 7,
  last_sent_at: null,
  timezone: 'America/New_York',
  recipient_count: 1,
  recipients_are_fallback: false,
};

describe('WeeklySecurityReportCard', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockGet.mockResolvedValue({ ...settings });
  });

  it('shows the stored schedule and who receives the report', async () => {
    render(<WeeklySecurityReportCard />);

    expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Day')).toHaveValue('0');
    expect(screen.getByLabelText(/Time/)).toHaveValue('7');
    expect(screen.getByText(/Sent to 1 person holding the IT Manager position/)).toBeInTheDocument();
    expect(screen.getByText('Not sent yet.')).toBeInTheDocument();
  });

  it('tells an administrator when the IT Manager position is vacant', async () => {
    mockGet.mockResolvedValue({ ...settings, recipient_count: 2, recipients_are_fallback: true });
    render(<WeeklySecurityReportCard />);

    expect(await screen.findByRole('note')).toHaveTextContent('No one holds the IT Manager position');
  });

  it('warns when no one would receive it', async () => {
    mockGet.mockResolvedValue({ ...settings, recipient_count: 0, recipients_are_fallback: true });
    render(<WeeklySecurityReportCard />);

    expect(await screen.findByText(/No one with an email address/)).toBeInTheDocument();
  });

  it('keeps Save disabled until something changes', async () => {
    render(<WeeklySecurityReportCard />);
    await screen.findByRole('switch');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the chosen day, hour and switch together', async () => {
    const user = userEvent.setup();
    mockSet.mockResolvedValue({ ...settings, weekday: 4, hour: 16 });
    render(<WeeklySecurityReportCard />);
    await screen.findByRole('switch');

    await user.selectOptions(screen.getByLabelText('Day'), '4');
    await user.selectOptions(screen.getByLabelText(/Time/), '16');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ enabled: true, weekday: 4, hour: 16 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('can be switched off, which disables the schedule fields', async () => {
    const user = userEvent.setup();
    mockSet.mockResolvedValue({ ...settings, enabled: false });
    render(<WeeklySecurityReportCard />);

    await user.click(await screen.findByRole('switch'));
    expect(screen.getByLabelText('Day')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ enabled: false, weekday: 0, hour: 7 }));
  });
});
