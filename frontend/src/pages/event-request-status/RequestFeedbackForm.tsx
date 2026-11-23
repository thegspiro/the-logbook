/**
 * The department's feedback form, on a completed request's status page.
 *
 * The questions are the department's own form from Forms, branches included:
 * a question shows only while the answer it depends on matches, by the same
 * rule the server applies when it checks the submission (utils/formVisibility
 * mirrors FormsService). One response per request, final once sent.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import FieldRenderer from '../../components/forms/FieldRenderer';
import { toFieldDefinition } from '../../components/forms/publicFormFields';
import { eventRequestService } from '../../services/api';
import type { PublicFeedbackForm } from '../../types/event';
import { getVisibleFieldIds } from '../../utils/formVisibility';
import { getErrorMessage, toAppError } from '../../utils/errorHandling';
import { FieldType } from '../../constants/enums';

interface Props {
  token: string;
  /** Called once the response is stored, or found already stored. */
  onSent: () => void;
}

const RequestFeedbackForm: React.FC<Props> = ({ token, onSent }) => {
  const [form, setForm] = useState<PublicFeedbackForm | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    eventRequestService
      .getPublicFeedbackForm(token)
      .then((result) => {
        if (!cancelled) setForm(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (toAppError(err).status === 409) onSent();
        else setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, onSent]);

  const fields = useMemo(
    () => (form ? [...form.fields].sort((a, b) => a.sort_order - b.sort_order).map(toFieldDefinition) : []),
    [form]
  );
  const visibleIds = useMemo(() => getVisibleFieldIds(fields, values), [fields, values]);

  const handleChange = (fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setFieldErrors((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setFormError(null);
    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.field_type === FieldType.SECTION_HEADER || !visibleIds.has(field.id)) continue;
      if (field.required && !(values[field.id] ?? '').trim()) errors[field.id] = `${field.label} is required`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError('Some answers need attention before your feedback can be sent.');
      return;
    }
    // Only what is showing is sent: an answer to a question its branch has
    // since hidden is not part of the response.
    const answers = Object.fromEntries(Object.entries(values).filter(([id]) => visibleIds.has(id)));
    setSending(true);
    try {
      await eventRequestService.sendPublicFeedback(token, answers);
      onSent();
    } catch (err: unknown) {
      if (toAppError(err).status === 409) onSent();
      else setFormError(getErrorMessage(err, 'Your feedback could not be sent. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  if (unavailable) {
    return (
      <p className="text-theme-text-secondary text-sm">
        The feedback form could not be loaded. Please try the link again later.
      </p>
    );
  }

  if (!form) {
    return (
      <div className="flex items-center gap-2 text-sm" role="status">
        <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="text-theme-text-secondary">Loading the feedback form…</span>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5" noValidate aria-labelledby="feedback-heading">
      <header>
        <h2 id="feedback-heading" className="text-theme-text-primary text-lg font-semibold">
          {form.form_name}
        </h2>
        {form.form_description && (
          <p className="text-theme-text-secondary mt-1 text-sm whitespace-pre-line">{form.form_description}</p>
        )}
      </header>

      {formError && (
        <p className="alert-danger text-sm" role="alert">
          {formError}
        </p>
      )}

      {fields
        .filter((field) => visibleIds.has(field.id))
        .map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={values[field.id] ?? ''}
            onChange={handleChange}
            theme="light"
            disabled={sending}
            error={fieldErrors[field.id]}
          />
        ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-theme-text-muted text-xs">You can send feedback once; it cannot be changed afterwards.</p>
        <button type="submit" disabled={sending} className="btn-primary">
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </form>
  );
};

export default RequestFeedbackForm;
