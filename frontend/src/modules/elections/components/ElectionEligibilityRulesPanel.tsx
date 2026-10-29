/**
 * This election's own election-wide voter rules (attendance, tenure).
 *
 * Copied from the department's defaults when the election was created, and
 * editable here until voting opens — the backend refuses the change on an
 * open or closed election, because redrawing the electorate after ballots
 * have gone out would change who may vote mid-vote.
 */

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../../../services/api';
import type { Election, ElectionEligibilityRules } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { EMPTY_ELIGIBILITY_RULES, describeEligibilityRules } from '../eligibilityRules';
import { EligibilityRulesEditor } from './EligibilityRulesEditor';

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
  const [saving, setSaving] = useState(false);
  // Bumped on discard so the editor drops any half-typed number with it.
  const [editorKey, setEditorKey] = useState(0);
  const dirty = JSON.stringify(rules) !== JSON.stringify(rulesOf(election));

  const save = async () => {
    try {
      setSaving(true);
      const updated = await electionService.updateElection(election.id, { eligibility_rules: rules });
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
      <h2 id="election-eligibility-rules-heading" className="text-theme-text-primary text-lg font-semibold">
        Rules every voter must meet
      </h2>
      {editable ? (
        <>
          <p className="text-theme-text-muted mt-1 mb-5 text-sm">
            Copied from the department&apos;s defaults in Election Settings when this election was created. They can be
            changed until voting opens. A voter override still lets a member vote who fails them.
          </p>
          <EligibilityRulesEditor
            key={editorKey}
            idPrefix={`election-${election.id}-eligibility`}
            value={rules}
            onChange={setRules}
          />
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
            Fixed when voting opened. A voter override still lets a member vote who fails them.
          </p>
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
