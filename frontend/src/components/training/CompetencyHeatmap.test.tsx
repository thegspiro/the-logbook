import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompetencyHeatmap as HeatmapData, MemberCompetency } from '../../types/training';

const mockGetDepartmentCompetencies = vi.fn();
vi.mock('../../services/trainingServices', () => ({
  competencyService: {
    getDepartmentCompetencies: (...args: unknown[]) => mockGetDepartmentCompetencies(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

// Import AFTER mocks
import { CompetencyHeatmap } from './CompetencyHeatmap';

const competency = (userId: string, skillId: string, level: MemberCompetency['current_level']): MemberCompetency => ({
  id: `${userId}-${skillId}`,
  organization_id: 'org-1',
  user_id: userId,
  skill_evaluation_id: skillId,
  current_level: level,
  evaluation_count: 1,
  decay_warning_sent: false,
  last_evaluated_at: '2026-09-01T14:00:00Z',
  next_evaluation_due: '2027-03-01',
  created_at: '2026-09-01T14:00:00Z',
  updated_at: '2026-09-01T14:00:00Z',
});

const DATA: HeatmapData = {
  members: [
    { user_id: 'u1', name: 'Alex Alpha', station: 'Station 1', rank: 'captain' },
    { user_id: 'u2', name: 'Blair Bravo', station: 'Station 2', rank: 'firefighter' },
  ],
  skills: [
    { id: 's1', name: 'Ladder Raise', category: 'Firefighting' },
    { id: 's2', name: 'Patient Assessment', category: 'EMS' },
  ],
  competencies: [competency('u1', 's1', 'expert'), competency('u2', 's2', 'novice')],
};

const cell = (member: string, skill: string) => screen.getByRole('cell', { name: new RegExp(`^${member} — ${skill}`) });

describe('CompetencyHeatmap', () => {
  beforeEach(() => {
    mockGetDepartmentCompetencies.mockReset();
    mockGetDepartmentCompetencies.mockResolvedValue(DATA);
  });

  it('shows each member against each skill at the stored level', async () => {
    render(<CompetencyHeatmap />);

    expect(await screen.findByRole('columnheader', { name: 'Ladder Raise' })).toBeInTheDocument();
    expect(within(cell('Alex Alpha', 'Ladder Raise')).getByText('E')).toBeInTheDocument();
    expect(cell('Alex Alpha', 'Ladder Raise')).toHaveAccessibleName(
      'Alex Alpha — Ladder Raise: Expert. Last evaluated 9/1/2026. Re-evaluation due 3/1/2027'
    );
    expect(within(cell('Blair Bravo', 'Patient Assessment')).getByText('N')).toBeInTheDocument();
    // No row on record is shown as "not evaluated", never as a level.
    expect(cell('Alex Alpha', 'Patient Assessment')).toHaveAccessibleName(
      'Alex Alpha — Patient Assessment: not evaluated'
    );
  });

  it('filters members by station and rank, and skills by category', async () => {
    const user = userEvent.setup();
    render(<CompetencyHeatmap />);
    await screen.findByRole('columnheader', { name: 'Ladder Raise' });

    await user.selectOptions(screen.getByLabelText('Station'), 'Station 2');
    expect(screen.queryByRole('rowheader', { name: 'Alex Alpha' })).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Blair Bravo' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Station'), '');
    await user.selectOptions(screen.getByLabelText('Rank'), 'captain');
    expect(screen.getByRole('rowheader', { name: 'Alex Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Blair Bravo' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Skill category'), 'EMS');
    expect(screen.queryByRole('columnheader', { name: 'Ladder Raise' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Patient Assessment' })).toBeInTheDocument();
  });

  it('says when no skills are defined rather than drawing an empty grid', async () => {
    mockGetDepartmentCompetencies.mockReset();
    mockGetDepartmentCompetencies.mockResolvedValue({ ...DATA, skills: [], competencies: [] });
    render(<CompetencyHeatmap />);

    expect(await screen.findByText(/No skills are defined yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
