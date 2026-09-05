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
 * forget: the two toggles save on change, and the two number fields commit on
 * blur (see ``commitCheckinBound``).
 *
 * The save sends **only** ``checklist_timing``. The organization settings
 * endpoint deep-merges (``_deep_merge_settings``, added for ORU-9), so the
 * sibling ``post_shift_validation`` block — still edited in Scheduling — is
 * untouched. Sending the whole ``shift_reports`` object from two screens in two
 * modules is what would let whichever saved last revert the other.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ClipboardCheck, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { CHECKIN_BOUNDS, DEFAULT_CHECKLIST_TIMING, type ChecklistTimingSettings } from '../types/checklistSettings';
import { useSchedulingStore } from '../../scheduling/store/schedulingStore';

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
      {/* mobile-touch-target, not a bare inline-flex: at text-sm this link is
          about 20px tall, which is under the 44px minimum the presentation
          ratchet enforces. justify-start keeps it left-aligned — the utility
          centers by default, which would float it away from the page edge. */}
      <Link
        to="/inventory/admin/checklists"
        className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target mb-4 justify-start gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Equipment Checklists
      </Link>

      <header className="mb-6">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <ClipboardCheck className="h-5 w-5" /> Checklist Settings
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          When crews are prompted to run their checklists, and how long they have to check in. Which checklists a crew
          gets is decided by the apparatus or the shift template, not here.
        </p>
      </header>

      <section className="card mb-6 p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">When crews are prompted</h2>
        <p className="text-theme-text-muted mt-1 mb-4 text-xs">
          Turning one off stops the prompt and its reminders. It does not delete anything — checklists already completed
          stay, and the checklists themselves remain available.
        </p>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={timing.start_of_shift_enabled}
              onChange={(e) => updateTiming('start_of_shift_enabled', e.target.checked)}
              disabled={saving}
              className="form-checkbox"
            />
            <div>
              <span className="text-theme-text-primary text-sm font-medium">Start-of-shift checklists</span>
              <p className="text-theme-text-muted text-xs">
                Members are prompted to complete equipment checks when their shift begins.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={timing.end_of_shift_enabled}
              onChange={(e) => updateTiming('end_of_shift_enabled', e.target.checked)}
              disabled={saving}
              className="form-checkbox"
            />
            <div>
              <span className="text-theme-text-primary text-sm font-medium">End-of-shift checklists</span>
              <p className="text-theme-text-muted text-xs">
                Members are reminded to complete equipment checks before their shift ends.
              </p>
            </div>
          </label>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">When members can check in</h2>
        <p className="text-theme-text-muted mt-1 mb-3 text-xs">
          Outside this window the Check In button is switched off and says why. Widen it if your crews are held over on
          long call-backs; a shift that has been closed out is always shut regardless.
        </p>
        {/* Held as text while being edited so the box can be cleared and
            retyped, and committed on blur or Enter rather than per keystroke. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="checkin-opens" className="form-label">
              Opens before the start
            </label>
            <div className="flex items-center gap-2">
              <input
                id="checkin-opens"
                type="number"
                min={CHECKIN_BOUNDS.checkin_opens_hours_before.min}
                max={CHECKIN_BOUNDS.checkin_opens_hours_before.max}
                value={opensDraft}
                onChange={(e) => setOpensDraft(e.target.value)}
                onBlur={() => commitCheckinBound('checkin_opens_hours_before', opensDraft, setOpensDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                disabled={saving}
                className="form-input w-24"
              />
              <span className="text-theme-text-muted text-xs">hours early</span>
            </div>
          </div>

          <div>
            <label htmlFor="checkin-closes" className="form-label">
              Closes after the end
            </label>
            <div className="flex items-center gap-2">
              <input
                id="checkin-closes"
                type="number"
                min={CHECKIN_BOUNDS.checkin_closes_hours_after.min}
                max={CHECKIN_BOUNDS.checkin_closes_hours_after.max}
                value={closesDraft}
                onChange={(e) => setClosesDraft(e.target.value)}
                onBlur={() => commitCheckinBound('checkin_closes_hours_after', closesDraft, setClosesDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                disabled={saving}
                className="form-input w-24"
              />
              <span className="text-theme-text-muted text-xs">hours late</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ChecklistSettingsPage;
