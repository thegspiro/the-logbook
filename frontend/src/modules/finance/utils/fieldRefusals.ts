/**
 * The owner's save rule (2026-11-05) for Finance dialogs, in one place.
 *
 * A create sends nothing until every field is accepted, so a 422 only needs
 * its entries put on their fields (`refusalsOnFields`). A single-save edit
 * writes what it can: the refused fields are dropped from the payload and the
 * rest is sent again, and the dialog stays open with those fields flagged
 * (`updateExceptRefused`). Either way an entry the form has no field for is a
 * real failure, and the original error is rethrown for the caller to report.
 */

import { useCallback, useState } from 'react';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** The form's field errors and a setter that clears one as it is edited. */
export function useDialogFieldErrors<K extends string>() {
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const clearError = useCallback(
    (field: K) =>
      setErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }),
    []
  );
  return { errors, setErrors, clearError };
}

/** The first field with an error, in the order the form declares them. */
export function firstErrorField<K extends string>(errors: FieldErrors<K>, order: readonly K[]): K | undefined {
  return order.find((key) => errors[key]);
}

/**
 * A 422's entries on the form's fields, or `null` when the failure is not one
 * the form can show on a field (no entry matched, or one matched nothing).
 */
export function refusalsOnFields<K extends string>(
  err: unknown,
  specs: Record<K, ServerFieldSpec>
): { fieldErrors: FieldErrors<K>; unmatched: string[] } | null {
  const mapped = mapServerFieldErrors(err, specs);
  if (!mapped || Object.keys(mapped.fieldErrors).length === 0) return null;
  return mapped;
}

/**
 * Sends an update; on a 422 that names only fields the form has, sends it
 * again without them. Returns what was saved and what was refused.
 */
export async function updateExceptRefused<K extends string, P extends object, R>(
  send: (payload: P) => Promise<R>,
  payload: P,
  specs: Record<K, ServerFieldSpec>,
  payloadKeys: Partial<Record<K, readonly (keyof P)[]>>
): Promise<{ saved: R; refused: FieldErrors<K> }> {
  try {
    return { saved: await send(payload), refused: {} };
  } catch (err: unknown) {
    const mapped = refusalsOnFields(err, specs);
    if (!mapped || mapped.unmatched.length > 0) throw err;
    const rest: P = { ...payload };
    for (const key of Object.keys(mapped.fieldErrors) as K[]) {
      for (const sent of payloadKeys[key] ?? []) delete rest[sent];
    }
    return { saved: await send(rest), refused: mapped.fieldErrors };
  }
}
