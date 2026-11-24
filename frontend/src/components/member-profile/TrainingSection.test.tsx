import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { RequirementDetail, TrainingRecord } from '../../types/training';
import TrainingSection from './TrainingSection';

const record = (overrides: Partial<TrainingRecord>): TrainingRecord => ({
  id: 'r-1',
  organization_id: 'org-1',
  user_id: 'member-1',
  course_name: 'Pump Operations',
  training_type: 'continuing_education',
  completion_date: '2024-03-01',
  hours_completed: 2,
  status: 'completed',
  created_at: '2024-03-01T00:00:00Z',
  updated_at: '2024-03-01T00:00:00Z',
  ...overrides,
});

describe('member profile TrainingSection', () => {
  it('says where each recent record came from', () => {
    renderWithRouter(
      <TrainingSection
        userId="member-1"
        trainings={[
          record({ id: 'a', source: 'provider', source_label: 'Target Solutions' }),
          record({ id: 'b', course_name: 'Ladders', source: 'logbook', source_label: 'The Logbook' }),
        ]}
        trainingsLoading={false}
        complianceSummary={null}
        tz="America/New_York"
      />
    );

    expect(screen.getByText('Source: Target Solutions')).toBeInTheDocument();
    expect(screen.getByText('Source: The Logbook')).toBeInTheDocument();
  });

  it('shows a former member as not graded, not as a grade', () => {
    renderWithRouter(
      <TrainingSection
        userId="member-1"
        trainings={[]}
        trainingsLoading={false}
        complianceSummary={{
          user_id: 'member-1',
          requirements_met: 0,
          requirements_total: 0,
          certs_expiring_soon: 0,
          certs_expired: 0,
          compliance_status: 'not_current_member',
          compliance_label: 'Not a Current Member',
          hours_this_year: 3,
          active_certifications: 1,
        }}
        tz="America/New_York"
      />
    );

    const badge = screen.getByText('Not a Current Member');
    expect(badge.className).toContain('text-theme-text-muted');
    expect(screen.getByText(/not a current member of the department/)).toBeInTheDocument();
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
  });
});

describe('member profile certifications list', () => {
  const cert = (overrides: Partial<RequirementDetail>): RequirementDetail => ({
    id: 'req-cpr',
    name: 'CPR/BLS Certification',
    requirement_type: 'certification',
    frequency: 'biannual',
    required_hours: 1,
    completed_hours: 1,
    progress_percentage: 100,
    is_met: true,
    due_date: null,
    days_until_due: null,
    expiry_date: '2027-03-14',
    ...overrides,
  });

  const renderWith = (requirements: RequirementDetail[]) =>
    renderWithRouter(
      <TrainingSection
        userId="member-1"
        trainings={[]}
        trainingsLoading={false}
        complianceSummary={null}
        requirements={requirements}
        tz="America/New_York"
      />
    );

  it('lists each certification with its state and expiry date', () => {
    renderWith([
      cert({}),
      cert({ id: 'req-emt', name: 'EMT-B', is_met: false, expiry_date: '2026-03-14' }),
      cert({ id: 'req-hazmat', name: 'Hazmat Ops', is_met: false, expiry_date: null }),
      // Not a certification: not listed.
      cert({ id: 'req-hours', name: 'Annual Training Hours', requirement_type: 'hours' }),
    ]);

    const list = screen.getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('CPR/BLS CertificationOn file(Expires Mar 14, 2027)');
    expect(rows[1]).toHaveTextContent('EMT-BExpired(Mar 14, 2026)');
    expect(rows[2]).toHaveTextContent('Hazmat OpsNot recorded');
    expect(screen.queryByText('Annual Training Hours')).not.toBeInTheDocument();
  });

  it('is left out when the department withholds certification status', () => {
    renderWith([cert({ is_met: false, expiry_date: null, certification_status_hidden: true })]);
    expect(screen.queryByText('Certifications')).not.toBeInTheDocument();
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument();
  });

  it('prints record dates the way the rest of the app does', () => {
    renderWithRouter(
      <TrainingSection
        userId="member-1"
        trainings={[record({ completion_date: '2025-03-14', expiration_date: '2027-03-14' })]}
        trainingsLoading={false}
        complianceSummary={null}
        tz="America/New_York"
      />
    );
    expect(screen.getByText('Completed: Mar 14, 2025')).toBeInTheDocument();
    expect(screen.getByText('Expires: Mar 14, 2027')).toBeInTheDocument();
  });
});
