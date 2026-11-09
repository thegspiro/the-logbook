/**
 * One labelled form control: label, required marker, hint and error, wired to
 * the input it wraps.
 *
 * The forms review (docs/FORMS_REVIEW_2026-11-05.md, F-4 and F-5) found errors
 * shown beside a field but not tied to it, and asterisks drawn on fields that
 * were never announced as required. Every form re-typed the same markup. This
 * renders it once: the caller spreads `field` onto its own input, select or
 * textarea, so the id, `aria-required`, `aria-invalid` and `aria-describedby` are
 * always present and always point at text that is on the page.
 * `required` is announced, never enforced: the form decides when a missing
 * value stops it, which is at submit, not at save.
 */
import React from 'react';

export interface FormFieldControlProps {
  id: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

interface FormFieldProps {
  /** The control's DOM id. Also what an error summary links to. */
  id: string;
  label: React.ReactNode;
  required?: boolean;
  /** Mark a field the form treats as optional, for forms that say so. */
  optional?: boolean;
  hint?: React.ReactNode;
  /** The field's current error. Falsy hides it. */
  error?: string | null | undefined;
  /** Extra classes for the label, e.g. to match a dense form's style. */
  labelClassName?: string;
  className?: string;
  children: (field: FormFieldControlProps) => React.ReactNode;
}

// red-800 / red-300 clear 7:1 in all three themes; red-700 / red-400 do not,
// and mobile-accessibility.spec.ts holds several routes to zero AAA shortfalls.
export const FIELD_ERROR_CLASS = 'text-red-800 dark:text-red-300';

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  required = false,
  optional = false,
  hint,
  error,
  labelClassName = 'form-label',
  className,
  children,
}) => {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const field: FormFieldControlProps = {
    id,
    // aria-required, not the native attribute: inside a <form>, `required`
    // makes the browser refuse the submit event, and a draft save must go
    // through with the field still empty (owner rule, 2026-11-05).
    ...(required ? { 'aria-required': true as const } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
        {required && (
          <>
            {' '}
            <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
              *
            </span>
          </>
        )}
        {optional && !required && <span className="text-theme-text-muted font-normal"> optional</span>}
      </label>
      {children(field)}
      {error && (
        <p id={errorId} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-theme-text-muted mt-1 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
};

export default FormField;
