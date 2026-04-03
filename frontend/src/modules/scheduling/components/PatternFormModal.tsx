import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { X } from 'lucide-react';
import type {
  PatternFormData,
  ShiftTemplate,
} from './shiftTemplateTypes';
import {
  PATTERN_TYPES,
  emptyPatternForm,
} from './shiftTemplateTypes';

interface PatternFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: PatternFormData | undefined;
  title: string;
  templates: ShiftTemplate[];
}

const PatternFormModal: React.FC<PatternFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  title,
  templates,
}) => {
  const [formData, setFormData] = useState<PatternFormData>(initialData || emptyPatternForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setFormData(initialData || emptyPatternForm);
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        pattern_type: formData.pattern_type,
        start_date: formData.start_date,
      };
      if (formData.description) payload.description = formData.description;
      if (formData.template_id) payload.template_id = formData.template_id;
      if (formData.rotation_days) payload.rotation_days = parseInt(formData.rotation_days, 10);
      if (formData.days_on) payload.days_on = parseInt(formData.days_on, 10);
      if (formData.days_off) payload.days_off = parseInt(formData.days_off, 10);
      if (formData.end_date) payload.end_date = formData.end_date;
      await onSubmit(payload);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save pattern'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pattern-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="pattern-modal-title" className="text-xl font-bold text-theme-text-primary">{title}</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-4">
          <div>
            <label htmlFor="pattern-name" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="pattern-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              placeholder="e.g., 24/48 Rotation"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="pattern-description" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Description
            </label>
            <textarea
              id="pattern-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              rows={2}
              placeholder="Optional description"
            />
          </div>

          <div>
            <label htmlFor="pattern-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Pattern Type <span aria-hidden="true">*</span>
            </label>
            <select
              id="pattern-type"
              value={formData.pattern_type}
              onChange={(e) => setFormData(prev => ({ ...prev, pattern_type: e.target.value as PatternFormData['pattern_type'] }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              required
            >
              {PATTERN_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label} - {pt.description}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pattern-template" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Shift Template
            </label>
            <select
              id="pattern-template"
              value={formData.template_id}
              onChange={(e) => setFormData(prev => ({ ...prev, template_id: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
            >
              <option value="">No template</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.start_time_of_day} - {t.end_time_of_day})</option>
              ))}
            </select>
          </div>

          {(formData.pattern_type === 'platoon' || formData.pattern_type === 'custom') && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="pattern-rotation" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Rotation Days
                </label>
                <input
                  id="pattern-rotation"
                  type="number"
                  value={formData.rotation_days}
                  onChange={(e) => setFormData(prev => ({ ...prev, rotation_days: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  min="1"
                  placeholder="e.g., 3"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-on" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Days On
                </label>
                <input
                  id="pattern-days-on"
                  type="number"
                  value={formData.days_on}
                  onChange={(e) => setFormData(prev => ({ ...prev, days_on: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  min="1"
                  placeholder="e.g., 1"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-off" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Days Off
                </label>
                <input
                  id="pattern-days-off"
                  type="number"
                  value={formData.days_off}
                  onChange={(e) => setFormData(prev => ({ ...prev, days_off: e.target.value }))}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  min="1"
                  placeholder="e.g., 2"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pattern-start-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Start Date <span aria-hidden="true">*</span>
              </label>
              <input
                id="pattern-start-date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                required
              />
            </div>
            <div>
              <label htmlFor="pattern-end-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
                End Date
              </label>
              <input
                id="pattern-end-date"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              />
            </div>
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
              disabled={isSubmitting}
              className="btn-primary px-6"
            >
              {isSubmitting ? 'Saving...' : 'Save Pattern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatternFormModal;
