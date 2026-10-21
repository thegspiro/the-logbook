/**
 * Equipment checklist settings — Inventory Admin.
 *
 * These four values decide when crews are prompted to run a checklist and how
 * long the check-in link stays usable. They were edited from the shift module's
 * settings panel, which stopped making sense once checklists became Inventory's:
 * the officer who writes a checklist had to go to Scheduling to say when it runs.
 *
 * What is stored has NOT moved — the values still live in org.settings under
 * ``shift_reports.checklist_timing``, which is where the backend reads them.
 * Only the editing surface moved.
 *
 * Each control saves on its own, immediately, so there is no Save footer to
 * forget: the two switches save on change, and the two number fields commit on
 * blur (see ``commitCheckinBound``).
 *
 * The save sends **only** ``checklist_timing``. The organization settings
 * endpoint deep-merges (``_deep_merge_settings``, added for ORU-9), so the
 * sibling ``post_shift_validation`` block — still edited in Scheduling — is
 * untouched. Sending the whole ``shift_reports`` object from two screens in two
 * modules is what would let whichever saved last revert the other.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { CHECKIN_BOUNDS, DEFAULT_CHECKLIST_TIMING, type ChecklistTimingSettings } from '../types/checklistSettings';
import { useSchedulingStore } from '../../scheduling/store/schedulingStore';
import { Breadcrumbs } from '../../../components/ux';

export const ChecklistSettingsPage: React.FC = () => {
  const [timing, setTiming] = useState<ChecklistTimingSettings>(DEFAULT_CHECKLIST_TIMING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // The two bounds as typed text, so a box can be empty mid-edit without that
  // being saved as 0. Re-synced whenever the saved values change, which is also
  // what restores a field after an unusable entry.
  const [opensDraft, setOpensDraft] = useState(String(DEFAULT_CHECKLIST_TIMING.checkin_opens_hours_before));
  const [closesDraft, setClosesDraft] = useState(String(DEFAULT_CHECKLIST_TIMING.checkin_closes_hours_after));
  useEffect(() => {
    setOpensDraft(String(timing.checkin_opens_hours_before));
    setClosesDraft(String(timing.checkin_closes_hours_after));
  }, [timing.checkin_opens_hours_before, timing.checkin_closes_hours_after]);

  useEffect(() => {
    const load = async () => {
      try {
        const orgSettings = (await organizationService.getSettings()) as Record<string, unknown>;
        const reports = orgSettings.shift_reports as
          { checklist_timing?: Partial<ChecklistTimingSettings> } | undefined;
        if (reports?.checklist_timing) {
          setTiming({ ...DEFAULT_CHECKLIST_TIMING, ...reports.checklist_timing });
        }
      } catch {
        // Defaults stand. They are today's behaviour, so a failed read shows
        // the screen as it would be rather than an error the officer cannot act on.
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const save = useCallback(async (updated: ChecklistTimingSettings) => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ shift_reports: { checklist_timing: updated } });
      setTiming(updated);
      // The scheduling store mirrors this setting: an open-ended shift counts
      // as running for `checkin_closes_hours_after` past its start, which is
      // what its roster lock reads. That store is a once-per-session cache, so
      // without this an administrator who widened check-in here would go back
      // to scheduling in the same tab and still find the roster locking on the
      // old number — hiding controls the server now accepts.
      //
      // Invalidated rather than recomputed here. The server resolves the
      // cushion (a floor, and a ceiling) and reports it on
      // `/scheduling/settings`; clamping a second copy of that rule in this
      // file is how the two would come to disagree. The next scheduling mount
      // refetches, and reads the permissive default until it lands.
      //
      // Through the store's own action rather than `setState`: a GET issued
      // before this save may still be in flight, and clearing the flag alone
      // would let that older response land afterwards and write the pre-save
      // cushion back as loaded.
      useSchedulingStore.getState().invalidateSettings();
      toast.success('Checklist settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save checklist settings'));
    } finally {
      setSaving(false);
    }
  }, []);

  const updateTiming = useCallback(
    (field: keyof ChecklistTimingSettings, value: boolean | number) => {
      void save({ ...timing, [field]: value });
    },
    [timing, save]
  );

  /**
   * Commit one of the numeric window fields, if what was typed is usable.
   *
   * Saving straight from `onChange` was wrong three ways: `Number('')` is 0, so
   * clearing the box to retype silently persisted "opens at the start time";
   * every keystroke saved, so typing "12" wrote 1 and then 12; and `min`/`max`
   * on the input do not stop `onChange`, so a typed 999 went to the server, was
   * rejected, and stayed in state to be resubmitted with the next edit.
   */
  const commitCheckinBound = useCallback(
    (field: keyof typeof CHECKIN_BOUNDS, raw: string, restore: (value: string) => void) => {
      const saved = timing[field];
      const trimmed = raw.trim();
      const parsed = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(parsed)) {
        restore(String(saved));
        return;
      }
      const { min, max } = CHECKIN_BOUNDS[field];
      const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
      if (clamped === saved) {
        // Nothing to save, but the box may hold "02" or an out-of-range number
        // the clamp folded back onto the saved value.
        restore(String(saved));
        return;
      }
      void save({ ...timing, [field]: clamped });
    },
    [timing, save]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading checklist settings" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* compactOnPhone collapses the four-deep trail to one "← Equipment
          Checklists" link below 640px, which is also why there is no separate
          Back link: on a phone it repeated the trail above it word for word. */}
      <Breadcrumbs compactOnPhone />

      <header className="mb-4 sm:mb-6">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <ClipboardCheck className="h-5 w-5 shrink-0" aria-hidden="true" /> Checklist Settings
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm sm:hidden">
          When crews are prompted, and how long they have to check in.
        </p>
        <p className="text-theme-text-secondary mt-1 text-sm max-sm:hidden">
          When crews are prompted to run their checklists, and how long they have to check in. Which checklists a crew
          gets is decided by the apparatus or the shift template, not here.
        </p>
      </header>

      <section className="card mb-4 p-4 sm:mb-6 sm:p-5" aria-labelledby="prompted-heading">
        <h2 id="prompted-heading" className="text-theme-text-primary text-sm font-semibold">
          When crews are prompted
        </h2>
        <p className="text-theme-text-muted mt-1 text-xs">
          Turning one off stops the prompt and its reminders. It does not delete anything — checklists already completed
          stay, and the checklists themselves remain available.
        </p>

        <div className="divide-theme-surface-border mt-2 divide-y">
          <SwitchRow
            id="start-of-shift"
            label="Start-of-shift checklists"
            description="Members are prompted to complete equipment checks when their shift begins."
            checked={timing.start_of_shift_enabled}
            disabled={saving}
            onChange={(checked) => updateTiming('start_of_shift_enabled', checked)}
          />
          <SwitchRow
            id="end-of-shift"
            label="End-of-shift checklists"
            description="Members are reminded to complete equipment checks before their shift ends."
            checked={timing.end_of_shift_enabled}
            disabled={saving}
            onChange={(checked) => updateTiming('end_of_shift_enabled', checked)}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="checkin-heading">
        <h2 id="checkin-heading" className="text-theme-text-primary text-sm font-semibold">
          When members can check in
        </h2>
        <p className="text-theme-text-muted mt-1 text-xs">
          Outside this window the Check In button is switched off and says why. Widen it if your crews are held over on
          long call-backs; a shift that has been closed out is always shut regardless.
        </p>
        {/* Held as text while being edited so the box can be cleared and
            retyped, and committed on blur or Enter rather than per keystroke. */}
        <div className="divide-theme-surface-border mt-2 divide-y">
          <HoursRow
            id="checkin-opens"
            label="Opens before the start"
            unit="hours early"
            value={opensDraft}
            disabled={saving}
            onChange={setOpensDraft}
            onCommit={() => commitCheckinBound('checkin_opens_hours_before', opensDraft, setOpensDraft)}
          />
          <HoursRow
            id="checkin-closes"
            label="Closes after the end"
            unit="hours late"
            value={closesDraft}
            disabled={saving}
            onChange={setClosesDraft}
            onCommit={() => commitCheckinBound('checkin_closes_hours_after', closesDraft, setClosesDraft)}
          />
        </div>
      </section>
    </div>
  );
};

interface SwitchRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * One on/off setting, laid out the way a phone's own settings screen is: the
 * words on the left, the switch on the right. The whole row is the button, so
 * the tap target is the text as well as the 44px track beside it.
 */
const SwitchRow: React.FC<SwitchRowProps> = ({ id, label, description, checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={`${id}-label`}
    aria-describedby={`${id}-description`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex min-h-[44px] w-full items-center justify-between gap-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
  >
    <span className="min-w-0">
      <span id={`${id}-label`} className="text-theme-text-primary block text-sm font-medium">
        {label}
      </span>
      <span id={`${id}-description`} className="text-theme-text-muted block text-xs">
        {description}
      </span>
    </span>
    <span aria-hidden="true" className={`toggle-track-sm ${checked ? 'bg-blue-600' : 'bg-theme-surface-border'}`}>
      <span className={`toggle-knob-sm ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </span>
  </button>
);

interface HoursRowProps {
  id: string;
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}

/**
 * A whole-hours field on one row: the label on the left, "[ 2 ] hours early" on
 * the right.
 *
 * `type="text"` with `inputMode="numeric"`, not `type="number"`: iOS answers a
 * number input with the full keyboard on its symbols page, and only a numeric
 * inputmode gets the digit pad. Nothing is lost by dropping min/max — they never
 * stopped `onChange`; the bounds are enforced by the clamp in
 * `commitCheckinBound`, which also turns anything that is not a number back into
 * the saved value.
 */
const HoursRow: React.FC<HoursRowProps> = ({ id, label, unit, value, disabled, onChange, onCommit }) => (
  <div className="flex min-h-[44px] items-center justify-between gap-4 py-3">
    <label htmlFor={id} className="text-theme-text-primary text-sm font-medium">
      {label}
    </label>
    <span className="flex shrink-0 items-center gap-2">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        autoComplete="off"
        aria-describedby={`${id}-unit`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        disabled={disabled}
        className="form-input w-20 text-center"
      />
      <span id={`${id}-unit`} className="text-theme-text-muted w-[4.5rem] text-xs">
        {unit}
      </span>
    </span>
  </div>
);

export default ChecklistSettingsPage;
