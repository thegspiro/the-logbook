import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TrainingDashboardSummary } from '../../../../services/trainingServices';
import { ComplianceOverviewWidget, PendingValidationWidget, UpcomingExpirationsWidget } from '.';
import { TRAINING_WIDGET_METADATA } from './metadata';

const data = {
  widget_metadata: {},
  stats: {
    total_members: 2,
    tracked_members: 2,
    active_requirements: 1,
    active_courses: 1,
    training_sessions: 1,
    active_programs: 0,
    graded_members: 2,
    not_applicable_members: 0,
    compliant_members: 1,
    compliance_percentage: 50,
    expiring_count: 1,
    completions_last_30_days: 0,
    total_hours_this_year: 0,
    average_hours_per_member: 0,
  },
  expirations: [
    {
      id: 'e1',
      member_id: 'm1',
      member_name: 'Example Member',
      course_name: 'CPR',
      expiration_date: '2026-09-01',
      days_left: 11,
    },
  ],
  recent_completions: [],
  requirements: [],
  members_needing_intervention: [],
  upcoming_session_capacity: [],
  pending_validation: { count: 3 },
  requirements_at_risk: [],
} as TrainingDashboardSummary;

describe('training dashboard widgets', () => {
  it('associates every widget with training.manage', () => {
    expect(
      Object.values(TRAINING_WIDGET_METADATA).every(
        (x) => x.module === 'training' && x.permission === 'training.manage'
      )
    ).toBe(true);
  });
  it('includes the expiration window in navigation', () => {
    render(<UpcomingExpirationsWidget data={data} days={90} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('days=90'));
  });
  it('links validation state and does not require names in the count payload', () => {
    render(<PendingValidationWidget data={{ ...data, pending_validation: { count: 3 } }} />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('validation_state=pending_review')
    );
    expect(screen.queryByText('Example Member')).not.toBeInTheDocument();
  });
  it('reports the compliance percentage when requirements exist', () => {
    render(<ComplianceOverviewWidget data={data} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 graded members')).toBeInTheDocument();
  });
  it('counts only graded members, and names the not-applicable ones', () => {
    const mixed = {
      ...data,
      stats: { ...data.stats, tracked_members: 3, graded_members: 2, not_applicable_members: 1 },
    };
    render(<ComplianceOverviewWidget data={mixed} />);
    expect(screen.getByText('1 of 2 graded members · 1 not applicable')).toBeInTheDocument();
  });
  it('shows N/A, not 100%, when no requirement applies to any member', () => {
    const nothingApplies = {
      ...data,
      stats: {
        ...data.stats,
        graded_members: 0,
        not_applicable_members: 2,
        compliant_members: 0,
        compliance_percentage: null,
      },
    };
    render(<ComplianceOverviewWidget data={nothingApplies} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByText('No active requirement applies to any tracked member.')).toBeInTheDocument();
  });
  it('says compliance is not set up, not 100%, when no requirements exist', () => {
    const empty = {
      ...data,
      stats: { ...data.stats, active_requirements: 0, compliant_members: 2, compliance_percentage: 100 },
    };
    render(<ComplianceOverviewWidget data={empty} />);
    expect(screen.getByText('Not set up')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/training/admin?page=setup&tab=requirements');
  });
});
