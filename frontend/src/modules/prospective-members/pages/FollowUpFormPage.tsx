/**
 * Follow-up Form Page (Public)
 *
 * The form a Follow-up Form stage emails an applicant, opened from their
 * personal link with no sign-in. It opens filled with the saved draft or with
 * what the department already holds, saves as the applicant goes, and is
 * closed once submitted.
 *
 * Visibility follows the same rules the backend applies on submit
 * (getVisibleFieldIds), so a hidden follow-up question is neither required
 * here nor stored there.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import FieldRenderer from '../../../components/forms/FieldRenderer';
import type { FieldDefinition } from '../../../components/forms/FieldRenderer';
import { publicFollowUpFormService } from '../services/api';
import type { PublicFollowUpForm, PublicFollowUpFormField } from '../types';
import { getVisibleFieldIds } from '../../../utils/formVisibility';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { FieldType } from '../../../constants/enums';

/** How long the applicant must stop typing before the draft saves itself. */
const AUTOSAVE_DELAY_MS = 3000;

type PageState = 'loading' | 'ready' | 'not_found' | 'unavailable' | 'submitted';

function toFieldDefinition(field: PublicFollowUpFormField): FieldDefinition {
  return {
    id: field.id,
    label: field.label,
    field_type: field.field_type,
    placeholder: field.placeholder ?? undefined,
    help_text: field.help_text ?? undefined,
    required: field.required,
    min_length: field.min_length ?? undefined,
    max_length: field.max_length ?? undefined,
    min_value: field.min_value ?? undefined,
    max_value: field.max_value ?? undefined,
    options: field.options ?? undefined,
    condition_field_id: field.condition_field_id ?? undefined,
    condition_operator: field.condition_operator ?? undefined,
    condition_value: field.condition_value ?? undefined,
    sort_order: field.sort_order,
    width: field.width,
    is_sensitive: field.is_sensitive,
  };
}

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main
    id="main-content"
    className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-8 sm:py-12"
  >
    <div className="mx-auto max-w-2xl">{children}</div>
  </main>
);

const FollowUpFormPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const tz = useTimezone();
  const [state, setState] = useState<PageState>('loading');
  const [form, setForm] = useState<PublicFollowUpForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!token) {
      setState('not_found');
      return;
    }
    let cancelled = false;
    publicFollowUpFormService
      .getForm(token)
      .then((result) => {
        if (cancelled) return;
        setForm(result);
        setValues(result.values);
        setSavedAt(result.draft_saved_at ?? null);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = toAppError(err).status;
        if (status === 409) setState('submitted');
        else if (status === 404 || status === 400 || status === 422) setState('not_found');
        else setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const fields = useMemo(
    () => (form ? [...form.fields].sort((a, b) => a.sort_order - b.sort_order).map(toFieldDefinition) : []),
    [form]
  );
  const visibleIds = useMemo(() => getVisibleFieldIds(fields, values), [fields, values]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    setSaving(true);
    try {
      const result = await publicFollowUpFormService.saveDraft(token, values);
      dirty.current = false;
      setSavedAt(result.draft_saved_at);
      return true;
    } catch (err: unknown) {
      if (toAppError(err).status === 409) setState('submitted');
      return false;
    } finally {
      setSaving(false);
    }
  }, [token, values]);

  // Saves a few seconds after the applicant stops typing, so a long form is
  // not lost to a closed tab or a dropped connection.
  useEffect(() => {
    if (state !== 'ready' || !dirty.current) return undefined;
    const timer = setTimeout(() => void saveDraft(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [values, state, saveDraft]);

  const handleChange = (fieldId: string, value: string) => {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setFieldErrors((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.field_type === FieldType.SECTION_HEADER || !visibleIds.has(field.id)) continue;
      const value = (values[field.id] ?? '').trim();
      if (field.required && !value) errors[field.id] = `${field.label} is required`;
      else if (value && field.field_type === FieldType.EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors[field.id] = 'Enter a valid email address';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    setFormError(null);
    if (!validate()) {
      setFormError('Some answers need attention before the form can be sent.');
      return;
    }
    const answers = Object.fromEntries(Object.entries(values).filter(([id]) => visibleIds.has(id)));
    setSubmitting(true);
    try {
      await publicFollowUpFormService.submit(token, answers);
      setState('submitted');
    } catch (err: unknown) {
      if (toAppError(err).status === 409) setState('submitted');
      else setFormError(getErrorMessage(err, 'The form could not be sent. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading your form...</span>
        </div>
      </Shell>
    );
  }

  if (state === 'submitted') {
    return (
      <Shell>
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <h1 className="text-theme-text-primary mb-2 text-xl font-semibold">Thank you</h1>
          <p className="text-theme-text-secondary text-sm">
            Your answers have been sent to the department. If anything changes, please contact them directly.
          </p>
        </div>
      </Shell>
    );
  }

  if (state !== 'ready' || !form) {
    return (
      <Shell>
        <div className="card p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <h1 className="text-theme-text-primary mb-2 text-xl font-semibold">
            {state === 'unavailable' ? 'We could not load your form' : 'This form is not available'}
          </h1>
          <p className="text-theme-text-secondary text-sm">
            {state === 'unavailable'
              ? 'Please check your connection and try the link again in a few minutes.'
              : 'The link may be incomplete, or the application it belongs to is no longer open. Please contact the department if you think this is a mistake.'}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={(e) => void handleSubmit(e)} className="card space-y-6 p-6 sm:p-8" noValidate>
        <header>
          {form.organization_name && <p className="text-theme-text-muted text-sm">{form.organization_name}</p>}
          <h1 className="text-theme-text-primary text-2xl font-semibold">{form.form_name}</h1>
          <p className="text-theme-text-secondary mt-2 text-sm">
            Hi {form.applicant_first_name}. We have filled in what we already know, so please check each answer and
            correct anything that has changed.
          </p>
          {form.form_description && (
            <p className="text-theme-text-secondary mt-2 text-sm whitespace-pre-line">{form.form_description}</p>
          )}
        </header>

        {formError && (
          <p className="alert-danger text-sm" role="alert">
            {formError}
          </p>
        )}

        <div className="space-y-5">
          {fields
            .filter((field) => visibleIds.has(field.id))
            .map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={values[field.id] ?? ''}
                onChange={handleChange}
                theme="light"
                disabled={submitting}
                error={fieldErrors[field.id]}
              />
            ))}
        </div>

        <div className="split-row border-theme-surface-border gap-3 border-t pt-4 sm:items-center">
          <p className="split-row-main text-theme-text-muted text-xs" aria-live="polite">
            {saving
              ? 'Saving...'
              : savedAt
                ? `Saved ${formatDateTime(savedAt, tz)}. You can come back to this link to finish.`
                : 'Your answers save as you go.'}
          </p>
          <div className="split-row-aside flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || submitting}
              className="btn-secondary"
            >
              Save and finish later
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Sending...' : 'Submit'}
            </button>
          </div>
        </div>
      </form>
    </Shell>
  );
};

export default FollowUpFormPage;
