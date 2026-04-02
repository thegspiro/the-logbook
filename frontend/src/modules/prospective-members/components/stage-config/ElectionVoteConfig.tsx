import React from 'react';
import { VictoryCondition } from '../../../../constants/enums';
import type {
  ElectionStageConfig,
  ElectionPackageFieldConfig,
  StageConfig,
} from '../../types';
import { DEFAULT_ELECTION_PACKAGE_FIELDS } from '../../types';

interface ElectionVoteConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  errors: Record<string, string>;
}

const ElectionVoteConfig: React.FC<ElectionVoteConfigProps> = ({
  config,
  setConfig,
  errors,
}) => {
  const electionConfig = config as ElectionStageConfig;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stage-voting-method" className="text-theme-text-muted mb-2 block text-sm">
          Voting Method
        </label>
        <select
          id="stage-voting-method"
          value={electionConfig.voting_method}
          onChange={(e) =>
            setConfig({
              ...electionConfig,
              voting_method: e.target.value as ElectionStageConfig['voting_method'],
            })
          }
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        >
          <option value="simple_majority">Simple Majority</option>
          <option value="approval">Approval Voting</option>
          <option value="supermajority">Supermajority</option>
        </select>
      </div>
      <div>
        <label htmlFor="stage-victory-condition" className="text-theme-text-muted mb-2 block text-sm">
          Victory Condition
        </label>
        <select
          id="stage-victory-condition"
          value={electionConfig.victory_condition}
          onChange={(e) =>
            setConfig({
              ...electionConfig,
              victory_condition: e.target.value as ElectionStageConfig['victory_condition'],
            })
          }
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        >
          <option value="most_votes">Most Votes</option>
          <option value="majority">Majority (&gt;50%)</option>
          <option value="supermajority">Supermajority</option>
        </select>
      </div>
      {electionConfig.victory_condition === VictoryCondition.SUPERMAJORITY && (
        <div>
          <label htmlFor="stage-victory-percentage" className="text-theme-text-muted mb-2 block text-sm">
            Required Percentage
          </label>
          <input
            id="stage-victory-percentage"
            type="number"
            min={51}
            max={100}
            value={electionConfig.victory_percentage ?? 67}
            onChange={(e) => setConfig({ ...electionConfig, victory_percentage: Number(e.target.value) })}
            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-32 rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
          />
          <span className="text-theme-text-muted ml-2 text-sm">%</span>
        </div>
      )}
      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={electionConfig.anonymous_voting}
          onChange={(e) => setConfig({ ...electionConfig, anonymous_voting: e.target.checked })}
          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
        />
        Anonymous voting
      </label>

      {/* Election Package Fields */}
      <div className="border-theme-surface-border mt-4 border-t pt-4">
        <h4 className="text-theme-text-secondary mb-2 text-sm font-medium">Election Package Contents</h4>
        <p className="text-theme-text-muted mb-3 text-xs">
          Choose what applicant information is included in the election package for voters and the secretary.
        </p>
        {(() => {
          const fields: ElectionPackageFieldConfig = electionConfig.package_fields ?? {
            ...DEFAULT_ELECTION_PACKAGE_FIELDS,
          };
          const updateField = (key: keyof ElectionPackageFieldConfig, value: boolean | string) => {
            setConfig({
              ...electionConfig,
              package_fields: { ...fields, [key]: value },
            });
          };
          return (
            <div className="space-y-2">
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_email}
                  onChange={(e) => updateField('include_email', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include email address
              </label>
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_phone}
                  onChange={(e) => updateField('include_phone', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include phone number
              </label>
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_address}
                  onChange={(e) => updateField('include_address', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include address
              </label>
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_date_of_birth}
                  onChange={(e) => updateField('include_date_of_birth', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include date of birth
              </label>
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_documents}
                  onChange={(e) => updateField('include_documents', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include uploaded documents
              </label>
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fields.include_stage_history}
                  onChange={(e) => updateField('include_stage_history', e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Include stage completion history
              </label>
              <div className="pt-1">
                <label
                  htmlFor="stage-custom-note-prompt"
                  className="text-theme-text-muted mb-1 block text-xs"
                >
                  Custom note prompt (optional)
                </label>
                <input
                  id="stage-custom-note-prompt"
                  type="text"
                  value={fields.custom_note_prompt ?? ''}
                  onChange={(e) => updateField('custom_note_prompt', e.target.value)}
                  placeholder="e.g., Please describe the applicant's qualifications..."
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
            </div>
          );
        })()}
      </div>
      {errors.eligible_voter_roles && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.eligible_voter_roles}</p>
      )}
      {errors.victory_percentage && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.victory_percentage}</p>
      )}
    </div>
  );
};

export default ElectionVoteConfig;
