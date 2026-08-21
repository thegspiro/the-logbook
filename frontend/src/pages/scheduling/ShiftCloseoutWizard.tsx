/**
 * Shift Close-Out Wizard
 *
 * Three questions, one per screen, reached from the post-shift validation
 * notification: when everyone was on, how many calls the apparatus ran, then
 * a confirmation that credits both to each member.
 *
 * Each step saves as it advances (`PATCH .../closeout/attendance`, then
 * `.../closeout/calls`), so a phone locking mid-flow resumes where it left
 * off instead of starting over. The server's `closeout_step` decides the entry
 * screen; nothing here is held only in component state.
 *
 * **The call count has exactly one source: the per-type rows.** The total is
 * derived from them and rendered read-only. An earlier design had a total
 * input *and* a breakdown, each claiming to own the number, which needed a
 * reconciliation rule per direction — the downward one was missing, so
 * revising a count down left the total stranded at its old value and that
 * stale figure was what got saved.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { CloseoutState, CloseoutAttendanceEntry, MemberCallCredit } from '../../modules/scheduling/types';
import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { UNCATEGORISED, deriveCallTotal, hoursBetween, num } from './closeoutMath';

interface ShiftCloseoutWizardProps {
  shiftId: string;
  unitLabel: string;
  /** IANA timezone the crew works in — every time shown is converted to it. */
  tz: string;
  /** End-of-shift equipment checks still outstanding on this shift. */
  outstandingChecks: number;
  /** Whether those checks block close-out for this department. */
  requireChecks: boolean;
  onCancel: () => void;
  onFinalized: () => void;
}

/** Local editable copy of one member's row. Times are datetime-local strings. */
interface MemberDraft {
  userId: string;
  name: string;
  inLocal: string;
  outLocal: string;
  missingCheckout: boolean;
  /**
   * Always a concrete number, seeded from the apparatus count. Held as a
   * string so the field shows exactly what state holds — rendering a
   * fallback the state did not contain meant clearing and retyping appended
   * to the number on screen.
   */
  credit: string;
  /**
   * Whether the officer actually changed this credit.
   *
   * Needed because a seeded credit and a typed one are indistinguishable by
   * value: on a fresh close-out the count is not known yet, so every credit
   * seeds to 0, and treating that as an officer's answer pinned the whole
   * crew at 0 once a real count arrived.
   */
  creditTouched: boolean;
}

const inputClass = 'form-input px-2 py-1 text-sm focus:ring-violet-500';

export const ShiftCloseoutWizard: React.FC<ShiftCloseoutWizardProps> = ({
  shiftId,
  unitLabel,
  tz,
  outstandingChecks,
  requireChecks,
  onCancel,
  onFinalized,
}) => {
  const [state, setState] = useState<CloseoutState | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [passDownNotes, setPassDownNotes] = useState('');
  const [overrideChecks, setOverrideChecks] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // Enforcement is a hard block server-side. Without the override the shift
  // simply cannot be closed out, so the wizard has to carry it — replacing the
  // old checklist meant replacing everything it could do, not most of it.
  const blocked = requireChecks && outstandingChecks > 0;
  const overrideBlocked = blocked && (!overrideChecks || overrideReason.trim() === '');

  /**
   * Seed the local drafts from whatever the server already holds.
   *
   * `adoptServerStep` is set only on first load. Re-hydrating after a save
   * must not move the officer: the save handler advances the step itself, and
   * letting the response drive it too meant two sources for one decision.
   */
  const hydrate = useCallback(
    (next: CloseoutState, adoptServerStep = false) => {
      setState(next);
      const seeded: Record<string, string> = { [UNCATEGORISED]: '' };
      next.call_types.forEach((t) => {
        seeded[t.slug] = '';
      });
      let typed = 0;
      Object.entries(next.reported_call_types || {}).forEach(([slug, n]) => {
        // A type retired since this shift was saved has no row to show it, so
        // its count folds into the uncategorised remainder below rather than
        // inflating a total nobody can see or edit.
        if (slug in seeded) {
          seeded[slug] = String(n);
          typed += n;
        }
      });
      // Whatever the shift recorded beyond its typed breakdown was never given
      // a type, so it belongs in the uncategorised row rather than vanishing.
      const remainder = (next.reported_call_count || 0) - typed;
      if (remainder > 0) seeded[UNCATEGORISED] = String(remainder);
      // Seed credits here rather than in an effect: an effect runs after the
      // first paint, so the confirm step rendered a frame of empty credit
      // fields before filling them in.
      const seededTotal = deriveCallTotal(seeded) ?? 0;
      setMembers((prev) => {
        const local = new Map(prev.map((m) => [m.userId, m]));
        return next.members.map((m) => {
          // Per-member credit is only persisted at finalize, so the server
          // reports null for it all the way through the wizard. Re-seeding
          // from that would wipe an adjustment the officer had already made
          // the moment they stepped back and saved again — silently, and only
          // for the member they had singled out.
          const held = local.get(m.user_id);
          const credit =
            held?.creditTouched && held.credit.trim() !== ''
              ? Math.min(num(held.credit), seededTotal)
              : (m.call_count ?? seededTotal);
          return {
            userId: m.user_id,
            name: m.user_name,
            inLocal: formatForDateTimeInput(m.checked_in_at, tz),
            outLocal: formatForDateTimeInput(m.checked_out_at, tz),
            missingCheckout: m.missing_checkout,
            credit: String(Math.min(credit, seededTotal)),
            creditTouched: held?.creditTouched ?? false,
          };
        });
      });
      setCounts(seeded);
      // Resume where the officer left off. A finalized shift has no wizard.
      if (adoptServerStep) setStep(next.is_finalized ? 3 : Math.min(next.closeout_step + 1, 3));
    },
    [tz]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await schedulingService.getCloseoutState(shiftId);
        if (!cancelled) hydrate(next, true);
      } catch (err: unknown) {
        if (!cancelled) toast.error(getErrorMessage(err, 'Could not load the close-out'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [shiftId, hydrate]);

  const combinedHours = useMemo(
    () => Math.round(members.reduce((sum, m) => sum + hoursBetween(m.inLocal, m.outLocal), 0) * 10) / 10,
    [members]
  );
  const callTotal = useMemo(() => deriveCallTotal(counts), [counts]);
  const totalOrZero = callTotal ?? 0;

  /** Credit defaults to the apparatus count and can never exceed it. */
  const creditOf = useCallback(
    (m: MemberDraft): number => (m.credit.trim() === '' ? totalOrZero : Math.min(num(m.credit), totalOrZero)),
    [totalOrZero]
  );
  const highestCredit = useMemo(() => members.reduce((hi, m) => Math.max(hi, creditOf(m)), 0), [members, creditOf]);

  const setMemberField = (userId: string, field: 'inLocal' | 'outLocal' | 'credit', value: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.userId === userId ? { ...m, [field]: value, creditTouched: m.creditTouched || field === 'credit' } : m
      )
    );
  };

  const saveAttendance = async () => {
    setSaving(true);
    try {
      const entries: CloseoutAttendanceEntry[] = members.map((m) => ({
        user_id: m.userId,
        // localToUTC returns '' for a blank field; send null so the server
        // records "no time" rather than rejecting an empty string.
        checked_in_at: localToUTC(m.inLocal, tz) || null,
        checked_out_at: localToUTC(m.outLocal, tz) || null,
      }));
      hydrate(await schedulingService.saveCloseoutAttendance(shiftId, entries));
      setStep(2);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the times'));
    } finally {
      setSaving(false);
    }
  };

  const saveCalls = async () => {
    setSaving(true);
    try {
      const known = new Set(state?.call_types.map((t) => t.slug) ?? []);
      const types: Record<string, number> = {};
      Object.entries(counts).forEach(([slug, v]) => {
        if (slug !== UNCATEGORISED && known.has(slug) && num(v) > 0) types[slug] = num(v);
      });
      hydrate(
        await schedulingService.saveCloseoutCalls(shiftId, {
          reported_call_count: callTotal,
          reported_call_types: Object.keys(types).length ? types : undefined,
        })
      );
      setStep(3);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the call count'));
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    setSaving(true);
    try {
      const credits: MemberCallCredit[] = members.map((m) => ({
        user_id: m.userId,
        call_count: creditOf(m),
      }));
      const opts: {
        member_call_counts: MemberCallCredit[];
        pass_down_notes?: string;
        override_incomplete_checks?: boolean;
        override_reason?: string;
      } = { member_call_counts: credits };
      if (passDownNotes.trim()) opts.pass_down_notes = passDownNotes.trim();
      if (blocked && overrideChecks) {
        opts.override_incomplete_checks = true;
        if (overrideReason.trim()) opts.override_reason = overrideReason.trim();
      }
      await schedulingService.finalizeShift(shiftId, undefined, opts);
      toast.success('Shift closed out');
      onFinalized();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not close out the shift'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-theme-text-muted flex items-center justify-center gap-2 p-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading close-out…
      </div>
    );
  }
  if (!state) return null;

  // Only the department's current types are offered. A count left behind
  // against a type an admin has since removed would be invisible, counted in
  // the total, and rejected by the server as an unknown slug with no field to
  // clear it — so the row list is the authority and stale keys are dropped.
  const rows = state.call_types.map((t) => ({ slug: t.slug, label: t.label }));
  rows.push({ slug: UNCATEGORISED, label: 'Not categorised' });

  return (
    <div className="border-theme-surface-border bg-theme-surface space-y-3 rounded-lg border p-4">
      {/* Progress */}
      <nav aria-label="Close-out progress" className="flex items-center">
        {[1, 2, 3].map((n, i) => (
          <React.Fragment key={n}>
            <span
              aria-current={n === step ? 'step' : undefined}
              aria-label={`Step ${n} of 3`}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                n < step
                  ? 'bg-green-600 text-white'
                  : n === step
                    ? 'bg-red-600 text-white'
                    : 'border-theme-surface-border text-theme-text-muted border'
              }`}
            >
              {n < step ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
            </span>
            {i < 2 && <span className={`mx-2 h-0.5 flex-1 ${n < step ? 'bg-green-600' : 'bg-theme-surface-border'}`} />}
          </React.Fragment>
        ))}
      </nav>

      {/* ---------------- Step 1 — attendance ---------------- */}
      {step === 1 && (
        <div className="space-y-3">
          <h4 className="text-theme-text-primary text-sm font-semibold">When was everyone on?</h4>
          <p className="text-theme-text-muted text-xs">Taken from check-in. Change anyone whose times were off.</p>
          <div className="divide-theme-surface-border divide-y">
            {members.map((m) => (
              <div key={m.userId} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary truncate text-sm">{m.name}</p>
                  {m.missingCheckout && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">no check-out recorded</p>
                  )}
                </div>
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={m.inLocal}
                  aria-label={`Start time for ${m.name}`}
                  onChange={(e) => setMemberField(m.userId, 'inLocal', e.target.value)}
                />
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={m.outLocal}
                  aria-label={`End time for ${m.name}`}
                  onChange={(e) => setMemberField(m.userId, 'outLocal', e.target.value)}
                />
                <span className="text-theme-text-secondary w-12 text-right text-xs tabular-nums">
                  {hoursBetween(m.inLocal, m.outLocal).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-theme-surface-border text-theme-text-secondary flex justify-between border-t pt-2 text-xs">
            <span>
              {members.length} member{members.length === 1 ? '' : 's'}
            </span>
            {/* "Combined", not "total": summed across the crew it is several
                times the length of the shift and reads as an error without it. */}
            <strong className="text-theme-text-primary tabular-nums">{combinedHours.toFixed(1)} combined hours</strong>
          </div>
        </div>
      )}

      {/* ---------------- Step 2 — calls ---------------- */}
      {step === 2 && (
        <div className="space-y-3">
          <h4 className="text-theme-text-primary text-sm font-semibold">How many calls did {unitLabel} run?</h4>
          <div
            className="border-theme-surface-border bg-theme-surface-secondary flex flex-col items-center rounded-lg border p-3"
            aria-live="polite"
          >
            <span
              className={`text-3xl font-semibold tabular-nums ${
                callTotal === null ? 'text-theme-text-muted' : 'text-theme-text-primary'
              }`}
              data-testid="call-total"
            >
              {callTotal === null ? '—' : callTotal}
            </span>
            <span className="text-theme-text-muted text-[10px] tracking-wider uppercase">Total calls</span>
          </div>
          <p className="text-theme-text-muted text-xs">
            Enter them by type below. If you don’t break them down, put the lot in “Not categorised”.
          </p>
          <div className="divide-theme-surface-border divide-y">
            {rows.map((r) => (
              <div key={r.slug} className="flex items-center gap-2 py-2">
                <span className="text-theme-text-secondary min-w-0 flex-1 text-sm">{r.label}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="0"
                  className={`${inputClass} w-16 text-right tabular-nums`}
                  value={counts[r.slug] ?? ''}
                  aria-label={`${r.label} calls`}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [r.slug]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Step 3 — confirm ---------------- */}
      {step === 3 && (
        <div className="space-y-3">
          <h4 className="text-theme-text-primary text-sm font-semibold">Does this look right?</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-2">
              <p className="text-theme-text-primary text-xl font-semibold tabular-nums">{combinedHours.toFixed(1)}</p>
              <p className="text-theme-text-muted text-[10px] tracking-wider uppercase">Combined hours</p>
            </div>
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-2">
              <p className="text-theme-text-primary text-xl font-semibold tabular-nums">{totalOrZero}</p>
              <p className="text-theme-text-muted text-[10px] tracking-wider uppercase">Calls</p>
            </div>
          </div>
          <p className="text-theme-text-muted text-xs">
            Everyone starts on the apparatus’s count. Lower anyone who wasn’t on them all.
          </p>
          <div className="divide-theme-surface-border divide-y">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary truncate text-sm">{m.name}</p>
                  <p className="text-theme-text-muted text-xs tabular-nums">
                    {hoursBetween(m.inLocal, m.outLocal).toFixed(1)}h
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={totalOrZero}
                  inputMode="numeric"
                  className={`${inputClass} w-16 text-right tabular-nums`}
                  value={m.credit}
                  aria-label={`Calls credited to ${m.name}`}
                  onChange={(e) => setMemberField(m.userId, 'credit', e.target.value)}
                  // Snap the display into range only on blur. Clamping per
                  // keystroke rewrites "1" before the "2" of "12" arrives.
                  onBlur={() => setMemberField(m.userId, 'credit', String(creditOf(m)))}
                />
              </div>
            ))}
          </div>
          {totalOrZero > 0 && highestCredit < totalOrZero && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Nobody is credited with all {totalOrZero} calls — the highest is {highestCredit}. That is right if the
                crew turned over mid-shift; otherwise a member is credited too low, or the total is too high.
              </p>
            </div>
          )}
          <p className="text-theme-text-muted text-xs">
            The department records {totalOrZero} call{totalOrZero === 1 ? '' : 's'} — per-member credit is never added
            into the department’s total.
          </p>

          <div>
            <label htmlFor="closeout-pass-down" className="text-theme-text-secondary mb-1 block text-xs font-medium">
              Pass-down to next crew (optional)
            </label>
            <textarea
              id="closeout-pass-down"
              rows={2}
              className={`${inputClass} w-full`}
              placeholder="Apparatus issues, ongoing incidents, staffing notes…"
              value={passDownNotes}
              onChange={(e) => setPassDownNotes(e.target.value)}
            />
          </div>

          {blocked && (
            <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
                <input
                  type="checkbox"
                  checked={overrideChecks}
                  onChange={(e) => setOverrideChecks(e.target.checked)}
                  className="border-theme-surface-border rounded"
                />
                Close out anyway, with {outstandingChecks} equipment check
                {outstandingChecks === 1 ? '' : 's'} outstanding
              </label>
              {overrideChecks && (
                <input
                  type="text"
                  className={`${inputClass} w-full`}
                  placeholder="Why are the checks outstanding?"
                  aria-label="Reason for closing out with checks outstanding"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              )}
              <p className="text-xs text-red-600 dark:text-red-300">
                {overrideChecks
                  ? 'A reason is required — it goes on the shift’s record.'
                  : 'Complete the outstanding checks, or tick the box to override.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Nav ---------------- */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => (step > 1 ? setStep(step - 1) : onCancel())}
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 px-2 py-1.5 text-sm"
        >
          {step > 1 && <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
          {step > 1 ? 'Back' : 'Cancel'}
        </button>
        <button
          type="button"
          disabled={saving || (step === 3 && overrideBlocked)}
          onClick={() => {
            if (step === 1) void saveAttendance();
            else if (step === 2) void saveCalls();
            else void finalize();
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
            step === 3 ? 'bg-green-600 hover:bg-green-700' : 'bg-violet-600 hover:bg-violet-700'
          }`}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : step === 3 ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : null}
          {step === 3 ? 'Close out shift' : 'Next'}
        </button>
      </div>
    </div>
  );
};

export default ShiftCloseoutWizard;
