/**
 * Prompt Dialog Component
 *
 * The in-app replacement for `window.prompt`: ask for one short value, then
 * act on it.
 *
 * `window.prompt` is not merely unstyled — browsers are free to suppress it
 * (Chrome does so for repeated dialogs and inside cross-origin frames; iOS and
 * Firefox offer the user a "prevent this page from creating further dialogs"
 * checkbox), and a suppressed prompt returns `null` — exactly what pressing
 * Cancel returns. Every caller therefore read a blocked dialog as a deliberate
 * cancellation and silently did nothing at all, with no error and no clue.
 *
 * The same applies to a caller's own validation: a value that fails a length
 * check has to be reported, not dropped on the floor.
 */

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../Modal';

interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the trimmed value once it satisfies `required` / `minLength`. */
  onSubmit: (value: string) => void;
  title: string;
  /** Context shown above the field — what this value is about to do. */
  message?: React.ReactNode;
  label: string;
  placeholder?: string;
  /** Prefilled on every open. Use for a default the user can simply accept. */
  defaultValue?: string;
  /** When false, an empty submission is allowed and passes an empty string. */
  required?: boolean;
  /** Enforced only on a non-empty value, so it composes with `required`. */
  minLength?: number;
  /** Longer prose (a reason, a note) gets a textarea instead of an input. */
  multiline?: boolean;
  /** Shown under the field — e.g. who will be able to read the value. */
  hint?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Amber for withdrawing something, matching the void dialogs elsewhere. */
  confirmVariant?: 'primary' | 'warning';
  loading?: boolean;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  message,
  label,
  placeholder,
  defaultValue = '',
  required = true,
  minLength = 0,
  multiline = false,
  hint,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  loading = false,
}) => {
  const [value, setValue] = useState(defaultValue);
  const [touched, setTouched] = useState(false);

  // Reset on each open rather than on mount: pages render these permanently and
  // toggle `isOpen`, so a value left behind would be prefilled into the next
  // one — on a void reason, that means filing someone else's explanation.
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTouched(false);
    }
  }, [isOpen, defaultValue]);

  const trimmed = value.trim();
  const missing = required && trimmed.length === 0;
  const tooShort = trimmed.length > 0 && trimmed.length < minLength;
  const invalid = missing || tooShort;
  const showError = touched && invalid;

  const handleSubmit = () => {
    setTouched(true);
    if (invalid || loading) return;
    onSubmit(trimmed);
  };

  const fieldId = 'prompt-dialog-field';
  const errorId = 'prompt-dialog-error';
  const errorText = missing ? `${label} is required.` : `Please write at least ${String(minLength)} characters.`;

  const sharedFieldProps = {
    id: fieldId,
    value,
    placeholder: placeholder ?? '',
    'aria-invalid': showError,
    ...(showError ? { 'aria-describedby': errorId } : {}),
    className: 'form-input',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={
              confirmVariant === 'warning'
                ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50'
                : 'btn-primary inline-flex items-center justify-center gap-2 font-medium'
            }
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-3">
        {message && <div className="text-theme-text-secondary text-sm">{message}</div>}
        <div>
          <label htmlFor={fieldId} className="form-label">
            {label}
            {!required && <span className="text-theme-text-muted font-normal"> (optional)</span>}
          </label>
          {multiline ? (
            <textarea {...sharedFieldProps} rows={3} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input
              {...sharedFieldProps}
              type="text"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          )}
          {showError ? (
            <p id={errorId} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {errorText}
            </p>
          ) : (
            hint && <p className="text-theme-text-muted mt-1 text-xs">{hint}</p>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default PromptDialog;
