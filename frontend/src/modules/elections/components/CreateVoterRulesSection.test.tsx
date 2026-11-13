/**
 * Create Election › Who may vote: customizing an election's rules away from
 * the kind's defaults, the reason that goes with it, and the count of
 * members the rules would admit today.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ElectionEligibilityRules, ElectionSettings } from '../../../types/election';
import type { MeetingKind } from '../../../constants/enums';

const mockPreview = vi.fn();
vi.mock('../../../services/api', () => ({
  electionService: {
    previewElectorate: (...args: unknown[]) => mockPreview(...args) as unknown,
  },
}));

import { CreateVoterRulesSection } from './CreateVoterRulesSection';

const typeDefaults = (types: ElectionEligibilityRules['types']) => ({
  rules: { version: 2 as const, attendance: { mode: 'none' as const }, types },
  default_require_attendance: true,
  default_voter_types: ['all'],
  position_voter_types: {},
});

const SETTINGS: ElectionSettings = {
  eligibility: typeDefaults({ regular: { may_vote: true, wait: null, attendance: [] } }),
  bylaws_eligibility: typeDefaults({ probationary: { may_vote: false, wait: null, attendance: [] } }),
  voter_rows: [
    { key: 'regular', label: 'Regular', decided_by: 'status', counts_as: null },
    { key: 'probationary', label: 'Probationary', decided_by: 'status', counts_as: null },
  ],
};

const onRulesChange = vi.fn();

/** Holds the section's state the way the create dialog does. */
const Harness: React.FC = () => {
  const [kind, setKind] = useState<MeetingKind>('regular');
  const [rules, setRules] = useState<ElectionEligibilityRules | null>(null);
  const [reason, setReason] = useState('');
  return (
    <CreateVoterRulesSection
      settings={SETTINGS}
      meetingKind={kind}
      onMeetingKindChange={setKind}
      customRules={rules}
      onCustomRulesChange={(next) => {
        onRulesChange(next);
        setRules(next);
      }}
      reason={reason}
      onReasonChange={setReason}
    />
  );
};

describe('CreateVoterRulesSection', () => {
  beforeEach(() => {
    mockPreview.mockReset();
    mockPreview.mockResolvedValue({ eligible: 7, total: 9 });
    onRulesChange.mockReset();
  });

  it('counts the members the kind’s rules admit today', async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('create-voter-preview')).toHaveTextContent(
        '7 of 9 active members would receive a ballot today'
      )
    );
    expect(mockPreview).toHaveBeenCalledWith({ meeting_kind: 'regular' });
  });

  it('starts a customization from the kind’s defaults and previews the custom rules', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Kind of vote'), 'bylaws');
    await user.click(screen.getByRole('checkbox', { name: 'Customize the rules for this election' }));

    expect(onRulesChange).toHaveBeenLastCalledWith(SETTINGS.bylaws_eligibility?.rules);
    expect(screen.getByRole('group', { name: 'Probationary members' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Why do these rules differ/)).toBeInTheDocument();

    await user.selectOptions(
      within(screen.getByRole('group', { name: 'Probationary members' })).getByLabelText('May vote'),
      'yes'
    );
    await waitFor(() => {
      const last = mockPreview.mock.calls[mockPreview.mock.calls.length - 1] as
        [{ meeting_kind: string; eligibility_rules?: ElectionEligibilityRules }] | undefined;
      expect(last?.[0].meeting_kind).toBe('bylaws');
      expect(last?.[0].eligibility_rules?.types?.probationary).toEqual({ may_vote: true, wait: null, attendance: [] });
    });
    expect(screen.getByTestId('create-voter-rules')).toHaveTextContent('Voter rules for this election');
  });

  it('goes back to the defaults when the box is cleared', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'Customize the rules for this election' });
    await user.click(box);
    await user.click(box);
    expect(onRulesChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByLabelText(/Why do these rules differ/)).not.toBeInTheDocument();
  });

  it('says so when the members cannot be counted', async () => {
    mockPreview.mockRejectedValue(new Error('offline'));
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId('create-voter-preview')).toHaveTextContent('could not be counted just now')
    );
  });
});
