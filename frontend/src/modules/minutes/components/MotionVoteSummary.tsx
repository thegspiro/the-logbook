/**
 * A recorded motion's vote: the totals, what it needed to carry, and, when it
 * was taken by roll call, how each member voted.
 *
 * Who voted which way is shown here and kept on the record, and left off the
 * printed and published copies. When the counts do not support the recorded
 * result the screen says so, using the server's reading of the threshold rather
 * than working it out again, and offers to change the result.
 */

import React, { useState } from 'react';
import { THRESHOLD_LABELS, VOTE_LABELS } from '../utils/voteDraft';
import type { Motion } from '../types/minutes';

interface MotionVoteSummaryProps {
  motion: Motion;
  /** Offered when the counts support a different result than the one recorded. */
  onUseSuggested?: ((status: 'passed' | 'failed') => void) | undefined;
}

export const MotionVoteSummary: React.FC<MotionVoteSummaryProps> = ({ motion, onUseSuggested }) => {
  const [showRoll, setShowRoll] = useState(false);
  const hasCounts = motion.votes_for !== null && motion.votes_for !== undefined;
  const roll = motion.roll_call ?? [];
  const suggested = motion.suggested_status;
  const disagrees =
    suggested && (motion.status === 'passed' || motion.status === 'failed') && suggested !== motion.status;

  if (!hasCounts && roll.length === 0) return null;

  return (
    <div className="mt-2 text-xs">
      {hasCounts && (
        <p className="text-theme-text-muted">
          Vote: {motion.votes_for}-{motion.votes_against || 0}
          {motion.votes_abstain ? `, ${motion.votes_abstain} abstained` : ''}
          {motion.votes_recused ? `, ${motion.votes_recused} recused` : ''}
          {motion.threshold ? ` · needed ${THRESHOLD_LABELS[motion.threshold].toLowerCase()}` : ''}
        </p>
      )}

      {disagrees && (
        <p className="mt-1 text-amber-800 dark:text-amber-400" role="status">
          The counts support {suggested}, but the result is recorded as {motion.status}.
          {onUseSuggested && suggested && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => onUseSuggested(suggested)}
                className="touch:min-h-11 underline hover:no-underline"
              >
                Change it to {suggested}
              </button>
            </>
          )}
        </p>
      )}

      {roll.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={showRoll}
            onClick={() => setShowRoll(!showRoll)}
            className="touch:min-h-11 text-blue-700 hover:underline dark:text-blue-400"
          >
            {showRoll ? 'Hide how each member voted' : 'Show how each member voted'}
          </button>
          {showRoll && (
            <ul className="text-theme-text-secondary mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {roll.map((entry) => (
                <li key={entry.name}>
                  {entry.name}: {VOTE_LABELS[entry.vote]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MotionVoteSummary;
