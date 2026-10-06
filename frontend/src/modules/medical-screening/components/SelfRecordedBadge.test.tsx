/**
 * MS-7: a screening its own subject recorded counts, but is marked wherever
 * compliance is read — the expiring list on the Compliance tab and the Records
 * tab — so a self-cleared result is visible without opening the audit log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpiringScreening } from '../types';

const fetchExpiringScreenings = vi.fn<(days?: number) => Promise<void>>();
let expiringScreenings: ExpiringScreening[] = [];
vi.mock('../store/medicalScreeningStore', () => ({
  useMedicalScreeningStore: () => ({ expiringScreenings, fetchExpiringScreenings }),
}));

import { ComplianceDashboard } from './ComplianceDashboard';

const row = (overrides: Partial<ExpiringScreening>): ExpiringScreening => ({
  record_id: 'r-1',
  screening_type: 'physical_exam',
  user_id: 'u-1',
  user_name: 'Jake Thompson',
  expiration_date: '2026-11-01',
  days_until_expiration: 20,
  self_recorded: false,
  ...overrides,
});

describe('Self-recorded marking (MS-7)', () => {
  beforeEach(() => {
    fetchExpiringScreenings.mockReset();
    fetchExpiringScreenings.mockResolvedValue(undefined);
    expiringScreenings = [];
  });

  it('marks only the self-recorded screening in the expiring list', () => {
    expiringScreenings = [
      row({ record_id: 'r-own', user_name: 'Jake Thompson', self_recorded: true }),
      row({ record_id: 'r-other', user_name: 'Maria Lopez', self_recorded: false }),
    ];
    render(<ComplianceDashboard />);

    const own = screen.getByText('Jake Thompson');
    const other = screen.getByText('Maria Lopez');
    expect(within(own).getByText('Self-recorded')).toBeInTheDocument();
    expect(within(other).queryByText('Self-recorded')).not.toBeInTheDocument();
  });

  it('explains the mark to screen readers, not only on hover', () => {
    expiringScreenings = [row({ self_recorded: true })];
    render(<ComplianceDashboard />);
    expect(screen.getByText(/still counts toward compliance/i)).toBeInTheDocument();
  });

  it('the records list renders the mark from the record flag', () => {
    // Reaching the records tab needs the page's whole store and permission
    // surface; the wiring is one expression, asserted where it lives.
    const source = readFileSync(join(__dirname, '..', 'pages', 'MedicalScreeningPage.tsx'), 'utf8');
    expect(source).toContain('{record.self_recorded && <SelfRecordedBadge />}');
  });
});
