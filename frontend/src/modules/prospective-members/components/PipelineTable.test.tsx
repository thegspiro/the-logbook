import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { PipelineTable } from './PipelineTable';
import type { ApplicantListItem } from '../types';

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => ({
    advanceApplicant: vi.fn(),
    regressApplicant: vi.fn(),
    holdApplicant: vi.fn(),
    rejectApplicant: vi.fn(),
    withdrawApplicant: vi.fn(),
    isRejecting: false,
    isWithdrawing: false,
  }),
}));

const row = (id: string, first: string, last: string): ApplicantListItem => ({
  id,
  pipeline_id: 'pipe-1',
  first_name: first,
  last_name: last,
  email: `${first.toLowerCase()}@example.com`,
  current_stage_id: 's1',
  current_stage_name: 'Application',
  stage_entered_at: '2026-09-01T00:00:00Z',
  target_membership_type: 'regular',
  status: 'active',
  days_in_stage: 3,
  days_in_pipeline: 3,
  last_activity_at: '2026-09-01T00:00:00Z',
  days_since_activity: 3,
  inactivity_alert_level: 'normal',
  created_at: '2026-09-01T00:00:00Z',
});

const applicants = [row('a1', 'Riley', 'Bishop'), row('a2', 'Sam', 'Ortega')];

const onToggleSelect = vi.fn();
const onToggleAll = vi.fn();

const renderTable = (selected: Set<string>) =>
  renderWithRouter(
    <PipelineTable
      applicants={applicants}
      totalApplicants={applicants.length}
      currentPage={1}
      totalPages={1}
      onPageChange={vi.fn()}
      onApplicantClick={vi.fn()}
      selectedApplicants={selected}
      onToggleSelect={onToggleSelect}
      onToggleAll={onToggleAll}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PipelineTable selection', () => {
  // The page draws the one bulk bar for both views. The table drawing its own
  // as well stacked two "N selected" bars (15-11-table-bulk-actions).
  it('draws no bulk-action bar of its own when rows are selected', () => {
    renderTable(new Set(['a1', 'a2']));

    expect(screen.queryByText(/2 selected/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /selected applicant/ })).not.toBeInTheDocument();
  });

  it('reports row and header toggles to the page, which owns the selection', async () => {
    const user = userEvent.setup();
    renderTable(new Set(['a1']));

    await user.click(screen.getByRole('button', { name: 'Select Sam Ortega' }));
    expect(onToggleSelect).toHaveBeenCalledWith('a2');

    await user.click(screen.getByRole('button', { name: 'Select all applicants on this page' }));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
  });

  it('marks selected rows pressed and the header mixed on a partial selection', () => {
    renderTable(new Set(['a1']));

    expect(screen.getByRole('button', { name: 'Select Riley Bishop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select Sam Ortega' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Select all applicants on this page' })).toHaveAttribute(
      'aria-pressed',
      'mixed'
    );
  });
});
