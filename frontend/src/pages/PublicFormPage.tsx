import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { publicFormsService } from '../services/api';
import type { PublicFormDef, PublicFormField } from '../services/api';

// Sanitize any text content that came from the server
const clean = (text: string | null | undefined): string => {
  if (!text) return '';
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
};

const PublicFormPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicFormDef | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitterName, setSubmitterName] = useState('');
  const [submitterEmail, setSubmitterEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState('');
  // Honeypot ref - hidden from real users, bots will fill it
  const honeypotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slug) {
      loadForm();
    }
  }, [slug]);

  const loadForm = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await publicFormsService.getForm(slug!);
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

    // Validate required fields
    for (const field of form.fields) {
      if (field.required && !formData[field.id]?.trim()) {
        setError(`"${field.label}" is required.`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setError(null);
      const result = await publicFormsService.submitForm(
        slug!,
        formData,
        submitterName || undefined,
        submitterEmail || undefined,
        honeypotRef.current?.value || undefined
      );
      setSubmitted(true);
      setSubmitMessage(result.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit form. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const renderField = (field: PublicFormField) => {
    const value = formData[field.id] || '';
    const baseInputClass =
      'w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder-gray-400';

    switch (field.field_type) {
      case 'text':
      case 'email':
      case 'phone':
        return (
          <input
            type={field.field_type === 'phone' ? 'tel' : field.field_type}
            className={baseInputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            minLength={field.min_length || undefined}
            maxLength={field.max_length || undefined}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            className={baseInputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            min={field.min_value || undefined}
            max={field.max_value || undefined}
          />
        );

      case 'textarea':
        return (
          <textarea
            className={`${baseInputClass} min-h-[100px]`}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            minLength={field.min_length || undefined}
            maxLength={field.max_length || undefined}
          />
        );

      case 'date':
        return (
          <input
            type="date"
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case 'time':
        return (
          <input
            type="time"
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case 'datetime':
        return (
          <input
            type="datetime-local"
            className={baseInputClass}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case 'select':
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

      case 'radio':
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name={field.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => {
              const checked = value.split(',').includes(opt.value);
              return (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
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
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-gray-700">{opt.label}</span>
                </label>
              );
            })}
          </div>
        );

      case 'section_header':
        return (
          <div className="border-b border-gray-200 pb-2 -mb-2">
            <h3 className="text-lg font-semibold text-gray-800">{clean(field.label)}</h3>
            {field.help_text && <p className="text-sm text-gray-500 mt-1">{clean(field.help_text)}</p>}
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-t-3 border-b-3 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Loading form...</p>
        </div>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Form Not Available</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Submission Received</h2>
          <p className="text-gray-600">{submitMessage || 'Thank you for your submission!'}</p>
          {form?.allow_multiple_submissions && (
            <button
              onClick={() => {
                setSubmitted(false);
                setFormData({});
                setSubmitterName('');
                setSubmitterEmail('');
              }}
              className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6">
            {form.organization_name && (
              <p className="text-blue-100 text-sm mb-1">{clean(form.organization_name)}</p>
            )}
            <h1 className="text-2xl font-bold text-white">{clean(form.name)}</h1>
            {form.description && (
              <p className="text-blue-100 mt-2">{clean(form.description)}</p>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Contact Info Section */}
          <div className="mb-8 pb-6 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Your Information (Optional)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder-gray-400"
                  placeholder="Your name"
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder-gray-400"
                  placeholder="your@email.com"
                  value={submitterEmail}
                  onChange={(e) => setSubmitterEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-6">
            {form.fields.map((field) => {
              if (field.field_type === 'section_header') {
                return (
                  <div key={field.id} className="pt-4">
                    {renderField(field)}
                  </div>
                );
              }

              return (
                <div key={field.id} className={field.width === 'half' ? 'w-1/2 inline-block pr-2' : field.width === 'third' ? 'w-1/3 inline-block pr-2' : ''}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {clean(field.label)}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.help_text && (
                    <p className="text-xs text-gray-500 mb-2">{clean(field.help_text)}</p>
                  )}
                  {renderField(field)}
                </div>
              );
            })}
          </div>

          {/* Honeypot field - hidden from real users, catches bots */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}>
            <label htmlFor="website">Website</label>
            <input
              type="text"
              id="website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              ref={honeypotRef}
            />
          </div>

          {/* Submit */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
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
        <p className="text-center text-gray-400 text-xs mt-6">
          Powered by The Logbook
        </p>
      </div>
    </div>
  );
};

export default PublicFormPage;
