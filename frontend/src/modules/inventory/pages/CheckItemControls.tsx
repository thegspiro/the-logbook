/**
 * What a check item is, and the one shared piece of the answering surface.
 *
 * The types are the contract every screen in the check works against: a check
 * stores exactly one of five things — a number, a pass/fail, a quantity, a
 * date, or present/absent — and the type decides the control, the pass rule, and what the record
 * keeps. An admin picks what is being asked and the answer's shape follows,
 * rather than picking a layout and hoping the pass rule matches.
 *
 * The four controls that used to live here were deleted with `CheckLap`, the
 * only screen that rendered them. The rules they enforced did not go with
 * them: `checkAnswers.ts` owns those and has its own tests, and the sweep's
 * layouts call into it. `FaultDetail` stayed because it is genuinely shared —
 * a note written on one screen and a note written on another are the same
 * field on the same record. `ReplacementDateFields` is shared for the same
 * reason.
 */
import { Camera } from 'lucide-react';
import React, { useState } from 'react';

import { daysUntil } from '@/modules/inventory/types/equipmentCheck';
import { toLocalISODate } from '@/utils/dateFormatting';

import { CLEARED_REPLACEMENT, replacementAnswer } from './checkAnswers';

// ============================================================================
// Shared shape
// ============================================================================

export interface CheckItemAnswer {
  /** Pass/fail verdict, for the types that have one. */
  status?: 'pass' | 'fail' | 'not_checked' | 'not_applicable' | 'out_of_service';
  /** Count type: how many are actually on the truck. */
  quantityFound?: number | undefined;
  /** Level type: the reading taken. */
  levelReading?: number | undefined;
  /** Expiry type: the date on record was looked at and confirmed. */
  expiryConfirmed?: boolean | undefined;
  /**
   * Expiry type, on a line inventory does not track: the date printed on the
   * replacement unit the crew put in. The server writes it onto the line.
   */
  expirationFound?: string | undefined;
  /** The lot printed on that replacement unit, when the crew entered one. */
  lotFound?: string | undefined;
  /** Function type: what went wrong, when it did. */
  notes?: string | undefined;
  photoFiles?: File[] | undefined;
  photoUrls?: string[] | undefined;
  /**
   * Count type: short of par, and the shortfall has been reported for
   * restocking. Deliberately separate from `status` — see `CountControl`.
   */
  restockNeeded?: boolean | undefined;
}

export interface CheckItemSpec {
  id: string;
  name: string;
  /** The test, written on the item so two people run it the same way. */
  description?: string | null | undefined;
  checkType?: string | null | undefined;

  // Level
  minLevel?: number | null | undefined;
  levelUnit?: string | null | undefined;
  /** What this gauge read at the last check, so a drift is visible. */
  lastLevelReading?: number | null | undefined;

  // Count
  /** Par: what the position should hold. A shortfall is a restock line. */
  expectedQuantity?: number | null | undefined;
  /**
   * The count below which the line fails — Min to Pass, else Critical Min
   * (`passFloor`). Absent means a count never fails on its number.
   */
  passFloor?: number | null | undefined;
  /** What is counted: "each", "rolls", the catalog's unit. */
  countUnit?: string | null | undefined;
  /**
   * What the last check recorded, or the truck's running count if that is
   * newer. The number the crew opens on — 12 found against a par of 10 stays
   * 12 for the next crew rather than resetting to par.
   */
  carriedQuantity?: number | null | undefined;

  // Expiry
  expirationDate?: string | null | undefined;
  /**
   * The catalog item this position draws from, where it has one.
   *
   * Carried so a screen can offer the replacement the expiry rule asks for.
   * Absent on a position that is not linked to inventory — there is no ready
   * stock to swap in, and the crew restocks it another way.
   */
  inventoryItemId?: string | null | undefined;
  expirationWarningDays?: number | null | undefined;
  /**
   * The crew may date the replacement they put in, because nothing else
   * tracks this line's units. See `canRecordReplacementDate`.
   */
  takesReplacementDate?: boolean | undefined;
}

interface ControlProps {
  item: CheckItemSpec;
  answer: CheckItemAnswer | undefined;
  onChange: (patch: Partial<CheckItemAnswer>) => void;
  // Widened rather than cast at the call sites: under exactOptionalPropertyTypes
  // a caller holding `boolean | undefined` cannot pass it to `disabled?: boolean`,
  // and every sweep row forwards exactly that.
  disabled?: boolean | undefined;
}

const TOUCH = 'min-h-[48px]';

/** What the upload endpoint accepts. Mirrors the accordion's own cap. */
const MAX_FAULT_PHOTOS = 3;

/**
 * What a fault needs said about it, wherever the fault was recorded.
 *
 * Shared by the accordion's FunctionControl and the sweep's FunctionRow so the
 * two cannot drift: a note written in one place and a note written in the
 * other are the same field on the same record, and a crew that learns "photo
 * goes here" on one screen should not have to relearn it on the next.
 *
 * Neither field blocks. A crew standing at a truck with a broken latch needs
 * to keep moving, and a check that demands a paragraph is a check that gets
 * abandoned — the unwritten note is flagged on the finished check instead.
 */
export const FaultDetail: React.FC<ControlProps> = ({ item, answer, onChange, disabled }) => (
  <div className="alert-danger flex flex-col gap-2 p-3">
    <label className="form-label" htmlFor={`what-happened-${item.id}`}>
      What happened
    </label>
    <textarea
      id={`what-happened-${item.id}`}
      data-testid={`function-note-${item.id}`}
      rows={3}
      disabled={disabled}
      value={answer?.notes ?? ''}
      onChange={(e) => onChange({ notes: e.target.value })}
      className="form-input"
      placeholder="What you saw, and what you already tried."
    />
    <label
      className={`${TOUCH} border-theme-surface-border text-theme-text-secondary flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium`}
    >
      <Camera className="h-4 w-4" aria-hidden="true" />
      Photo
      <input
        type="file"
        // The upload endpoint takes JPEG, PNG or WebP, at most three. Accepting
        // more here does not widen it — the check is filed and its evidence is
        // rejected out of the retry queue afterwards, which is the one failure
        // the crew never sees.
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        disabled={disabled}
        data-testid={`function-photo-${item.id}`}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) {
            onChange({ photoFiles: [...(answer?.photoFiles ?? []), ...files].slice(0, MAX_FAULT_PHOTOS) });
          }
        }}
      />
    </label>
    {answer?.photoFiles?.length ? (
      <p className="text-theme-text-muted text-xs">
        {answer.photoFiles.length} photo{answer.photoFiles.length === 1 ? '' : 's'} attached
      </p>
    ) : null}
    <p className="text-theme-text-muted text-xs">
      Neither is required to move on — an unwritten note is flagged on the finished check.
    </p>
  </div>
);

/**
 * The date and lot off a replacement unit, on a Date line nothing else tracks.
 *
 * A linked line has the swap, which moves the stock and the dates together. An
 * untracked one had nothing: the crew put a new box in, the line stayed
 * expired, and the next shift failed it again. The date entered here replaces
 * the line's date on the record, logged against the member and the check.
 *
 * A past date is refused here as the server refuses it, rather than stored and
 * bounced at submit, so the crew finds out while the box is still in hand.
 */
export const ReplacementDateFields: React.FC<ControlProps & { today: Date }> = ({
  item,
  answer,
  onChange,
  disabled,
  today,
}) => {
  const [open, setOpen] = useState(Boolean(answer?.expirationFound));
  const [date, setDate] = useState(answer?.expirationFound ?? '');
  const [lot, setLot] = useState(answer?.lotFound ?? '');
  const days = date ? daysUntil(date, today) : null;
  const past = days !== null && days < 0;

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid={`replacement-open-${item.id}`}
        className="text-theme-accent-blue min-h-11 text-left text-sm font-medium hover:opacity-80 disabled:opacity-50"
      >
        Put in a replacement? Record its date
      </button>
    );
  }

  return (
    <div className="border-theme-surface-border flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="form-label">Replacement expires</span>
          <input
            type="date"
            className={`form-input ${past ? 'border-theme-alert-danger-icon' : ''}`}
            data-testid={`replacement-date-${item.id}`}
            aria-invalid={past}
            min={toLocalISODate(today)}
            disabled={disabled}
            value={date}
            onChange={(e) => {
              const next = e.target.value;
              setDate(next);
              // A refused date clears an earlier accepted one rather than
              // leaving it standing behind the box the crew just corrected.
              onChange(replacementAnswer(next, lot, today) ?? CLEARED_REPLACEMENT);
            }}
          />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
          <span className="form-label">Lot (optional)</span>
          <input
            type="text"
            className="form-input"
            data-testid={`replacement-lot-${item.id}`}
            maxLength={100}
            disabled={disabled}
            value={lot}
            onChange={(e) => {
              setLot(e.target.value);
              if (answer?.expirationFound) onChange({ lotFound: e.target.value.trim() || undefined });
            }}
          />
        </label>
      </div>
      {past && (
        <p className="text-theme-alert-danger-title text-xs font-medium" role="alert">
          That date has already passed. Enter the date printed on the unit you put in.
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          setDate('');
          setLot('');
          if (answer?.expirationFound) onChange(CLEARED_REPLACEMENT);
        }}
        className="text-theme-text-muted hover:text-theme-text-secondary min-h-11 w-fit text-sm"
      >
        No replacement
      </button>
    </div>
  );
};
