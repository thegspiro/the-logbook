/**
 * The call-type chip row in the draft report editor.
 *
 * Exists because the field has two vocabularies and the editor was offering
 * the wrong one. A report filed against a count-only shift stores this
 * department's own type **slugs**; the shift-report settings carry a separate
 * free-text list (`shift_review_call_types` — "Structure Fire"), which is
 * right for detailed tracking and wrong here. Offered the free-text list, an
 * officer saw a stored slug as unselected and any chip they tapped landed
 * beside it, so the saved value mixed the two and the slug stopped resolving
 * to a label.
 *
 * So the caller decides the vocabulary and this renders it. The chips carry a
 * value distinct from their text precisely so a slug can be stored while the
 * department's own name for it is what an officer reads.
 */

import React from 'react';
import type { CallTypeChoice } from './callTypeChoices';

interface CallTypeChipsProps {
  choices: CallTypeChoice[];
  selected: string[];
  onToggle: (value: string) => void;
}

export const CallTypeChips: React.FC<CallTypeChipsProps> = ({ choices, selected, onToggle }) => (
  <div className="flex flex-wrap gap-1.5">
    {choices.map((choice) => {
      const isSelected = selected.includes(choice.value);
      return (
        <button
          key={choice.value}
          type="button"
          aria-pressed={isSelected}
          onClick={() => onToggle(choice.value)}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            isSelected
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400'
              : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-violet-500/30'
          }`}
        >
          {choice.label}
        </button>
      );
    })}
  </div>
);

export default CallTypeChips;
