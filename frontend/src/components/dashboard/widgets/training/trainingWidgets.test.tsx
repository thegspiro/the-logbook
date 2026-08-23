import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TrainingDashboardSummary } from '../../../../services/trainingServices';
import { PendingValidationWidget, UpcomingExpirationsWidget } from '.';
import { TRAINING_WIDGET_METADATA } from './metadata';

const data = {
  widget_metadata: {},
  stats: {
    total_members: 2,
    tracked_members: 2,
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
});
