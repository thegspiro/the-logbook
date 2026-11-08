/**
 * One error message per form field, filled from local checks or from a 422.
 *
 * Owner rule (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With an
 * Error"): saving is never the step that refuses. A form flags every open
 * error on its field and keeps it flagged until it is resolved; only
 * submitting, publishing or sending for approval is held back by one. This
 * hook holds those flags. It never blocks anything itself.
 */
import { useCallback, useMemo, useState } from 'react';
import { getErrorMessage } from '../utils/errorHandling';

export interface FieldSpec {
  /** The input's DOM id — what FormField renders and what focus moves to. */
  id: string;
  /** The field's visible label, used in the error summary. */
  label: string;
  /**
   * Request keys that report against this field when they differ from its
   * name: a module that sends camelCase, or a nested key such as `positions`.
   */
  apiKeys?: readonly string[];
}

export type FieldSpecs<F extends string> = Readonly<Record<F, FieldSpec>>;
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

export interface SummaryItem {
  id: string;
  label: string;
  message: string;
}

interface ValidationEntry {
  loc?: Array<string | number>;
  field?: string;
  message?: string;
  msg?: string;
}

/**
 * The summary rows for a set of errors, in the order the form declares its
 * fields. Exported for a form whose errors are partly derived from its live
 * values rather than all held in this hook.
 */
export function buildSummary<F extends string>(fields: FieldSpecs<F>, errors: FieldErrors<F>): SummaryItem[] {
  return (Object.keys(fields) as F[]).flatMap((name) => {
    const message = errors[name];
    return message ? [{ id: fields[name].id, label: fields[name].label, message }] : [];
  });
}

function validationEntries(error: unknown): ValidationEntry[] | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  return Array.isArray(detail) ? (detail as ValidationEntry[]) : null;
}

function terminate(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function useFieldErrors<F extends string>(fields: FieldSpecs<F>) {
  const [errors, setErrorsState] = useState<FieldErrors<F>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Field order is the order the form declares them in, so the summary and
  // the first focused field follow the page from top to bottom.
  const order = useMemo(() => Object.keys(fields) as F[], [fields]);

  const apiKeyToField = useMemo(() => {
    const map = new Map<string, F>();
    for (const name of order) {
      map.set(name, name);
      for (const key of fields[name].apiKeys ?? []) map.set(key, name);
    }
    return map;
  }, [fields, order]);

  const setErrors = useCallback((next: FieldErrors<F>) => {
    setErrorsState(next);
  }, []);

  const setError = useCallback((field: F, message: string | null) => {
    setErrorsState((prev) => {
      if (!message) {
        if (!(field in prev)) return prev;
        const rest = { ...prev };
        delete rest[field];
        return rest;
      }
      return { ...prev, [field]: message };
    });
  }, []);

  const clear = useCallback(() => {
    setErrorsState({});
    setFormError(null);
  }, []);

  /**
   * Put a failed request's messages on the fields they name. A 422 entry whose
   * field the form does not show, and any non-422 failure, becomes the
   * form-level message instead, so nothing the server said is dropped.
   *
   * Returns the field errors it set (empty when none matched), so a caller
   * can pass them straight to focusFirst before React re-renders.
   */
  const setFromApiError = useCallback(
    (error: unknown, fallback = 'Could not save. Try again.'): FieldErrors<F> => {
      const entries = validationEntries(error);
      if (!entries) {
        setErrorsState({});
        setFormError(getErrorMessage(error, fallback));
        return {};
      }
      const next: FieldErrors<F> = {};
      const unmatched: string[] = [];
      for (const entry of entries) {
        const key = entry.field ?? (entry.loc?.length ? String(entry.loc[entry.loc.length - 1]) : undefined);
        const message = terminate(entry.message || entry.msg || 'Invalid value');
        const field = key ? apiKeyToField.get(key) : undefined;
        if (field) {
          if (!next[field]) next[field] = message;
        } else {
          // `request` is the backend's name for an error it could not pin on
          // any field; prefixing it would read as a field called "request".
          unmatched.push(key && key !== 'request' ? `${key}: ${message}` : message);
        }
      }
      setErrorsState(next);
      setFormError(unmatched.length ? unmatched.join(' ') : null);
      return next;
    },
    [apiKeyToField]
  );

  const firstInvalid = useCallback(
    (current: FieldErrors<F> = errors): F | undefined => order.find((name) => current[name]),
    [errors, order]
  );

  /**
   * Move focus to the first flagged field. Pass the errors just computed when
   * calling in the same tick as setErrors, before React has re-rendered.
   */
  const focusFirst = useCallback(
    (current: FieldErrors<F> = errors) => {
      const name = firstInvalid(current);
      if (name) document.getElementById(fields[name].id)?.focus();
    },
    [errors, fields, firstInvalid]
  );

  const summary: SummaryItem[] = useMemo(() => buildSummary(fields, errors), [errors, fields]);

  const hasErrors = summary.length > 0;

  return {
    errors,
    formError,
    setFormError,
    setErrors,
    setError,
    clear,
    setFromApiError,
    focusFirst,
    summary,
    hasErrors,
  };
}
