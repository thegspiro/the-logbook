/**
 * The tracked changes in a suggestion: each edit as a card, the words removed
 * struck through and the words added underlined, with a little of the text
 * around it. The secretary accepts or rejects each one; a reader just sees what
 * was decided.
 */

import React from 'react';
import type { ChangeDecision, SuggestionChange } from '../types/minutes';

const KIND_LABEL: Record<SuggestionChange['kind'], string> = {
  replace: 'Changed',
  insert: 'Added',
  delete: 'Removed',
  format: 'Formatting',
};

const DECISION_BADGE: Record<string, string> = {
  accepted: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-theme-surface-secondary text-theme-text-secondary',
};

interface TrackedChangesProps {
  suggestionId: string;
  changes: SuggestionChange[];
  /** The secretary's pending choice for each change; a change with none is accepted. */
  decisions?: Record<string, 'accepted' | 'rejected'>;
  /** When given, each change offers Accept and Reject. */
  onDecide?: (changeId: string, decision: 'accepted' | 'rejected') => void;
  /** Changes the server could not place in the section as it now reads. */
  doesNotFit?: string[];
}

export const TrackedChanges: React.FC<TrackedChangesProps> = ({
  suggestionId,
  changes,
  decisions = {},
  onDecide,
  doesNotFit = [],
}) => (
  <ol className="mt-2 space-y-2" aria-label="Tracked changes">
    {changes.map((change, index) => {
      const chosen = decisions[change.id] ?? 'accepted';
      const name = `change-${suggestionId}-${change.id}`;
      const settled: ChangeDecision = change.decision;
      return (
        <li key={change.id} className="border-theme-surface-border rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-theme-text-muted text-xs font-medium">
              Change {index + 1} · {KIND_LABEL[change.kind]}
            </p>
            {onDecide ? (
              <fieldset className="flex gap-3 text-sm">
                <legend className="sr-only">Decision for change {index + 1}</legend>
                <label className="touch:min-h-11 inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name={name}
                    checked={chosen === 'accepted'}
                    onChange={() => onDecide(change.id, 'accepted')}
                    aria-label={`Accept change ${index + 1}`}
                  />
                  Accept
                </label>
                <label className="touch:min-h-11 inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name={name}
                    checked={chosen === 'rejected'}
                    onChange={() => onDecide(change.id, 'rejected')}
                    aria-label={`Reject change ${index + 1}`}
                  />
                  Reject
                </label>
              </fieldset>
            ) : (
              settled !== 'open' && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_BADGE[settled] ?? ''}`}>
                  {settled === 'accepted' ? 'Accepted' : 'Rejected'}
                </span>
              )
            )}
          </div>
          <p className="text-theme-text-primary mt-2 text-sm">
            {change.before && <span className="text-theme-text-muted">…{change.before} </span>}
            {change.kind === 'format' ? (
              <em>{change.deleted} (formatting only)</em>
            ) : (
              <>
                {change.deleted && (
                  <del className="rounded-sm bg-red-100 px-0.5 text-red-900 line-through dark:bg-red-500/20 dark:text-red-300">
                    {change.deleted}
                  </del>
                )}{' '}
                {change.inserted && (
                  <ins className="rounded-sm bg-green-100 px-0.5 text-green-900 underline dark:bg-green-500/20 dark:text-green-300">
                    {change.inserted}
                  </ins>
                )}
              </>
            )}
            {change.after && <span className="text-theme-text-muted"> {change.after}…</span>}
          </p>
          {doesNotFit.includes(change.id) && (
            <p className="alert-warning mt-2 text-xs" role="status">
              This change no longer fits the section, which has been edited since. Reject it, or make it by hand.
            </p>
          )}
        </li>
      );
    })}
  </ol>
);

export default TrackedChanges;
