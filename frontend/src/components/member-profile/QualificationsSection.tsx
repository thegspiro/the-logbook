/**
 * What the member is certified to do — EMT, Paramedic, Driver/Operator — as
 * shift eligibility reads it.
 *
 * Members-managers only, matching the endpoint. A qualification arrives two
 * ways: from a completed training record against a course that certifies it,
 * or entered here. Entering one here is how a department records a licence a
 * member already held before the system existed, without inventing a course
 * completion to match it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberQualificationService } from '../../services/api';
import { COURSE_QUALIFICATIONS } from '../../constants/enums';
import type { MemberQualification } from '../../types/user';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';

interface QualificationsSectionProps {
  userId: string;
  memberName: string;
  tz: string;
}

interface DraftState {
  /** Set when editing an existing row; the code is then fixed. */
  existing: MemberQualification | null;
  code: string;
  grantedOn: string;
  expiresOn: string;
  notes: string;
}

const emptyDraft = (): DraftState => ({ existing: null, code: '', grantedOn: '', expiresOn: '', notes: '' });

export const QualificationsSection: React.FC<QualificationsSectionProps> = ({ userId, memberName, tz }) => {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<MemberQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await memberQualificationService.list(userId));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Unable to load qualifications.'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setDraft(null);
    void load();
  }, [load]);

  const heldCodes = new Set(rows.map((r) => r.qualification_code));
  const addable = COURSE_QUALIFICATIONS.filter((q) => !heldCodes.has(q.value));

  const startEdit = (row: MemberQualification) => {
    setSaveError(null);
    setDraft({
      existing: row,
      code: row.qualification_code,
      grantedOn: row.granted_on ?? '',
      expiresOn: row.expires_on ?? '',
      notes: row.notes ?? '',
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.code) {
      setSaveError('Choose a qualification.');
      return;
    }
    if (draft.grantedOn && draft.expiresOn && draft.expiresOn < draft.grantedOn) {
      setSaveError('The expiry date cannot be before the granted date.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Every field on every save: a cleared date is an explicit null.
      setRows(
        await memberQualificationService.save(userId, draft.code, {
          granted_on: blankToNull(draft.grantedOn),
          expires_on: blankToNull(draft.expiresOn),
          notes: blankToNull(draft.notes),
        })
      );
      setDraft(null);
      toast.success('Qualification saved');
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Unable to save the qualification.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: MemberQualification) => {
    const confirmed = await confirm({
      title: 'Remove qualification?',
      message: `${memberName} will no longer be cleared for the shift seats ${row.label} unlocks.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    try {
      setRows(await memberQualificationService.remove(userId, row.qualification_code));
      toast.success('Qualification removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to remove the qualification.'));
    }
  };

  const statusLabel = (row: MemberQualification): { text: string; className: string } => {
    if (row.in_force) {
      return { text: 'In force', className: 'badge bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-white' };
    }
    // Lapsed, or granted with a future start date: either way the scheduler
    // does not count it today.
    return {
      text: 'Not in force',
      className: 'badge bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-white',
    };
  };

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-theme-text-primary text-lg font-semibold">Qualifications</h2>
        {!draft && !loading && !loadError && addable.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setDraft(emptyDraft());
            }}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : (
        <div className="space-y-4">
          {rows.length === 0 && !draft && (
            <p className="text-theme-text-muted text-sm">
              No qualifications on record. Shift seats that need a certification will not be offered to this member.
            </p>
          )}
          {rows.length > 0 && (
            <ul className="divide-theme-surface-border divide-y">
              {rows.map((row) => {
                const status = statusLabel(row);
                return (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="text-theme-text-primary flex flex-wrap items-center gap-2 font-medium">
                        {row.label}
                        <span className={status.className}>{status.text}</span>
                      </p>
                      <p className="text-theme-text-muted text-xs">
                        {row.granted_on ? `Granted ${formatDate(row.granted_on, tz)}` : 'Grant date not recorded'}
                        {' · '}
                        {row.expires_on ? `Expires ${formatDate(row.expires_on, tz)}` : 'Does not expire'}
                        {' · '}
                        {row.source === 'training_record' ? 'From a training record' : 'Entered directly'}
                      </p>
                      {row.notes && <p className="text-theme-text-secondary mt-1 text-sm">{row.notes}</p>}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="btn-icon"
                        aria-label={`Edit ${row.label}`}
                        title="Edit"
                        disabled={draft !== null}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(row)}
                        className="btn-icon text-red-700 dark:text-red-400"
                        aria-label={`Remove ${row.label}`}
                        title="Remove"
                        disabled={draft !== null}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {draft && (
            <fieldset
              className="border-theme-surface-border m-0 min-w-0 space-y-3 rounded-lg border p-3"
              disabled={saving}
            >
              <legend className="text-theme-text-secondary px-1 text-xs font-medium uppercase">
                {draft.existing ? `Edit ${draft.existing.label}` : 'Add a qualification'}
              </legend>
              {draft.existing?.source === 'training_record' && (
                <p className="alert-info text-sm">
                  This came from a training record. Saving it here makes it a direct entry, so voiding that record will
                  no longer remove it.
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!draft.existing && (
                  <div className="sm:col-span-2">
                    <label htmlFor="qualification-code" className="form-label">
                      Qualification
                    </label>
                    <select
                      id="qualification-code"
                      className="form-input"
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {addable.map((q) => (
                        <option key={q.value} value={q.value}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="qualification-granted" className="form-label">
                    Granted <span className="text-theme-text-muted font-normal">(optional)</span>
                  </label>
                  <input
                    id="qualification-granted"
                    type="date"
                    className="form-input"
                    value={draft.grantedOn}
                    onChange={(e) => setDraft({ ...draft, grantedOn: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="qualification-expires" className="form-label">
                    Expires <span className="text-theme-text-muted font-normal">(blank if it does not)</span>
                  </label>
                  <input
                    id="qualification-expires"
                    type="date"
                    className="form-input"
                    value={draft.expiresOn}
                    onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="qualification-notes" className="form-label">
                    Notes <span className="text-theme-text-muted font-normal">(optional)</span>
                  </label>
                  <input
                    id="qualification-notes"
                    type="text"
                    className="form-input"
                    maxLength={2000}
                    placeholder="e.g. State licence number, reciprocity"
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  />
                </div>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save qualification
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
};

export default QualificationsSection;
