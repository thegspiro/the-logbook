import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { TrainingRecord } from '../../types/training';

const mockGetRecords = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: {
    getRecords: (...args: unknown[]) => mockGetRecords(...args) as unknown,
    getUserStats: () => Promise.resolve(null),
    getComplianceSummary: () => Promise.resolve(null),
  },
  trainingProgramService: {
    getUserEnrollments: () => Promise.resolve([]),
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import MemberTrainingPrintPage from './MemberTrainingPrintPage';

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

describe('MemberTrainingPrintPage', () => {
  beforeEach(() => {
    mockGetRecords.mockReset();
    window.history.pushState({}, '', '/training/print/member?id=member-1&name=Pat');
  });

  it('prints where each course came from', async () => {
    mockGetRecords.mockResolvedValue([
      record({ id: 'a', course_name: 'Synced class', source: 'provider', source_label: 'Target Solutions' }),
      record({
        id: 'b',
        course_name: 'Imported class',
        completion_date: '2024-02-01',
        source: 'imported',
        source_label: 'Imported',
      }),
    ]);
    renderWithRouter(<MemberTrainingPrintPage />);

    const table = await screen.findByRole('table', { name: 'Complete course history' });
    expect(within(table).getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /Synced class/ })).getByText('Target Solutions')
    ).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /Imported class/ })).getByText('Imported')
    ).toBeInTheDocument();
  });
});
