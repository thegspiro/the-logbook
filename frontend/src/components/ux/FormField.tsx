import React, { useId } from 'react';

/**
 * One labelled form control with its required marker, hint and error, wired
 * together (forms review F-3/F-4/F-5).
 *
 * Before this, every form assembled its own label and error markup, and the
 * review found the parts disagreeing: an asterisk on a field announced as
 * optional, a red message no screen reader was told about, a red outline with
 * no words at all. Here the parts cannot drift apart:
 *
 *   - `required` draws the asterisk *and* sets `aria-required`, so what is seen
 *     and what is announced are one fact. Native `required` is deliberately not
 *     set: under the owner's rule of 2026-11-05 a draft always saves, and a
 *     browser bubble would refuse it before the form could flag the field.
 *   - `error` renders under the control and is tied to it through
 *     `aria-describedby`, with `aria-invalid` set, so focusing the field reads
 *     the reason. The form decides when to focus the first failing field.
 *   - `maxLength` is passed to the control and, once the value nears the
 *     limit, a counter shows how much is left.
 *
 * The control is rendered by the caller through a function child, so any
 * input, select, textarea or custom control can take the props:
 *
 *     <FormField label="First name" required error={errors.firstName} maxLength={100} count={name.length}>
 *       {(field) => <input {...field} className="form-input" value={name} onChange={...} />}
 *     </FormField>
 *
 * Styling stays on the existing `form-label` / `form-input` utilities.
 */

export interface FieldControlProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  'aria-required': true | undefined;
  maxLength?: number;
}

interface FormFieldProps {
  label: React.ReactNode;
  children: (control: FieldControlProps) => React.ReactNode;
  required?: boolean | undefined;
  /** Shows "(optional)" after the label, for forms that mark the optional fields instead. */
  optional?: boolean | undefined;
  hint?: React.ReactNode;
  /** The refusal to show and announce; empty, null or undefined shows none. */
  error?: string | null | undefined;
  maxLength?: number | undefined;
  /** The value's current length, for the counter shown near `maxLength`. */
  count?: number | undefined;
  /** A fixed id, for a control other code already points at; generated otherwise. */
  id?: string | undefined;
  className?: string | undefined;
  /**
   * Replaces the standard `form-label` look, for a page with its own label
   * style; the label stays tied to the control either way.
   */
  labelClassName?: string | undefined;
}

/** The counter appears once this share of the limit is used, not before. */
const COUNTER_FROM = 0.8;

export const FormField: React.FC<FormFieldProps> = ({
  label,
  children,
  required,
  optional,
  hint,
  error,
  maxLength,
  count,
  id: idProp,
  className,
  labelClassName,
}) => {
  const generated = useId();
  const id = idProp ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const showCounter = maxLength !== undefined && count !== undefined && count >= maxLength * COUNTER_FROM;

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName ?? 'form-label'}>
        {label}
        {required && (
          <span className="text-red-800 dark:text-red-300" aria-hidden="true">
            {' '}
            *
          </span>
        )}
        {optional && !required && <span className="text-theme-text-muted font-normal"> (optional)</span>}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
        ...(maxLength !== undefined ? { maxLength } : {}),
      })}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-theme-text-muted mt-1 text-xs">
          {hint}
        </p>
      )}
      {showCounter && (
        <p className="text-theme-text-muted mt-1 text-right text-xs">
          {count} / {maxLength}
        </p>
      )}
    </div>
  );
};

export default FormField;
