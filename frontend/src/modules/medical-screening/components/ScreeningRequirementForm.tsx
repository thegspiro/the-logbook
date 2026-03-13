/**
 * Screening Requirement Form
 *
 * Modal form for creating/editing screening requirements.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  ScreeningType,
  SCREENING_TYPE_LABELS,
} from '../types';
import type {
  ScreeningRequirement,
  ScreeningRequirementCreate,
  ScreeningRequirementUpdate,
} from '../types';

interface ScreeningRequirementFormProps {
  requirement: ScreeningRequirement | null;
  onSave: (data: ScreeningRequirementCreate | ScreeningRequirementUpdate) => Promise<void>;
  onClose: () => void;
}

const inputClass =
  'bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden';
const labelClass = 'text-theme-text-secondary mb-2 block text-sm font-medium';

export const ScreeningRequirementForm: React.FC<ScreeningRequirementFormProps> = ({
  requirement,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(requirement?.name ?? '');
  const [screeningType, setScreeningType] = useState<string>(
    requirement?.screening_type ?? ScreeningType.PHYSICAL_EXAM
  );
  const [description, setDescription] = useState(requirement?.description ?? '');
  const [frequencyMonths, setFrequencyMonths] = useState<string>(
    requirement?.frequency_months?.toString() ?? '12'
  );
  const [isOneTime, setIsOneTime] = useState(!requirement?.frequency_months);
  const [appliesTo, setAppliesTo] = useState(
    requirement?.applies_to_roles?.join(', ') ?? ''
  );
  const [isActive, setIsActive] = useState(requirement?.is_active ?? true);
  const [gracePeriodDays, setGracePeriodDays] = useState<string>(
    requirement?.grace_period_days?.toString() ?? '30'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!isOneTime && (!frequencyMonths || Number(frequencyMonths) < 1)) {
      newErrors.frequency = 'Frequency must be at least 1 month';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSaving(true);
    const roles = appliesTo
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    const data: ScreeningRequirementCreate = {
      name: name.trim(),
      screening_type: screeningType as ScreeningRequirementCreate['screening_type'],
      description: description.trim() || undefined,
      frequency_months: isOneTime ? undefined : Number(frequencyMonths),
      applies_to_roles: roles.length > 0 ? roles : undefined,
      is_active: isActive,
      grace_period_days: Number(gracePeriodDays) || 30,
    };
    await onSave(data);
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
            {requirement ? 'Edit Requirement' : 'Add Screening Requirement'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-6">
          <div>
            <label htmlFor="req-name" className={labelClass}>
              Name *
            </label>
            <input
              id="req-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Annual Physical Exam"
              className={inputClass}
            />
            {errors.name && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="req-type" className={labelClass}>
              Screening Type
            </label>
            <select
              id="req-type"
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
            <label htmlFor="req-desc" className={labelClass}>
              Description
            </label>
            <textarea
              id="req-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the screening requirement..."
              rows={2}
              className={inputClass + ' resize-none'}
            />
          </div>

          <div>
            <label className="text-theme-text-secondary mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isOneTime}
                onChange={(e) => setIsOneTime(e.target.checked)}
                className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
              />
              One-time requirement (not recurring)
            </label>
            {!isOneTime && (
              <div className="mt-2">
                <label htmlFor="req-frequency" className={labelClass}>
                  Frequency (months)
                </label>
                <input
                  id="req-frequency"
                  type="number"
                  min={1}
                  value={frequencyMonths}
                  onChange={(e) => setFrequencyMonths(e.target.value)}
                  className={inputClass + ' w-32'}
                />
                {errors.frequency && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.frequency}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="req-roles" className={labelClass}>
              Applies to Roles (comma-separated)
            </label>
            <input
              id="req-roles"
              type="text"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              placeholder="e.g., firefighter, emt, officer"
              className={inputClass}
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Leave blank to apply to all members.
            </p>
          </div>

          <div>
            <label htmlFor="req-grace" className={labelClass}>
              Grace Period (days past expiration)
            </label>
            <input
              id="req-grace"
              type="number"
              min={0}
              value={gracePeriodDays}
              onChange={(e) => setGracePeriodDays(e.target.value)}
              className={inputClass + ' w-32'}
            />
          </div>

          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
            />
            Active
          </label>

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
              {isSaving ? 'Saving...' : requirement ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
