import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const getComplianceMatrix = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: { getComplianceMatrix: (...args: unknown[]) => getComplianceMatrix(...args) as unknown },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import CompliancePrintPage from './CompliancePrintPage';

const cell = (status: string) => ({
  requirement_id: 'req-hazmat',
  requirement_name: 'Annual Hazmat Hours',
  status,
  completion_date: null,
  expiry_date: null,
});

describe('CompliancePrintPage', () => {
  beforeEach(() => {
    getComplianceMatrix.mockReset();
    getComplianceMatrix.mockResolvedValue({
      generated_at: '2026-09-29T09:00:00Z',
      requirements: [
        { id: 'req-hazmat', name: 'Annual Hazmat Hours' },
        { id: 'req-pump', name: 'Pump Operations' },
      ],
      members: [
        {
          user_id: 'u1',
          member_name: 'Avery, Jordan',
          requirements: [cell('in_progress')],
          completion_pct: 0,
          standing: 'at_risk',
        },
        {
          user_id: 'u2',
          member_name: 'Brooks, Alex',
          requirements: [cell('not_started')],
          completion_pct: 0,
          standing: 'non_compliant',
        },
      ],
    });
  });

  it('counts members by their standing and tells "not started" apart from "does not apply"', async () => {
    render(<CompliancePrintPage />);

    expect(await screen.findByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('Non-Compliant')).toBeInTheDocument();
    expect(screen.queryByText('Not Started')).not.toBeInTheDocument();

    const brooks = screen.getByRole('row', { name: /Brooks, Alex/ });
    // Hazmat applies and is unmet; Pump Operations does not apply to them.
    expect(within(brooks).getByText('✗')).toBeInTheDocument();
    expect(within(brooks).getByText('—')).toBeInTheDocument();

    // Names print whole: paper has no tooltip for "ANNUAL HAZMA…".
    expect(screen.getByRole('columnheader', { name: 'Annual Hazmat Hours' })).toBeInTheDocument();
  });
});
