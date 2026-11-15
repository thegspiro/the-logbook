/**
 * ElectionWorkflowTabs — the section links in an election's header.
 *
 * Each section is its own address, so these are links marking the open one
 * with aria-current, not ARIA tabs; which sections appear is
 * visibleElectionSections' decision, covered in electionSections.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ElectionWorkflowTabs } from './ElectionWorkflowTabs';
import type { Election } from '../../../types/election';
import type { ElectionSection } from '../electionSections';

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

const renderLinks = (
  activeSection: ElectionSection | null,
  election: Election = baseElection,
  candidateCount?: number
) =>
  render(
    <MemoryRouter>
      <ElectionWorkflowTabs
        electionId="el1"
        election={election}
        canManage
        activeSection={activeSection}
        candidateCount={candidateCount}
      />
    </MemoryRouter>
  );

describe('ElectionWorkflowTabs', () => {
  it('links the Overview and each section to its own address', () => {
    renderLinks(null);
    const nav = screen.getByRole('navigation', { name: 'Election sections' });

    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/elections/el1');
    expect(within(nav).getByRole('link', { name: 'Eligibility' })).toHaveAttribute(
      'href',
      '/elections/el1/eligibility'
    );
    expect(within(nav).getByRole('link', { name: 'Integrity & Audit' })).toHaveAttribute(
      'href',
      '/elections/el1/integrity'
    );
  });

  it('marks the Overview as the open page when no section is', () => {
    renderLinks(null);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Eligibility' })).not.toHaveAttribute('aria-current');
  });

  it('marks the open section and only that one', () => {
    renderLinks('proxies');
    expect(screen.getByRole('link', { name: 'Proxy Voting' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the Attendance link on a closed election', () => {
    renderLinks(null, { ...baseElection, status: 'closed' });
    expect(screen.getByRole('link', { name: 'Attendance' })).toHaveAttribute('href', '/elections/el1/attendance');
    expect(screen.getByRole('link', { name: 'Results' })).toBeInTheDocument();
  });

  it('shows the nominee count beside Candidates', () => {
    renderLinks(null, baseElection, 3);
    expect(screen.getByRole('link', { name: /^Candidates\s*3$/ })).toBeInTheDocument();
  });
});
