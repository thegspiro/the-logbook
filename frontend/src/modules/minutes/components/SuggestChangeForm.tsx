/**
 * An inline form for suggesting a change to one section of circulated minutes,
 * or to the minutes as a whole when no section is given.
 *
 * It sits under the text it is about, so a member comments where the words are
 * instead of picking a section from a list. A suggestion never edits the
 * minutes; the secretary answers it.
 */

import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';

interface SuggestChangeFormProps {
  minutesId: string;
  /** The section the suggestion is about; none means the minutes as a whole. */
  sectionKey?: string | undefined;
  /** What the suggestion is about, for the form's accessible name. */
  subject: string;
  onSent: () => Promise<void> | void;
  onCancel: () => void;
}

export const SuggestChangeForm: React.FC<SuggestChangeFormProps> = ({
  minutesId,
  sectionKey,
  subject,
  onSent,
  onCancel,
}) => {
  const id = useId();
  const [comment, setComment] = useState('');
  const [proposed, setProposed] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (comment.trim().length < 3) return;
    setSending(true);
    try {
      await minutesService.addSuggestion(minutesId, {
        section_key: sectionKey || undefined,
        comment: comment.trim(),
        proposed_text: proposed.trim() || undefined,
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
      <div>
        <label htmlFor={`${id}-comment`} className="form-label">
          What should change?
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
      <div className="flex gap-2">
        <button type="submit" disabled={sending || comment.trim().length < 3} className="btn-primary touch:min-h-11">
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
