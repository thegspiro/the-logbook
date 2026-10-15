/**
 * How a motion was voted on: what it needed to carry, and either the totals or
 * each present member's vote.
 *
 * A roll call lists the members recorded present, each of whom votes yes, no,
 * abstain or recuse; the server counts it, so what is shown here while filling
 * it in is only a running tally. Whether the counts carry the motion is the
 * server's reading (see the recorded motion), not something worked out here.
 */

import React from 'react';
import { motionMakers } from '../utils/motionMakers';
import { DEFAULT_THRESHOLD, THRESHOLD_LABELS, VOTE_LABELS, rollCallEntries, rollTotals } from '../utils/voteDraft';
import type { VoteDraft } from '../utils/voteDraft';
import type { AttendeeEntry, MotionThreshold, RollCallVote } from '../types/minutes';

interface MotionVoteFieldsProps {
  idPrefix: string;
  attendees: AttendeeEntry[];
  value: VoteDraft;
  onChange: (next: VoteDraft) => void;
  disabled?: boolean | undefined;
}

const THRESHOLDS = Object.keys(THRESHOLD_LABELS) as MotionThreshold[];
const VOTES = Object.keys(VOTE_LABELS) as RollCallVote[];

export const MotionVoteFields: React.FC<MotionVoteFieldsProps> = ({
  idPrefix,
  attendees,
  value,
  onChange,
  disabled,
}) => {
  const voters = motionMakers(attendees);
  const entries = rollCallEntries(value, voters);
  const totals = rollTotals(entries);

  const counts: { key: 'votesFor' | 'votesAgainst' | 'votesAbstain' | 'votesRecused'; label: string }[] = [
    { key: 'votesFor', label: 'For' },
    { key: 'votesAgainst', label: 'Against' },
    { key: 'votesAbstain', label: 'Abstentions' },
    { key: 'votesRecused', label: 'Recused' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-threshold`} className="form-label">
            Needed to carry
          </label>
          <select
            id={`${idPrefix}-threshold`}
            value={value.threshold}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, threshold: e.target.value as MotionThreshold })}
            className="form-input"
          >
            {THRESHOLDS.map((t) => (
              <option key={t} value={t}>
                {THRESHOLD_LABELS[t]}
                {t === DEFAULT_THRESHOLD ? ' (usual)' : ''}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="form-label">Vote recorded as</legend>
          <div className="flex flex-wrap gap-4 py-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                checked={value.mode === 'counts'}
                disabled={disabled}
                onChange={() => onChange({ ...value, mode: 'counts' })}
              />
              Totals
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                checked={value.mode === 'roll'}
                disabled={disabled}
                onChange={() => onChange({ ...value, mode: 'roll' })}
              />
              Roll call
            </label>
          </div>
        </fieldset>
      </div>

      {value.mode === 'counts' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {counts.map(({ key, label }) => (
            <div key={key}>
              <label htmlFor={`${idPrefix}-${key}`} className="form-label">
                {label}
              </label>
              <input
                id={`${idPrefix}-${key}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={value[key]}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                className="form-input"
              />
            </div>
          ))}
        </div>
      ) : voters.length === 0 ? (
        <p className="text-theme-text-muted text-sm">
          No one is recorded as present yet. Take the roll to record how each member voted, or enter totals instead.
        </p>
      ) : (
        <div>
          <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-md border">
            {voters.map((name) => (
              <li key={name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-theme-text-primary text-sm">{name}</span>
                <div role="radiogroup" aria-label={`${name}'s vote`} className="flex flex-wrap gap-3 text-sm">
                  {VOTES.map((vote) => (
                    <label key={vote} className="touch:min-h-11 inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`${idPrefix}-roll-${name}`}
                        checked={value.roll[name] === vote}
                        disabled={disabled}
                        onChange={() => onChange({ ...value, roll: { ...value.roll, [name]: vote } })}
                      />
                      {VOTE_LABELS[vote]}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-theme-text-muted mt-2 text-xs" aria-live="polite">
            Yes {totals.yes} · No {totals.no} · Abstain {totals.abstain} · Recused {totals.recuse} — {entries.length} of{' '}
            {voters.length} present have voted
          </p>
        </div>
      )}
    </div>
  );
};

export default MotionVoteFields;
