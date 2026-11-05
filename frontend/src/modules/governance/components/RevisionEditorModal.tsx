import React, { useEffect, useState } from 'react';

import { Modal } from '../../../components/Modal';
import LegalMarkup from '../../../pages/legal/LegalMarkup';
import { LEGAL_DOCUMENT_LABEL, type LegalDocumentType } from '../types/legal';

interface RevisionDraftValues {
  body: string;
  changeNote: string;
  effectiveDate: string;
}

interface RevisionEditorModalProps {
  isOpen: boolean;
  documentType: LegalDocumentType;
  /** Set when editing an existing draft; absent when proposing a new one. */
  editingRevisionId?: string | undefined;
  initialValues: RevisionDraftValues;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (values: RevisionDraftValues) => Promise<void>;
}

const labelClass = 'form-label';
const inputClass = 'form-input';

/**
 * Editor for a proposed revision to a public legal document.
 *
 * The body is text with a small formatting subset — headings and lists, and
 * nothing else (pages/legal/legalMarkup.ts) — because that is exactly what the
 * public page renders. Rich text or HTML here would promise formatting the
 * published page refuses to apply; the preview below shows what it will.
 */
export const RevisionEditorModal: React.FC<RevisionEditorModalProps> = ({
  isOpen,
  documentType,
  editingRevisionId,
  initialValues,
  isSaving,
  onCancel,
  onSave,
}) => {
  const [values, setValues] = useState<RevisionDraftValues>(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reseed whenever the modal opens: a body typed for the privacy notice must
  // not survive into a proposal against the terms.
  useEffect(() => {
    if (isOpen) {
      setValues(initialValues);
      setValidationError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingRevisionId, documentType]);

  const handleSave = async () => {
    if (!values.body.trim()) {
      setValidationError('Enter the document text.');
      return;
    }
    if (!values.changeNote.trim()) {
      setValidationError('Say what this revision changes and why.');
      return;
    }
    setValidationError(null);
    await onSave({
      body: values.body.trim(),
      changeNote: values.changeNote.trim(),
      effectiveDate: values.effectiveDate.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={`${editingRevisionId ? 'Edit' : 'Propose'} a ${LEGAL_DOCUMENT_LABEL[documentType]} revision`}
      size="xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-icon px-4" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="alert-info text-sm">
          Saving stores this as a draft. The public {LEGAL_DOCUMENT_LABEL[documentType]} does not change until someone
          with publishing rights publishes it.
        </p>

        <div>
          <label className={labelClass} htmlFor="revision-body">
            Document text
          </label>
          <p id="revision-body-help" className="text-theme-text-muted mb-2 text-xs">
            Leave a blank line between paragraphs. Start a line with <code>## </code> for a heading,
            <code>### </code> for a smaller one, <code>- </code> for a bulleted list item, or <code>1. </code> for a
            numbered one. Nothing else is formatted: links, bold and HTML appear exactly as typed.
          </p>
          <textarea
            id="revision-body"
            className={`${inputClass} min-h-[24rem] font-mono text-xs leading-5`}
            value={values.body}
            aria-describedby="revision-body-help"
            onChange={(e) => setValues({ ...values, body: e.target.value })}
          />
          <details className="mt-2">
            <summary className="text-theme-accent-red touch:py-3 cursor-pointer text-sm font-medium">
              Preview as members will see it
            </summary>
            <LegalMarkup
              text={values.body}
              headingLevel={3}
              className="bg-theme-surface-secondary mt-2 max-h-96 overflow-auto rounded-md px-4 pb-4"
            />
          </details>
        </div>

        <div>
          <label className={labelClass} htmlFor="revision-note">
            What does this change, and why?
          </label>
          <p className="text-theme-text-muted mb-2 text-xs">
            Name the bylaw, SOP, statute, or counsel advice behind the wording. This is kept with the revision and is
            what a future officer — or a records request — reads to understand the change.
          </p>
          <textarea
            id="revision-note"
            className={`${inputClass} min-h-24`}
            value={values.changeNote}
            onChange={(e) => setValues({ ...values, changeNote: e.target.value })}
            placeholder="e.g. Adds the retention period required by our state records schedule (Art. IV of the bylaws)."
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="revision-date">
            Effective date shown to members (optional)
          </label>
          <input
            id="revision-date"
            className={`${inputClass} w-60`}
            value={values.effectiveDate}
            onChange={(e) => setValues({ ...values, effectiveDate: e.target.value })}
            placeholder="e.g. March 3, 2026"
          />
          <p className="text-theme-text-muted mt-2 text-xs">
            Printed as &ldquo;Last updated&rdquo; at the top of the public page. Free text, so it can match however your
            department dates its policies.
          </p>
        </div>

        {validationError ? (
          <p className="alert-danger text-sm" role="alert">
            {validationError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};

export default RevisionEditorModal;
