/**
 * RPT5-29-1: the `compliance_status` and `training_summary` reports measure
 * training-program progress, not the requirement compliance the Training
 * dashboard reports. The owner chose to say so on the reports rather than
 * change their numbers, so nothing on them may read as "compliance".
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComplianceStatusRenderer, getComplianceStatusExportData } from './ComplianceStatusRenderer';
import { TrainingSummaryRenderer, getTrainingSummaryExportData } from './TrainingSummaryRenderer';
import type { ComplianceStatusReport, TrainingSummaryReport } from '../../types';

const programReport = {
  report_type: 'compliance_status',
  total_members: 2,
  fully_compliant_count: 1,
  partially_compliant_count: 0,
  non_compliant_count: 1,
  not_applicable_count: 0,
  overall_compliance_rate: 50,
  entries: [
    {
      member_id: 'm1',
      member_name: 'Dana Reyes',
      rank: null,
      total_requirements: 2,
      completed_requirements: 1,
      compliance_percentage: 50,
      overdue_items: ['Live Fire'],
      upcoming_deadlines: [],
    },
  ],
} as unknown as ComplianceStatusReport;

const summaryReport = {
  report_type: 'training_summary',
  total_courses: 1,
  total_records: 1,
  completion_rate: 100,
  entries: [],
  course_breakdown: [],
  requirement_breakdown: [
    { requirement_id: 'r1', requirement_name: 'Live Fire', total_members: 3, completed: 2, completion_pct: 66.7 },
  ],
} as unknown as TrainingSummaryReport;

describe('program progress labels', () => {
  it('the program requirement report never says compliance', () => {
    const { container } = render(<ComplianceStatusRenderer data={programReport} />);

    expect(screen.getByText('All Requirements Met')).toBeInTheDocument();
    expect(screen.getByText(/progress through training-program enrollments/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/compliant|compliance rate/i);
    const headers = getComplianceStatusExportData(programReport).columns.map((c) => c.header);
    expect(headers).toContain('Program Progress %');
    expect(headers.join(' ')).not.toMatch(/compliance/i);
  });

  it('the summary labels its requirement tab as program progress', async () => {
    render(<TrainingSummaryRenderer data={summaryReport} />);

    await userEvent.click(screen.getByRole('button', { name: 'Program Progress by Requirement' }));

    expect(screen.getByText('Program Progress %')).toBeInTheDocument();
    expect(screen.getByText('Members Graded')).toBeInTheDocument();
    expect(screen.getByText(/catch-up period, are left out/i)).toBeInTheDocument();
  });

  it('the summary export no longer prints an always-zero compliance column', () => {
    const headers = getTrainingSummaryExportData(summaryReport).columns.map((c) => c.header);
    expect(headers).not.toContain('Compliance %');
  });
});
