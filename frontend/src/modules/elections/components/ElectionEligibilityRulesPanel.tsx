/**
 * This election's own election-wide voter rules (attendance, tenure), and
 * whether it is held at a regular business meeting or the annual meeting.
 *
 * The rules are copied from the department's defaults for that meeting kind
 * when the election is created, and are editable here until voting opens — the backend refuses the change on an
 * open or closed election, because redrawing the electorate after ballots
 * have gone out would change who may vote mid-vote.
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../../../services/api';
import type { Election, ElectionEligibilityRules } from '../../../types/election';
import { ElectionStatus, MeetingKind } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useConfirm } from '../../../contexts/ConfirmContext';
import {
  EMPTY_ELIGIBILITY_RULES,
  MEETING_KINDS,
  MEETING_KIND_LABELS,
  describeEligibilityRules,
  rowsForRules,
} from '../eligibilityRules';
import { EligibilityRulesEditor } from './EligibilityRulesEditor';
import { TypeRulesEditor } from './TypeRulesEditor';
import { OVERRIDE_REASON_MAX } from './CreateVoterRulesSection';

/**
 * Render with a `key` derived from the election's stored rules, so a save or
 * an election reloaded elsewhere starts the panel afresh from what is stored.
 */
interface ElectionEligibilityRulesPanelProps {
  election: Election;
  onUpdate: (updated: Election) => void;
}

const rulesOf = (election: Election): ElectionEligibilityRules => election.eligibility_rules ?? EMPTY_ELIGIBILITY_RULES;

export const ElectionEligibilityRulesPanel: React.FC<ElectionEligibilityRulesPanelProps> = ({ election, onUpdate }) => {
  const editable = election.status === ElectionStatus.DRAFT || election.status === ElectionStatus.NOMINATIONS;
  const [rules, setRules] = useState<ElectionEligibilityRules>(() => rulesOf(election));
  const storedReason = election.eligibility_override_reason ?? '';
  const [reason, setReason] = useState(storedReason);
  const [saving, setSaving] = useState(false);
  // Bumped on discard so the editor drops any half-typed number with it.
  const [editorKey, setEditorKey] = useState(0);
  const dirty = JSON.stringify(rules) !== JSON.stringify(rulesOf(election)) || reason !== storedReason;
  const { confirm } = useConfirm();
  const kind = election.meeting_kind ?? MeetingKind.REGULAR;

  const changeKind = async (next: MeetingKind) => {
    const replace = await confirm({
      title: `Make this election a ${MEETING_KIND_LABELS[next].toLowerCase()}?`,
      message: `Its voter rules and position voter types will be replaced with the ${MEETING_KIND_LABELS[
        next
      ].toLowerCase()} defaults from Election Settings${dirty ? ', and your unsaved changes below will be lost' : ''}.`,
      confirmLabel: 'Change and replace rules',
      cancelLabel: 'Keep current rules',
      variant: 'warning',
    });
    if (!replace) return;
    try {
      setSaving(true);
      const updated = await electionService.updateElection(election.id, { meeting_kind: next });
      onUpdate(updated);
      toast.success(`Now a ${MEETING_KIND_LABELS[next].toLowerCase()}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to change the meeting'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      // The server keeps the reason only while the rules differ from the
      // kind's defaults, and refuses a difference without one.
      const updated = await electionService.updateElection(election.id, {
        eligibility_rules: rules,
        eligibility_override_reason: reason.trim() || null,
      });
      onUpdate(updated);
      toast.success('Voter rules saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save voter rules'));
    } finally {
      setSaving(false);
    }
  };

  const summary = describeEligibilityRules(election.eligibility_rules);

  return (
    <section className="card p-6" aria-labelledby="election-eligibility-rules-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="election-eligibility-rules-heading" className="text-theme-text-primary text-lg font-semibold">
          {election.eligibility_rules?.version === 2 ? 'Voter rules by member type' : 'Rules every voter must meet'}
        </h2>
        <Link
          to={`/elections/attendance?election=${encodeURIComponent(election.id)}`}
          className="text-theme-text-primary touch-target-phone inline-flex items-center text-sm font-medium underline"
        >
          Meeting attendance
        </Link>
      </div>
      {editable ? (
        <>
          <p className="text-theme-text-muted mt-1 mb-5 text-sm">
            Copied from the department&apos;s defaults in Election Settings when this election was created. They can be
            changed until voting opens. A voter override still lets a member vote who fails them.
          </p>
          <div className="mb-5 max-w-xs">
            <label htmlFor={`election-${election.id}-meeting-kind`} className="form-label">
              Kind of vote
            </label>
            <select
              id={`election-${election.id}-meeting-kind`}
              className="form-input"
              value={kind}
              disabled={saving}
              onChange={(e) => void changeKind(e.target.value as MeetingKind)}
            >
              {MEETING_KINDS.map((option) => (
                <option key={option} value={option}>
                  {MEETING_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          {rules.version === 2 ? (
            <TypeRulesEditor
              key={editorKey}
              idPrefix={`election-${election.id}-eligibility`}
              value={rules}
              rows={rowsForRules(rules)}
              onChange={setRules}
            />
          ) : (
            <EligibilityRulesEditor
              key={editorKey}
              idPrefix={`election-${election.id}-eligibility`}
              value={rules}
              onChange={setRules}
            />
          )}
          <div className="mt-5 max-w-2xl">
            <label htmlFor={`election-${election.id}-override-reason`} className="form-label">
              Why these rules differ from the defaults
            </label>
            <textarea
              id={`election-${election.id}-override-reason`}
              className="form-input mt-1"
              rows={3}
              maxLength={OVERRIDE_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={`election-${election.id}-override-reason-help`}
            />
            <p id={`election-${election.id}-override-reason-help`} className="text-theme-text-muted mt-1 text-xs">
              Required when the rules differ from the {MEETING_KIND_LABELS[kind].toLowerCase()} rules in Election
              Settings. Recorded in the audit log and printed in the minutes with the result.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save voter rules
            </button>
            {dirty && (
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => {
                  setRules(rulesOf(election));
                  setReason(storedReason);
                  setEditorKey((k) => k + 1);
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-theme-text-muted mt-1 mb-3 text-sm">
            {MEETING_KIND_LABELS[kind]}. Fixed when voting opened. A voter override still lets a member vote who fails
            them.
          </p>
          {storedReason && (
            <p className="text-theme-text-primary mb-3 text-sm" data-testid="election-override-reason">
              <span className="font-medium">Why these rules differ from the defaults:</span> {storedReason}
            </p>
          )}
          {summary.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">No election-wide rules apply to this election.</p>
          ) : (
            <ul className="text-theme-text-primary list-disc space-y-1 pl-5 text-sm">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default ElectionEligibilityRulesPanel;
