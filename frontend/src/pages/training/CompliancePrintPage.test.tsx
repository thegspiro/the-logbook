import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { ComplianceMatrix } from '../../services/communicationsServices';

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

const setUrl = (search: string) => {
  window.history.pushState({}, '', `/training/print/compliance${search}`);
};

afterEach(() => {
  setUrl('');
});

describe('CompliancePrintPage', () => {
  beforeEach(() => {
    setUrl('');
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
    renderWithRouter(<CompliancePrintPage />);

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

  it('prints a member nothing grades as N/A, last, and outside the compliant count', async () => {
    getComplianceMatrix.mockReset();
    getComplianceMatrix.mockResolvedValue({
      generated_at: '2026-09-29T09:00:00Z',
      requirements: [{ id: 'req-hazmat', name: 'Annual Hazmat Hours' }],
      members: [
        {
          user_id: 'u3',
          member_name: 'Carver, Lee',
          requirements: [],
          completion_pct: null,
          standing: 'not_applicable',
        },
        {
          user_id: 'u1',
          member_name: 'Avery, Jordan',
          requirements: [cell('completed')],
          completion_pct: 100,
          standing: 'compliant',
        },
      ],
    });

    renderWithRouter(<CompliancePrintPage />);

    const carver = await screen.findByRole('row', { name: /Carver, Lee/ });
    expect(within(carver).getByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('Not Applicable: 1')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    const avery = rows.findIndex((t) => t.includes('Avery, Jordan'));
    expect(rows.findIndex((t) => t.includes('Carver, Lee'))).toBeGreaterThan(avery);
  });

  describe('member classes', () => {
    const pumpCell = (status: string) => ({
      requirement_id: 'req-pump',
      requirement_name: 'Pump Operations',
      status,
    });
    const recordsCell = (status: string) => ({
      requirement_id: 'req-records',
      requirement_name: 'Records Management',
      status,
    });

    /** Two operational members, one administrative, one nobody has classified. */
    const classed = (): ComplianceMatrix => ({
      generated_at: '2026-09-29T09:00:00Z',
      requirements: [
        { id: 'req-pump', name: 'Pump Operations' },
        { id: 'req-records', name: 'Records Management' },
      ],
      members: [
        {
          user_id: 'u1',
          member_name: 'Avery, Jordan',
          member_class: 'operational',
          requirements: [pumpCell('completed')],
          completion_pct: 100,
          standing: 'compliant',
        },
        {
          user_id: 'u2',
          member_name: 'Brooks, Alex',
          member_class: 'operational',
          requirements: [pumpCell('not_started')],
          completion_pct: 0,
          standing: 'non_compliant',
        },
        {
          user_id: 'u3',
          member_name: 'Carver, Lee',
          member_class: 'administrative',
          requirements: [recordsCell('completed')],
          completion_pct: 100,
          standing: 'compliant',
        },
        {
          user_id: 'u4',
          member_name: 'Dunn, Casey',
          member_class: null,
          requirements: [pumpCell('in_progress')],
          completion_pct: 0,
          standing: 'at_risk',
        },
      ],
    });

    const region = (name: string) => screen.getByRole('region', { name: `${name} compliance matrix` });

    beforeEach(() => {
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(classed());
    });

    it('lists the whole roster under a heading per class, each with its own columns', async () => {
      renderWithRouter(<CompliancePrintPage />);

      expect(await screen.findByRole('heading', { name: 'Operational Members (2)' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Administrative Members (1)' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Unclassified Members (1)' })).toBeInTheDocument();
      expect(screen.getByText('Department-Wide Compliance Matrix')).toBeInTheDocument();
      expect(screen.getByText('Total Members: 4')).toBeInTheDocument();

      expect(within(region('Operational Members')).getByRole('row', { name: /Brooks, Alex/ })).toBeInTheDocument();
      expect(within(region('Operational Members')).queryByRole('row', { name: /Carver, Lee/ })).not.toBeInTheDocument();
      expect(
        within(region('Operational Members')).queryByRole('columnheader', { name: 'Records Management' })
      ).not.toBeInTheDocument();

      expect(within(region('Administrative Members')).getByRole('row', { name: /Carver, Lee/ })).toBeInTheDocument();
      expect(
        within(region('Administrative Members')).getByRole('columnheader', { name: 'Records Management' })
      ).toBeInTheDocument();
      expect(
        within(region('Administrative Members')).queryByRole('columnheader', { name: 'Pump Operations' })
      ).not.toBeInTheDocument();

      // A member with no class is listed apart, not guessed into one.
      expect(within(region('Unclassified Members')).getByRole('row', { name: /Dunn, Casey/ })).toBeInTheDocument();
    });

    it('prints only the class named in the URL', async () => {
      setUrl('?class=administrative');
      renderWithRouter(<CompliancePrintPage />);

      expect(await screen.findByText('Administrative Members — Compliance Matrix')).toBeInTheDocument();
      expect(screen.getByText('Total Members: 1')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Carver, Lee/ })).toBeInTheDocument();
      expect(screen.queryByRole('row', { name: /Avery, Jordan/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('row', { name: /Dunn, Casey/ })).not.toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Records Management' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Pump Operations' })).not.toBeInTheDocument();
      // One class needs no section headings.
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    it('prints a single-class roster as one table against every requirement', async () => {
      const single = classed();
      single.members = single.members.filter((m) => m.member_class === 'operational');
      getComplianceMatrix.mockReset();
      getComplianceMatrix.mockResolvedValue(single);

      renderWithRouter(<CompliancePrintPage />);

      expect(await screen.findByRole('row', { name: /Avery, Jordan/ })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Records Management' })).toBeInTheDocument();
    });
  });
});
