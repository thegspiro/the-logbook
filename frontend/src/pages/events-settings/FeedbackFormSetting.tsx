/**
 * Which form asks a requester for feedback once their request is Completed,
 * and which of its questions is the rating the report averages.
 *
 * The questions themselves, branches included, are built in Forms; this only
 * chooses among the department's published forms. The starter form is a
 * shortcut to a sensible first one, with its rating already chosen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { MessageSquare } from 'lucide-react';
import { outreachFeedbackService } from '../../services/outreachFeedbackServices';
import type { FeedbackFormOption, RequestPipelineSettings } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';

interface Props {
  pipeline: RequestPipelineSettings;
  saving: boolean;
  onSave: (patch: Partial<RequestPipelineSettings>) => void;
}

const FeedbackFormSetting: React.FC<Props> = ({ pipeline, saving, onSave }) => {
  const [options, setOptions] = useState<FeedbackFormOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setOptions(await outreachFeedbackService.getFeedbackFormOptions());
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'The forms could not be loaded'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const formId = pipeline.feedback_form_id ?? '';
  const ratingId = pipeline.feedback_rating_field_id ?? '';
  const chosen = options?.find((o) => o.id === formId);

  const createStarter = async () => {
    setCreating(true);
    try {
      const made = await outreachFeedbackService.createStarterFeedbackForm();
      await load();
      // The server already saved the choice; mirror it so the screen agrees.
      onSave({ feedback_form_id: made.form_id, feedback_rating_field_id: made.rating_field_id });
      toast.success(`"${made.form_name}" is now your feedback form`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The starter form could not be created'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="border-theme-surface-border border-t py-3">
      <div className="mb-1 flex items-center gap-2">
        <MessageSquare className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <p className="text-theme-text-primary text-sm font-medium">Feedback From Requesters</p>
      </div>
      <p className="text-theme-text-muted mb-3 text-xs">
        Once a request is Completed, its status page asks the requester these questions, and the Completed email links
        to them. Build or change the questions, and the branches between them, in{' '}
        <Link to="/forms" className="text-blue-700 underline dark:text-blue-400">
          Forms
        </Link>
        . Each requester can answer once.
      </p>

      {loadError ? (
        <div className="text-sm" role="alert">
          <p className="text-theme-text-secondary">{loadError}</p>
          <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="feedback-form" className="form-label">
              Feedback form
            </label>
            <select
              id="feedback-form"
              className="form-input"
              value={formId}
              disabled={saving || options === null}
              // A different form cannot keep the last one's rating question.
              onChange={(e) => onSave({ feedback_form_id: e.target.value || null, feedback_rating_field_id: null })}
            >
              <option value="">Do not ask for feedback</option>
              {(options ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="feedback-rating" className="form-label">
              Rating question
            </label>
            <select
              id="feedback-rating"
              className="form-input"
              value={ratingId}
              disabled={saving || !chosen}
              onChange={(e) => onSave({ feedback_rating_field_id: e.target.value || null })}
            >
              <option value="">No rating</option>
              {(chosen?.rating_fields ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            {chosen && chosen.rating_fields.length === 0 && (
              <p className="text-theme-text-muted mt-1 text-xs">
                This form has no number question, or choice whose options are whole numbers, to use as a rating.
              </p>
            )}
          </div>
        </div>
      )}

      {!formId && !loadError && (
        <button
          type="button"
          className="btn-secondary btn-sm mt-3"
          disabled={saving || creating}
          onClick={() => void createStarter()}
        >
          {creating ? 'Creating…' : 'Create the starter feedback form'}
        </button>
      )}
    </div>
  );
};

export default FeedbackFormSetting;
