/**
 * ElectionWorkflowTabs — tab validity sync tests
 *
 * The parent (ElectionDetailPage) renders panels off its own activeTab
 * state, which defaults to the manager-only 'ballot' tab. For a
 * non-manager the component must push the corrected tab back up via
 * onTabChange, otherwise no panel renders under the highlighted tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ElectionWorkflowTabs } from './ElectionWorkflowTabs';
import type { Election } from '../../../types/election';

const baseElection = {
  id: 'el1',
  organization_id: 'org1',
  title: 'Officer Election',
  election_type: 'officer',
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-07-31T00:00:00Z',
  status: 'open',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'most_votes',
  enable_runoffs: false,
  runoff_type: 'top_two',
  max_runoff_rounds: 3,
  is_runoff: false,
  runoff_round: 0,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
} as unknown as Election;

describe('ElectionWorkflowTabs', () => {
  const onTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects a non-manager away from the hidden ballot tab to the first visible tab', () => {
    render(
      <ElectionWorkflowTabs election={baseElection} canManage={false} activeTab="ballot" onTabChange={onTabChange} />
    );

    // Non-managers viewing an OPEN election only see 'voting' (results are
    // hidden until close), so the parent must be told to switch to it.
    expect(onTabChange).toHaveBeenCalledWith('voting');
  });

  it('keeps a manager on the ballot tab', () => {
    render(
      <ElectionWorkflowTabs election={baseElection} canManage={true} activeTab="ballot" onTabChange={onTabChange} />
    );

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('redirects when the active tab becomes hidden after a status change', () => {
    const closedElection = {
      ...baseElection,
      status: 'closed',
    } as unknown as Election;

    render(
      <ElectionWorkflowTabs
        election={closedElection}
        canManage={true}
        activeTab="attendance"
        onTabChange={onTabChange}
      />
    );

    // 'attendance' only shows for draft/open elections; the first visible
    // tab for a closed election is 'ballot'.
    expect(onTabChange).toHaveBeenCalledWith('ballot');
  });
});
