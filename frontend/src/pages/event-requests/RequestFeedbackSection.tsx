/**
 * The requester's feedback on a completed request, as officers read it.
 *
 * Loads on its own, so the request detail does not wait on it. The answers are
 * the department's feedback form's, question by question; an answer to a
 * question marked Sensitive stays with the submission in Forms and is only
 * counted here.
 */

import React, { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { outreachFeedbackService } from '../../services/outreachFeedbackServices';
import type { EventRequestFeedback } from '../../types/event';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const RequestFeedbackSection: React.FC<{ requestId: string }> = ({ requestId }) => {
  const tz = useTimezone();
  const [feedback, setFeedback] = useState<EventRequestFeedback | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeedback(undefined);
    setError(null);
    outreachFeedbackService
      .getRequestFeedback(requestId)
      .then((result) => {
        if (!cancelled) setFeedback(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'The feedback could not be loaded'));
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  return (
    <section className="border-theme-surface-border border-t pt-4" aria-labelledby={`feedback-${requestId}`}>
      <h3
        id={`feedback-${requestId}`}
        className="text-theme-text-muted mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Requester feedback
      </h3>
      {error ? (
        <p className="text-theme-text-secondary text-sm" role="alert">
          {error}
        </p>
      ) : feedback === undefined ? (
        <p className="text-theme-text-muted text-sm">Loading…</p>
      ) : feedback === null ? (
        <p className="text-theme-text-muted text-sm">The requester has not sent feedback.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-theme-text-secondary">
            {feedback.rating != null && (
              <span className="text-theme-text-primary mr-2 font-semibold">Rated {feedback.rating}</span>
            )}
            Sent {formatDateTime(feedback.submitted_at, tz)}
            {feedback.form_name ? ` · ${feedback.form_name}` : ''}
          </p>
          {feedback.answers.length > 0 && (
            <dl className="space-y-2">
              {feedback.answers.map((a) => (
                <div key={a.question}>
                  <dt className="text-theme-text-muted text-xs">{a.question}</dt>
                  <dd className="text-theme-text-primary whitespace-pre-wrap">{a.answer}</dd>
                </div>
              ))}
            </dl>
          )}
          {feedback.sensitive_answers > 0 && (
            <p className="text-theme-text-muted text-xs">
              {feedback.sensitive_answers} {feedback.sensitive_answers === 1 ? 'answer is' : 'answers are'} to a
              question marked Sensitive and can be read with the submission in Forms.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default RequestFeedbackSection;
