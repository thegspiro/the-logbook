import React, { useEffect, useState } from 'react';

import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import LegalMarkup from '../../../pages/legal/LegalMarkup';
import { LEGAL_DOCUMENT_LABEL, type LegalDocumentType } from '../types/legal';

interface RevisionDraftValues {
  body: string;
  changeNote: string;
  effectiveDate: string;
}

type RevisionField = keyof RevisionDraftValues;

export interface RevisionSaveOptions {
  /**
   * Fields to leave out of an edit, so the draft keeps their stored values.
   * The page keeps the editor open when any are given: the fields stay
   * flagged until fixed (owner rule of 2026-11-05).
   */
  omit?: readonly RevisionField[] | undefined;
}

/** LegalRevisionCreate / Update in schemas/legal.py; requests are camelCase (to_camel). */
const REVISION_FIELDS: Record<RevisionField, ServerFieldSpec> = {
  body: { label: 'Document text', maxLength: 100_000 },
  changeNote: { label: 'Change note', maxLength: 2000 },
  effectiveDate: { label: 'Effective date', maxLength: 64 },
};

/** In the order they appear, so the first failing one takes focus. */
const REVISION_FIELD_IDS: Record<RevisionField, string> = {
  body: 'revision-body',
  changeNote: 'revision-note',
  effectiveDate: 'revision-date',
};

interface RevisionEditorModalProps {
  isOpen: boolean;
  documentType: LegalDocumentType;
  /** Set when editing an existing draft; absent when proposing a new one. */
  editingRevisionId?: string | undefined;
  initialValues: RevisionDraftValues;
  isSaving: boolean;
  onCancel: () => void;
  /** Rejects with a 422 for the editor to put on its fields; reports other failures itself. */
  onSave: (values: RevisionDraftValues, options?: RevisionSaveOptions) => Promise<void>;
}

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
  const [errors, setErrors] = useState<Partial<Record<RevisionField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState(false);
  const setField = (field: RevisionField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Anything changed from what the editor opened with is unsaved work, so
  // Escape, the X and Cancel ask first (forms review F-6).
  const isDirty =
    values.body !== initialValues.body ||
    values.changeNote !== initialValues.changeNote ||
    values.effectiveDate !== initialValues.effectiveDate;
  const requestCancel = useDiscardGuard({ isDirty, onClose: onCancel });

  const showErrors = (next: Partial<Record<RevisionField, string>>) => {
    setErrors(next);
    const first = (Object.keys(REVISION_FIELD_IDS) as RevisionField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(REVISION_FIELD_IDS[first])?.focus(), 0);
  };

  // Reseed whenever the modal opens: a body typed for the privacy notice must
  // not survive into a proposal against the terms.
  useEffect(() => {
    if (isOpen) {
      setValues(initialValues);
      setErrors({});
      setFormError(null);
      setSavedExcept(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingRevisionId, documentType]);

  /**
   * Saves the draft under the owner's rule of 2026-11-05. Editing a draft
   * saves whatever can be stored: a field this editor or the server refuses
   * is left out, keeping its stored value, and stays flagged with the editor
   * open. A new proposal cannot be stored at all without its text and change
   * note (the server requires both), so it is refused on those fields.
   */
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let refused: Partial<Record<RevisionField, string>> = {};
    if (!values.body.trim()) refused.body = 'Enter the document text.';
    if (!values.changeNote.trim()) refused.changeNote = 'Say what this revision changes and why.';
    if (!editingRevisionId && Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    setErrors({});
    setFormError(null);
    setSavedExcept(false);
    const trimmed = {
      body: values.body.trim(),
      changeNote: values.changeNote.trim(),
      effectiveDate: values.effectiveDate.trim(),
    };
    const save = () => {
      const omit = Object.keys(refused) as RevisionField[];
      return omit.length ? onSave(trimmed, { omit }) : onSave(trimmed);
    };
    try {
      try {
        await save();
      } catch (err: unknown) {
        const mapped = mapServerFieldErrors(err, REVISION_FIELDS);
        if (!mapped) throw err;
        refused = { ...refused, ...mapped.fieldErrors };
        showErrors(refused);
        setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
        if (!editingRevisionId || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) {
          return;
        }
        await save();
      }
      if (Object.keys(refused).length > 0) {
        showErrors(refused);
        setSavedExcept(true);
      }
    } catch {
      // The page has already said why; the editor keeps what was typed.
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestCancel}
      title={`${editingRevisionId ? 'Edit' : 'Propose'} a ${LEGAL_DOCUMENT_LABEL[documentType]} revision`}
      size="xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-icon px-4" onClick={requestCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" form="revision-editor-form" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      }
    >
      <form id="revision-editor-form" noValidate onSubmit={(e) => void handleSave(e)} className="space-y-4">
        {savedExcept && (
          <p role="status" className="alert-warning text-theme-text-primary text-sm">
            Draft saved, except the field flagged below, which keeps its stored value. Fix it and save again.
          </p>
        )}
        <p className="alert-info text-sm">
          Saving stores this as a draft. The public {LEGAL_DOCUMENT_LABEL[documentType]} does not change until someone
          with publishing rights publishes it.
        </p>

        <div>
          <FormField
            label="Document text"
            required
            error={errors.body}
            id="revision-body"
            maxLength={REVISION_FIELDS.body.maxLength}
            count={values.body.length}
            hint={
              <>
                Leave a blank line between paragraphs. Start a line with <code>## </code> for a heading,
                <code>### </code> for a smaller one, <code>- </code> for a bulleted list item, or <code>1. </code> for a
                numbered one. Nothing else is formatted: links, bold and HTML appear exactly as typed.
              </>
            }
          >
            {(field) => (
              <textarea
                {...field}
                className={`${inputClass} min-h-[24rem] font-mono text-xs leading-5`}
                value={values.body}
                onChange={(e) => setField('body', e.target.value)}
              />
            )}
          </FormField>
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

        <FormField
          label="What does this change, and why?"
          required
          error={errors.changeNote}
          id="revision-note"
          maxLength={REVISION_FIELDS.changeNote.maxLength}
          count={values.changeNote.length}
          hint="Name the bylaw, SOP, statute, or counsel advice behind the wording. This is kept with the revision and is what a future officer — or a records request — reads to understand the change."
        >
          {(field) => (
            <textarea
              {...field}
              className={`${inputClass} min-h-24`}
              value={values.changeNote}
              onChange={(e) => setField('changeNote', e.target.value)}
              placeholder="e.g. Adds the retention period required by our state records schedule (Art. IV of the bylaws)."
            />
          )}
        </FormField>

        <FormField
          label="Effective date shown to members (optional)"
          error={errors.effectiveDate}
          id="revision-date"
          maxLength={REVISION_FIELDS.effectiveDate.maxLength}
          count={values.effectiveDate.length}
          hint="Printed as “Last updated” at the top of the public page. Free text, so it can match however your department dates its policies."
        >
          {(field) => (
            <input
              {...field}
              type="text"
              autoComplete="off"
              className={`${inputClass} w-60`}
              value={values.effectiveDate}
              onChange={(e) => setField('effectiveDate', e.target.value)}
              placeholder="e.g. March 3, 2026"
            />
          )}
        </FormField>

        {formError ? (
          <p className="alert-danger text-sm" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
};

export default RevisionEditorModal;
