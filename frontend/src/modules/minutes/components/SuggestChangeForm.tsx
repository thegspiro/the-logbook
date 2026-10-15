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
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { getErrorMessage } from '../../../utils/errorHandling';
import { plainTextToHtml } from '../../../utils/richText';
import { minutesService } from '../services/api';

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

  const editing = original !== undefined;
  const edited = editing && html !== initialHtml;
  const canSend = edited || comment.trim().length >= 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
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
      toast.error(getErrorMessage(err, 'Failed to send the suggestion'));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      aria-label={`Suggest a change to ${subject}`}
      className="border-theme-surface-border mt-3 space-y-3 rounded-lg border p-3"
    >
      {editing && (
        <div>
          <p className="form-label" id={`${id}-edit-label`}>
            Edit the text. Your changes are shown to the secretary as tracked changes.
          </p>
          <RichTextEditor id={`${id}-edit`} value={initialHtml} onChange={setHtml} label={`Your edit of ${subject}`} />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-comment`} className="form-label">
          {editing ? 'Comment (optional)' : 'What should change?'}
        </label>
        <textarea
          id={`${id}-comment`}
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="form-input"
        />
      </div>
      {!editing && (
        <div>
          <label htmlFor={`${id}-proposed`} className="form-label">
            Suggested wording (optional)
          </label>
          <textarea
            id={`${id}-proposed`}
            rows={3}
            maxLength={10000}
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            className="form-input"
          />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={sending || !canSend} className="btn-primary touch:min-h-11">
          {sending ? 'Sending…' : 'Send suggestion'}
        </button>
        <button type="button" onClick={onCancel} disabled={sending} className="btn-secondary touch:min-h-11">
          Cancel
        </button>
      </div>
    </form>
  );
};

export default SuggestChangeForm;
