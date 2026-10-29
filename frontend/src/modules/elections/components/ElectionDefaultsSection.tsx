/**
 * Election Settings → Defaults
 *
 * The values a new election's form starts from (ELEC2-9). The create form
 * reads them through `electionDefaultsFrom`; an officer can still change any
 * of them for one election. Elections already created are not affected.
 */

import React, { useState } from 'react';
import { QuorumType, VictoryCondition } from '../../../constants/enums';
import type { ElectionSettings } from '../../../types/election';
import { WINNER_RULES } from '../../../utils/electionDefaults';
import { SettingsToggle as Toggle } from '../../../components/settings/SettingsToggle';

interface ElectionDefaultsSectionProps {
  settings: ElectionSettings;
  /** Writes the changed fields; `immediate: false` debounces a typed value. */
  onChange: (patch: Partial<ElectionSettings>, options?: { immediate?: boolean }) => void;
}

const QUORUM_VALUE_MAX = 2_147_483_647;

/** A whole number within [min, max], or null for anything else. */
const parseWhole = (raw: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
};

export const ElectionDefaultsSection: React.FC<ElectionDefaultsSectionProps> = ({ settings, onChange }) => {
  // What has been typed into a number box while it is not a value the API
  // accepts. Nothing is sent until it is.
  const [percentageDraft, setPercentageDraft] = useState<string | null>(null);
  const [quorumDraft, setQuorumDraft] = useState<string | null>(null);

  const rule = `${settings.default_voting_method ?? 'simple_majority'}|${settings.default_victory_condition ?? 'most_votes'}`;
  const condition = settings.default_victory_condition;
  const usesPercentage = condition === VictoryCondition.SUPERMAJORITY || condition === VictoryCondition.THRESHOLD;
  const quorumType = settings.default_quorum_type ?? QuorumType.NONE;
  const quorumMax = quorumType === QuorumType.PERCENTAGE ? 100 : QUORUM_VALUE_MAX;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="election-default-rule" className="form-label">
          How is the winner determined?
        </label>
        <select
          id="election-default-rule"
          className="form-input"
          value={WINNER_RULES.some((r) => r.value === rule) ? rule : 'simple_majority|most_votes'}
          onChange={(e) => {
            const picked = WINNER_RULES.find((r) => r.value === e.target.value);
            if (!picked) return;
            setPercentageDraft(null);
            onChange({
              default_voting_method: picked.method,
              default_victory_condition: picked.condition,
              // As on the create form, a percentage belongs to one rule.
              default_victory_percentage: null,
            });
          }}
        >
          {WINNER_RULES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {usesPercentage && (
        <div className="max-w-xs">
          <label htmlFor="election-default-percentage" className="form-label">
            {condition === VictoryCondition.SUPERMAJORITY ? 'Supermajority percentage' : 'Percentage threshold'}
          </label>
          <input
            id="election-default-percentage"
            type="number"
            inputMode="numeric"
            className="form-input"
            min={1}
            max={100}
            step={1}
            placeholder={condition === VictoryCondition.SUPERMAJORITY ? '67' : 'e.g. 60'}
            value={percentageDraft ?? settings.default_victory_percentage ?? ''}
            aria-invalid={percentageDraft !== null}
            aria-describedby={percentageDraft !== null ? 'election-default-percentage-error' : undefined}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw.trim() === '') {
                setPercentageDraft(null);
                onChange({ default_victory_percentage: null }, { immediate: false });
                return;
              }
              const parsed = parseWhole(raw, 1, 100);
              if (parsed === null) {
                setPercentageDraft(raw);
                return;
              }
              setPercentageDraft(null);
              onChange({ default_victory_percentage: parsed }, { immediate: false });
            }}
          />
          {percentageDraft !== null && (
            <p
              id="election-default-percentage-error"
              role="alert"
              className="mt-1 text-sm text-red-700 dark:text-red-400"
            >
              Enter a whole number from 1 to 100.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Anonymous voting</p>
            <p className="text-theme-text-muted text-xs">Votes are saved without the voter&apos;s name.</p>
          </div>
          <Toggle
            checked={settings.default_anonymous_voting ?? true}
            onChange={(next) => onChange({ default_anonymous_voting: next })}
            label="Anonymous voting"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">Allow write-in candidates</p>
            <p className="text-theme-text-muted text-xs">Voters may type in someone who is not on the ballot.</p>
          </div>
          <Toggle
            checked={settings.default_allow_write_ins ?? false}
            onChange={(next) => onChange({ default_allow_write_ins: next })}
            label="Allow write-in candidates"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="election-default-quorum-type" className="form-label">
            Quorum
          </label>
          <select
            id="election-default-quorum-type"
            className="form-input"
            value={quorumType}
            onChange={(e) => {
              const next = e.target.value as QuorumType;
              setQuorumDraft(null);
              const value = settings.default_quorum_value;
              // A count above 100 is not a percentage; clear it rather than
              // send a pair the API refuses.
              const keepValue =
                next !== QuorumType.NONE && !(next === QuorumType.PERCENTAGE && value != null && value > 100);
              onChange({ default_quorum_type: next, default_quorum_value: keepValue ? (value ?? null) : null });
            }}
          >
            <option value={QuorumType.NONE}>No quorum</option>
            <option value={QuorumType.PERCENTAGE}>Percentage of eligible voters</option>
            <option value={QuorumType.COUNT}>Number of voters</option>
          </select>
        </div>
        {quorumType !== QuorumType.NONE && (
          <div>
            <label htmlFor="election-default-quorum-value" className="form-label">
              {quorumType === QuorumType.PERCENTAGE ? 'Percentage who must vote' : 'Voters who must vote'}
            </label>
            <input
              id="election-default-quorum-value"
              type="number"
              inputMode="numeric"
              className="form-input"
              min={1}
              max={quorumMax}
              step={1}
              value={quorumDraft ?? settings.default_quorum_value ?? ''}
              aria-invalid={quorumDraft !== null}
              aria-describedby="election-default-quorum-hint"
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = parseWhole(raw, 1, quorumMax);
                if (parsed === null) {
                  setQuorumDraft(raw);
                  return;
                }
                setQuorumDraft(null);
                onChange({ default_quorum_value: parsed }, { immediate: false });
              }}
            />
            <p
              id="election-default-quorum-hint"
              role={quorumDraft !== null ? 'alert' : undefined}
              className={
                quorumDraft !== null
                  ? 'mt-1 text-sm text-red-700 dark:text-red-400'
                  : 'text-theme-text-muted mt-1 text-xs'
              }
            >
              {quorumDraft !== null
                ? `Enter a whole number from 1 to ${quorumType === QuorumType.PERCENTAGE ? '100' : 'the number of members'}.`
                : settings.default_quorum_value == null
                  ? 'New elections get no quorum until a number is entered here.'
                  : 'New elections start with this quorum.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ElectionDefaultsSection;
