import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockGetApplicationStatus = vi.fn();

vi.mock('../services/api', () => ({
  publicStatusService: {
    getApplicationStatus: (...args: unknown[]) => mockGetApplicationStatus(...args) as unknown,
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
    </MemoryRouter>,
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
