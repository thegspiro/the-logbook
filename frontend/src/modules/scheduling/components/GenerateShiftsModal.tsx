import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { X, RefreshCw, Play } from 'lucide-react';
import { schedulingService } from '../services/api';
import type { ShiftPattern } from './shiftTemplateTypes';
import { PATTERN_TYPES } from './shiftTemplateTypes';

interface GenerateShiftsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pattern: ShiftPattern | null;
}

const GenerateShiftsModal: React.FC<GenerateShiftsModalProps> = ({ isOpen, onClose, pattern }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStartDate('');
      setEndDate('');
    }
  }, [isOpen]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern) return;
    setIsGenerating(true);
    try {
      const result = await schedulingService.generateShiftsFromPattern(pattern.id, {
        start_date: startDate,
        end_date: endDate,
      });
      toast.success(`Generated ${String(result.shifts_created)} shifts`);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to generate shifts'));
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen || !pattern) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="generate-modal-title" className="text-theme-text-primary text-xl font-bold">
            Generate Shifts
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleGenerate(e);
          }}
          className="space-y-4 p-6"
        >
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-3">
            <p className="text-theme-text-muted text-sm">Pattern</p>
            <p className="text-theme-text-primary font-medium">{pattern.name}</p>
            <p className="text-theme-text-muted mt-1 text-xs">
              Type: {PATTERN_TYPES.find((pt) => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
              {pattern.days_on && pattern.days_off && ` (${pattern.days_on} on / ${pattern.days_off} off)`}
            </p>
          </div>

          <div>
            <label htmlFor="generate-start" className="form-label">
              Start Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div>
            <label htmlFor="generate-end" className="form-label">
              End Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
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
