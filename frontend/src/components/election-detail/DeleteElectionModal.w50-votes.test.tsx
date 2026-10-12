/**
 * The delete dialog listed the votes it would destroy with
 * `total_votes && total_votes > 0 && (...)`, which renders the number itself
 * when it is 0 — a bare "0" bullet on every zero-vote election (REDRIVE-A-3).
 */

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { Election } from '../../types/election';

import DeleteElectionModal from './DeleteElectionModal';

const election = (total_votes: number) =>
  ({ id: 'e-1', title: 'Officer Election', status: 'open', total_votes }) as unknown as Election;

const renderModal = (total_votes: number) =>
  renderWithRouter(
    <DeleteElectionModal
      election={election(total_votes)}
      isDraft={false}
      deleting={false}
      error={null}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
    />
  );

describe('DeleteElectionModal vote bullet', () => {
  it('prints no bullet at all for an election with no votes', () => {
    renderModal(0);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).not.toContain('0');
    expect(screen.queryByText(/votes.*already cast/)).not.toBeInTheDocument();
  });

  it('names the votes it will delete when there are some', () => {
    renderModal(5);
    expect(screen.getByText('5 votes')).toBeInTheDocument();
  });
});
