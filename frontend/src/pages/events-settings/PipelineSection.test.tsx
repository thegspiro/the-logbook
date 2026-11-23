import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import PipelineSection from './PipelineSection';
import type { EventModuleSettings } from '../../types/event';
import type { OrgMember } from './types';

vi.mock('../../hooks/useRanks', () => ({
  useRanks: () => ({ ranks: [], formatRank: (rank: string) => rank }),
}));
// The section holds the feedback form setting, which loads the department's
// published forms; none are needed for the coordinator tests here.
vi.mock('../../services/api', () => ({
  eventService: { getFeedbackFormOptions: () => Promise.resolve([]) },
}));

const members: OrgMember[] = [
  { id: 'u1', first_name: 'Sam', last_name: 'Ortiz', status: 'active' },
  { id: 'u2', first_name: 'Dana', last_name: 'Reyes', status: 'probationary' },
  { id: 'u3', first_name: 'Lee', last_name: 'Park', status: 'archived' },
];

const settingsWith = (defaultAssigneeId: string | null) =>
  ({
    request_pipeline: {
      min_lead_time_days: 14,
      default_assignee_id: defaultAssigneeId,
      public_progress_visible: false,
      accept_public_requests: false,
      public_daily_limit: 10,
      tasks: [],
      email_triggers: {},
    },
  }) as unknown as EventModuleSettings;

const renderSection = (defaultAssigneeId: string | null) =>
  render(
    <MemoryRouter>
      <PipelineSection
        settings={settingsWith(defaultAssigneeId)}
        saving={false}
        members={members}
        onUpdateDefaultAssignee={vi.fn()}
        onTogglePublicVisibility={vi.fn()}
        onSaveFeedback={vi.fn()}
        onAddTask={vi.fn()}
        onRemoveTask={vi.fn()}
        onReorderTask={vi.fn()}
        newTaskLabel=""
        onNewTaskLabelChange={vi.fn()}
        newTaskDesc=""
        onNewTaskDescChange={vi.fn()}
      />
    </MemoryRouter>
  );

const coordinatorOptions = () =>
  within(screen.getByDisplayValue(/No default|Sam Ortiz|Lee Park/))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('PipelineSection — default coordinator', () => {
  it('offers only current members', () => {
    renderSection(null);

    expect(coordinatorOptions()).toEqual(['No default (manually assign)', 'Sam Ortiz', 'Dana Reyes']);
  });

  it('keeps a stored coordinator who has since left, marked as a former member', () => {
    renderSection('u3');

    expect(screen.getByDisplayValue('Lee Park (former member)')).toBeInTheDocument();
    expect(coordinatorOptions()).toEqual([
      'No default (manually assign)',
      'Sam Ortiz',
      'Dana Reyes',
      'Lee Park (former member)',
    ]);
  });
});
