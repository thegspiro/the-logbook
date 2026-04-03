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
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
              <h3 id="save-template-modal-title" className="text-lg leading-6 font-medium text-theme-text-primary mb-4">
                Save as Template
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Template Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={templateName}
                    onChange={(e) => onTemplateNameChange(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    placeholder="e.g., Weekly Business Meeting"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={templateDescription}
                    onChange={(e) => onTemplateDescriptionChange(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    placeholder="Brief description of this template..."
                  />
                </div>
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting || !templateName.trim()}
                className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Template'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
