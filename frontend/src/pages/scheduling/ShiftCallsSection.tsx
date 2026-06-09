/**
 * Shift Calls Section
 *
 * Lets shift officers log, review, edit, and remove the calls/incidents a crew
 * responded to during a shift. Surfaces the backend shift-call endpoints
 * (create/list/update/delete) that feed each shift's call count.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Flame, Plus, Trash2, Pencil, Loader2, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftCallRecord } from '../../modules/scheduling/types';
import { formatDateTime, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface ShiftCallsSectionProps {
  shiftId: string;
  canManage: boolean;
  tz: string;
  /** Called after a call is added/edited/removed so the parent can refresh counts. */
  onChange?: () => void;
}

interface CallForm {
  incident_type: string;
  incident_number: string;
  dispatched_at: string;
  cleared_at: string;
  cancelled_en_route: boolean;
  medical_refusal: boolean;
  notes: string;
}

const emptyForm: CallForm = {
  incident_type: '',
  incident_number: '',
  dispatched_at: '',
  cleared_at: '',
  cancelled_en_route: false,
  medical_refusal: false,
  notes: '',
};

const inputCls =
  'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

/** Convert a `datetime-local` value to a UTC ISO string in the org timezone. */
const toUtcIso = (localValue: string, timezone: string): string | undefined =>
  localValue ? localToUTC(localValue, timezone) || undefined : undefined;

/** Convert a stored UTC ISO string to a `datetime-local` value in the org timezone. */
const toLocalInput = (iso: string | null | undefined, timezone: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};

const callToForm = (call: ShiftCallRecord, timezone: string): CallForm => ({
  incident_type: call.incident_type,
  incident_number: call.incident_number ?? '',
  dispatched_at: toLocalInput(call.dispatched_at, timezone),
  cleared_at: toLocalInput(call.cleared_at, timezone),
  cancelled_en_route: call.cancelled_en_route,
  medical_refusal: call.medical_refusal,
  notes: call.notes ?? '',
});

export const ShiftCallsSection: React.FC<ShiftCallsSectionProps> = ({
  shiftId,
  canManage,
  tz,
  onChange,
}) => {
  const [calls, setCalls] = useState<ShiftCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // null = form hidden, 'new' = adding, otherwise the id of the call being edited
  const [formMode, setFormMode] = useState<string | null>(null);
  const [form, setForm] = useState<CallForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schedulingService.getShiftCalls(shiftId);
      setCalls(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load calls'));
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  const openAdd = () => {
    setForm(emptyForm);
    setFormMode('new');
  };

  const openEdit = (call: ShiftCallRecord) => {
    setForm(callToForm(call, tz));
    setFormMode(call.id);
  };

  const closeForm = () => {
    setFormMode(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.incident_type.trim()) {
      toast.error('Incident type is required');
      return;
    }
    const payload = {
      incident_type: form.incident_type.trim(),
      incident_number: form.incident_number.trim() || undefined,
      dispatched_at: toUtcIso(form.dispatched_at, tz),
      cleared_at: toUtcIso(form.cleared_at, tz),
      cancelled_en_route: form.cancelled_en_route,
      medical_refusal: form.medical_refusal,
      notes: form.notes.trim() || undefined,
    };
    setSaving(true);
    try {
      if (formMode === 'new') {
        await schedulingService.createCall(shiftId, payload);
        toast.success('Call logged');
      } else if (formMode) {
        await schedulingService.updateCall(formMode, payload);
        toast.success('Call updated');
      }
      closeForm();
      await loadCalls();
      onChange?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save call'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (callId: string) => {
    setDeletingId(callId);
    try {
      await schedulingService.deleteCall(callId);
      toast.success('Call removed');
      if (formMode === callId) closeForm();
      await loadCalls();
      onChange?.();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove call'));
    } finally {
      setDeletingId(null);
    }
  };

  const renderForm = () => (
    <div className="p-3 border border-violet-500/20 rounded-lg bg-violet-500/5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="call-type" className="block text-xs font-medium text-theme-text-secondary mb-1">
            Incident Type *
          </label>
          <input
            id="call-type"
            type="text"
            value={form.incident_type}
            onChange={e => setForm(p => ({ ...p, incident_type: e.target.value }))}
            placeholder="e.g. Structure fire, EMS, MVA"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="call-number" className="block text-xs font-medium text-theme-text-secondary mb-1">
            Incident #
          </label>
          <input
            id="call-number"
            type="text"
            value={form.incident_number}
            onChange={e => setForm(p => ({ ...p, incident_number: e.target.value }))}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="call-dispatched" className="block text-xs font-medium text-theme-text-secondary mb-1">
            Dispatched
          </label>
          <input
            id="call-dispatched"
            type="datetime-local"
            value={form.dispatched_at}
            onChange={e => setForm(p => ({ ...p, dispatched_at: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="call-cleared" className="block text-xs font-medium text-theme-text-secondary mb-1">
            Cleared
          </label>
          <input
            id="call-cleared"
            type="datetime-local"
            value={form.cleared_at}
            onChange={e => setForm(p => ({ ...p, cleared_at: e.target.value }))}
            className={inputCls}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.cancelled_en_route}
            onChange={e => setForm(p => ({ ...p, cancelled_en_route: e.target.checked }))}
            className="w-4 h-4 rounded border-theme-input-border text-violet-600 focus:ring-violet-500"
          />
          Cancelled en route
        </label>
        <label className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.medical_refusal}
            onChange={e => setForm(p => ({ ...p, medical_refusal: e.target.checked }))}
            className="w-4 h-4 rounded border-theme-input-border text-violet-600 focus:ring-violet-500"
          />
          Medical refusal
        </label>
      </div>
      <div>
        <label htmlFor="call-notes" className="block text-xs font-medium text-theme-text-secondary mb-1">
          Notes
        </label>
        <textarea
          id="call-notes"
          value={form.notes}
          onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
          rows={2}
          placeholder="Optional details"
          className={inputCls + ' resize-none'}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={closeForm}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {formMode === 'new' ? 'Save Call' : 'Update Call'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          Calls / Runs
          {!loading && calls.length > 0 && (
            <span className="text-xs font-normal text-theme-text-muted">({calls.length})</span>
          )}
        </h3>
        {canManage && formMode === null && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Log Call
          </button>
        )}
      </div>

      {canManage && formMode === 'new' && renderForm()}

      {loading ? (
        <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" aria-hidden="true" />
          <span className="sr-only">Loading calls…</span>
        </div>
      ) : calls.length === 0 ? (
        <p className="text-xs text-theme-text-muted">No calls logged for this shift.</p>
      ) : (
        <div className="space-y-2">
          {calls.map(call =>
            formMode === call.id ? (
              <div key={call.id}>{renderForm()}</div>
            ) : (
              <div
                key={call.id}
                className="flex items-start justify-between gap-3 p-2.5 bg-theme-surface border border-theme-surface-border rounded-lg"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-theme-text-primary capitalize">
                      {call.incident_type}
                    </span>
                    {call.incident_number && (
                      <span className="text-xs text-theme-text-muted">#{call.incident_number}</span>
                    )}
                    {call.cancelled_en_route && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        Cancelled en route
                      </span>
                    )}
                    {call.medical_refusal && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400">
                        Refusal
                      </span>
                    )}
                  </div>
                  {call.dispatched_at && (
                    <p className="text-xs text-theme-text-muted mt-0.5">
                      Dispatched {formatDateTime(call.dispatched_at, tz)}
                      {call.cleared_at ? ` — cleared ${formatDateTime(call.cleared_at, tz)}` : ''}
                    </p>
                  )}
                  {call.notes && (
                    <p className="text-xs text-theme-text-secondary mt-0.5">{call.notes}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(call)}
                      className="p-1.5 text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10 rounded-lg transition-colors"
                      title="Edit call"
                      aria-label="Edit call"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { void handleDelete(call.id); }}
                      disabled={deletingId === call.id}
                      className="p-1.5 text-red-500 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Remove call"
                      aria-label="Remove call"
                    >
                      {deletingId === call.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default ShiftCallsSection;
