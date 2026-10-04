import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router';
import DOMPurify from 'dompurify';
import { publicFormsService } from '../services/api';
import type { PublicFormDef, PublicFormField } from '../services/api';
import { getErrorMessage, toAppError } from '../utils/errorHandling';
import { useAuthStore } from '../stores/authStore';
import { FieldType } from '../constants/enums';
import TimeQuarterHour from '../components/ux/TimeQuarterHour';
import DateTimeQuarterHour from '../components/ux/DateTimeQuarterHour';
import { useCaptcha } from '../hooks/useCaptcha';
import { getVisibleFieldIds } from '../utils/formVisibility';

// Sanitize any text content that came from the server
const clean = (text: string | null | undefined): string => {
  if (!text) return '';
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
};

const fieldInputId = (fieldId: string): string => `public-field-${fieldId}`;

const PublicFormPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicFormDef | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState('');
  // Honeypot ref - hidden from real users, bots will fill it
  const honeypotRef = useRef<HTMLInputElement>(null);
  const captcha = useCaptcha('form_submit');

  // This page is outside ProtectedRoute, so nothing else resolves the session
  // here. loadUser only calls the server when the has_session flag is set, so
  // a visitor who has never signed in costs no request.
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [sessionChecked, setSessionChecked] = useState(isAuthenticated);
  // Set when the server refuses a submission for want of a sign-in, which a
  // stale has_session flag can make the check above miss.
  const [signInRefused, setSignInRefused] = useState(false);

  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated) return;
    void useAuthStore
      .getState()
      .loadUser()
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    if (slug) {
      void loadForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const loadForm = async () => {
    if (!slug) return;
    try {
      setLoading(true);
      setError(null);
      const data = await publicFormsService.getForm(slug);
      setForm(data);
      // Initialize form data with defaults
      const defaults: Record<string, string> = {};
      data.fields.forEach((f) => {
        if (f.default_value) {
          defaults[f.id] = f.default_value;
        }
      });
      setFormData(defaults);
    } catch {
      setError("It may have been removed, or it hasn't been published yet.");
    } finally {
      setLoading(false);
    }
  };

  // Follows branches through every level, so a follow-up to a question that
  // has been hidden is hidden (and not required) too.
  const visibleFieldIds = useMemo(() => getVisibleFieldIds(form?.fields ?? [], formData), [form, formData]);
  const isFieldVisible = (field: PublicFormField): boolean => visibleFieldIds.has(field.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    // Validate required fields (skip hidden conditional fields)
    for (const field of form.fields) {
      if (!isFieldVisible(field)) continue;
      if (field.required && !formData[field.id]?.trim()) {
        setError(`"${field.label}" is required.`);
        return;
      }
    }

    let captchaToken: string | null = null;
    if (captcha.required) {
      captchaToken = await captcha.getToken();
      if (!captchaToken) {
        setError('Complete the challenge below, then submit.');
        return;
      }
    }

    try {
      setSubmitting(true);
      setError(null);
      // An answer left in a question that is now hidden belongs to a branch
      // the visitor backed out of; it stays in state but is not sent.
      const visibleAnswers = Object.fromEntries(
        Object.entries(formData).filter(([fieldId]) => visibleFieldIds.has(fieldId))
      );
      const result = await publicFormsService.submitForm(
        slug ?? '',
        visibleAnswers,
        honeypotRef.current?.value || undefined,
        captchaToken || undefined
      );
      setSubmitted(true);
      setSubmitMessage(result.message);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Your response wasn't sent. Try again.");
      setError(msg);
      if (toAppError(err).status === 401) setSignInRefused(true);
      // Provider tokens are single-use: a rejected submission must solve a new
      // challenge, or every retry replays a token the server already burned.
      captcha.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const renderField = (field: PublicFormField) => {
    const value = formData[field.id] || '';
    const baseInputClass = 'form-input py-3';
    // Pairs the control with the visible label rendered beside it. Without it
    // every field on a public form announced as a blank edit box (workflow
    // review W22).
    const inputId = fieldInputId(field.id);

    switch (field.field_type) {
      case FieldType.TEXT:
      case FieldType.EMAIL:
      case FieldType.PHONE:
        return (
          <input
            id={inputId}
            type={field.field_type === FieldType.PHONE ? 'tel' : field.field_type}
            className={baseInputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            minLength={field.min_length ?? undefined}
            maxLength={field.max_length ?? undefined}
          />
        );

      case FieldType.NUMBER:
        return (
          <input
            id={inputId}
            type="number"
            className={baseInputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            min={field.min_value ?? undefined}
            max={field.max_value ?? undefined}
          />
        );

      case FieldType.TEXTAREA:
        return (
          <textarea
            id={inputId}
            className={`${baseInputClass} min-h-[100px]`}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            minLength={field.min_length ?? undefined}
            maxLength={field.max_length ?? undefined}
          />
        );

      case FieldType.DATE:
        return (
          <input
            id={inputId}
            type="date"
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case FieldType.TIME:
        return (
          <TimeQuarterHour
            aria-label={field.label}
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case FieldType.DATETIME:
        return (
          <DateTimeQuarterHour
            id={inputId}
            timeLabel={field.label}
            className={baseInputClass}
            value={value}
            onChange={(val) => handleFieldChange(field.id, val)}
            required={field.required}
          />
        );

      case FieldType.SELECT:
        return (
          <select
            id={inputId}
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          >
            <option value="">{field.placeholder || 'Select an option...'}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case FieldType.RADIO:
        return (
          <fieldset className="space-y-2">
            <legend className="sr-only">{field.label}</legend>
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={field.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-theme-text-secondary">{opt.label}</span>
              </label>
            ))}
          </fieldset>
        );

      case FieldType.CHECKBOX:
        return (
          <fieldset className="space-y-2">
            <legend className="sr-only">{field.label}</legend>
            {field.options?.map((opt) => {
              const checked = value.split(',').includes(opt.value);
              return (
                <label key={opt.value} className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = value ? value.split(',') : [];
                      const updated = e.target.checked
                        ? [...current, opt.value]
                        : current.filter((v) => v !== opt.value);
                      handleFieldChange(field.id, updated.join(','));
                    }}
                    className="form-checkbox"
                  />
                  <span className="text-theme-text-secondary">{opt.label}</span>
                </label>
              );
            })}
          </fieldset>
        );

      case FieldType.SECTION_HEADER:
        return (
          <div className="border-theme-surface-border -mb-2 border-b pb-2">
            <h3 className="text-theme-text-primary text-lg font-semibold">{clean(field.label)}</h3>
            {field.help_text && <p className="text-theme-text-muted mt-1 text-sm">{clean(field.help_text)}</p>}
          </div>
        );

      default:
        return (
          <input
            id={inputId}
            type="text"
            className={baseInputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );
    }
  };

  if (loading) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br"
      >
        <div className="text-center">
          <div className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-t-3 border-b-3 border-blue-500"></div>
          <p className="text-theme-text-secondary">Loading form...</p>
        </div>
      </main>
    );
  }

  if (error && !form) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4"
      >
        <div className="bg-theme-surface max-w-md rounded-xl p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <svg
              className="h-8 w-8 text-red-700 dark:text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-theme-text-primary mb-2 text-xl font-bold">Form Not Available</h2>
          <p className="text-theme-text-secondary">{error}</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4"
      >
        <div className="bg-theme-surface max-w-md rounded-xl p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <svg
              className="h-8 w-8 text-green-700 dark:text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-theme-text-primary mb-2 text-xl font-bold">Submission Received</h2>
          <p className="text-theme-text-secondary">{submitMessage || 'Thank you for your submission!'}</p>
          {form?.allow_multiple_submissions && (
            <button
              onClick={() => {
                setSubmitted(false);
                setFormData({});
              }}
              className="btn-info mt-6 px-6"
            >
              Submit Another Response
            </button>
          )}
        </div>
      </main>
    );
  }

  if (!form) return null;

  // Mirrors the public submit endpoint: a form that allows one response per
  // person needs a signed-in identity to enforce that, so it refuses
  // anonymous visitors whatever require_authentication says. Said up front,
  // before the visitor fills in answers the server would then discard.
  const formNeedsSignIn = form.require_authentication || !form.allow_multiple_submissions;
  const showSignInNotice = signInRefused || (formNeedsSignIn && sessionChecked && !isAuthenticated);

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-8">
      <main id="main-content" className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="bg-theme-surface mb-6 overflow-hidden rounded-xl shadow-lg">
          <div className="bg-linear-to-r from-blue-600 to-blue-700 px-8 py-6">
            {form.organization_name && <p className="mb-1 text-sm text-blue-100">{clean(form.organization_name)}</p>}
            <h1 className="text-2xl font-bold text-white">{clean(form.name)}</h1>
            {form.description && <p className="mt-2 text-blue-100">{clean(form.description)}</p>}
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="bg-theme-surface rounded-xl p-8 shadow-lg"
        >
          {showSignInNotice && (
            <div className="alert-info mb-6" role="note" aria-labelledby="public-form-signin-title">
              <p id="public-form-signin-title" className="text-theme-text-primary text-sm font-semibold">
                Sign in to submit this form
              </p>
              <p className="text-theme-text-secondary mt-1 text-sm">
                {form.organization_name ? clean(form.organization_name) : 'This department'} accepts responses to this
                form from signed-in members only. Sign in before you start, and you will come back to this page.
              </p>
              <Link
                to="/login"
                state={{ from: { pathname: `/f/${slug ?? ''}` } }}
                className="btn-primary mobile-touch-target mt-3 inline-flex items-center"
              >
                Sign in
              </Link>
            </div>
          )}
          {error && (
            <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-6">
            {form.fields.map((field) => {
              if (!isFieldVisible(field)) return null;

              if (field.field_type === FieldType.SECTION_HEADER) {
                return (
                  <div key={field.id} className="pt-4">
                    {renderField(field)}
                  </div>
                );
              }

              return (
                <div
                  key={field.id}
                  className={
                    field.width === 'half'
                      ? 'inline-block w-full sm:w-1/2 sm:pr-2'
                      : field.width === 'third'
                        ? 'inline-block w-full sm:w-1/3 sm:pr-2'
                        : ''
                  }
                >
                  <label
                    // A radio or checkbox group is named by its own legend;
                    // there is no single control for this label to point at.
                    {...(field.field_type === FieldType.RADIO || field.field_type === FieldType.CHECKBOX
                      ? {}
                      : { htmlFor: fieldInputId(field.id) })}
                    className="text-theme-text-secondary mb-1 block text-sm font-medium"
                  >
                    {clean(field.label)}
                    {field.required && <span className="ml-1 text-red-700 dark:text-red-500">*</span>}
                  </label>
                  {field.help_text && <p className="text-theme-text-muted mb-2 text-xs">{clean(field.help_text)}</p>}
                  {renderField(field)}
                </div>
              );
            })}
          </div>

          {/* Honeypot field - hidden from real users, catches bots */}
          <div
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', top: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}
          >
            <label htmlFor="website">Website</label>
            <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" ref={honeypotRef} />
          </div>

          {/* Challenge — renders nothing unless the server enforces one */}
          {captcha.required && (
            <div className="mt-6">
              <div ref={captcha.containerRef} />
              {captcha.error && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-500" role="alert">
                  {captcha.error}
                </p>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="border-theme-surface-border mt-8 border-t pt-6">
            <button
              type="submit"
              disabled={submitting}
              className="btn-info w-full px-6 py-3 font-semibold disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Submitting...
                </span>
              ) : (
                'Submit'
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="text-theme-text-muted mt-6 text-center text-xs">Powered by The Logbook</p>
      </main>
    </div>
  );
};

export default PublicFormPage;
