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
import type { CallTypeOption } from '../types';

export interface CallTypeChoice {
  /** What is stored when the chip is selected. */
  value: string;
  /** What the officer reads. */
  label: string;
}

/**
 * Choices for a report whose stored values are this department's slugs.
 *
 * Two things beyond the active list, both about not losing what is already on
 * the report:
 *
 * - A **retired** type still on it is offered, so it renders as selected and
 *   can be removed. Retirement stops a type being newly picked; it does not
 *   erase the reports that name it.
 * - A stored value the department no longer configures at all — a type deleted
 *   before deletion was guarded — is offered as itself. There is no label left
 *   for it, but a chip nobody can see is one an officer cannot remove, and
 *   saving without it would drop the value silently.
 *
 * `stored` is the report's saved list rather than the live form, so a chip
 * does not vanish the moment it is deselected.
 */
export const orgCallTypeChoices = (configured: CallTypeOption[], stored: string[]): CallTypeChoice[] => {
  const known = new Set(configured.map((t) => t.slug));
  const onReport = new Set(stored);
  return [
    ...configured.filter((t) => t.active || onReport.has(t.slug)).map((t) => ({ value: t.slug, label: t.label })),
    ...stored.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ];
};

/** Choices for a report whose stored values are the officer's own wording. */
export const textCallTypeChoices = (options: string[]): CallTypeChoice[] =>
  options.map((t) => ({ value: t, label: t }));

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
