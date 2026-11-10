import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { TrainingRecord } from '../../types/training';
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
});
