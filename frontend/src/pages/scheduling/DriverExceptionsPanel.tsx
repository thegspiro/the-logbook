/**
 * Driver Qualification Exceptions
 *
 * The sanctioned way past the EVOC block. Enforcement is a hard stop — a
 * member without the certification their apparatus requires is not seated as
 * its driver — which is correct for emergency response and wrong for the
 * parade a life member has driven since before the certification existed.
 *
 * The controls the backend enforces are surfaced here rather than hidden:
 * a request grants nothing on its own, the approver must be a different person
 * from the requester, approval needs a chief-level permission, and every
 * exception carries an end date.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Clock, Loader2, Plus, ShieldOff, Truck, X } from 'lucide-react';
import { driverExceptionService } from '../../modules/apparatus/services/api';
import {
  DRIVER_EXCEPTION_REASON_LABELS,
  type DriverException,
  type DriverExceptionCreate,
} from '../../modules/apparatus/types';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import { useAuthStore } from '../../stores/authStore';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { useConfirm } from '../../contexts/ConfirmContext';
import { EmptyState } from '../../components/ux/EmptyState';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  denied: 'bg-theme-surface-secondary text-theme-text-muted',
  revoked: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

interface RequestForm {
  userId: string;
  apparatusId: string;
  reason: string;
  justification: string;
  restrictions: string;
  validFrom: string;
  validUntil: string;
}

const DriverExceptionsPanel: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const canApprove = checkPermission('apparatus.approve_driver_exception');

  const { members, apparatus, loadMembers, loadApparatus } = useSchedulingStore();

  const [exceptions, setExceptions] = useState<DriverException[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const today = getTodayLocalDate(tz);
  const emptyForm: RequestForm = useMemo(
    () => ({
      userId: '',
      apparatusId: '',
      reason: 'parade',
      justification: '',
      restrictions: '',
      validFrom: today,
      validUntil: today,
    }),
    [today]
  );
  const [form, setForm] = useState<RequestForm>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExceptions(await driverExceptionService.list({ includeExpired: showExpired }));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load driver exceptions'));
    } finally {
      setLoading(false);
    }
  }, [showExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMembers();
    void loadApparatus();
  }, [loadMembers, loadApparatus]);

  const pending = exceptions.filter((e) => e.status === 'pending');

  const handleSubmit = async () => {
    if (!form.userId || !form.justification.trim()) {
      toast.error('Choose a member and give a justification');
      return;
    }
    if (form.validUntil < form.validFrom) {
      toast.error('The end date cannot be before the start date');
      return;
    }

    setSaving(true);
    try {
      // Create payload: blanks omitted so an empty string never reaches a
      // validator.
      const payload: DriverExceptionCreate = {
        userId: form.userId,
        apparatusId: form.apparatusId || undefined,
        reason: form.reason,
        justification: form.justification.trim(),
        restrictions: form.restrictions.trim() || undefined,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
      };
      await driverExceptionService.request(payload);
      toast.success('Exception requested — a chief must approve it before it takes effect');
      setForm(emptyForm);
      setRequesting(false);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to request the exception'));
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (exception: DriverException, approve: boolean) => {
    if (approve) {
      const confirmed = await confirm({
        title: `Approve driving exception for ${exception.userName ?? 'this member'}?`,
        message:
          `This lets them drive ${exception.apparatusUnitNumber ?? 'any apparatus'} without the required EVOC ` +
          `certification through ${formatCalendarDate(exception.validUntil)}. The approval is recorded against your ` +
          'name in the audit log.',
        confirmLabel: 'Approve exception',
        cancelLabel: 'Not now',
      });
      if (!confirmed) return;
    }

    setActingId(exception.id);
    try {
      await driverExceptionService.review(exception.id, approve);
      toast.success(approve ? 'Exception approved' : 'Exception denied');
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to record the decision'));
    } finally {
      setActingId(null);
    }
  };

  const handleRevoke = async (exception: DriverException) => {
    const confirmed = await confirm({
      title: `Revoke the exception for ${exception.userName ?? 'this member'}?`,
      message:
        'They will be blocked from the driver seat again immediately. Existing assignments are not removed — ' +
        'check the roster for shifts already covered under this exception.',
      confirmLabel: 'Revoke it',
      cancelLabel: 'Leave it in place',
    });
    if (!confirmed) return;

    setActingId(exception.id);
    try {
      await driverExceptionService.revoke(exception.id);
      toast.success('Exception revoked');
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke the exception'));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-theme-text-secondary text-sm">
            A member without the EVOC level their apparatus requires cannot be seated as its driver. An exception lifts
            that block for a named member, for a bounded period — parades, special events, non-emergency moves.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">
            Requests grant nothing on their own. A chief other than the requester must approve, and every exception
            expires.
          </p>
        </div>
        {!requesting && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setRequesting(true);
            }}
            className="btn-info inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Request exception
          </button>
        )}
      </div>

      {requesting && (
        <div className="border-theme-surface-border bg-theme-surface-secondary/50 rounded-lg border p-4">
          <p className="text-theme-text-primary mb-3 text-sm font-medium">New exception request</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="exc-member" className="form-label">
                Member
              </label>
              <select
                id="exc-member"
                value={form.userId}
                onChange={(e) => setForm((prev) => ({ ...prev, userId: e.target.value }))}
                className="form-input"
              >
                <option value="">Select a member…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exc-apparatus" className="form-label">
                Apparatus
              </label>
              <select
                id="exc-apparatus"
                value={form.apparatusId}
                onChange={(e) => setForm((prev) => ({ ...prev, apparatusId: e.target.value }))}
                className="form-input"
              >
                <option value="">Any apparatus (broader — prefer a specific unit)</option>
                {apparatus.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.unit_number}
                    {unit.name ? ` — ${unit.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="exc-reason" className="form-label">
                Reason
              </label>
              <select
                id="exc-reason"
                value={form.reason}
                onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                className="form-input"
              >
                {Object.entries(DRIVER_EXCEPTION_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="exc-from" className="form-label">
                Valid from
              </label>
              <input
                id="exc-from"
                type="date"
                value={form.validFrom}
                onChange={(e) => setForm((prev) => ({ ...prev, validFrom: e.target.value }))}
                className="form-input"
              />
            </div>
            <div>
              <label htmlFor="exc-until" className="form-label">
                Valid until
              </label>
              <input
                id="exc-until"
                type="date"
                value={form.validUntil}
                onChange={(e) => setForm((prev) => ({ ...prev, validUntil: e.target.value }))}
                className="form-input"
              />
            </div>
          </div>

          <div className="mt-3">
            <label htmlFor="exc-justification" className="form-label">
              Justification
            </label>
            <textarea
              id="exc-justification"
              value={form.justification}
              onChange={(e) => setForm((prev) => ({ ...prev, justification: e.target.value }))}
              rows={2}
              maxLength={2000}
              placeholder="Why this member, on this apparatus, for this period"
              className="form-input"
            />
          </div>

          <div className="mt-3">
            <label htmlFor="exc-restrictions" className="form-label">
              Operating restrictions
            </label>
            <input
              id="exc-restrictions"
              type="text"
              value={form.restrictions}
              onChange={(e) => setForm((prev) => ({ ...prev, restrictions: e.target.value }))}
              maxLength={1000}
              placeholder="e.g. Parade route only, no emergency response, no lights or siren"
              className="form-input"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Shown to the officer whenever this member is seated as a driver.
            </p>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRequesting(false);
                setForm(emptyForm);
              }}
              className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={saving}
              className="btn-info inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Submit request
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-theme-text-secondary text-sm">
          {pending.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {pending.length} awaiting a chief&apos;s decision
            </span>
          ) : (
            <span className="text-theme-text-muted">Nothing awaiting review</span>
          )}
        </p>
        <label className="text-theme-text-muted flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={(e) => setShowExpired(e.target.checked)}
            className="form-checkbox"
          />
          Include expired
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      ) : exceptions.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          title="No driver exceptions"
          description="Everyone driving is doing so on a current certification."
        />
      ) : (
        <div className="card divide-theme-surface-border divide-y">
          {exceptions.map((exception) => {
            const isSelf = currentUserId != null && String(currentUserId) === exception.requestedBy;
            const isBeneficiary = currentUserId != null && String(currentUserId) === exception.userId;
            // Mirrors the backend's separation-of-duties bar so the button is
            // absent rather than present-and-failing.
            const blockedBySod = isSelf || isBeneficiary;

            return (
              <div key={exception.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-theme-text-primary text-sm font-semibold">
                      {exception.userName ?? 'Unknown member'}
                    </p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_STYLES[exception.status] ?? ''
                      }`}
                    >
                      {exception.status}
                    </span>
                    <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                      <Truck className="h-3 w-3" aria-hidden="true" />
                      {exception.apparatusUnitNumber ?? 'Any apparatus'}
                    </span>
                    <span className="text-theme-text-muted text-xs">
                      {DRIVER_EXCEPTION_REASON_LABELS[exception.reason] ?? exception.reason}
                    </span>
                  </div>

                  <p className="text-theme-text-secondary mt-1 text-xs">
                    {formatCalendarDate(exception.validFrom)} – {formatCalendarDate(exception.validUntil)}
                    {exception.requestedByName && (
                      <span className="text-theme-text-muted"> · requested by {exception.requestedByName}</span>
                    )}
                    {exception.reviewedByName && (
                      <span className="text-theme-text-muted">
                        {' '}
                        · {exception.status} by {exception.reviewedByName}
                      </span>
                    )}
                  </p>

                  <p className="text-theme-text-secondary mt-1.5 text-sm">{exception.justification}</p>

                  {exception.restrictions && (
                    <p className="mt-1.5 inline-flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      {exception.restrictions}
                    </p>
                  )}
                </div>

                {canApprove && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {exception.status === 'pending' &&
                      (blockedBySod ? (
                        <p className="text-theme-text-muted max-w-48 text-xs">
                          {isBeneficiary
                            ? 'You cannot approve your own exception — another chief must decide.'
                            : 'You raised this request — another chief must decide.'}
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              void handleReview(exception, false);
                            }}
                            disabled={actingId === exception.id}
                            className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleReview(exception, true);
                            }}
                            disabled={actingId === exception.id}
                            className="btn-info inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            {actingId === exception.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="h-3 w-3" aria-hidden="true" />
                            )}
                            Approve
                          </button>
                        </>
                      ))}
                    {exception.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRevoke(exception);
                        }}
                        disabled={actingId === exception.id}
                        className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DriverExceptionsPanel;
