/**
 * A member's voting waiting period, and the secretary's override of it.
 *
 * Election Settings sets a waiting period per member type ("administrative
 * members may vote a year after becoming administrative"). The wait counts
 * from when the member became that type, which the app has recorded only
 * since this release — older dates are a best guess — so a secretary can
 * correct the date the wait counts from, or waive the wait for this member.
 *
 * A waiver never lifts a type the department made ineligible, nor an
 * attendance requirement. Shown with elections.manage only, matching the
 * endpoint.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../../services/api';
import type { MemberVotingEligibility, MemberVotingEligibilityUpdate } from '../../types/election';
import { MEETING_KIND_LABELS } from '../../modules/elections/eligibilityRules';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { useConfirm } from '../../contexts/ConfirmContext';

interface VotingEligibilitySectionProps {
  userId: string;
  memberName: string;
}

const outcomeText = (outcome: MemberVotingEligibility['outcomes'][number]): string => {
  switch (outcome.state) {
    case 'never':
      return 'Not eligible to vote';
    case 'waived':
      return 'Waiting period waived';
    case 'waiting':
      return `Waiting — may vote from ${formatCalendarDate(outcome.eligible_from)}`;
    case 'eligible':
      return outcome.eligible_from
        ? `Waiting period over since ${formatCalendarDate(outcome.eligible_from)}`
        : 'Waiting period does not hold them back';
    default:
      return 'No waiting period';
  }
};

export const VotingEligibilitySection: React.FC<VotingEligibilitySectionProps> = ({ userId, memberName }) => {
  const [data, setData] = useState<MemberVotingEligibility | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [waived, setWaived] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { confirm } = useConfirm();

  const adopt = (next: MemberVotingEligibility) => {
    setData(next);
    setStartDate(next.voting_wait_from ?? '');
    setWaived(next.voting_wait_waived);
    setReason(next.voting_wait_override_reason ?? '');
    setFormError(null);
  };

  const load = useCallback(async () => {
    try {
      adopt(await electionService.getMemberVotingEligibility(userId));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load voting eligibility'));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <section className="card p-6" aria-labelledby="voting-eligibility-heading">
        <h2 id="voting-eligibility-heading" className="text-theme-text-primary text-lg font-semibold">
          Voting eligibility
        </h2>
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {loadError}
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card flex justify-center p-6" aria-label="Voting eligibility" aria-busy="true">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
      </section>
    );
  }

  const storedDate = data.voting_wait_from ?? '';
  const dirty =
    startDate !== storedDate ||
    waived !== data.voting_wait_waived ||
    reason.trim() !== (data.voting_wait_override_reason ?? '');
  const hasOverride = data.voting_wait_from !== null && data.voting_wait_from !== undefined;
  const overridden = hasOverride || data.voting_wait_waived;

  const save = async (payload: MemberVotingEligibilityUpdate, success: string) => {
    try {
      setSaving(true);
      adopt(await electionService.updateMemberVotingEligibility(userId, payload));
      toast.success(success);
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Failed to save the override'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const settingOverride = startDate !== '' || waived;
    if (settingOverride && !reason.trim()) {
      setFormError('Give a reason for the override.');
      return;
    }
    // Every field the form owns, so a cleared date is a clear (pitfall #1).
    void save(
      {
        voting_wait_from: startDate || null,
        voting_wait_waived: waived,
        reason: reason.trim() || undefined,
      },
      'Voting eligibility saved'
    );
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: 'Remove the override?',
      message: `${memberName}'s waiting period will count from when they became ${(
        data.member_type_label ?? 'their type'
      ).toLowerCase()} again, and the recorded reason is removed.`,
      confirmLabel: 'Remove override',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (ok) void save({ voting_wait_from: null, voting_wait_waived: false }, 'Override removed');
  };

  return (
    <section className="card p-6" aria-labelledby="voting-eligibility-heading">
      <h2 id="voting-eligibility-heading" className="text-theme-text-primary text-lg font-semibold">
        Voting eligibility
      </h2>
      {/* One column at every width: the card renders only in the profile's
          narrow sidebar, and a viewport breakpoint cannot see that — `sm:`
          split it into two ~120px columns on every desktop. */}
      <dl data-testid="voting-eligibility-fields" className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-theme-text-muted">Member type</dt>
          <dd className="text-theme-text-primary">{data.member_type_label ?? 'Not a voting member type'}</dd>
        </div>
        <div>
          <dt className="text-theme-text-muted">Became this type</dt>
          <dd className="text-theme-text-primary">
            {data.type_since ? formatCalendarDate(data.type_since) : 'Not recorded'}
          </dd>
        </div>
        {data.outcomes.map((outcome) => (
          <div key={outcome.meeting_kind}>
            <dt className="text-theme-text-muted">{MEETING_KIND_LABELS[outcome.meeting_kind]}</dt>
            <dd className="text-theme-text-primary" data-testid={`wait-outcome-${outcome.meeting_kind}`}>
              {outcomeText(outcome)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-theme-text-muted mt-2 text-xs">
        Under the waiting periods in Election Settings. Meeting attendance is judged separately, at each election.
      </p>

      <fieldset className="mt-5 space-y-3" disabled={saving}>
        <legend className="text-theme-text-primary text-sm font-medium">Override for this member</legend>
        <div className="max-w-xs">
          <label htmlFor="voting-wait-from" className="form-label">
            Count the wait from
          </label>
          <input
            id="voting-wait-from"
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-describedby="voting-wait-from-help"
          />
          <p id="voting-wait-from-help" className="text-theme-text-muted mt-1 text-xs">
            Use when the member became their type earlier than the app recorded. Leave empty to use the recorded date.
          </p>
        </div>
        <label className="text-theme-text-primary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={waived}
            onChange={(e) => setWaived(e.target.checked)}
          />
          Waive the waiting period
        </label>
        <p className="text-theme-text-muted text-xs">
          A waiver does not make a type that may never vote eligible, and does not lift an attendance requirement.
        </p>
        <div>
          <label htmlFor="voting-wait-reason" className="form-label">
            Reason
          </label>
          <input
            id="voting-wait-reason"
            type="text"
            className="form-input"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Made regular at the March 2019 meeting"
          />
        </div>
        {formError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save override
          </button>
          {overridden && (
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => void handleClear()}>
              Remove override
            </button>
          )}
        </div>
      </fieldset>
    </section>
  );
};

export default VotingEligibilitySection;
