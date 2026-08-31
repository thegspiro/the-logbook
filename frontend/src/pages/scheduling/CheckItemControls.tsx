/**
 * What a check item is, and the one shared piece of the answering surface.
 *
 * The types are the contract every screen in the check works against: a check
 * stores exactly one of four things — a number, a pass/fail, a quantity, or a
 * date — and the type decides the control, the pass rule, and what the record
 * keeps. An admin picks what is being asked and the answer's shape follows,
 * rather than picking a layout and hoping the pass rule matches.
 *
 * The four controls that used to live here were deleted with `CheckLap`, the
 * only screen that rendered them. The rules they enforced did not go with
 * them: `checkAnswers.ts` owns those and has its own tests, and the sweep's
 * layouts call into it. `FaultDetail` stayed because it is genuinely shared —
 * a note written on one screen and a note written on another are the same
 * field on the same record.
 */
import { Camera } from 'lucide-react';
import React from 'react';

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
  expectedQuantity?: number | null | undefined;
  /**
   * What the last check recorded, or the truck's running count if that is
   * newer. The number the crew opens on — 12 found against a par of 10 stays
   * 12 for the next crew rather than resetting to par.
   */
  carriedQuantity?: number | null | undefined;

  // Expiry
  expirationDate?: string | null | undefined;
  expirationWarningDays?: number | null | undefined;
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
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled}
        data-testid={`function-photo-${item.id}`}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onChange({ photoFiles: [...(answer?.photoFiles ?? []), ...files] });
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
