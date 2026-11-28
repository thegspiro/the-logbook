/**
 * "Days Left" is coloured by the status the server decided, so the number
 * and the "Expiring Soon" badge beside it agree. The server's window is the
 * department's setting (90 days by default); the screen used a fixed 30.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CertExpirationReport } from '../../types';
import { CertExpirationRenderer } from './CertExpirationRenderer';

const report = (
  days: number,
  status: CertExpirationReport['entries'][number]['expiry_status']
): CertExpirationReport => ({
  report_type: 'certification_expiration',
  generated_at: '2026-11-26T00:00:00Z',
  total_certifications: 1,
  expired_count: 0,
  expiring_soon_count: status === 'expiring_soon' ? 1 : 0,
  valid_count: status === 'valid' ? 1 : 0,
  no_expiry_count: 0,
  entries: [
    {
      member_id: 'm-1',
      member_name: 'Pat Rivera',
      course_name: 'EMT-B',
      completion_date: '2024-01-25',
      expiration_date: '2027-01-25',
      days_until_expiry: days,
      expiry_status: status,
      source: 'The Logbook',
    },
  ],
});

describe('CertExpirationRenderer days left', () => {
  it('marks a certificate the server calls expiring soon, 60 days out', () => {
    render(<CertExpirationRenderer data={report(60, 'expiring_soon')} />);
    expect(screen.getAllByText('60')[0]).toHaveClass('text-yellow-700');
  });

  it('leaves a valid certificate plain, even inside 30 days', () => {
    render(<CertExpirationRenderer data={report(20, 'valid')} />);
    expect(screen.getAllByText('20')[0]).not.toHaveClass('text-yellow-700');
  });
});
