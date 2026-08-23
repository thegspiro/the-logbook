import React, { useEffect, useRef, useState } from 'react';
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
  /** The seal has been answered — intact, or reported broken. */
  confirmed: boolean;
  /**
   * The seal stood in for the contents count.
   *
   * False for a broken seal, for a tag that does not match the last count, and
   * for a crew that chose to count anyway. Kept separate from `intact` because
   * a seal can be perfectly intact and still clear nothing: an unrecognised
   * number is evidence the bag was opened, not evidence it was not.
   */
  cleared: boolean;
}

interface SealPanelProps {
  compartmentName: string;
  /** Positions the seal would clear — presence and quantity checks inside. */
  clearableCount: number;
  /** A few of their names, for the line that says what was cleared. */
  clearableNames: string[];
  lastSeal?: LastSealRecord | undefined;
  state?: SealState | undefined;
  /** `clearContents` is false when the tag cannot vouch for the contents. */
  onConfirmIntact: (sealNumber: string, clearContents: boolean) => void;
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

  // The previous seals are fetched, so on a first render there is usually
  // nothing to prefill with yet. Without this the field stays empty and the
  // shortcut never appears, however well the tag matches. Once the crew has
  // typed, their number stands — a late response must not overwrite it.
  const edited = useRef(false);
  useEffect(() => {
    if (edited.current || state?.confirmed) return;
    if (lastNumber !== '') setDraft(lastNumber);
  }, [lastNumber, state?.confirmed]);

  // Only a tag that matches an intact prior seal is evidence the bag stayed
  // shut. A different number, or no prior seal at all, leaves the contents
  // unvouched-for however genuine the seal in the crew's hand is.
  const matchesLast = lastNumber !== '' && normalizeTag(draft) === normalizeTag(lastNumber);
  const canClear = matchesLast && lastSeal?.intact === true;
  const answered = state?.confirmed ?? false;
  const cleared = answered && state?.intact === true && state.cleared;

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

  if (answered && state?.intact === true) {
    // Intact, but vouching for nothing: either the tag did not match the last
    // count, or the crew chose to count regardless. Both end in the same place
    // — the contents below are counted by hand — so they read the same here.
    return (
      <div className="border-theme-surface-border bg-theme-surface-secondary rounded-xl border-2 p-3">
        <div className="flex items-start gap-3">
          <BadgeCheck className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-primary text-sm font-bold">Seal recorded</p>
            <p className="text-theme-text-muted mt-0.5 text-xs">
              {state.sealNumber ? `Tag ${state.sealNumber}. ` : ''}
              Count the contents below — this seal does not stand in for them.
            </p>
          </div>
          <button
            type="button"
            onClick={onReopen}
            disabled={disabled}
            className="text-theme-text-secondary min-h-[44px] shrink-0 text-xs font-semibold underline"
          >
            Undo
          </button>
        </div>
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
        onChange={(event) => {
          edited.current = true;
          setDraft(event.target.value);
        }}
        disabled={disabled}
      />
      {draft.trim() !== '' && (
        <p className={`mt-1.5 text-xs ${canClear ? 'text-green-600 dark:text-green-400' : 'text-amber-600'}`}>
          {canClear
            ? 'Matches the last count — nothing inside has been touched.'
            : lastNumber === ''
              ? 'No seal to compare against, so the contents still need counting.'
              : lastSeal?.intact === false
                ? `The last count found this seal broken, so the contents still need counting.`
                : `Different from the last count (${lastNumber}). The bag has been opened since — count the contents.`}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => onConfirmIntact(draft.trim(), canClear)}
          disabled={disabled || draft.trim() === ''}
          className="btn-primary flex-1 text-sm font-semibold disabled:opacity-50"
        >
          {canClear && clearableCount > 0
            ? `Seal intact — clear ${clearableCount} ${clearableCount === 1 ? 'check' : 'checks'}`
            : 'Record seal'}
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
