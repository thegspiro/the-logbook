/**
 * The four controls a check item can have.
 *
 * A check stores exactly one of four things — a number, a pass/fail, a
 * quantity, or a date — and the type decides the control, the pass rule, and
 * what the record keeps. That is the whole point of naming four types: an
 * admin picks what is being asked, and the answer's shape follows, rather than
 * picking a layout and hoping the pass rule matches.
 *
 * These live apart from `EquipmentCheckForm` on purpose. The form owns the
 * walk — which stop is open, what is saved, what happens offline — and the
 * controls own one question each. Keeping them separate is what makes the four
 * testable without standing up a whole check, and it is what stops a fifth
 * control being added by accident inside a 2,000-line render.
 */

import { countAnswer, expiryAnswer, levelAnswer } from './checkAnswers';
import { AlertTriangle, Camera, Check, Minus, Plus, X } from 'lucide-react';
import React from 'react';

import { CheckType, daysUntil, normalizeCheckType } from '@/modules/scheduling/types/equipmentCheck';

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

// ============================================================================
// Level — stores a number
// ============================================================================

/**
 * A reading against a threshold. Passing is a value, not a tick.
 *
 * The number is kept rather than reduced to pass/fail because the trend is the
 * useful part: a cylinder reading 1850 every shift and one reading 1850 after
 * three weeks at 2100 are different facts, and only the stored number can tell
 * them apart. Under the threshold fails the item outright — the crew does not
 * get to decide that 400psi is acceptable today.
 */
export const LevelControl: React.FC<ControlProps> = ({ item, answer, onChange, disabled }) => {
  const unit = item.levelUnit?.trim() || '';
  const threshold = item.minLevel ?? null;
  const reading = answer?.levelReading;
  const isShort = threshold !== null && reading !== undefined && reading < threshold;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          data-testid={`level-input-${item.id}`}
          aria-label={`${item.name} reading${unit ? ` in ${unit}` : ''}`}
          value={reading ?? ''}
          disabled={disabled}
          onChange={(e) => {
            onChange(levelAnswer(item, e.target.value));
          }}
          className={`form-input w-28 ${TOUCH} ${isShort ? 'border-red-500' : ''}`}
          placeholder="—"
        />
        {unit ? <span className="text-theme-text-secondary text-sm">{unit}</span> : null}
      </div>

      <div className="text-theme-text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {threshold !== null ? (
          <span className={isShort ? 'font-semibold text-red-600' : undefined}>
            Swap below {threshold}
            {unit ? ` ${unit}` : ''}
          </span>
        ) : null}
        {item.lastLevelReading !== null && item.lastLevelReading !== undefined ? (
          <span>
            Last shift {item.lastLevelReading}
            {unit ? ` ${unit}` : ''}
          </span>
        ) : null}
      </div>

      {isShort ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Below the swap threshold — this opens a swap task.
        </p>
      ) : null}
    </div>
  );
};

// ============================================================================
// Function — stores pass / fail
// ============================================================================

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

/**
 * Something is switched on and watched.
 *
 * A fail always opens the same two fields, every time, so leadership reads the
 * fault as the crew saw it rather than as a status code. Neither field is
 * required to move on: a crew mid-walk at 07:00 should not be held at a
 * textarea, and a check that blocks is a check that gets abandoned. An
 * unwritten note is flagged on the finished check instead.
 */
export const FunctionControl: React.FC<ControlProps> = ({ item, answer, onChange, disabled }) => {
  const status = answer?.status;
  const failed = status === 'fail';

  return (
    <div className="flex flex-col gap-3">
      {item.description ? (
        <p className="text-theme-text-secondary text-sm leading-relaxed">{item.description}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-action="pass"
          data-testid={`function-pass-${item.id}`}
          disabled={disabled}
          onClick={() => onChange({ status: 'pass' })}
          className={`${TOUCH} flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
            status === 'pass'
              ? 'bg-green-600 text-white'
              : 'border-theme-surface-border text-theme-text-secondary border hover:border-green-600 hover:text-green-700'
          }`}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Works
        </button>
        <button
          type="button"
          data-action="fail"
          data-testid={`function-fail-${item.id}`}
          disabled={disabled}
          onClick={() => onChange({ status: 'fail' })}
          className={`${TOUCH} flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
            failed
              ? 'bg-red-800 text-white'
              : 'border-theme-surface-border text-theme-text-secondary border hover:border-red-600 hover:text-red-700'
          }`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Fails
        </button>
      </div>

      {failed ? <FaultDetail item={item} answer={answer} onChange={onChange} disabled={disabled} /> : null}
    </div>
  );
};

// ============================================================================
// Count — stores a quantity
// ============================================================================

/**
 * A par level to match. One tap confirms par; the stepper is only for when it
 * doesn't.
 *
 * Short of par is a **restock line, not a failure**. That distinction is the
 * whole reason this is its own type: a truck three bandages light is not a
 * truck that failed its check, and filing it as a failure teaches crews that
 * failures are routine — which is exactly how a real failure gets missed. The
 * verdict stays `pass` and `restockNeeded` carries the shortfall.
 */
export const CountControl: React.FC<ControlProps> = ({ item, answer, onChange, disabled }) => {
  const par = item.expectedQuantity ?? null;
  const found = answer?.quantityFound;
  const atPar = par !== null && found === par;
  const isShort = par !== null && found !== undefined && found < par;

  const set = (value: number) => onChange(countAnswer(item, value));

  return (
    <div className="flex flex-col gap-2">
      {par !== null ? (
        <button
          type="button"
          data-action="at-par"
          data-testid={`count-at-par-${item.id}`}
          disabled={disabled}
          onClick={() => set(par)}
          className={`${TOUCH} flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
            atPar
              ? 'bg-green-600 text-white'
              : 'border-theme-surface-border text-theme-text-secondary border hover:border-green-600 hover:text-green-700'
          }`}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {par} · par
        </button>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`One fewer ${item.name}`}
          data-testid={`count-minus-${item.id}`}
          disabled={disabled}
          onClick={() => set((found ?? par ?? 0) - 1)}
          className={`${TOUCH} border-theme-surface-border text-theme-text-secondary flex w-12 items-center justify-center rounded-lg border`}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          data-testid={`count-input-${item.id}`}
          aria-label={`${item.name} count`}
          value={found ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange({ quantityFound: undefined, status: 'not_checked', restockNeeded: false });
              return;
            }
            set(Number(raw));
          }}
          className={`form-input w-20 text-center ${TOUCH} ${isShort ? 'border-amber-500' : ''}`}
          placeholder="—"
        />
        <button
          type="button"
          aria-label={`One more ${item.name}`}
          data-testid={`count-plus-${item.id}`}
          disabled={disabled}
          onClick={() => set((found ?? par ?? 0) + 1)}
          className={`${TOUCH} border-theme-surface-border text-theme-text-secondary flex w-12 items-center justify-center rounded-lg border`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isShort && par !== null ? (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-500">
          {par - (found ?? 0)} short — this becomes a restock line, not a failure.
        </p>
      ) : null}
    </div>
  );
};

// ============================================================================
// Expiry — stores a date
// ============================================================================

/**
 * The date on record is shown and confirmed rather than retyped.
 *
 * Retyping a date the system already knows is how a check becomes a
 * transcription exercise: the crew copies what is on screen instead of
 * reading the vial, which is the one thing the item exists to make them do.
 * Confirming is a glance; typing is a form.
 *
 * Inside the pull window the line is amber on every shift until it is
 * replaced — not once, not dismissible. A warning that can be cleared without
 * changing anything is a warning that stops being read.
 */
export const ExpiryControl: React.FC<ControlProps> = ({ item, answer, onChange, disabled }) => {
  const today = new Date();
  const days = daysUntil(item.expirationDate, today);
  const pullAt = item.expirationWarningDays ?? 30;
  const expired = days !== null && days < 0;
  const inPullWindow = days !== null && days >= 0 && days <= pullAt;
  const confirmed = answer?.expiryConfirmed === true;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`text-base font-semibold ${
            expired ? 'text-red-600' : inPullWindow ? 'text-amber-700 dark:text-amber-500' : 'text-theme-text-primary'
          }`}
          data-testid={`expiry-date-${item.id}`}
        >
          {item.expirationDate ?? 'No date on record'}
        </span>
        {days !== null ? (
          <span className="text-theme-text-muted text-xs">
            {expired ? `Expired ${Math.abs(days)} days ago` : `${days} days`} · pull at {pullAt}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        data-action="confirm-expiry"
        data-testid={`expiry-confirm-${item.id}`}
        disabled={disabled}
        onClick={() => onChange(expiryAnswer(item, today))}
        className={`${TOUCH} flex w-fit items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
          confirmed
            ? 'bg-green-600 text-white'
            : 'border-theme-surface-border text-theme-text-secondary border hover:border-green-600 hover:text-green-700'
        }`}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        {confirmed ? 'Confirmed' : 'Confirm'}
      </button>

      {expired ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          Out of date — pull it and fit a replacement.
        </p>
      ) : inPullWindow ? (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-500">
          Inside the pull window — replace it before it expires.
        </p>
      ) : null}
    </div>
  );
};

// ============================================================================
// The switch
// ============================================================================

/**
 * Render the control that belongs to this item's type.
 *
 * `normalizeCheckType` is applied at the boundary rather than trusted from the
 * payload: a response may still be served to a client that predates the
 * collapse to four types, and an unrecognised value renders the one control
 * that is answerable for any item rather than nothing at all.
 */
export const CheckItemControl: React.FC<ControlProps> = (props) => {
  const type = normalizeCheckType(props.item.checkType);
  switch (type) {
    case CheckType.LEVEL:
      return <LevelControl {...props} />;
    case CheckType.COUNT:
      return <CountControl {...props} />;
    case CheckType.EXPIRY:
      return <ExpiryControl {...props} />;
    case CheckType.FUNCTION:
      return <FunctionControl {...props} />;
    default:
      // header / text are layout and ask nothing.
      return null;
  }
};

export default CheckItemControl;
