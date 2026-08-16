import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText(/EMT-B Recertification expires in 24 days/)).toBeInTheDocument();
    // The scope note keeps a green line from reading as a full clearance.
    expect(screen.getByText(/Certifications only/)).toBeInTheDocument();
  });

  it('opens the certification list when pressed', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<DashboardReadiness certs={[cert()]} onOpen={onOpen} />);

    await user.click(screen.getByRole('button'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
