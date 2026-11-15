/**
 * Program Requirement Progress lists each member's leave in the past year
 * beside progress it does not change (owner decision 2026-11-14), so an
 * officer chasing an outstanding item can see the member was, or is, away.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ComplianceStatusRenderer, getComplianceStatusExportData } from './ComplianceStatusRenderer';
import type { ComplianceMemberEntry, ComplianceStatusReport } from '../../types';

const entry = (overrides: Partial<ComplianceMemberEntry>): ComplianceMemberEntry => ({
  member_id: 'm1',
  member_name: 'Pat Member',
  total_requirements: 2,
  completed_requirements: 1,
  compliance_percentage: 50,
  overdue_items: ['Live Fire'],
  upcoming_deadlines: [],
  ...overrides,
});

const report = (entries: ComplianceMemberEntry[]): ComplianceStatusReport => ({
  report_type: 'compliance_status',
  generated_at: '2026-08-01T00:00:00Z',
  total_members: entries.length,
  fully_compliant_count: 0,
  partially_compliant_count: entries.length,
  non_compliant_count: 0,
  overall_compliance_rate: 50,
  entries,
});

const away = entry({
  on_leave: true,
  leave_periods: [{ start_date: '2025-07-01', end_date: '2026-09-01', excuses_training: true }],
});

describe('ComplianceStatusRenderer leave column', () => {
  it('marks a member on leave today and gives the dates', () => {
    render(<ComplianceStatusRenderer data={report([away])} />);
    const row = screen.getByRole('row', { name: /Pat Member/ });
    expect(within(row).getByText('On leave')).toBeInTheDocument();
    expect(within(row).getByText('Jul 1, 2025 – Sep 1, 2026')).toBeInTheDocument();
  });

  it('lists a leave that has ended without calling the member on leave', () => {
    const returned = entry({
      on_leave: false,
      leave_periods: [{ start_date: '2025-07-01', end_date: '2026-09-01', excuses_training: true }],
    });
    render(<ComplianceStatusRenderer data={report([returned])} />);
    const row = screen.getByRole('row', { name: /Pat Member/ });
    expect(within(row).queryByText('On leave')).not.toBeInTheDocument();
    expect(within(row).getByText('Jul 1, 2025 – Sep 1, 2026')).toBeInTheDocument();
  });

  it('exports whether the member is on leave and the periods', () => {
    const { rows, columns } = getComplianceStatusExportData(report([away, entry({ member_id: 'm2' })]));
    expect(columns.map((c) => c.header)).toEqual(expect.arrayContaining(['On Leave Now', 'Leave in Past Year']));
    expect(rows[0]).toMatchObject({ on_leave_text: 'Yes', leave_periods_text: 'Jul 1, 2025 – Sep 1, 2026' });
    expect(rows[1]).toMatchObject({ on_leave_text: 'No', leave_periods_text: '' });
  });
});
