/**
 * W50-55 — the roster must report what the send actually did.
 *
 * After a live send every eligible row still showed a bare check mark under
 * "Ballot" and the green counter still said "Will Receive Ballot", so the
 * screen read as "not yet sent". The backend now stamps each row with
 * `ballot_sent` and the response with `total_ballots_sent` / `email_sent_at`;
 * a sent row says "Received ballot <when>", the counters carry a legend that
 * explains why a post-freeze member is ineligible, and the frozen-roll reason
 * is shown verbatim rather than rewritten as an item rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { EligibilityRoster as EligibilityRosterType, RosterMember } from '../../../types/election';

const mockGetEligibilityRoster = vi.fn();

vi.mock('../../../services/api', () => ({
  electionService: {
    getEligibilityRoster: (...args: unknown[]) => mockGetEligibilityRoster(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'UTC',
}));

import { EligibilityRoster } from './EligibilityRoster';

const FROZEN_ROLL_REASON = 'Not on the voter roll frozen when the election opened';

const member = (overrides: Partial<RosterMember>): RosterMember => ({
  user_id: 'u1',
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  membership_type: 'active',
  has_override: false,
  has_voted: false,
  is_attending: false,
  will_receive_ballot: true,
  ballot_sent: false,
  eligible_item_count: 2,
  total_item_count: 2,
  item_eligibility: [],
  ...overrides,
});

const rosterResponse = (overrides: Partial<EligibilityRosterType>): EligibilityRosterType => ({
  election_id: 'e1',
  election_title: 'Chief Election',
  election_status: 'open',
  total_members: 2,
  total_eligible: 1,
  total_ineligible: 1,
  total_voted: 0,
  total_overrides: 0,
  total_ballots_sent: 0,
  email_sent_at: null,
  roster: [],
  ...overrides,
});

const openRoster = async () => {
  renderWithRouter(<EligibilityRoster electionId="e1" />);
  await userEvent.click(screen.getByRole('button', { name: /voter eligibility roster/i }));
  await screen.findByRole('table', { name: /voter eligibility roster/i });
};

describe('EligibilityRoster (W50-55)', () => {
  beforeEach(() => {
    mockGetEligibilityRoster.mockReset();
  });

  it('says "Received ballot <when>" on a sent row and keeps the check mark on an unsent eligible row', async () => {
    mockGetEligibilityRoster.mockResolvedValue(
      rosterResponse({
        total_members: 2,
        total_eligible: 2,
        total_ineligible: 0,
        total_ballots_sent: 1,
        email_sent_at: '2026-09-30T14:05:00Z',
        roster: [
          member({ user_id: 'u1', full_name: 'Ada Lovelace', ballot_sent: true }),
          member({ user_id: 'u2', full_name: 'Grace Hopper', ballot_sent: false }),
        ],
      })
    );

    await openRoster();

    const sentRow = screen.getByRole('row', { name: /Ada Lovelace/ });
    expect(within(sentRow).getByText(/received ballot/i)).toHaveTextContent(/Received ballot .*September 30, 2026/);

    // The unsent-but-eligible row keeps the "will receive" mark, not the sent wording.
    const unsentRow = screen.getByRole('row', { name: /Grace Hopper/ });
    expect(within(unsentRow).queryByText(/received ballot/i)).not.toBeInTheDocument();
    expect(within(unsentRow).getByRole('img', { name: /will receive ballot/i })).toBeInTheDocument();

    // The counters say how many actually went out and when.
    expect(screen.getByText(/1 ballot\(s\) sent/i)).toHaveTextContent(/September 30, 2026/);
    expect(screen.queryByText('Will Receive Ballot')).not.toBeInTheDocument();
    expect(screen.getByText('Eligible', { selector: 'div' })).toBeInTheDocument();
  });

  it('shows the frozen-roll reason verbatim and explains it in the counter legend', async () => {
    mockGetEligibilityRoster.mockResolvedValue(
      rosterResponse({
        roster: [
          member({ user_id: 'u1', full_name: 'Ada Lovelace' }),
          member({
            user_id: 'u2',
            full_name: 'Newcomer Member',
            will_receive_ballot: false,
            eligible_item_count: 0,
            ineligibility_reason: FROZEN_ROLL_REASON,
          }),
        ],
      })
    );

    await openRoster();

    const newcomerRow = screen.getByRole('row', { name: /Newcomer Member/ });
    expect(within(newcomerRow).getByText(FROZEN_ROLL_REASON)).toBeInTheDocument();
    expect(within(newcomerRow).getByRole('img', { name: /will not receive ballot/i })).toBeInTheDocument();
    expect(screen.getByText(/joined after the roll was frozen/i)).toBeInTheDocument();

    // Nothing has been sent yet, so no row claims a delivery.
    expect(screen.queryByText(/received ballot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ballot\(s\) sent/i)).not.toBeInTheDocument();
    expect(screen.getByText('Will Receive Ballot')).toBeInTheDocument();
  });
});
