import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';

const mockGetApplicationStatus = vi.fn();
const mockWithdrawApplication = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  publicStatusService: {
    getApplicationStatus: (...args: unknown[]) => mockGetApplicationStatus(...args) as unknown,
    withdrawApplication: (...args: unknown[]) => mockWithdrawApplication(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import { ApplicationStatusPage } from './ApplicationStatusPage';

const baseStatus = {
  first_name: 'Jane',
  last_name: 'Doe',
  status: 'active',
  current_stage_name: 'Interview',
  pipeline_name: 'Recruit',
  total_stages: 3,
  stage_timeline: [],
  applied_at: '2026-01-01T00:00:00Z',
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/status/tok123']}>
      <Routes>
        <Route path="/status/:token" element={<ApplicationStatusPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('ApplicationStatusPage current-stage action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a Cal.com scheduling link when provided', async () => {
    mockGetApplicationStatus.mockResolvedValue({
      ...baseStatus,
      current_stage_action: {
        type: 'calcom_scheduling',
        label: 'Schedule Your Meeting',
        url: 'https://cal.com/dept/interview',
        message: 'Pick a time that works for you.',
      },
    });

    renderPage();

    const link = await screen.findByRole('link', { name: /Schedule/i });
    expect(link).toHaveAttribute('href', 'https://cal.com/dept/interview');
    expect(screen.getByText('Schedule Your Meeting')).toBeInTheDocument();
  });

  it('does not render an unsafe (non-http) booking URL as a link', async () => {
    mockGetApplicationStatus.mockResolvedValue({
      ...baseStatus,
      current_stage_action: {
        type: 'calcom_scheduling',
        label: 'Schedule Your Meeting',
        url: 'javascript:alert(1)',
      },
    });

    renderPage();

    expect(await screen.findByText('Schedule Your Meeting')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Schedule/i })).not.toBeInTheDocument();
  });

  it('renders the Documenso e-signature note (no link)', async () => {
    mockGetApplicationStatus.mockResolvedValue({
      ...baseStatus,
      current_stage_action: {
        type: 'documenso_signature',
        label: 'Documents Sent for Signature',
        message: 'Watch your email for a signing request.',
      },
    });

    renderPage();

    expect(await screen.findByText('Documents Sent for Signature')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders no action card when none is present', async () => {
    mockGetApplicationStatus.mockResolvedValue({ ...baseStatus });

    renderPage();

    await screen.findByText('Application Status');
    expect(screen.queryByText('Documents Sent for Signature')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Schedule/i })).not.toBeInTheDocument();
  });
});

describe('ApplicationStatusPage progress count', () => {
  beforeEach(() => {
    mockGetApplicationStatus.mockReset();
  });

  it('shows completed out of total when the department shows upcoming stages', async () => {
    mockGetApplicationStatus.mockResolvedValue({
      ...baseStatus,
      total_stages: 3,
      stage_timeline: [{ stage_name: 'Interest Form', status: 'completed', completed_at: '2026-01-02T00:00:00Z' }],
    });

    renderPage();

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('shows only the completed count when upcoming stages are hidden', async () => {
    mockGetApplicationStatus.mockResolvedValue({
      ...baseStatus,
      total_stages: null,
      stage_timeline: [{ stage_name: 'Interest Form', status: 'completed', completed_at: '2026-01-02T00:00:00Z' }],
    });

    renderPage();

    expect(await screen.findByText('1 completed')).toBeInTheDocument();
    expect(screen.queryByText(/\/ /)).not.toBeInTheDocument();
  });
});

describe('ApplicationStatusPage withdraw application', () => {
  beforeEach(() => {
    mockGetApplicationStatus.mockReset();
    mockWithdrawApplication.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it('offers no withdraw button when the backend does not allow it', async () => {
    mockGetApplicationStatus.mockResolvedValue({ ...baseStatus, status: 'approved', can_withdraw: false });

    renderPage();

    await screen.findByText('Application Status');
    expect(screen.queryByRole('button', { name: /Withdraw Application/i })).not.toBeInTheDocument();
  });

  it('withdraws after confirmation and shows the refreshed status', async () => {
    const user = userEvent.setup();
    mockGetApplicationStatus
      .mockResolvedValueOnce({ ...baseStatus, can_withdraw: true })
      .mockResolvedValueOnce({ ...baseStatus, status: 'withdrawn', can_withdraw: false });
    mockWithdrawApplication.mockResolvedValue({ status: 'withdrawn', message: 'ok' });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Withdraw Application/i }));
    expect(screen.getByText('Withdraw your application?')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/i), 'Moving away');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Withdraw Application/i }));

    await waitFor(() => expect(mockWithdrawApplication).toHaveBeenCalledWith('tok123', 'Moving away'));
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith('Your application has been withdrawn.');
    expect(screen.queryByRole('button', { name: /Withdraw Application/i })).not.toBeInTheDocument();
  });

  it('does nothing when the applicant keeps their application', async () => {
    const user = userEvent.setup();
    mockGetApplicationStatus.mockResolvedValue({ ...baseStatus, can_withdraw: true });

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Withdraw Application/i }));
    await user.click(screen.getByRole('button', { name: /Keep My Application/i }));

    expect(mockWithdrawApplication).not.toHaveBeenCalled();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('reports a failed withdrawal and keeps the application shown as open', async () => {
    const user = userEvent.setup();
    mockGetApplicationStatus.mockResolvedValue({ ...baseStatus, can_withdraw: true });
    mockWithdrawApplication.mockRejectedValue(new Error('This application is no longer open'));

    renderPage();

    await user.click(await screen.findByRole('button', { name: /Withdraw Application/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Withdraw Application/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('This application is no longer open'));
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });
});
