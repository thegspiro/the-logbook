/**
 * Skill Test Officer Actions
 *
 * The decisions an officer makes about a finished official result, on the page
 * where they read it. Previously these lived only on the admin list, so an
 * officer who opened a scorecard to judge it had to navigate back to a row and
 * act on a record they could no longer see.
 *
 * Every action here changes what the person tested experiences, and the rules
 * governing that are inherited three levels deep (test → template →
 * department). An officer cannot be expected to hold that chain in their head,
 * so each action states its actual consequence for this test — resolved by the
 * backend and sent as effective_result_disclosure / effective_result_release —
 * rather than a generic description of what the button does.
 */

import React, { useState } from 'react';
import { Ban, CheckCircle2, Send } from 'lucide-react';
import toast from 'react-hot-toast';

import { useSkillsTestingStore } from '../../stores/skillsTestingStore';
import { ResultDisclosure, ResultRelease } from '../../types/skillsTesting';
import type { SkillTest } from '../../types/skillsTesting';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { Modal } from '../Modal';

/** Matches the backend's SkillTestVoidRequest minimum — a void stays visible in
 *  the member's history, so the record has to say why it was withdrawn. */
export const MIN_VOID_REASON_LENGTH = 10;

interface SkillTestOfficerActionsProps {
  test: SkillTest;
}

/** What the candidate ends up seeing, in the words an officer would use.
 *
 *  Deliberately phrased as an outcome for a named person rather than as a
 *  setting name: "Maria sees her scores but not your notes" is checkable
 *  against intent in a way that "disclosure: scores" is not.
 */
function candidateSeesLine(test: SkillTest, disclosure: string): string {
  const who = test.candidate_name || 'The candidate';
  if (disclosure === ResultDisclosure.NONE) {
    return `${who} is never shown this result — your department withholds results for this skill — so nothing is sent to them.`;
  }
  if (disclosure === ResultDisclosure.SCORES) {
    return `${who} is notified and can open the scorecard: every criterion's pass/fail and points, but none of the written notes.`;
  }
  return `${who} is notified and can open the full scorecard, including the notes you and the examiner wrote.`;
}

export const SkillTestOfficerActions: React.FC<SkillTestOfficerActionsProps> = ({ test }) => {
  const tz = useTimezone();
  const { validateTest, releaseTest, voidTest } = useSkillsTestingStore();

  const [validating, setValidating] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  // Fall back to the permissive defaults the backend itself resolves to, so a
  // response predating these fields describes the behavior members already
  // have rather than claiming results are withheld.
  const disclosure = test.effective_result_disclosure ?? ResultDisclosure.FULL;
  const release = test.effective_result_release ?? ResultRelease.ON_COMPLETION;

  const isPending = test.pending_validation === true;
  const isVoided = test.status === 'voided';
  const withheld = disclosure === ResultDisclosure.NONE;
  // Releasing is only a real step under on_release; everywhere else the result
  // is already as visible as it will ever be, and offering the button would
  // imply the candidate is waiting on something.
  const needsRelease = release === ResultRelease.ON_RELEASE && !test.released_at && !withheld;

  const handleValidate = async () => {
    setValidating(true);
    try {
      await validateTest(test.id);
      toast.success('Result accepted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to accept result'));
    } finally {
      setValidating(false);
    }
  };

  const handleRelease = async () => {
    setReleasing(true);
    try {
      await releaseTest(test.id);
      toast.success(`Result released to ${test.candidate_name || 'the candidate'}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to release result'));
    } finally {
      setReleasing(false);
    }
  };

  const closeVoidModal = () => {
    setVoidOpen(false);
    setVoidReason('');
  };

  const handleVoid = async () => {
    if (voidReason.trim().length < MIN_VOID_REASON_LENGTH) return;
    setVoiding(true);
    try {
      await voidTest(test.id, voidReason.trim());
      toast.success('Result voided');
      closeVoidModal();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to void result'));
    } finally {
      setVoiding(false);
    }
  };

  // A cancelled test never reached a result, so there is nothing to accept,
  // release or withdraw. Without this the panel fell through to its normal
  // state and told the officer the result "counts toward the candidate's
  // record" — of a test that was abandoned and counts toward nothing.
  if (test.status === 'cancelled') {
    return (
      <div className="card">
        <p className="text-theme-text-primary mb-1 text-sm font-medium">Test cancelled</p>
        <p className="text-theme-text-muted text-sm">
          This test was closed out before it finished, so there is no result to accept, release or withdraw. It counts
          toward nothing on {test.candidate_name || 'the candidate'}&apos;s record and uses none of their attempts.
        </p>
      </div>
    );
  }

  // A voided result is closed. Nothing is left to accept or release, and the
  // trail of who withdrew it and why is the only thing worth showing.
  if (isVoided) {
    return (
      <div className="card">
        <p className="text-theme-text-primary mb-1 text-sm font-medium">Result withdrawn</p>
        <p className="text-theme-text-muted text-sm">
          Voided{test.voided_at ? ` ${formatDateTime(test.voided_at, tz)}` : ''}
          {test.voided_by_name ? ` by ${test.voided_by_name}` : ''}. It stays in{' '}
          {test.candidate_name || 'the candidate'}&apos;s history marked as voided, counts toward nothing, and has
          released any program requirement it had credited.
        </p>
        {test.void_reason && (
          <p className="text-theme-text-secondary mt-2 text-sm">
            <span className="text-theme-text-muted">Reason:</span> {test.void_reason}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <p className="text-theme-text-primary mb-3 text-sm font-medium">Officer actions</p>

        <div className="space-y-4">
          {/* Accept — the step that makes a member-run evaluation count. */}
          {isPending ? (
            <div>
              <button
                onClick={() => void handleValidate()}
                disabled={validating}
                className="mobile-touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-3 font-bold text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-5 w-5" />
                {validating ? 'Accepting…' : 'Accept result'}
              </button>
              <p className="text-theme-text-muted mt-2 text-xs">
                Accepting confirms {test.examiner_name || 'the examiner'}&apos;s evaluation stands. From that point it
                counts toward {test.candidate_name || 'the candidate'}&apos;s record, credits any program requirement
                this test is linked to, and uses one of their attempts.{' '}
                {needsRelease
                  ? `${test.candidate_name || 'They'} still won't see it, or hear anything, until you release it below.`
                  : candidateSeesLine(test, disclosure)}
              </p>
            </div>
          ) : (
            <p className="text-theme-text-muted text-xs">
              Accepted{test.validated_at ? ` ${formatDateTime(test.validated_at, tz)}` : ''}
              {test.validated_by_name ? ` by ${test.validated_by_name}` : ''}. This result counts toward{' '}
              {test.candidate_name || 'the candidate'}&apos;s record.{' '}
              {needsRelease
                ? `They cannot see it yet — it is held back until an officer releases it.`
                : candidateSeesLine(test, disclosure)}
            </p>
          )}

          {/* Release — only where the department holds results back. */}
          {needsRelease && (
            <div>
              <button
                onClick={() => void handleRelease()}
                disabled={releasing || isPending}
                className="mobile-touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 font-bold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                <Send className="h-5 w-5" />
                {releasing ? 'Releasing…' : 'Release to candidate'}
              </button>
              <p className="text-theme-text-muted mt-2 text-xs">
                {isPending
                  ? 'Accept the result first. Until then there is no decided outcome to release — the candidate only sees that a test of theirs is under review.'
                  : candidateSeesLine(test, disclosure)}
              </p>
            </div>
          )}

          {/* Void — the rejection path, and the only way out of a wrong result. */}
          <div>
            <button
              onClick={() => setVoidOpen(true)}
              className="bg-theme-surface border-theme-surface-border text-theme-text-secondary mobile-touch-target flex w-full items-center justify-center gap-2 rounded-xl border-2 py-3 font-medium transition-colors hover:border-amber-500 hover:text-amber-600"
            >
              <Ban className="h-4 w-4" />
              Void result
            </button>
            <p className="text-theme-text-muted mt-2 text-xs">
              {isPending ? 'Rejects this evaluation. ' : 'Withdraws this result. '}
              The record is kept, not deleted — it stays in {test.candidate_name || 'the candidate'}&apos;s history
              marked as voided, stops counting toward statistics, and gives back any program requirement it had
              credited. You must give a reason, and they can read it.
            </p>
          </div>
        </div>
      </div>

      <Modal
        isOpen={voidOpen}
        onClose={closeVoidModal}
        title="Void test result"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={closeVoidModal}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleVoid()}
              disabled={voiding || voidReason.trim().length < MIN_VOID_REASON_LENGTH}
              className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {voiding ? 'Voiding…' : 'Void result'}
            </button>
          </div>
        }
      >
        <div className="modal-body space-y-3">
          <p className="text-theme-text-secondary text-sm">
            Voiding withdraws this result for{' '}
            <span className="text-theme-text-primary font-medium">{test.candidate_name}</span> ({test.template_name})
            without deleting it. The record stays in the member&apos;s history marked as voided, stops counting toward
            testing statistics, and releases any training requirement this test completed.
          </p>
          <div>
            <label htmlFor="void-reason-detail" className="form-label">
              Reason for voiding
            </label>
            <textarea
              id="void-reason-detail"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Scored against the wrong candidate"
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Required, at least {MIN_VOID_REASON_LENGTH} characters. The member can see this reason.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default SkillTestOfficerActions;
