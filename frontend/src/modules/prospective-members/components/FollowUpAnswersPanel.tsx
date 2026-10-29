/**
 * Follow-up Answers Panel
 *
 * The answers an applicant gave on their submitted follow-up forms, for the
 * Interview page. A sensitive answer is shown only to a viewer the backend
 * reveals it to (sensitive_answers.view, audit-logged); anyone else sees that
 * it was withheld rather than a blank that reads as "not answered".
 * Renders nothing for an applicant with no submitted form.
 */

import React, { useEffect, useState } from 'react';
import { ClipboardPen, Loader2, Lock } from 'lucide-react';
import type { FollowUpAnswers } from '../types';
import { FollowUpFormStatus } from '../types';
import { followUpFormService } from '../services/api';
import { formatDateTime } from '../../../utils/dateFormatting';

interface FollowUpAnswersPanelProps {
  applicantId: string;
  timezone: string;
}

const FollowUpAnswersPanel: React.FC<FollowUpAnswersPanelProps> = ({ applicantId, timezone }) => {
  const [forms, setForms] = useState<FollowUpAnswers[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const load = async () => {
      const requests = await followUpFormService.list(applicantId);
      const submitted = requests.filter((r) => r.status === FollowUpFormStatus.SUBMITTED);
      return Promise.all(submitted.map((r) => followUpFormService.getAnswers(applicantId, r.id)));
    };
    load()
      .then((loaded) => {
        if (!cancelled) setForms(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicantId]);

  if (loading) {
    return (
      <div className="card flex items-center justify-center p-4" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading follow-up form answers</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="card p-4">
        <p className="alert-danger text-sm" role="alert">
          The follow-up form answers could not be loaded.
        </p>
      </div>
    );
  }

  if (forms.length === 0) return null;

  return (
    <section className="card p-4" aria-labelledby="follow-up-answers-heading">
      <h3
        id="follow-up-answers-heading"
        className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold"
      >
        <ClipboardPen className="text-theme-text-secondary h-4 w-4" aria-hidden="true" />
        Follow-up Forms
      </h3>
      <div className="space-y-4">
        {forms.map((form) => (
          <div key={form.request_id} className="card-secondary p-3">
            <p className="text-theme-text-primary text-sm font-medium">
              {form.form_name ?? 'Form no longer available'}
            </p>
            <p className="text-theme-text-muted mb-2 text-xs">
              {form.step_name ? `Stage: ${form.step_name}` : null}
              {form.step_name && form.submitted_at ? ' · ' : null}
              {form.submitted_at ? `Submitted ${formatDateTime(form.submitted_at, timezone)}` : null}
            </p>
            {form.answers.length === 0 ? (
              <p className="text-theme-text-muted text-xs">No answers were recorded.</p>
            ) : (
              <dl className="space-y-2">
                {form.answers.map((answer) => (
                  <div key={answer.field_id}>
                    <dt className="text-theme-text-secondary flex items-center gap-1.5 text-xs font-medium">
                      {answer.label}
                      {answer.is_sensitive && (
                        <span className="badge bg-amber-500/15 text-amber-800 dark:text-amber-300">Sensitive</span>
                      )}
                    </dt>
                    <dd className="text-theme-text-primary text-sm wrap-break-word whitespace-pre-line">
                      {answer.withheld ? (
                        <span className="text-theme-text-muted inline-flex items-center gap-1 italic">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Withheld: you do not have permission to view sensitive answers
                        </span>
                      ) : (
                        answer.answer || <span className="text-theme-text-muted">(no answer)</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default FollowUpAnswersPanel;
