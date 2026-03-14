/**
 * Screening Record Form
 *
 * Modal form for creating/editing individual screening records.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  ScreeningType,
  ScreeningStatus,
  SCREENING_TYPE_LABELS,
  SCREENING_STATUS_LABELS,
} from '../types';
import type {
  ScreeningRecord,
  ScreeningRequirement,
  ScreeningRecordCreate,
  ScreeningRecordUpdate,
} from '../types';

interface ScreeningRecordFormProps {
  record: ScreeningRecord | null;
  requirements: ScreeningRequirement[];
  onSave: (data: ScreeningRecordCreate | ScreeningRecordUpdate) => Promise<void>;
  onClose: () => void;
}

const inputClass = 'form-input';
const labelClass = 'text-theme-text-secondary mb-2 block text-sm font-medium';

export const ScreeningRecordForm: React.FC<ScreeningRecordFormProps> = ({
  record,
  requirements,
  onSave,
  onClose,
}) => {
  const [screeningType, setScreeningType] = useState<string>(
    record?.screening_type ?? ScreeningType.PHYSICAL_EXAM
  );
  const [recordStatus, setRecordStatus] = useState<string>(
    record?.status ?? ScreeningStatus.SCHEDULED
  );
  const [requirementId, setRequirementId] = useState(record?.requirement_id ?? '');
  const [scheduledDate, setScheduledDate] = useState(record?.scheduled_date ?? '');
  const [completedDate, setCompletedDate] = useState(record?.completed_date ?? '');
  const [expirationDate, setExpirationDate] = useState(record?.expiration_date ?? '');
  const [providerName, setProviderName] = useState(record?.provider_name ?? '');
  const [resultSummary, setResultSummary] = useState(record?.result_summary ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    if (record) {
      const data: ScreeningRecordUpdate = {
        screening_type: screeningType as ScreeningRecordUpdate['screening_type'],
        status: recordStatus as ScreeningRecordUpdate['status'],
        scheduled_date: scheduledDate || undefined,
        completed_date: completedDate || undefined,
        expiration_date: expirationDate || undefined,
        provider_name: providerName.trim() || undefined,
        result_summary: resultSummary.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await onSave(data);
    } else {
      const data: ScreeningRecordCreate = {
        screening_type: screeningType as ScreeningRecordCreate['screening_type'],
        status: recordStatus as ScreeningRecordCreate['status'],
        requirement_id: requirementId || undefined,
        scheduled_date: scheduledDate || undefined,
        completed_date: completedDate || undefined,
        expiration_date: expirationDate || undefined,
        provider_name: providerName.trim() || undefined,
        result_summary: resultSummary.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await onSave(data);
    }
    setIsSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal border-theme-surface-border modal-body w-full max-w-lg rounded-xl border">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 className="text-theme-text-primary text-lg font-bold">
            {record ? 'Edit Screening Record' : 'Add Screening Record'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          {!record && (
            <div>
              <label htmlFor="rec-requirement" className={labelClass}>
                Linked Requirement (optional)
              </label>
              <select
                id="rec-requirement"
                value={requirementId}
                onChange={(e) => {
                  setRequirementId(e.target.value);
                  const req = requirements.find((r) => r.id === e.target.value);
                  if (req) setScreeningType(req.screening_type);
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
            </div>
          )}

          <div>
            <label htmlFor="rec-type" className={labelClass}>
              Screening Type
            </label>
            <select
              id="rec-type"
              value={screeningType}
              onChange={(e) => setScreeningType(e.target.value)}
              className={inputClass}
            >
              {Object.entries(SCREENING_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rec-status" className={labelClass}>
              Status
            </label>
            <select
              id="rec-status"
              value={recordStatus}
              onChange={(e) => setRecordStatus(e.target.value)}
              className={inputClass}
            >
              {Object.entries(SCREENING_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rec-scheduled" className={labelClass}>
                Scheduled Date
              </label>
              <input
                id="rec-scheduled"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="rec-completed" className={labelClass}>
                Completed Date
              </label>
              <input
                id="rec-completed"
                type="date"
                value={completedDate}
                onChange={(e) => setCompletedDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="rec-expiration" className={labelClass}>
              Expiration Date
            </label>
            <input
              id="rec-expiration"
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="rec-provider" className={labelClass}>
              Provider / Facility
            </label>
            <input
              id="rec-provider"
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="e.g., Dr. Smith, Valley Medical Center"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="rec-result" className={labelClass}>
              Result Summary
            </label>
            <textarea
              id="rec-result"
              value={resultSummary}
              onChange={(e) => setResultSummary(e.target.value)}
              placeholder="Brief summary of results..."
              rows={2}
              className={inputClass + ' resize-none'}
            />
          </div>

          <div>
            <label htmlFor="rec-notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="rec-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
              className={inputClass + ' resize-none'}
            />
          </div>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="text-theme-text-secondary hover:text-theme-text-primary rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : record ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
