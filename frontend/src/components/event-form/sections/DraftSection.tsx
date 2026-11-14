import React from 'react';
import type { EventFormModel } from '../useEventFormModel';

interface DraftSectionProps {
  model: Pick<EventFormModel, 'formData' | 'setIsDraft'>;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

/** Save as draft, and the form's Cancel and submit buttons. */
export const DraftSection: React.FC<DraftSectionProps> = ({ model, onCancel, isSubmitting, submitLabel }) => {
  const { formData, setIsDraft } = model;
  return (
    <div className="border-theme-surface-border flex flex-wrap items-center justify-between gap-3 border-t pt-6">
      <label className="text-theme-text-secondary mobile-touch-target inline-flex cursor-pointer items-center justify-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={formData.is_draft || false}
          onChange={(e) => setIsDraft(e.target.checked)}
          className="form-checkbox"
        />
        Save as Draft
      </label>
      <div className="ml-auto flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary text-theme-text-secondary hover:bg-theme-surface-secondary px-4 py-3 text-sm font-medium focus:ring-offset-2 sm:px-6"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary border border-transparent px-5 py-3 text-sm font-medium disabled:cursor-not-allowed sm:px-8"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
};
