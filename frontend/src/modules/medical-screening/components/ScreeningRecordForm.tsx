/**
 * Screening Record Form
 *
 * Modal form for creating/editing individual screening records.
 */

import React, { useEffect, useState } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { X } from 'lucide-react';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { ScreeningType, ScreeningStatus, SCREENING_TYPE_LABELS, SCREENING_STATUS_LABELS } from '../types';
import type {
  ScreeningRecord,
  ScreeningRequirement,
  ScreeningRecordCreate,
  ScreeningRecordUpdate,
  ScreeningSubjects,
  ScreeningSaveOptions,
} from '../types';
import { blankToNull } from '../../../utils/formValues';
import { addCalendarMonths } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { medicalScreeningService } from '../services/api';

type SubjectKind = 'member' | 'prospect';

interface ScreeningRecordFormProps {
  record: ScreeningRecord | null;
  requirements: ScreeningRequirement[];
  /** Rejects with a 422 for the form to put on its fields; reports other failures itself. */
  onSave: (data: ScreeningRecordCreate | ScreeningRecordUpdate, options?: ScreeningSaveOptions) => Promise<void>;
  onClose: () => void;
  /**
   * Whether to show and send the clinical narrative fields (MS-14). Without
   * `medical_screening.view_details` the API returns them null, so an edit
   * form showing them would send the blanks back and erase what is stored.
   */
  showNarrative?: boolean | undefined;
}

const inputClass = 'form-input';

function subjectPlaceholder(kind: SubjectKind, loaded: boolean, failed: boolean): string {
  if (failed) return 'Unavailable';
  if (!loaded) return 'Loading…';
  return kind === 'member' ? 'Select a member' : 'Select a prospect';
}
const labelClass = 'form-label mb-2';

type RecordField =
  | 'subject'
  | 'requirement_id'
  | 'screening_type'
  | 'status'
  | 'scheduled_date'
  | 'completed_date'
  | 'expiration_date'
  | 'provider_name'
  | 'result_summary'
  | 'notes';

/** The record schema is snake_case (no alias generator), so the keys are the API's names. */
const RECORD_FIELDS: Record<RecordField, ServerFieldSpec> = {
  subject: { label: 'Member or prospect', api: ['user_id', 'prospect_id'] },
  requirement_id: { label: 'Linked requirement' },
  screening_type: { label: 'Screening type' },
  status: { label: 'Status' },
  scheduled_date: { label: 'Scheduled date' },
  completed_date: { label: 'Completed date' },
  expiration_date: { label: 'Expiration date' },
  provider_name: { label: 'Provider / facility', maxLength: 255 },
  result_summary: { label: 'Result summary' },
  notes: { label: 'Notes' },
};

/** In the order they appear, so the first failing one takes focus. */
const RECORD_FIELD_IDS: Record<RecordField, string> = {
  subject: 'rec-subject',
  requirement_id: 'rec-requirement',
  screening_type: 'rec-type',
  status: 'rec-status',
  scheduled_date: 'rec-scheduled',
  completed_date: 'rec-completed',
  expiration_date: 'rec-expiration',
  provider_name: 'rec-provider',
  result_summary: 'rec-result',
  notes: 'rec-notes',
};

// A failed or expired result clears nobody, so a date it "expires" a year out
// reads to the next officer as a clearance it never was.
const RESULTS_WITHOUT_EXPIRATION: readonly string[] = [ScreeningStatus.FAILED, ScreeningStatus.EXPIRED];

export const ScreeningRecordForm: React.FC<ScreeningRecordFormProps> = ({
  record,
  requirements,
  onSave,
  onClose,
  showNarrative = true,
}) => {
  const [screeningType, setScreeningType] = useState<string>(record?.screening_type ?? ScreeningType.PHYSICAL_EXAM);
  const [recordStatus, setRecordStatus] = useState<string>(record?.status ?? ScreeningStatus.SCHEDULED);
  const [requirementId, setRequirementId] = useState(record?.requirement_id ?? '');
  const [scheduledDate, setScheduledDate] = useState(record?.scheduled_date ?? '');
  const [completedDate, setCompletedDate] = useState(record?.completed_date ?? '');
  const [expirationDate, setExpirationDate] = useState(record?.expiration_date ?? '');
  // The expiration this form last filled in, so a date the officer typed is
  // never overwritten, while one the form suggested follows a corrected
  // completed date or requirement.
  const [suggestedExpiration, setSuggestedExpiration] = useState('');

  // W71: suggest the date the requirement's frequency implies, so the record
  // carries its own expiration; the officer can still change it. (One saved
  // without a date falls due by the same frequency when graded, W71-1.)
  const suggestExpiration = (nextRequirementId: string, nextCompletedDate: string, nextStatus = recordStatus) => {
    const req = requirements.find((r) => r.id === nextRequirementId);
    const months = req?.frequency_months;
    const suggestion =
      months && nextCompletedDate && !RESULTS_WITHOUT_EXPIRATION.includes(nextStatus)
        ? addCalendarMonths(nextCompletedDate, months)
        : '';
    if (expirationDate === '' || expirationDate === suggestedExpiration) {
      setExpirationDate(suggestion);
      setSuggestedExpiration(suggestion);
    }
  };
  const suggestionMonths = requirements.find((r) => r.id === requirementId)?.frequency_months;
  const [providerName, setProviderName] = useState(record?.provider_name ?? '');
  const [resultSummary, setResultSummary] = useState(record?.result_summary ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  // Create only: who the record is for. Exactly one member or one prospect —
  // the API rejects neither and both (MS-13), because compliance resolves a
  // record by its subject and a record with none counts toward nobody.
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('member');
  const [subjectId, setSubjectId] = useState('');
  const [subjects, setSubjects] = useState<ScreeningSubjects | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);

  useEffect(() => {
    // Editing never changes who a record belongs to (the update schema has no
    // subject fields), so only the create dialog needs the list.
    if (record) return;
    let cancelled = false;
    medicalScreeningService
      .listSubjects()
      .then((loaded) => {
        if (!cancelled) setSubjects(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSubjectsError(getErrorMessage(err, 'Could not load members and prospects'));
      });
    return () => {
      cancelled = true;
    };
  }, [record]);

  const [errors, setErrors] = useState<Partial<Record<RecordField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState(false);
  const clearError = (field: RecordField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Anything changed from what the dialog opened with is unsaved work, so
  // Escape, the X and Cancel ask first (forms review F-6). Nothing here is
  // drafted anywhere: the record is PHI.
  const snapshot = JSON.stringify([
    subjectId,
    requirementId,
    screeningType,
    recordStatus,
    scheduledDate,
    completedDate,
    expirationDate,
    providerName,
    resultSummary,
    notes,
  ]);
  const [initialSnapshot] = useState(snapshot);
  const requestClose = useDiscardGuard({ isDirty: snapshot !== initialSnapshot, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ onClose: requestClose });

  const showErrors = (next: Partial<Record<RecordField, string>>) => {
    setErrors(next);
    const first = (Object.keys(RECORD_FIELD_IDS) as RecordField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(RECORD_FIELD_IDS[first])?.focus(), 0);
  };

  /**
   * The page reports every failure but a 422, which comes back here so each
   * refusal lands on its field (forms review F-2). An edit is a single save:
   * under the owner's rule of 2026-11-05 the rest is written without the
   * refused fields, whose stored values are kept, and the dialog stays open
   * with them flagged. A create writes nothing until they are fixed.
   */
  const save = async (data: ScreeningRecordCreate | ScreeningRecordUpdate) => {
    setFormError(null);
    setSavedExcept(false);
    try {
      await onSave(data);
      return;
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, RECORD_FIELDS);
      if (!mapped) {
        setFormError(getErrorMessage(err, 'Failed to save record'));
        return;
      }
      const refused = Object.keys(mapped.fieldErrors) as RecordField[];
      showErrors(mapped.fieldErrors);
      setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      if (!record || refused.length === 0 || mapped.unmatched.length > 0) return;
      const rest: Record<string, unknown> = { ...data };
      for (const field of refused) delete rest[field];
      try {
        await onSave(rest, { keepOpen: true });
        setSavedExcept(true);
      } catch (retryErr: unknown) {
        setFormError(getErrorMessage(retryErr, 'Failed to save record'));
      }
    }
  };

  const subjectOptions = subjectKind === 'member' ? (subjects?.members ?? []) : (subjects?.prospects ?? []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record && !subjectId) {
      showErrors({
        subject: `Choose the ${subjectKind === 'member' ? 'member' : 'prospect'} this record is for.`,
      });
      return;
    }
    setIsSaving(true);

    if (record) {
      // Edit path sends an explicit null for a blanked field. The backend
      // dumps update payloads with exclude_unset, so `undefined` here (which
      // never leaves the browser as JSON) means "leave this alone" — a
      // cleared provider name, result summary or note would otherwise
      // silently survive behind the "Record updated" toast (CLAUDE.md
      // pitfall #1, and these three are PHI).
      const data: ScreeningRecordUpdate = {
        requirement_id: requirementId || null,
        screening_type: screeningType as ScreeningRecordUpdate['screening_type'],
        status: recordStatus as ScreeningRecordUpdate['status'],
        scheduled_date: scheduledDate || null,
        completed_date: completedDate || null,
        expiration_date: expirationDate || null,
        // Left out entirely when the narrative is not shown: an omitted key
        // leaves the stored value alone (exclude_unset on the backend).
        ...(showNarrative
          ? {
              provider_name: blankToNull(providerName),
              result_summary: blankToNull(resultSummary),
              notes: blankToNull(notes),
            }
          : {}),
      };
      await save(data);
    } else {
      const data: ScreeningRecordCreate = {
        user_id: subjectKind === 'member' ? subjectId || undefined : undefined,
        prospect_id: subjectKind === 'prospect' ? subjectId || undefined : undefined,
        screening_type: screeningType as ScreeningRecordCreate['screening_type'],
        status: recordStatus as ScreeningRecordCreate['status'],
        requirement_id: requirementId || undefined,
        scheduled_date: scheduledDate || undefined,
        completed_date: completedDate || undefined,
        expiration_date: expirationDate || undefined,
        provider_name: showNarrative ? providerName.trim() || undefined : undefined,
        result_summary: showNarrative ? resultSummary.trim() || undefined : undefined,
        notes: showNarrative ? notes.trim() || undefined : undefined,
      };
      await save(data);
    }
    setIsSaving(false);
  };

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screening-record-dialog-title"
    >
      <div ref={dialogRef} className="modal-panel modal-body w-full max-w-lg">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="screening-record-dialog-title" className="text-theme-text-primary text-lg font-bold">
            {record ? 'Edit Screening Record' : 'Add Screening Record'}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-muted hover:text-theme-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="max-h-[70dvh] space-y-4 overflow-y-auto p-6">
          {savedExcept && (
            <p role="status" className="alert-warning text-theme-text-primary text-sm">
              Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
            </p>
          )}
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          {!record && (
            <fieldset className="space-y-2">
              <legend className={labelClass}>Record is for *</legend>
              <div className="flex gap-4">
                {(['member', 'prospect'] as const).map((kind) => (
                  <label key={kind} className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="rec-subject-kind"
                      value={kind}
                      checked={subjectKind === kind}
                      onChange={() => {
                        setSubjectKind(kind);
                        setSubjectId('');
                      }}
                    />
                    {kind === 'member' ? 'Member' : 'Prospect'}
                  </label>
                ))}
              </div>
              <label htmlFor="rec-subject" className="sr-only">
                {subjectKind === 'member' ? 'Member' : 'Prospect'}
              </label>
              {/* Not a FormField: the legend above is this control's visible
                  label and carries the required marker. */}
              <select
                id="rec-subject"
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  clearError('subject');
                }}
                className={inputClass}
                aria-required="true"
                aria-invalid={errors.subject ? true : undefined}
                aria-describedby={errors.subject ? 'rec-subject-error' : undefined}
                disabled={!subjects}
              >
                <option value="">{subjectPlaceholder(subjectKind, subjects !== null, subjectsError !== null)}</option>
                {subjectOptions.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
              {errors.subject && (
                <p id="rec-subject-error" className="text-sm text-red-800 dark:text-red-300">
                  {errors.subject}
                </p>
              )}
              {subjectsError && (
                <p role="alert" className="text-xs text-red-800 dark:text-red-300">
                  {subjectsError}
                </p>
              )}
              {subjects && subjectOptions.length === 0 && (
                <p className="text-theme-text-secondary text-xs">
                  {subjectKind === 'member'
                    ? 'No current members to choose from.'
                    : 'No prospects are open in the pipeline.'}
                </p>
              )}
            </fieldset>
          )}
          {/* Editable on an existing record too: the link decides which
              requirement the record satisfies, and the only one (owner
              decision 2026-11-01), so a record the upgrade could not link is
              filed here. */}
          <FormField
            label="Linked Requirement (optional)"
            error={errors.requirement_id}
            id="rec-requirement"
            hint="A record counts only toward the requirement it is linked to. With none, it counts toward no requirement."
          >
            {(field) => (
              <select
                {...field}
                value={requirementId}
                onChange={(e) => {
                  setRequirementId(e.target.value);
                  clearError('requirement_id');
                  const req = requirements.find((r) => r.id === e.target.value);
                  if (req) setScreeningType(req.screening_type);
                  suggestExpiration(e.target.value, completedDate);
                }}
                className={inputClass}
              >
                <option value="">None</option>
                {requirements.map((req) => (
                  <option key={req.id} value={req.id}>
                    {req.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="Screening Type" error={errors.screening_type} id="rec-type">
            {(field) => (
              <select
                {...field}
                value={screeningType}
                onChange={(e) => {
                  setScreeningType(e.target.value);
                  clearError('screening_type');
                }}
                className={inputClass}
              >
                {Object.entries(SCREENING_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="Status" error={errors.status} id="rec-status">
            {(field) => (
              <select
                {...field}
                value={recordStatus}
                onChange={(e) => {
                  setRecordStatus(e.target.value);
                  clearError('status');
                  suggestExpiration(requirementId, completedDate, e.target.value);
                }}
                className={inputClass}
              >
                {Object.entries(SCREENING_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Scheduled Date" error={errors.scheduled_date} id="rec-scheduled">
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => {
                    setScheduledDate(e.target.value);
                    clearError('scheduled_date');
                  }}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField label="Completed Date" error={errors.completed_date} id="rec-completed">
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={completedDate}
                  onChange={(e) => {
                    setCompletedDate(e.target.value);
                    clearError('completed_date');
                    suggestExpiration(requirementId, e.target.value);
                  }}
                  className={inputClass}
                />
              )}
            </FormField>
          </div>

          <FormField
            label="Expiration Date"
            error={errors.expiration_date}
            id="rec-expiration"
            hint={
              expirationDate && expirationDate === suggestedExpiration && suggestionMonths
                ? `Filled in from the requirement's ${suggestionMonths}-month frequency. Change it if the provider gave a different date.`
                : undefined
            }
          >
            {(field) => (
              <input
                {...field}
                type="date"
                value={expirationDate}
                onChange={(e) => {
                  setExpirationDate(e.target.value);
                  clearError('expiration_date');
                }}
                className={inputClass}
              />
            )}
          </FormField>

          {showNarrative && (
            <>
              <FormField
                label="Provider / Facility"
                error={errors.provider_name}
                id="rec-provider"
                maxLength={RECORD_FIELDS.provider_name.maxLength}
                count={providerName.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    autoComplete="off"
                    value={providerName}
                    onChange={(e) => {
                      setProviderName(e.target.value);
                      clearError('provider_name');
                    }}
                    placeholder="e.g., Dr. Smith, Valley Medical Center"
                    className={inputClass}
                  />
                )}
              </FormField>

              <FormField label="Result Summary" error={errors.result_summary} id="rec-result">
                {(field) => (
                  <textarea
                    {...field}
                    value={resultSummary}
                    onChange={(e) => {
                      setResultSummary(e.target.value);
                      clearError('result_summary');
                    }}
                    placeholder="Brief summary of results..."
                    rows={2}
                    className={inputClass + ' resize-none'}
                  />
                )}
              </FormField>

              <FormField label="Notes" error={errors.notes} id="rec-notes">
                {(field) => (
                  <textarea
                    {...field}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      clearError('notes');
                    }}
                    placeholder="Additional notes..."
                    rows={2}
                    className={inputClass + ' resize-none'}
                  />
                )}
              </FormField>
            </>
          )}

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || (!record && !subjects)}
              className="touch:min-h-11 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : record ? 'Save Changes' : 'Add Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
