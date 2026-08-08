import React from 'react';

interface EventSaveTemplateModalProps {
  templateName: string;
  onTemplateNameChange: (name: string) => void;
  templateDescription: string;
  onTemplateDescriptionChange: (description: string) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const EventSaveTemplateModal: React.FC<EventSaveTemplateModalProps> = ({
  templateName,
  onTemplateNameChange,
  templateDescription,
  onTemplateDescriptionChange,
  submitting,
  onSubmit,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
              <h3 id="save-template-modal-title" className="text-theme-text-primary mb-4 text-lg leading-6 font-medium">
                Save as Template
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                    Template Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={templateName}
                    onChange={(e) => onTemplateNameChange(e.target.value)}
                    className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    placeholder="e.g., Weekly Business Meeting"
                  />
                </div>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                    Description (optional)
                  </label>
                  <textarea
                    value={templateDescription}
                    onChange={(e) => onTemplateDescriptionChange(e.target.value)}
                    rows={3}
                    className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    placeholder="Brief description of this template..."
                  />
                </div>
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                type="submit"
                disabled={submitting || !templateName.trim()}
                className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium disabled:opacity-50 sm:ml-3 sm:w-auto sm:text-sm"
              >
                {submitting ? 'Saving...' : 'Save Template'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring mt-3 inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EventSaveTemplateModal;
