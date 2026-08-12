import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import DOMPurify from 'dompurify';
import { publicFormsService } from '../services/api';
import type { PublicFormDef, PublicFormField } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { FieldType } from '../constants/enums';
import TimeQuarterHour from '../components/ux/TimeQuarterHour';
import DateTimeQuarterHour from '../components/ux/DateTimeQuarterHour';

// Sanitize any text content that came from the server
const clean = (text: string | null | undefined): string => {
  if (!text) return '';
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
};

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
      setError('This form is not available. It may have been removed or is not yet published.');
    } finally {
      setLoading(false);
    }
  };

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

    try {
      setSubmitting(true);
      setError(null);
      const result = await publicFormsService.submitForm(slug ?? '', formData, honeypotRef.current?.value || undefined);
      setSubmitted(true);
      setSubmitMessage(result.message);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to submit form. Please try again.');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  /** Evaluate conditional visibility for a field. */
  const isFieldVisible = (field: PublicFormField): boolean => {
    if (!field.condition_field_id || !field.condition_operator) return true;
    const parentValue = (formData[field.condition_field_id] || '').trim();
    switch (field.condition_operator) {
      case 'equals':
        return parentValue === (field.condition_value || '');
      case 'not_equals':
        return parentValue !== (field.condition_value || '');
      case 'contains':
        return parentValue.toLowerCase().includes((field.condition_value || '').toLowerCase());
      case 'not_empty':
        return parentValue.length > 0;
      case 'is_empty':
        return parentValue.length === 0;
      default:
        return true;
    }
  };

  const renderField = (field: PublicFormField) => {
    const value = formData[field.id] || '';
    const baseInputClass =
      'w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg focus:ring-2 focus:ring-theme-focus-ring focus:border-theme-focus-ring text-theme-text-primary placeholder-theme-text-muted';

    switch (field.field_type) {
      case FieldType.TEXT:
      case FieldType.EMAIL:
      case FieldType.PHONE:
        return (
          <input
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
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case FieldType.DATETIME:
        return (
          <DateTimeQuarterHour
            className={baseInputClass}
            value={value}
            onChange={(val) => handleFieldChange(field.id, val)}
            required={field.required}
          />
        );

      case FieldType.SELECT:
        return (
          <select
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
          <div className="space-y-2">
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
          </div>
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
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br">
        <div className="text-center">
          <div className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-t-3 border-b-3 border-blue-500"></div>
          <p className="text-theme-text-secondary">Loading form...</p>
        </div>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
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
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
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
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-8">
      <div className="mx-auto max-w-2xl">
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
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
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
      </div>
    </div>
  );
};

export default PublicFormPage;
