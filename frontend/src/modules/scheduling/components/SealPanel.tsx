import React, { useState } from 'react';
import { BadgeCheck, ChevronRight, ShieldAlert } from 'lucide-react';
import type { LastSealRecord } from '../types/equipmentCheck';

/**
 * The tamper seal on a bag or kit carried on an apparatus.
 *
 * A med bag is mostly counting, and counting it is most of a shift check. The
 * seal is the shortcut: if the tag still carries the number from the last
 * count, nobody has opened the bag, so the contents cannot have changed and
 * the crew does not need to open it either. One tap clears every presence and
 * quantity check inside.
 *
 * What a seal cannot vouch for stays in the list: expiry dates and pressure
 * readings move on their own while the bag sits shut.
 *
 * Two escapes, both deliberate. **Broken** is the honest answer when the tag is
 * missing, cut, or reads a different number — it opens the full list and the
 * record says the contents were counted by hand. **Count anyway** is for a crew
 * that wants to count a sealed bag regardless; it un-clears what the seal
 * cleared, so the record never claims a count that nobody performed.
 */

export interface SealState {
  /** The number the crew read off the tag. */
  sealNumber: string;
  intact: boolean;
  /** The seal has been answered — intact and clearing, or reported broken. */
  confirmed: boolean;
  /** The crew chose to count the contents even though the seal held. */
  countAnyway: boolean;
}

interface SealPanelProps {
  compartmentName: string;
  /** Positions the seal would clear — presence and quantity checks inside. */
  clearableCount: number;
  /** A few of their names, for the line that says what was cleared. */
  clearableNames: string[];
  lastSeal?: LastSealRecord | undefined;
  state?: SealState | undefined;
  onConfirmIntact: (sealNumber: string) => void;
  onReportBroken: (sealNumber: string) => void;
  onCountAnyway: () => void;
  /** Returns the panel to its unanswered state. */
  onReopen: () => void;
  disabled?: boolean | undefined;
}

/** Tags are read off a printed label; case and padding are not the number. */
const normalizeTag = (value: string): string => value.trim().toUpperCase();

export const SealPanel: React.FC<SealPanelProps> = ({
  compartmentName,
  clearableCount,
  clearableNames,
  lastSeal,
  state,
  onConfirmIntact,
  onReportBroken,
  onCountAnyway,
  onReopen,
  disabled = false,
}) => {
  const lastNumber = lastSeal?.sealNumber ?? '';
  // Prefilled with the last count's tag: the common case is that it has not
  // changed, and retyping a number that is already on the record is the exact
  // work this panel exists to remove.
  const [draft, setDraft] = useState(state?.sealNumber ?? lastNumber);

  const matchesLast = lastNumber !== '' && normalizeTag(draft) === normalizeTag(lastNumber);
  const answered = state?.confirmed ?? false;
  const cleared = answered && state?.intact === true && state.countAnyway !== true;

  if (answered && state?.intact === false) {
    return (
      <div className="alert-warning flex items-start gap-3">
        <ShieldAlert className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-theme-alert-warning-title text-sm font-bold">Seal broken or missing</p>
          <p className="text-theme-alert-warning-text mt-0.5 text-xs">
            {state.sealNumber
              ? `Recorded tag ${state.sealNumber}. Count the contents below.`
              : 'Count the contents below — the record will say they were counted by hand.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onReopen}
          disabled={disabled}
          className="text-theme-alert-warning-title min-h-[44px] shrink-0 text-xs font-semibold underline"
        >
          Undo
        </button>
      </div>
    );
  }

  if (cleared) {
    const named = clearableNames.slice(0, 4).join(', ');
    return (
      <div className="rounded-xl border-2 border-green-500/40 bg-green-500/10 p-3">
        <div className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-green-700 dark:text-green-300">Seal intact</p>
            <p className="mt-0.5 text-xs text-green-700/80 dark:text-green-400/80">
              {state?.sealNumber ? `Tag ${state.sealNumber} matches the last count.` : 'Matches the last count.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onReopen}
            disabled={disabled}
            className="min-h-[44px] shrink-0 text-xs font-semibold text-green-700 underline dark:text-green-300"
          >
            Broken?
          </button>
        </div>
        {clearableCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-green-500/25 pt-2">
            <span className="text-xs text-green-700/80 dark:text-green-400/80">
              {clearableCount} contents {clearableCount === 1 ? 'check' : 'checks'} cleared by the seal
              {named && ` — ${named}`}
              {clearableNames.length > 4 && `, and ${clearableNames.length - 4} more`}
            </span>
            <button
              type="button"
              onClick={onCountAnyway}
              disabled={disabled}
              className="inline-flex min-h-[44px] items-center gap-0.5 text-xs font-semibold text-green-700 dark:text-green-300"
            >
              Count anyway
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const inputId = `seal-${compartmentName.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="border-theme-surface-border bg-theme-surface-secondary rounded-xl border-2 p-3">
      <div className="flex items-start gap-3">
        <BadgeCheck className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-theme-text-primary text-sm font-bold">Tamper seal</p>
          <p className="text-theme-text-muted mt-0.5 text-xs">
            {lastNumber
              ? `Last count read tag ${lastNumber}.`
              : 'No seal recorded at the last count — read the tag and enter it.'}
          </p>
        </div>
      </div>

      <label htmlFor={inputId} className="form-label-sm mt-3">
        Seal number on the bag
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        className="form-input"
        placeholder="e.g. M2-40817"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
      />
      {draft.trim() !== '' && lastNumber !== '' && (
        <p className={`mt-1.5 text-xs ${matchesLast ? 'text-green-600 dark:text-green-400' : 'text-amber-600'}`}>
          {matchesLast
            ? 'Matches the last count — nothing inside has been touched.'
            : `Different from the last count (${lastNumber}). The bag has been opened since.`}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => onConfirmIntact(draft.trim())}
          disabled={disabled || draft.trim() === ''}
          className="btn-primary flex-1 text-sm font-semibold disabled:opacity-50"
        >
          {clearableCount > 0
            ? `Seal intact — clear ${clearableCount} ${clearableCount === 1 ? 'check' : 'checks'}`
            : 'Seal intact'}
        </button>
        <button
          type="button"
          onClick={() => onReportBroken(draft.trim())}
          disabled={disabled}
          className="btn-secondary flex-1 text-sm font-semibold"
        >
          Broken or missing
        </button>
      </div>
    </div>
  );
};

export default SealPanel;
