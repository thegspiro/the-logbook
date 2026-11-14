/**
 * The ballot-item carve-out: one question on a ballot (a bylaws amendment at
 * a business meeting) can follow another kind of vote's rules, or rules of
 * its own, instead of the election's.
 *
 * Choosing a kind applies at once — the server copies that kind's defaults
 * onto the item. Custom rules are drafted here and saved together with their
 * reason, because the server refuses rules that differ from the defaults
 * without one, and the ballot builder saves every other edit as it is made.
 */

import React, { useState } from 'react';
import type { BallotItem, ElectionEligibilityRules } from '../../../types/election';
import { MeetingKind } from '../../../constants/enums';
import {
  BUILTIN_VOTER_ROWS,
  EMPTY_TYPE_RULES,
  ITEM_RULES_CUSTOM,
  ITEM_RULES_SAME,
  MEETING_KINDS,
  MEETING_KIND_LABELS,
  describeEligibilityRules,
  itemRulesChoice,
  rowsForRules,
} from '../eligibilityRules';
import { TypeRulesEditor } from './TypeRulesEditor';
import { OVERRIDE_REASON_MAX } from './CreateVoterRulesSection';

/** Puts an item back on the election's rules. */
const CLEARED: Partial<BallotItem> = {
  eligibility_kind: null,
  eligibility_rules: null,
  eligibility_override_reason: null,
};

interface BallotItemVoterRulesProps {
  item: BallotItem;
  /** The election's own rules; custom item rules start from them. */
  electionRules: ElectionEligibilityRules | null | undefined;
  /** The department's regular rules, for an election whose rules are not per type. */
  fallbackRules: ElectionEligibilityRules;
  disabled: boolean;
  onApply: (updates: Partial<BallotItem>) => void;
}

export const BallotItemVoterRules: React.FC<BallotItemVoterRulesProps> = ({
  item,
  electionRules,
  fallbackRules,
  disabled,
  onApply,
}) => {
  const [draft, setDraft] = useState<ElectionEligibilityRules | null>(null);
  const [reason, setReason] = useState('');
  const choice = itemRulesChoice(item);
  const idBase = `ballot-item-${item.id}-voter-rules`;

  const startDraft = () => {
    const start =
      item.eligibility_rules ??
      (electionRules?.version === 2 ? electionRules : fallbackRules.version === 2 ? fallbackRules : EMPTY_TYPE_RULES);
    setDraft(structuredClone(start));
    setReason(item.eligibility_override_reason ?? '');
  };

  const choose = (value: string) => {
    if (value === ITEM_RULES_CUSTOM) {
      startDraft();
      return;
    }
    setDraft(null);
    onApply(value === ITEM_RULES_SAME ? CLEARED : { ...CLEARED, eligibility_kind: value as MeetingKind });
  };

  const summary = item.eligibility_rules ? describeEligibilityRules(item.eligibility_rules) : [];

  return (
    <div className="space-y-3">
      <div className="max-w-sm">
        <label htmlFor={idBase} className="form-label">
          Voter rules for this item
        </label>
        <select
          id={idBase}
          className="form-input"
          value={draft ? ITEM_RULES_CUSTOM : choice}
          onChange={(e) => choose(e.target.value)}
          disabled={disabled}
        >
          <option value={ITEM_RULES_SAME}>Same as the election</option>
          {MEETING_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              Follow the {MEETING_KIND_LABELS[kind].toLowerCase()} rules
            </option>
          ))}
          <option value={ITEM_RULES_CUSTOM}>Custom for this item</option>
        </select>
      </div>

      {!draft && item.eligibility_rules && (
        <div className="text-sm" data-testid={`${idBase}-summary`}>
          {summary.length === 0 ? (
            <p className="text-theme-text-secondary">Every member may vote on this item.</p>
          ) : (
            <ul className="text-theme-text-secondary list-disc pl-5">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {item.eligibility_override_reason && (
            <p className="text-theme-text-primary mt-1">
              <span className="font-medium">Reason:</span> {item.eligibility_override_reason}
            </p>
          )}
          {!disabled && choice === ITEM_RULES_CUSTOM && (
            <button type="button" className="btn-secondary mt-2 rounded-md px-3 py-2 text-sm" onClick={startDraft}>
              Edit these rules
            </button>
          )}
        </div>
      )}

      {draft && (
        <div className="space-y-4">
          <TypeRulesEditor
            idPrefix={idBase}
            value={draft}
            rows={rowsForRules(draft, Object.keys(draft.types ?? {}).length > 0 ? null : BUILTIN_VOTER_ROWS)}
            onChange={setDraft}
          />
          <div>
            <label htmlFor={`${idBase}-reason`} className="form-label">
              Why does this item follow different rules? <span className="text-red-700 dark:text-red-400">*</span>
            </label>
            <textarea
              id={`${idBase}-reason`}
              className="form-input mt-1"
              rows={2}
              maxLength={OVERRIDE_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={`${idBase}-reason-help`}
            />
            <p id={`${idBase}-reason-help`} className="text-theme-text-muted mt-1 text-xs">
              Required when they differ from the department&apos;s rules. Printed in the minutes with the result.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary"
              // Custom rules are a difference from the defaults by intent,
              // and the server refuses one without its reason; this builder
              // shows an edit before the save returns, so a refusal would
              // leave unsaved rules on screen.
              disabled={disabled || reason.trim() === ''}
              onClick={() => {
                onApply({
                  eligibility_kind: null,
                  eligibility_rules: draft,
                  eligibility_override_reason: reason.trim() || null,
                });
                setDraft(null);
              }}
            >
              Save item rules
            </button>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BallotItemVoterRules;
