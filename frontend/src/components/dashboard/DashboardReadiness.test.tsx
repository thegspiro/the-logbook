import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardReadiness from './DashboardReadiness';
import type { ReadinessCert } from '../../utils/readiness';

const cert = (overrides: Partial<ReadinessCert> = {}): ReadinessCert => ({
  id: 'cert-1',
  course_name: 'EMT-B Recertification',
  expiration_date: '2026-09-05',
  is_expired: false,
  days_until_expiry: 400,
  ...overrides,
});

describe('DashboardReadiness', () => {
  it('renders nothing without certifications', () => {
    const { container } = render(<DashboardReadiness certs={[]} onOpen={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('states the verdict and its scope', () => {
    render(<DashboardReadiness certs={[cert({ days_until_expiry: 24 })]} onOpen={vi.fn()} />);

    expect(screen.getByText('Clear, with conditions')).toBeInTheDocument();
    expect(screen.getByText(/1 certification expiring within 60 days/)).toBeInTheDocument();
    // The scope note keeps a green line from reading as a full clearance.
    expect(screen.getByText(/Certifications only/)).toBeInTheDocument();
  });

  it('lists the seats the member can hold', () => {
    render(<DashboardReadiness certs={[cert()]} positions={['firefighter', 'driver']} onOpen={vi.fn()} />);

    const seats = screen.getByLabelText('Seats you can hold');
    expect(within(seats).getByText('Firefighter')).toBeInTheDocument();
    expect(within(seats).getByText('Driver/Operator')).toBeInTheDocument();
  });

  it('falls back to the raw position when there is no label for it', () => {
    render(<DashboardReadiness certs={[cert()]} positions={['safety_officer']} onOpen={vi.fn()} />);

    expect(screen.getByText('safety_officer')).toBeInTheDocument();
  });

  // The scope note names the inputs the verdict actually used. Claiming seats
  // while showing none would be the same overstatement the empty-cert guard
  // exists to prevent.
  it('only claims seats in the scope note when it is showing some', () => {
    const { rerender } = render(<DashboardReadiness certs={[cert()]} positions={[]} onOpen={vi.fn()} />);
    expect(screen.getByText(/Certifications only/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Seats you can hold')).not.toBeInTheDocument();

    rerender(<DashboardReadiness certs={[cert()]} positions={['firefighter']} onOpen={vi.fn()} />);
    expect(screen.getByText(/Certifications and seats/)).toBeInTheDocument();
  });

  it('opens the certification list when pressed', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<DashboardReadiness certs={[cert()]} onOpen={onOpen} />);

    await user.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
