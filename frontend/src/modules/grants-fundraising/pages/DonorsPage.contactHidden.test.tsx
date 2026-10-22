/**
 * GF-9: a caller with only fundraising.view is sent donors without their
 * contact details. A blank email there is withheld, not missing, and the page
 * says so instead of showing a dash that reads as "no email on file".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockListDonors = vi.fn();

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: (_permission: string) => false };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../services/api', () => ({
  fundraisingService: { listDonors: (...args: unknown[]) => mockListDonors(...args) as unknown },
}));

import DonorsPage from './DonorsPage';
import type { Donor } from '../types';

const donor = (overrides: Partial<Donor>): Donor => ({
  id: 'd1',
  organizationId: 'o1',
  userId: null,
  firstName: 'Pat',
  lastName: 'Quinn',
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  donorType: 'individual',
  companyName: null,
  totalDonated: 250,
  donationCount: 1,
  firstDonationDate: null,
  lastDonationDate: null,
  notes: null,
  tags: null,
  communicationPreferences: null,
  isAnonymous: false,
  active: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('DonorsPage — withheld contact details', () => {
  beforeEach(() => {
    mockListDonors.mockReset();
  });

  it('says contact details are for managers when the server withheld them', async () => {
    mockListDonors.mockResolvedValue([donor({ contactHidden: true })]);

    render(<DonorsPage />);

    expect(await screen.findByText('Managers only')).toBeInTheDocument();
    expect(screen.getByText(/Pat Quinn/)).toBeInTheDocument();
  });

  it('keeps the dash for a donor that simply has no email', async () => {
    mockListDonors.mockResolvedValue([donor({ contactHidden: false })]);

    render(<DonorsPage />);

    expect(await screen.findByText(/Pat Quinn/)).toBeInTheDocument();
    expect(screen.queryByText('Managers only')).not.toBeInTheDocument();
  });

  it('shows an email the server did send', async () => {
    mockListDonors.mockResolvedValue([donor({ email: 'pat@example.org' })]);

    render(<DonorsPage />);

    expect(await screen.findByText('pat@example.org')).toBeInTheDocument();
  });
});
