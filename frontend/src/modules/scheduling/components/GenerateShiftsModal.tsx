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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="generate-modal-title" className="text-xl font-bold text-theme-text-primary">Generate Shifts</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleGenerate(e); }} className="p-6 space-y-4">
          <div className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
            <p className="text-sm text-theme-text-muted">Pattern</p>
            <p className="text-theme-text-primary font-medium">{pattern.name}</p>
            <p className="text-xs text-theme-text-muted mt-1">
              Type: {PATTERN_TYPES.find(pt => pt.value === pattern.pattern_type)?.label || pattern.pattern_type}
              {pattern.days_on && pattern.days_off && ` (${pattern.days_on} on / ${pattern.days_off} off)`}
            </p>
          </div>

          <div>
            <label htmlFor="generate-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Start Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              required
            />
          </div>

          <div>
            <label htmlFor="generate-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
              End Date <span aria-hidden="true">*</span>
            </label>
            <input
              id="generate-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="btn-primary flex gap-2 items-center px-6"
            >
              {isGenerating ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4" aria-hidden="true" />
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
