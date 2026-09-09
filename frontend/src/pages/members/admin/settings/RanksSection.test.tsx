/**
 * A failed load is not an empty ladder.
 *
 * The version this replaced caught the load error and rendered the section's
 * empty state, so an unreachable API told a department it had no rank
 * structure — while every rung was still in the database and every member
 * still held one. Same family as the five other absent-answers-shown-as-
 * confident-ones fixed across this work, and the reason it is tested here
 * rather than assumed from the shape of the code.
 *
 * The malformed-response half of that bug is asserted in `ranksService.test.ts`
 * instead, and has to be: it is `asArray` inside the service that turns a
 * proxy error page into an empty ladder, so a check in this component would sit
 * above the swallow and never fire. Mocking the service here mocks out the very
 * layer that carries the fault.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getRankLadder = vi.fn();
const validateRanks = vi.fn();

vi.mock('../../../../services/api', () => ({
  ranksService: {
    getRanks: vi.fn(),
    getRankLadder: (...args: unknown[]) => getRankLadder(...args) as unknown,
    validateRanks: (...args: unknown[]) => validateRanks(...args) as unknown,
    createRank: vi.fn(),
    updateRank: vi.fn(),
    deleteRank: vi.fn(),
    reorderRanks: vi.fn(),
  },
}));

vi.mock('../../../../hooks/useRanks', () => ({ invalidateRanksCache: vi.fn() }));

import RanksSection from './RanksSection';

describe('RanksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateRanks.mockResolvedValue({ issues: [], total: 0 });
  });

  it('says the ladder could not be loaded rather than showing an empty one', async () => {
    getRankLadder.mockRejectedValue(new Error('network'));

    render(<RanksSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The rank ladder could not be loaded.');
    // The distinction the whole fix turns on: not shown, not missing.
    expect(screen.getByText(/not shown, not missing/i)).toBeInTheDocument();
  });

  it('re-reads the ladder when the officer retries, and shows it once it arrives', async () => {
    // A flag rather than mockRejectedValueOnce: the effect consumes a "once"
    // before Retry is ever clicked, so that form of the test passes against the
    // reverted fix. This one fails against it.
    let reachable = false;
    getRankLadder.mockImplementation(() =>
      reachable
        ? Promise.resolve([
            {
              id: 'r1',
              rank_code: 'probationary',
              display_name: 'Probationary',
              sort_order: 0,
              is_active: true,
              eligible_positions: [],
            },
          ])
        : Promise.reject(new Error('network'))
    );

    render(<RanksSection />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    reachable = true;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText('Probationary')).toBeInTheDocument();
  });

  it('renders the ladder without an alert when the load succeeds', async () => {
    getRankLadder.mockResolvedValue([
      {
        id: 'r1',
        rank_code: 'captain',
        display_name: 'Captain',
        sort_order: 0,
        is_active: true,
        eligible_positions: [],
      },
    ]);

    render(<RanksSection />);

    expect(await screen.findByText('Captain')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the ladder when only the non-blocking validation call fails', async () => {
    // Validation reports members whose rank matches no rung. Its failure must
    // not take the ladder down with it — and an absent warning is not a claim
    // that nothing is wrong.
    getRankLadder.mockResolvedValue([
      {
        id: 'r1',
        rank_code: 'captain',
        display_name: 'Captain',
        sort_order: 0,
        is_active: true,
        eligible_positions: [],
      },
    ]);
    validateRanks.mockRejectedValue(new Error('network'));

    render(<RanksSection />);

    expect(await screen.findByText('Captain')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
