import React from 'react';
import { Modal } from '../Modal';

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
    <Modal
      isOpen
      onClose={onClose}
      title="Save as Template"
      titleId="save-template-modal-title"
      onSubmit={onSubmit}
      footer={
        <>
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
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </>
      }
    >
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
            className="form-input"
            placeholder="e.g., Weekly Business Meeting"
          />
        </div>
        <div>
          <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Description (optional)</label>
          <textarea
            value={templateDescription}
            onChange={(e) => onTemplateDescriptionChange(e.target.value)}
            rows={3}
            className="form-input"
            placeholder="Brief description of this template..."
          />
        </div>
      </div>
    </Modal>
  );
};

export default EventSaveTemplateModal;
