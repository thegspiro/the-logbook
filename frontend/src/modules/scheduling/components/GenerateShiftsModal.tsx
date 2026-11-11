import React, { useState, useEffect } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { X, RefreshCw, Play } from 'lucide-react';
import { schedulingService } from '../services/api';
import { reportGeneration } from '../utils/patternGeneration';
import type { ShiftPattern } from './shiftTemplateTypes';
import { PATTERN_TYPES } from './shiftTemplateTypes';

type GenerateField = 'start_date' | 'end_date';

const GENERATE_FIELDS: Record<GenerateField, ServerFieldSpec> = {
  start_date: { label: 'Start date' },
  end_date: { label: 'End date' },
};

const GENERATE_FIELD_IDS: Record<GenerateField, string> = {
  start_date: 'generate-start',
  end_date: 'generate-end',
};

interface GenerateShiftsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pattern: ShiftPattern | null;
}

const GenerateShiftsModal: React.FC<GenerateShiftsModalProps> = ({ isOpen, onClose, pattern }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<GenerateField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const clearError = (field: GenerateField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // A chosen range is unsaved work: Escape, the X and Cancel ask first (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty: Boolean(startDate || endDate), onClose });
  const dialogRef = useDialog<HTMLDivElement>({ isOpen: isOpen, onClose: requestClose });

  useEffect(() => {
    if (isOpen) {
      setStartDate('');
      setEndDate('');
      setErrors({});
      setFormError(null);
    }
  }, [isOpen]);

  const showErrors = (next: Partial<Record<GenerateField, string>>) => {
    setErrors(next);
    const first = (Object.keys(GENERATE_FIELD_IDS) as GenerateField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(GENERATE_FIELD_IDS[first])?.focus(), 0);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern) return;
    const missing: Partial<Record<GenerateField, string>> = {};
    if (!startDate) missing.start_date = 'Choose the first date to generate shifts for.';
    if (!endDate) missing.end_date = 'Choose the last date to generate shifts for.';
    if (Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setFormError(null);
    setIsGenerating(true);
    try {
      const result = await schedulingService.generateShiftsFromPattern(pattern.id, {
        start_date: startDate,
        end_date: endDate,
      });
      reportGeneration(result);
      onClose();
    } catch (err) {
      const mapped = mapServerFieldErrors(err, GENERATE_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to generate shifts'));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen || !pattern) return null;

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-modal-title"
    >
      <div ref={dialogRef} className="modal-panel modal-panel-scroll w-full max-w-md">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="generate-modal-title" className="text-theme-text-primary text-xl font-bold">
            Generate Shifts
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-muted hover:text-theme-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleGenerate(e);
          }}
          noValidate
          className="space-y-4 p-6"
        >
          {formError && (
            <p role="alert" className="alert-danger text-theme-text-primary text-sm">
              {formError}
            </p>
          )}
          <div className="card p-3">
            <p className="text-theme-text-muted text-sm">Pattern</p>
            <p className="text-theme-text-primary font-medium">{pattern.name}</p>
            <p className="text-theme-text-muted mt-1 text-xs">
              Type: {PATTERN_TYPES.find((pt) => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
              {pattern.days_on && pattern.days_off && ` (${pattern.days_on} on / ${pattern.days_off} off)`}
            </p>
          </div>

          <FormField label="Start Date" required error={errors.start_date} id="generate-start">
            {(field) => (
              <input
                {...field}
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  clearError('start_date');
                }}
                className="form-input"
              />
            )}
          </FormField>

          <FormField label="End Date" required error={errors.end_date} id="generate-end">
            {(field) => (
              <input
                {...field}
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  clearError('end_date');
                }}
                className="form-input"
              />
            )}
          </FormField>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
            >
              Cancel
            </button>
            <button type="submit" disabled={isGenerating} className="btn-primary flex items-center gap-2 px-6">
              {isGenerating ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {isGenerating ? 'Generating...' : 'Generate Shifts'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateShiftsModal;
