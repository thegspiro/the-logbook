/**
 * An inline form for suggesting a change to one section of circulated minutes,
 * or to the minutes as a whole when no section is given.
 *
 * For a section it opens the section's own text in the editor: the reviewer
 * edits a copy, and the server works out the tracked changes from the
 * difference. A comment is optional there. For the minutes as a whole there is
 * no text to edit, so it is a comment with optional suggested wording.
 *
 * It sits under the text it is about, so a member comments where the words are
 * instead of picking a section from a list. A suggestion never edits the
 * minutes; the secretary answers it.
 */

import React, { useId, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FormField } from '../../../components/ux/FormField';
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { plainTextToHtml } from '../../../utils/richText';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { minutesService } from '../services/api';

type SuggestField = 'edit' | 'comment' | 'proposed';

/** SuggestionCreate in schemas/minute.py (snake_case). */
const SUGGEST_FIELDS: Record<SuggestField, ServerFieldSpec> = {
  edit: { label: 'Your edit', api: 'proposed_html' },
  comment: { label: 'Comment', maxLength: 2000 },
  proposed: { label: 'Suggested wording', maxLength: 10000, api: 'proposed_text' },
};

interface SuggestChangeFormProps {
  minutesId: string;
  /** The section the suggestion is about; none means the minutes as a whole. */
  sectionKey?: string | undefined;
  /** What the suggestion is about, for the form's accessible name. */
  subject: string;
  /** The section's text, to be edited; given for a section, absent for the whole. */
  original?: { content: string; format?: 'text' | 'html' | undefined } | undefined;
  onSent: () => Promise<void> | void;
  onCancel: () => void;
}

export const SuggestChangeForm: React.FC<SuggestChangeFormProps> = ({
  minutesId,
  sectionKey,
  subject,
  original,
  onSent,
  onCancel,
}) => {
  const id = useId();
  const originalContent = original?.content;
  const originalFormat = original?.format;
  const initialHtml = useMemo(() => {
    if (originalContent === undefined) return '';
    return originalFormat === 'html' ? originalContent : plainTextToHtml(originalContent);
  }, [originalContent, originalFormat]);
  const [html, setHtml] = useState(initialHtml);
  const [comment, setComment] = useState('');
  const [proposed, setProposed] = useState('');
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SuggestField, string | undefined>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const editing = original !== undefined;
  const edited = editing && html !== initialHtml;
  const canSend = edited || comment.trim().length >= 3;

  // Inline rather than a dialog, but Cancel still throws typed words away, so
  // it asks first when there are any.
  const requestCancel = useDiscardGuard({
    isDirty: edited || comment.trim() !== '' || proposed.trim() !== '',
    onClose: onCancel,
  });

  const fieldId = (field: SuggestField) => `${id}-${field}`;
  const showErrors = (next: Partial<Record<SuggestField, string>>) => {
    setErrors(next);
    const first = (['edit', 'comment', 'proposed'] as const).find((field) => next[field]);
    if (first && first !== 'edit') window.setTimeout(() => document.getElementById(fieldId(first))?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The server's own rule (SuggestionCreate._says_something), said on the
    // field rather than by a button that will not press.
    if (!canSend) {
      showErrors({
        comment: editing
          ? 'Edit the text, or say in a comment what should change.'
          : 'Say what should change, in at least 3 characters.',
      });
      return;
    }
    setSending(true);
    setErrors({});
    setFormError(null);
    try {
      await minutesService.addSuggestion(minutesId, {
        section_key: sectionKey || undefined,
        comment: comment.trim() || undefined,
        proposed_text: editing ? undefined : proposed.trim() || undefined,
        proposed_html: edited ? html : undefined,
      });
      toast.success('Suggestion sent to the secretary');
      await onSent();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, SUGGEST_FIELDS);
      if (mapped) {
        showErrors(mapped.fieldErrors);
        if (mapped.unmatched.length) setFormError(mapped.unmatched.join(' '));
      } else {
        toast.error(getErrorMessage(err, 'Failed to send the suggestion'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={`Suggest a change to ${subject}`}
      className="border-theme-surface-border mt-3 space-y-3 rounded-lg border p-3"
    >
      {formError && (
        <p role="alert" className="alert-danger text-theme-text-primary text-sm">
          {formError}
        </p>
      )}
      {editing && (
        <div>
          <p className="form-label" id={`${id}-edit-label`}>
            Edit the text. Your changes are shown to the secretary as tracked changes.
          </p>
          <RichTextEditor
            id={fieldId('edit')}
            value={initialHtml}
            onChange={(next) => {
              setHtml(next);
              setErrors((prev) => ({ ...prev, edit: undefined, comment: undefined }));
            }}
            label={`Your edit of ${subject}`}
          />
          {errors.edit && (
            <p role="alert" className="mt-1 text-sm text-red-800 dark:text-red-300">
              {errors.edit}
            </p>
          )}
        </div>
      )}
      <FormField
        label={editing ? 'Comment' : 'What should change?'}
        optional={editing}
        required={!editing}
        id={fieldId('comment')}
        error={errors.comment}
        maxLength={2000}
        count={comment.length}
      >
        {(field) => (
          <textarea
            {...field}
            rows={3}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setErrors((prev) => ({ ...prev, comment: undefined }));
            }}
            className="form-input"
          />
        )}
      </FormField>
      {!editing && (
        <FormField
          label="Suggested wording"
          optional
          id={fieldId('proposed')}
          error={errors.proposed}
          maxLength={10000}
          count={proposed.length}
        >
          {(field) => (
            <textarea
              {...field}
              rows={3}
              value={proposed}
              onChange={(e) => {
                setProposed(e.target.value);
                setErrors((prev) => ({ ...prev, proposed: undefined }));
              }}
              className="form-input"
            />
          )}
        </FormField>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={sending} className="btn-primary touch:min-h-11">
          {sending ? 'Sending…' : 'Send suggestion'}
        </button>
        <button type="button" onClick={requestCancel} disabled={sending} className="btn-secondary touch:min-h-11">
          Cancel
        </button>
      </div>
    </form>
  );
};

export default SuggestChangeForm;
