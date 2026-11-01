/**
 * A member's voting waiting period on their profile, and the secretary's
 * override: correct the start date or waive the wait, with a reason.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { MemberVotingEligibility } from '../../types/election';
import { getTodayLocalDate } from '../../utils/dateFormatting';

const getMemberVotingEligibility = vi.fn();
const updateMemberVotingEligibility = vi.fn();

vi.mock('../../services/api', () => ({
  electionService: {
    getMemberVotingEligibility: (...a: unknown[]) => getMemberVotingEligibility(...a) as unknown,
    updateMemberVotingEligibility: (...a: unknown[]) => updateMemberVotingEligibility(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { VotingEligibilitySection } from './VotingEligibilitySection';

const waiting: MemberVotingEligibility = {
  user_id: 'u1',
  member_type: 'administrative',
  member_type_label: 'Administrative',
  type_since: '2026-06-01',
  wait_starts: '2026-06-01',
  voting_wait_from: null,
  voting_wait_waived: false,
  voting_wait_override_reason: null,
  outcomes: [
    { meeting_kind: 'regular', state: 'waiting', months: 12, eligible_from: '2027-06-01' },
    { meeting_kind: 'annual', state: 'never' },
  ],
};

describe('VotingEligibilitySection', () => {
  beforeEach(() => {
    getMemberVotingEligibility.mockReset();
    updateMemberVotingEligibility.mockReset();
    getMemberVotingEligibility.mockResolvedValue(structuredClone(waiting));
  });

  it('shows the member type, when they became it, and where they stand', async () => {
    renderWithRouter(<VotingEligibilitySection userId="u1" memberName="Sam Admin" />);

    expect(await screen.findByText('Administrative')).toBeInTheDocument();
    expect(screen.getByText('Jun 1, 2026')).toBeInTheDocument();
    expect(screen.getByTestId('wait-outcome-regular')).toHaveTextContent('Waiting — may vote from Jun 1, 2027');
    expect(screen.getByTestId('wait-outcome-annual')).toHaveTextContent('Not eligible to vote');
  });

  // The card lives only in the profile's narrow sidebar, where a viewport
  // breakpoint split it into two ~120px columns on every desktop. jsdom cannot
  // measure layout, so this pins the class; the Playwright capture is the
  // visual check.
  it('stacks its fields in one column at every width', async () => {
    renderWithRouter(<VotingEligibilitySection userId="u1" memberName="Sam Admin" />);

    const fields = await screen.findByTestId('voting-eligibility-fields');
    expect(fields.className).not.toMatch(/grid-cols/);
  });

  it('requires a reason before waiving the wait', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VotingEligibilitySection userId="u1" memberName="Sam Admin" />);

    await user.click(await screen.findByLabelText('Waive the waiting period'));
    await user.click(screen.getByRole('button', { name: 'Save override' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for the override.');
    expect(updateMemberVotingEligibility).not.toHaveBeenCalled();

    updateMemberVotingEligibility.mockResolvedValue({
      ...waiting,
      voting_wait_waived: true,
      voting_wait_override_reason: 'Board approved',
      outcomes: [{ meeting_kind: 'regular', state: 'waived', months: 12 }],
    });
    await user.type(screen.getByLabelText('Reason'), 'Board approved');
    await user.click(screen.getByRole('button', { name: 'Save override' }));

    await waitFor(() =>
      expect(updateMemberVotingEligibility).toHaveBeenCalledWith('u1', {
        voting_wait_from: null,
        voting_wait_waived: true,
        reason: 'Board approved',
      })
    );
    expect(await screen.findByTestId('wait-outcome-regular')).toHaveTextContent('Waiting period waived');
  });

  it('refuses a start date after today, which would bar the member until it passed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VotingEligibilitySection userId="u1" memberName="Sam Admin" />);

    const dateInput = await screen.findByLabelText('Count the wait from');
    const today = getTodayLocalDate();
    expect(dateInput).toHaveAttribute('max', today);

    await user.type(dateInput, '2099-01-01');
    await user.type(screen.getByLabelText('Reason'), 'Typo');
    await user.click(screen.getByRole('button', { name: 'Save override' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The date the wait counts from cannot be after today.');
    expect(updateMemberVotingEligibility).not.toHaveBeenCalled();
  });

  it('asks before removing an override', async () => {
    const user = userEvent.setup();
    getMemberVotingEligibility.mockResolvedValue({
      ...waiting,
      voting_wait_from: '2019-03-01',
      voting_wait_override_reason: 'Administrative since 2019',
    });
    updateMemberVotingEligibility.mockResolvedValue(structuredClone(waiting));
    renderWithRouter(<VotingEligibilitySection userId="u1" memberName="Sam Admin" />);

    await user.click(await screen.findByRole('button', { name: 'Remove override' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(updateMemberVotingEligibility).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove override' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove override' }));
    await waitFor(() =>
      expect(updateMemberVotingEligibility).toHaveBeenCalledWith('u1', {
        voting_wait_from: null,
        voting_wait_waived: false,
      })
    );
  });
});
