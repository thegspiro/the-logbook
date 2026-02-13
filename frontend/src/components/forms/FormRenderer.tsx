/**
 * FormRenderer - Renders a complete form and handles submission.
 *
 * Embeddable in any module. Usage:
 *
 *   <FormRenderer
 *     formId="uuid-of-form"
 *     onSubmitSuccess={(submission) => { ... }}
 *   />
 *
 * Or pass fields directly (no fetch needed):
 *
 *   <FormRenderer
 *     fields={myFields}
 *     onSubmit={(data) => myCustomHandler(data)}
 *   />
 */
import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { Send, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import FieldRenderer from './FieldRenderer';
import { formsService } from '../../services/api';
import type { FieldDefinition } from './FieldRenderer';
import type { FormDetailDef, FormSubmission } from '../../services/api';

export interface FormRendererProps {
  /** Fetch and render a form by ID */
  formId?: string;
  /** Or provide fields directly (skips fetch) */
  fields?: FieldDefinition[];
  /** Form title to show above fields (only used with direct fields) */
  title?: string;
  /** Form description */
  description?: string;
  /** Called after successful submission via formsService */
  onSubmitSuccess?: (submission: FormSubmission) => void;
  /** Custom submit handler (bypasses formsService). Return true on success. */
  onSubmit?: (data: Record<string, string>) => Promise<boolean>;
  /** Called when user cancels */
  onCancel?: () => void;
  /** Show cancel button */
  showCancel?: boolean;
  /** Custom submit button label */
  submitLabel?: string;
  /** Pre-fill form values */
  initialValues?: Record<string, string>;
  /** Dark or light theme */
  theme?: 'dark' | 'light';
  /** Compact layout (less padding) */
  compact?: boolean;
  /** Disable all fields (read-only mode) */
  readOnly?: boolean;
  /** Show success message after submit */
  showSuccessMessage?: boolean;
  /** Allow re-submit after success */
  allowResubmit?: boolean;
}

const FormRenderer = ({
  formId,
  fields: directFields,
  title,
  description,
  onSubmitSuccess,
  onSubmit,
  onCancel,
  showCancel = false,
  submitLabel = 'Submit',
  initialValues,
  theme = 'dark',
  compact = false,
  readOnly = false,
  showSuccessMessage = true,
  allowResubmit = false,
}: FormRendererProps) => {
  const [form, setForm] = useState<FormDetailDef | null>(null);
  const [fields, setFields] = useState<FieldDefinition[]>(directFields || []);
  const [formData, setFormData] = useState<Record<string, string>>(initialValues || {});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!!formId);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDark = theme === 'dark';

  // Load form definition if formId is provided
  useEffect(() => {
    if (formId) {
      loadForm();
    }
  }, [formId]);

  // Sync direct fields
  useEffect(() => {
    if (directFields) {
      setFields(directFields);
    }
  }, [directFields]);

  // Apply initial values
  useEffect(() => {
    if (initialValues) {
      setFormData((prev) => ({ ...prev, ...initialValues }));
    }
  }, [initialValues]);

  const loadForm = async () => {
    if (!formId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await formsService.getForm(formId);
      setForm(data);
      setFields(data.fields);
      // Initialize defaults
      const defaults: Record<string, string> = {};
      data.fields.forEach((f) => {
        if (f.default_value) defaults[f.id] = f.default_value;
      });
      setFormData((prev) => ({ ...defaults, ...prev, ...(initialValues || {}) }));
    } catch {
      setError('Failed to load form. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
    // Clear field error on change
    setFieldErrors((prev) => {
      if (prev[fieldId]) {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }
      return prev;
    });
  }, []);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      if (field.field_type === 'section_header') continue;
      const val = formData[field.id]?.trim() || '';

      if (field.required && !val) {
        errors[field.id] = `${field.label} is required`;
      }

      if (val && field.min_length && val.length < field.min_length) {
        errors[field.id] = `Minimum ${field.min_length} characters`;
      }

      if (val && field.max_length && val.length > field.max_length) {
        errors[field.id] = `Maximum ${field.max_length} characters`;
      }

      if (val && field.field_type === 'number') {
        const num = Number(val);
        if (isNaN(num)) {
          errors[field.id] = 'Must be a number';
        } else {
          if (field.min_value !== undefined && field.min_value !== null && num < field.min_value) {
            errors[field.id] = `Minimum value is ${field.min_value}`;
          }
          if (field.max_value !== undefined && field.max_value !== null && num > field.max_value) {
            errors[field.id] = `Maximum value is ${field.max_value}`;
          }
        }
      }

      if (val && field.field_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        errors[field.id] = 'Invalid email address';
      }

      if (val && field.validation_pattern) {
        try {
          const regex = new RegExp(field.validation_pattern);
          if (!regex.test(val)) {
            errors[field.id] = 'Invalid format';
          }
        } catch {
          // Skip invalid regex patterns
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || submitting) return;

    if (!validate()) {
      setError('Please fix the errors below.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Sanitize all form values before submission
      const sanitizedData: Record<string, string> = {};
      for (const [key, value] of Object.entries(formData)) {
        sanitizedData[key] = DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
      }

      if (onSubmit) {
        // Custom submit handler
        const success = await onSubmit(sanitizedData);
        if (success) {
          setSubmitted(true);
        }
      } else if (formId) {
        // Use formsService
        const submission = await formsService.submitForm(formId, sanitizedData);
        setSubmitted(true);
        onSubmitSuccess?.(submission);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setFormData(initialValues || {});
    setFieldErrors({});
    setError(null);
  };

  // Loading state
  if (loading) {
    return (
      <div className={`${isDark ? 'bg-white/5' : 'bg-gray-50'} rounded-lg p-8 text-center`}>
        <RefreshCw className={`w-6 h-6 animate-spin mx-auto mb-2 ${isDark ? 'text-pink-400' : 'text-blue-500'}`} />
        <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Loading form...</p>
      </div>
    );
  }

  // Success state
  if (submitted && showSuccessMessage) {
    return (
      <div className={`${isDark ? 'bg-white/5 border border-white/10' : 'bg-green-50 border border-green-200'} rounded-lg p-8 text-center`}>
        <CheckCircle className={`w-10 h-10 mx-auto mb-3 ${isDark ? 'text-green-400' : 'text-green-500'}`} />
        <h3 className={`text-lg font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-800'}`}>Submitted Successfully</h3>
        <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>Your response has been recorded.</p>
        {allowResubmit && (
          <button
            onClick={handleReset}
            className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium ${
              isDark ? 'bg-pink-600 hover:bg-pink-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            Submit Another Response
          </button>
        )}
      </div>
    );
  }

  // No fields
  if (fields.length === 0) {
    return (
      <div className={`${isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-200'} rounded-lg p-8 text-center`}>
        <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
          This form has no fields yet. Use the Form Builder to add fields.
        </p>
      </div>
    );
  }

  const formTitle = title || form?.name;
  const formDesc = description || form?.description;

  return (
    <form onSubmit={handleSubmit}>
      {/* Header */}
      {(formTitle || formDesc) && (
        <div className={`mb-${compact ? '4' : '6'}`}>
          {formTitle && <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>{formTitle}</h3>}
          {formDesc && <p className={`text-sm mt-1 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>{formDesc}</p>}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className={`text-sm ${isDark ? 'text-red-300' : 'text-red-700'}`}>{error}</p>
        </div>
      )}

      {/* Fields */}
      <div className={`space-y-${compact ? '3' : '5'}`}>
        {fields
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={formData[field.id] || ''}
              onChange={handleFieldChange}
              theme={theme}
              disabled={readOnly}
              error={fieldErrors[field.id]}
            />
          ))}
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className={`flex items-center gap-3 mt-${compact ? '4' : '6'} pt-${compact ? '3' : '4'} ${isDark ? 'border-t border-white/10' : 'border-t border-gray-200'}`}>
          <button
            type="submit"
            disabled={submitting}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
              isDark
                ? 'bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50'
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'
            }`}
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {submitLabel}
              </>
            )}
          </button>
          {showCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                isDark ? 'text-slate-400 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
};

export default FormRenderer;
