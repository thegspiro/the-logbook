/**
 * New ballot items start from the department's eligibility defaults on
 * Election Settings, and naming a position the department restricted fills
 * in who votes for it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Election, EligibilityDefaults } from '../types/election';

const getBallotTemplates = vi.fn();
const getSavedBallotTemplates = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getBallotTemplates: (...args: unknown[]) => getBallotTemplates(...args) as unknown,
    getSavedBallotTemplates: (...args: unknown[]) => getSavedBallotTemplates(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { BallotBuilder } from './BallotBuilder';

const election = {
  id: 'elec-1',
  status: 'draft',
  positions: ['Chief', 'Secretary'],
  ballot_items: [],
  total_votes: 0,
} as unknown as Election;

const defaults: EligibilityDefaults = {
  rules: { attendance: { mode: 'none' }, waiting_periods: {} },
  default_require_attendance: false,
  default_voter_types: ['regular', 'life'],
  position_voter_types: { chief: ['operational'] },
};

const openCustomForm = async (user: ReturnType<typeof userEvent.setup>) => {
  const [open] = await screen.findAllByRole('button', { name: /Custom Item/ });
  await user.click(open as HTMLElement);
};

describe('BallotBuilder eligibility defaults', () => {
  beforeEach(() => {
    getBallotTemplates.mockReset();
    getSavedBallotTemplates.mockReset();
    getBallotTemplates.mockResolvedValue([]);
    getSavedBallotTemplates.mockResolvedValue([]);
  });

  it('starts a custom item from the department defaults', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} eligibilityDefaults={defaults} />
    );
    await openCustomForm(user);

    expect(screen.getByLabelText('Who Can Vote')).toHaveValue('regular,life');
    expect(screen.getByLabelText('Require meeting attendance to vote')).not.toBeChecked();
  });

  it('keeps the built-in defaults when the department has none', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    await openCustomForm(user);

    expect(screen.getByLabelText('Who Can Vote')).toHaveValue('all');
    expect(screen.getByLabelText('Require meeting attendance to vote')).toBeChecked();
  });

  it('fills in who votes for a restricted position', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} eligibilityDefaults={defaults} />
    );
    await openCustomForm(user);
    await user.selectOptions(screen.getByLabelText('Vote Type'), 'candidate_selection');

    await user.selectOptions(screen.getByLabelText('Position'), 'Chief');
    expect(screen.getByLabelText('Who Can Vote')).toHaveValue('operational');

    // A position the department did not restrict leaves the choice alone.
    await user.selectOptions(screen.getByLabelText('Position'), 'Secretary');
    expect(screen.getByLabelText('Who Can Vote')).toHaveValue('operational');
  });
});
