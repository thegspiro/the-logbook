/**
 * MS2-7: a waiver about to lapse counts toward "expiring soon", so the list
 * that count links to names it too, and marks it as a waiver so the officer
 * knows the work is renewing an exemption rather than booking a screening.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ExpiringScreening } from '../types';

const fetchExpiringScreenings = vi.fn<(days?: number) => Promise<void>>();
let expiringScreenings: ExpiringScreening[] = [];
vi.mock('../store/medicalScreeningStore', () => ({
  useMedicalScreeningStore: () => ({ expiringScreenings, fetchExpiringScreenings }),
}));

vi.mock('./SubjectCompliancePanel', () => ({ SubjectCompliancePanel: () => null }));
vi.mock('./ComplianceRoster', () => ({ ComplianceRoster: () => null }));

import { ComplianceDashboard } from './ComplianceDashboard';

const row = (overrides: Partial<ExpiringScreening>): ExpiringScreening => ({
  record_id: 'r-1',
  screening_type: 'drug_screening',
  user_id: 'u-1',
  user_name: 'Jake Thompson',
  expiration_date: '2026-11-01',
  days_until_expiration: 10,
  self_recorded: false,
  ...overrides,
});

describe('Lapsing waivers on the expiring list (MS2-7)', () => {
  beforeEach(() => {
    fetchExpiringScreenings.mockReset();
    fetchExpiringScreenings.mockResolvedValue(undefined);
    expiringScreenings = [];
  });

  it('marks only the waived row', () => {
    expiringScreenings = [
      row({ record_id: 'r-waived', user_name: 'Jake Thompson', status: 'waived' }),
      row({ record_id: 'r-passed', user_name: 'Maria Lopez', status: 'passed' }),
    ];
    render(<ComplianceDashboard />);

    expect(within(screen.getByText('Jake Thompson')).getByText('Waived')).toBeInTheDocument();
    expect(within(screen.getByText('Maria Lopez')).queryByText('Waived')).not.toBeInTheDocument();
  });

  it('renders a row from a server that sends no status', () => {
    expiringScreenings = [row({})];
    render(<ComplianceDashboard />);

    expect(screen.getByText('Jake Thompson')).toBeInTheDocument();
    expect(screen.queryByText('Waived')).not.toBeInTheDocument();
  });
});

describe('A date derived from the frequency (W71-1)', () => {
  beforeEach(() => {
    fetchExpiringScreenings.mockReset();
    fetchExpiringScreenings.mockResolvedValue(undefined);
    expiringScreenings = [];
  });

  it('reads as due by frequency, not as an expiration on the record', () => {
    expiringScreenings = [
      row({ record_id: 'r-derived', user_name: 'Jake Thompson', expiration_from_frequency: true }),
      row({ record_id: 'r-own', user_name: 'Maria Lopez', expiration_from_frequency: false }),
    ];
    render(<ComplianceDashboard />);

    expect(screen.getByText(/^Due .* \(by frequency\)$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Expires /)).toHaveLength(1);
  });
});
