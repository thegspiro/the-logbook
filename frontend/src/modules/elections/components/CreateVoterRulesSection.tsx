/**
 * Create Election › Who may vote: the kind of vote, the rules it copies from
 * Election Settings, and — for an election held outside those rules — the
 * per-type editor, the reason the server requires for the difference, and a
 * count of the members the rules would admit today.
 *
 * The count comes from POST /elections/eligibility-preview, which runs the
 * same check the ballot send applies, so the number shown cannot disagree
 * with the ballots the election then sends (CLAUDE.md pitfall #29).
 */

import React, { useEffect, useState } from 'react';
import { electionService } from '../../../services/api';
import type { ElectionEligibilityRules, ElectionSettings, ElectoratePreview } from '../../../types/election';
import { MeetingKind } from '../../../constants/enums';
import { formatNumber } from '../../../utils/dateFormatting';
import {
  MEETING_KINDS,
  MEETING_KIND_LABELS,
  defaultsForKind,
  describeEligibilityRules,
  rowsForRules,
} from '../eligibilityRules';
import { TypeRulesEditor } from './TypeRulesEditor';

/** Mirrors backend `MAX_OVERRIDE_REASON_LENGTH`. */
export const OVERRIDE_REASON_MAX = 2000;
/** How long the rules sit unchanged before the count is asked for again. */
const PREVIEW_DEBOUNCE_MS = 600;

interface CreateVoterRulesSectionProps {
  settings: ElectionSettings;
  meetingKind: MeetingKind;
  onMeetingKindChange: (kind: MeetingKind) => void;
  /** The election's own rules, or null to copy the kind's defaults. */
  customRules: ElectionEligibilityRules | null;
  onCustomRulesChange: (rules: ElectionEligibilityRules | null) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
}

type PreviewState = { status: 'idle' } | { status: 'ready'; preview: ElectoratePreview } | { status: 'failed' };

export const CreateVoterRulesSection: React.FC<CreateVoterRulesSectionProps> = ({
  settings,
  meetingKind,
  onMeetingKindChange,
  customRules,
  onCustomRulesChange,
  reason,
  onReasonChange,
}) => {
  const defaults = defaultsForKind(settings, meetingKind);
  const rules = customRules ?? defaults.rules;
  const lines = describeEligibilityRules(rules, settings.voter_rows);
  // Version 1 defaults come only from a server that predates per-type rules,
  // which has no editor to offer here.
  const canCustomize = defaults.rules.version === 2;
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      electionService
        .previewElectorate({
          meeting_kind: meetingKind,
          ...(customRules ? { eligibility_rules: customRules } : {}),
        })
        .then((result) => {
          if (!cancelled) setPreview({ status: 'ready', preview: result });
        })
        .catch(() => {
          if (!cancelled) setPreview({ status: 'failed' });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // customRules is replaced, never mutated, so a new object means new rules;
    // each one restarts the debounce rather than adding a request.
  }, [meetingKind, customRules]);

  return (
    <section
      aria-labelledby="create-voter-rules-heading"
      className="bg-theme-surface-secondary space-y-4 rounded-md p-4"
    >
      <h3 id="create-voter-rules-heading" className="text-theme-text-primary text-base font-semibold">
        Who may vote
      </h3>
      <div className="max-w-xs">
        <label htmlFor="election-meeting-kind" className="form-label">
          Kind of vote
        </label>
        <select
          id="election-meeting-kind"
          value={meetingKind}
          onChange={(e) => onMeetingKindChange(e.target.value as MeetingKind)}
          aria-describedby="election-meeting-kind-help"
          className="form-input mt-1 shadow-xs"
        >
          {MEETING_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {MEETING_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <p id="election-meeting-kind-help" className="text-theme-text-muted mt-1 text-xs">
          Decides which voter rules from Election Settings this election starts with.
        </p>
      </div>

      <div data-testid="create-voter-rules">
        <p className="text-theme-text-primary text-sm font-medium">
          {customRules
            ? 'Voter rules for this election'
            : `Voter rules for ${MEETING_KIND_LABELS[meetingKind].toLowerCase()}s`}
        </p>
        {lines.length === 0 ? (
          <p className="text-theme-text-muted mt-1 text-sm">
            {rules.version === 2
              ? "No voter rules are set: every member may vote, subject to each ballot item's own rules."
              : "No election-wide rules. Every member whose tier may vote is eligible, subject to each ballot item's own rules."}
          </p>
        ) : (
          <ul className="text-theme-text-secondary mt-1 list-disc pl-5 text-sm">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {canCustomize && (
        <label className="text-theme-text-primary flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={customRules !== null}
            onChange={(e) => onCustomRulesChange(e.target.checked ? structuredClone(defaults.rules) : null)}
          />
          Customize the rules for this election
        </label>
      )}

      {customRules && (
        <div className="space-y-4">
          <TypeRulesEditor
            idPrefix="create-election-rules"
            value={customRules}
            rows={rowsForRules(customRules, settings.voter_rows)}
            onChange={onCustomRulesChange}
          />
          <div>
            <label htmlFor="election-override-reason" className="form-label">
              Why do these rules differ? <span className="text-red-700 dark:text-red-400">*</span>
            </label>
            <textarea
              id="election-override-reason"
              className="form-input mt-1"
              rows={3}
              maxLength={OVERRIDE_REASON_MAX}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              aria-describedby="election-override-reason-help"
            />
            <p id="election-override-reason-help" className="text-theme-text-muted mt-1 text-xs">
              Required when the rules differ from the {MEETING_KIND_LABELS[meetingKind].toLowerCase()} rules in Election
              Settings. Recorded in the audit log, shown on the election, and printed in the minutes with the result.
            </p>
          </div>
        </div>
      )}

      <p className="text-theme-text-secondary text-sm" aria-live="polite" data-testid="create-voter-preview">
        {preview.status === 'ready' &&
          `${formatNumber(preview.preview.eligible)} of ${formatNumber(preview.preview.total)} active members would receive a ballot today. Each ballot item's own voter types and check-in still apply.`}
        {preview.status === 'failed' && 'The members these rules admit could not be counted just now.'}
      </p>
      {!customRules && (
        <p className="text-theme-text-muted text-xs">
          The rules can still be changed for this election on its Eligibility tab, any time before voting opens.
        </p>
      )}
    </section>
  );
};

export default CreateVoterRulesSection;
