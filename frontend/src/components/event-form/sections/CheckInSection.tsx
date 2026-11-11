import React from 'react';
import { QrCode, Lock } from 'lucide-react';
import { CheckInWindowType } from '../../../constants/enums';
import { checkboxClass, inputClass, labelClass, selectClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface CheckInSectionProps {
  model: Pick<
    EventFormModel,
    | 'formData'
    | 'update'
    | 'attendanceLocked'
    | 'checkInLockHintId'
    | 'handleCheckInMinutesBeforeChange'
    | 'updateGuestSwitches'
  >;
  /**
   * `steps`: the training form's wording ("Check-In", with the rules under a
   * subheading and short window options explained once); the single-page
   * form keeps its own.
   */
  variant?: 'single-page' | 'steps' | undefined;
  /** Drawn under the heading, before the rules. */
  intro?: React.ReactNode;
}

const WINDOW_HINT_ID = 'checkin-window-hint';
const CHECKOUT_HINT_ID = 'require-checkout-hint';

/** The check-in window, manual check-out and guest sign-in. */
export const CheckInSection: React.FC<CheckInSectionProps> = ({ model, variant = 'single-page', intro }) => {
  const steps = variant === 'steps';
  const {
    formData,
    update,
    attendanceLocked,
    checkInLockHintId,
    handleCheckInMinutesBeforeChange,
    updateGuestSwitches,
  } = model;
  const showBefore =
    formData.check_in_window_type === CheckInWindowType.FLEXIBLE ||
    formData.check_in_window_type === CheckInWindowType.WINDOW;
  const showAfter = formData.check_in_window_type === CheckInWindowType.WINDOW;
  const windowSelect = (
    <div>
      <label htmlFor="checkin-window" className={labelClass}>
        Check-In Window
      </label>
      <select
        id="checkin-window"
        value={formData.check_in_window_type || 'flexible'}
        onChange={(e) => update({ check_in_window_type: e.target.value as 'flexible' | 'strict' | 'window' })}
        aria-describedby={steps && !attendanceLocked ? WINDOW_HINT_ID : undefined}
        className={selectClass}
      >
        {steps ? (
          <>
            <option value="flexible">Flexible</option>
            <option value="strict">Strict</option>
            <option value="window">Custom window</option>
          </>
        ) : (
          <>
            <option value="flexible">Flexible - Opens before the start, closes when the event ends</option>
            <option value="strict">Strict - Only while the event is running</option>
            <option value="window">Window - Opens before the start, closes after the end</option>
          </>
        )}
      </select>
    </div>
  );
  const minutesBefore = (
    <div>
      <label htmlFor="checkin-before" className={labelClass}>
        Minutes before start
      </label>
      <input
        type="number"
        id="checkin-before"
        min="0"
        max="120"
        value={formData.check_in_minutes_before ?? 60}
        onChange={(e) => handleCheckInMinutesBeforeChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
  const minutesAfter = (
    <div>
      <label htmlFor="checkin-after" className={labelClass}>
        Minutes after end
      </label>
      <input
        type="number"
        id="checkin-after"
        min="0"
        max="120"
        value={formData.check_in_minutes_after || 15}
        onChange={(e) => update({ check_in_minutes_after: parseInt(e.target.value) || 15 })}
        className={inputClass}
      />
    </div>
  );
  return (
    <section className="space-y-4">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-lg font-bold">
        <QrCode className="h-5 w-5 text-red-700" aria-hidden="true" />
        <span>{steps ? 'Check-In' : 'Check-In Settings'}</span>
      </h2>
      {intro}
      {steps && <h3 className="text-theme-text-primary font-semibold">Check-in rules</h3>}
      {attendanceLocked && (
        <p id={checkInLockHintId} className="text-theme-text-muted flex items-center gap-1.5 text-sm">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          The check-in rules are locked while attendance is finalized. Guest sign-in can still be changed.
        </p>
      )}

      <fieldset
        disabled={attendanceLocked}
        aria-describedby={attendanceLocked ? checkInLockHintId : undefined}
        className="min-w-0 space-y-4 disabled:opacity-60"
      >
        {attendanceLocked && <legend className="sr-only">Check-in rules, locked while attendance is finalized</legend>}
        {steps ? (
          // The training form sets the window and its minutes on one row, as
          // the approved Settings step draws them, with the options explained
          // once under it.
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {windowSelect}
              {showBefore && minutesBefore}
              {showAfter && minutesAfter}
            </div>
            <p id={WINDOW_HINT_ID} className="text-theme-text-muted mt-1 text-sm">
              Flexible opens before the start and closes when the event ends. Strict is open only while the event runs.
              Custom window opens before the start and closes after the end.
            </p>
          </div>
        ) : (
          <>
            {windowSelect}
            {showBefore && (
              <div
                className={`grid gap-3 border-l-2 border-red-500/30 pl-4 ${showAfter ? 'grid-cols-2' : 'grid-cols-1'}`}
              >
                {minutesBefore}
                {showAfter && minutesAfter}
              </div>
            )}
          </>
        )}

        <label className="mobile-touch-target flex items-center justify-start space-x-3">
          <input
            type="checkbox"
            id="require-checkout"
            checked={formData.require_checkout}
            onChange={(e) => update({ require_checkout: e.target.checked })}
            aria-describedby={steps && !attendanceLocked ? CHECKOUT_HINT_ID : undefined}
            className={checkboxClass}
          />
          <span className="text-theme-text-secondary text-sm">Require manual check-out</span>
        </label>
        {steps && (
          <p id={CHECKOUT_HINT_ID} className="text-theme-text-muted -mt-3 pl-7 text-sm">
            When off, members are checked out when the event ends.
          </p>
        )}
      </fieldset>

      <label className="mobile-touch-target flex items-center justify-start space-x-3">
        <input
          type="checkbox"
          id="allow-guest-check-in"
          checked={formData.allow_guest_check_in ?? false}
          onChange={(e) =>
            updateGuestSwitches({
              allow_guest_check_in: e.target.checked,
              // Turning guest sign-in off must also clear the pipeline
              // follow-up, or the event keeps a setting that can no longer
              // fire and reads as enabled next time someone opens the form.
              ...(e.target.checked ? {} : { guest_check_in_creates_prospect: false }),
            })
          }
          className={checkboxClass}
        />
        <span className="text-theme-text-secondary text-sm">Allow guest (non-member) sign-in</span>
      </label>

      {formData.allow_guest_check_in && (
        <div className="space-y-3 border-l-2 border-red-500/30 pl-4">
          <p className="text-theme-text-muted text-xs">
            A second QR code appears on room displays for this event. Anyone who scans it can record their attendance
            without an account — use this for interest nights and open houses, not internal meetings.
          </p>
          <label className="mobile-touch-target flex items-center justify-start space-x-3">
            <input
              type="checkbox"
              id="guest-creates-prospect"
              checked={formData.guest_check_in_creates_prospect ?? false}
              onChange={(e) => updateGuestSwitches({ guest_check_in_creates_prospect: e.target.checked })}
              className={checkboxClass}
            />
            <span className="text-theme-text-secondary text-sm">Add guests to the prospective members pipeline</span>
          </label>
          {formData.guest_check_in_creates_prospect && (
            <p className="text-theme-text-muted text-xs">
              Guests sign in with the email they applied with and confirm their name. Anyone the kiosk does not
              recognise as an applicant is asked to see a member of staff.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
