import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { X } from 'lucide-react';
import type { PatternFormData, ShiftTemplate } from './shiftTemplateTypes';
import { PATTERN_TYPES, emptyPatternForm } from './shiftTemplateTypes';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pattern-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg">
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="pattern-modal-title" className="text-theme-text-primary text-xl font-bold">
            {title}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 p-6"
        >
          <div>
            <label htmlFor="pattern-name" className="form-label">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="pattern-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="form-input"
              placeholder="e.g., 24/48 Rotation"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="pattern-description" className="form-label">
              Description
            </label>
            <textarea
              id="pattern-description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className="form-input"
              rows={2}
              placeholder="Optional description"
            />
          </div>

          <div>
            <label htmlFor="pattern-type" className="form-label">
              Pattern Type <span aria-hidden="true">*</span>
            </label>
            <select
              id="pattern-type"
              value={formData.pattern_type}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, pattern_type: e.target.value as PatternFormData['pattern_type'] }))
              }
              className="form-input"
              required
            >
              {PATTERN_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>
                  {pt.label} - {pt.description}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pattern-template" className="form-label">
              Shift Template
            </label>
            <select
              id="pattern-template"
              value={formData.template_id}
              onChange={(e) => setFormData((prev) => ({ ...prev, template_id: e.target.value }))}
              className="form-input"
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.start_time_of_day} - {t.end_time_of_day})
                </option>
              ))}
            </select>
          </div>

          {(formData.pattern_type === 'platoon' || formData.pattern_type === 'custom') && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="pattern-rotation" className="form-label">
                  Rotation Days
                </label>
                <input
                  id="pattern-rotation"
                  type="number"
                  value={formData.rotation_days}
                  onChange={(e) => setFormData((prev) => ({ ...prev, rotation_days: e.target.value }))}
                  className="form-input"
                  min="1"
                  placeholder="e.g., 3"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-on" className="form-label">
                  Days On
                </label>
                <input
                  id="pattern-days-on"
                  type="number"
                  value={formData.days_on}
                  onChange={(e) => setFormData((prev) => ({ ...prev, days_on: e.target.value }))}
                  className="form-input"
                  min="1"
                  placeholder="e.g., 1"
                />
              </div>
              <div>
                <label htmlFor="pattern-days-off" className="form-label">
                  Days Off
                </label>
                <input
                  id="pattern-days-off"
                  type="number"
                  value={formData.days_off}
                  onChange={(e) => setFormData((prev) => ({ ...prev, days_off: e.target.value }))}
                  className="form-input"
                  min="1"
                  placeholder="e.g., 2"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pattern-start-date" className="form-label">
                Start Date <span aria-hidden="true">*</span>
              </label>
              <input
                id="pattern-start-date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                className="form-input"
                required
              />
            </div>
            <div>
              <label htmlFor="pattern-end-date" className="form-label">
                End Date
              </label>
              <input
                id="pattern-end-date"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData((prev) => ({ ...prev, end_date: e.target.value }))}
                className="form-input"
              />
            </div>
          </div>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn-primary px-6">
              {isSubmitting ? 'Saving...' : 'Save Pattern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatternFormModal;
