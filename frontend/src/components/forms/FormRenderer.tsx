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
import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import FieldRenderer from './FieldRenderer';
import { formsService } from '../../services/api';
import type { FieldDefinition } from './FieldRenderer';
import type { FormDetailDef, FormSubmission } from '../../services/api';
import { FieldType } from '../../constants/enums';

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
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(!!formId);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const isDirtyRef = useRef(false);

  const isDark = theme === 'dark';

  // Track dirty state for unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current && !submitted) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [submitted]);

  // Load form definition if formId is provided
  useEffect(() => {
    if (formId) {
      void loadForm();
    }
  }, [formId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    isDirtyRef.current = true;
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

  /** Evaluate whether a field's visibility condition is satisfied. */
  const isFieldVisible = useCallback(
    (field: FieldDefinition): boolean => {
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
    },
    [formData],
  );

  /** Validate a single field. Returns error string or null. */
  const validateField = useCallback((field: FieldDefinition): string | null => {
    if (field.field_type === FieldType.SECTION_HEADER) return null;
    if (!isFieldVisible(field)) return null;
    const val = formData[field.id]?.trim() || '';

    if (field.required && !val) {
      return `${field.label} is required`;
    }
    if (val && field.min_length && val.length < field.min_length) {
      return `Minimum ${field.min_length} characters`;
    }
    if (val && field.max_length && val.length > field.max_length) {
      return `Maximum ${field.max_length} characters`;
    }
    if (val && field.field_type === FieldType.NUMBER) {
      const num = Number(val);
      if (isNaN(num)) {
        return 'Must be a number';
      }
      if (field.min_value !== undefined && field.min_value !== null && num < field.min_value) {
        return `Minimum value is ${field.min_value}`;
      }
      if (field.max_value !== undefined && field.max_value !== null && num > field.max_value) {
        return `Maximum value is ${field.max_value}`;
      }
    }
    if (val && field.field_type === FieldType.EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      return 'Invalid email address';
    }
    if (val && field.validation_pattern) {
      try {
        const regex = new RegExp(field.validation_pattern);
        if (!regex.test(val)) {
          return 'Invalid format';
        }
      } catch {
        // Skip invalid regex patterns
      }
    }
    return null;
  }, [formData, isFieldVisible]);

  /** Validate on blur — only shows errors for touched fields. */
  const handleFieldBlur = useCallback((fieldId: string) => {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      next.add(fieldId);
      return next;
    });
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const fieldError = validateField(field);
    setFieldErrors((prev) => {
      if (fieldError) {
        return { ...prev, [fieldId]: fieldError };
      }
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, [fields, validateField]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      const fieldError = validateField(field);
      if (fieldError) {
        errors[field.id] = fieldError;
      }
    }

    // Mark all fields as touched on submit attempt
    setTouchedFields(new Set(fields.map((f) => f.id)));
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || submitting) return;

    if (!validate()) {
      setError('Please fix the errors highlighted below.');
      // Focus the error summary for screen readers
      errorSummaryRef.current?.focus();
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Sanitize all form values before submission (lazy-loaded to reduce initial bundle)
      const DOMPurify = (await import('dompurify')).default;
      const sanitizedData: Record<string, string> = {};
      for (const [key, value] of Object.entries(formData)) {
        sanitizedData[key] = DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
      }

      if (onSubmit) {
        // Custom submit handler
        const success = await onSubmit(sanitizedData);
        if (success) {
          setSubmitted(true);
          isDirtyRef.current = false;
        }
      } else if (formId) {
        // Use formsService
        const submission = await formsService.submitForm(formId, sanitizedData);
        setSubmitted(true);
        isDirtyRef.current = false;
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
    setTouchedFields(new Set());
    setError(null);
    isDirtyRef.current = false;
  };

  // Loading state
  if (loading) {
    return (
      <div className={`${isDark ? 'bg-theme-surface-secondary' : 'bg-theme-surface-secondary'} rounded-lg p-8 text-center`}>
        <RefreshCw className={`w-6 h-6 animate-spin mx-auto mb-2 ${isDark ? 'text-pink-700 dark:text-pink-400' : 'text-blue-700 dark:text-blue-500'}`} />
        <p className={`text-sm ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>Loading form...</p>
      </div>
    );
  }

  // Success state
  if (submitted && showSuccessMessage) {
    return (
      <div className={`${isDark ? 'bg-theme-surface-secondary border border-theme-surface-border' : 'bg-green-50 border border-green-200'} rounded-lg p-8 text-center`}>
        <CheckCircle className={`w-10 h-10 mx-auto mb-3 ${isDark ? 'text-green-700 dark:text-green-400' : 'text-green-700 dark:text-green-500'}`} />
        <h3 className={`text-lg font-semibold mb-1 ${isDark ? 'text-theme-text-primary' : 'text-theme-text-primary'}`}>Submitted Successfully</h3>
        <p className={`text-sm ${isDark ? 'text-theme-text-muted' : 'text-theme-text-secondary'}`}>Your response has been recorded.</p>
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
      <div className={`${isDark ? 'bg-theme-surface-secondary border border-theme-surface-border' : 'bg-theme-surface-secondary border border-theme-surface-border'} rounded-lg p-8 text-center`}>
        <p className={`text-sm ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
          This form has no fields yet. Use the Form Builder to add fields.
        </p>
      </div>
    );
  }

  const formTitle = title || form?.name;
  const formDesc = description || form?.description;
  const hasRequired = fields.some((f) => f.required && f.field_type !== FieldType.SECTION_HEADER);
  const errorEntries = Object.entries(fieldErrors);
  const visibleFields = fields
    .filter((f) => isFieldVisible(f))
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
      {/* Header */}
      {(formTitle || formDesc) && (
        <div className={`mb-${compact ? '4' : '6'}`}>
          {formTitle && <h3 className={`text-lg font-semibold ${isDark ? 'text-theme-text-primary' : 'text-theme-text-primary'}`}>{formTitle}</h3>}
          {formDesc && <p className={`text-sm mt-1 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-secondary'}`}>{formDesc}</p>}
        </div>
      )}

      {/* Required fields legend */}
      {hasRequired && (
        <p className={`text-xs mb-4 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-secondary'}`}>
          Fields marked with <span className="text-red-700 dark:text-red-400">*</span> are required.
        </p>
      )}

      {/* Accessible error summary */}
      {errorEntries.length > 0 && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          className={`mb-4 p-3 rounded-lg ${isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />
            <p className={`text-sm font-medium ${isDark ? 'text-red-700 dark:text-red-300' : 'text-red-700'}`}>
              {error || `Please fix ${errorEntries.length} ${errorEntries.length === 1 ? 'error' : 'errors'} below.`}
            </p>
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {errorEntries.map(([fieldId, msg]) => (
              <li key={fieldId} className={`text-xs ${isDark ? 'text-red-700 dark:text-red-400' : 'text-red-600'}`}>
                <a
                  href={`#field-${fieldId}`}
                  className="underline hover:no-underline"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(`field-${fieldId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    document.getElementById(`field-${fieldId}`)?.focus();
                  }}
                >
                  {msg}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error banner (only show if no error entries — avoids duplication) */}
      {error && errorEntries.length === 0 && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
          <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />
          <p className={`text-sm ${isDark ? 'text-red-700 dark:text-red-300' : 'text-red-700'}`}>{error}</p>
        </div>
      )}

      {/* Fields */}
      <div className={`space-y-${compact ? '3' : '5'}`}>
        {visibleFields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={formData[field.id] || ''}
            onChange={handleFieldChange}
            onBlur={handleFieldBlur}
            theme={theme}
            disabled={readOnly}
            error={touchedFields.has(field.id) ? fieldErrors[field.id] : undefined}
          />
        ))}
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className={`flex items-center gap-3 mt-${compact ? '4' : '6'} pt-${compact ? '3' : '4'} ${isDark ? 'border-t border-theme-surface-border' : 'border-t border-theme-surface-border'}`}>
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
                isDark ? 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover' : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-secondary'
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
