/**
 * The owner's single-save rule for an edit (2026-11-05, docs/KNOWN_LIMITATIONS.md
 * "Forms — Save With an Error"): a refused field does not hold the rest of an
 * edit back. Its key is left out of the update, which the backend reads as
 * "leave alone" (`exclude_unset`), so the stored value survives, the rest
 * saves, and the form keeps the field flagged.
 *
 * Batches 16 and 17 wrote this loop inline in each dialog; it is the same
 * three steps every time, so later forms share it:
 *
 *   1. send the payload without the fields already refused locally;
 *   2. if the server answers with a 422 whose every entry belongs to a field
 *      of this form, add those to the refused set and send once more without
 *      them;
 *   3. anything else — a 422 naming a key the form does not show, a 403, a
 *      network failure, or a second refusal — is thrown to the caller, which
 *      reports it the way it reports any failed save.
 *
 * Only for an update whose payload keys map one to one onto the form's
 * fields. An update that replaces a whole record (an agenda, a suggestion box)
 * cannot leave a key out, and keeps its own handling.
 */

export interface PlacedRefusals<K extends string> {
  fieldErrors: Partial<Record<K, string>>;
  unmatched: string[];
}

export interface SaveExceptRefusedOptions<K extends string, T> {
  /** Every key the form owns, as the update would send them. */
  payload: Record<string, unknown>;
  /** Fields the form refused before sending (a blank required name, say). */
  refused: Partial<Record<K, string>>;
  /** The payload keys a form field writes; defaults to the field's own name. */
  keysFor?: (field: K) => readonly string[];
  send: (body: Record<string, unknown>) => Promise<T>;
  /** `mapServerFieldErrors` or `placeApiError`, bound to this form's fields. */
  place: (error: unknown) => PlacedRefusals<K> | null;
}

export interface SaveExceptRefusedResult<T, K extends string> {
  result: T;
  /** Every field left out of what was saved, with the reason; empty when all of it saved. */
  refused: Partial<Record<K, string>>;
}

export async function saveExceptRefused<K extends string, T>({
  payload,
  refused,
  keysFor = (field) => [field],
  send,
  place,
}: SaveExceptRefusedOptions<K, T>): Promise<SaveExceptRefusedResult<T, K>> {
  const without = (skip: Partial<Record<K, string>>) => {
    const body: Record<string, unknown> = { ...payload };
    for (const field of Object.keys(skip) as K[]) {
      for (const key of keysFor(field)) delete body[key];
    }
    return body;
  };

  try {
    return { result: await send(without(refused)), refused };
  } catch (err) {
    const placed = place(err);
    const fieldKeys = placed ? (Object.keys(placed.fieldErrors) as K[]) : [];
    // A refusal this form cannot point at is not one it can save around.
    if (!placed || fieldKeys.length === 0 || placed.unmatched.length > 0) throw err;
    const next = { ...refused, ...placed.fieldErrors };
    return { result: await send(without(next)), refused: next };
  }
}

/** The first refused field in the form's own order, for the "saved, except" notice. */
export function firstRefused<K extends string>(
  order: readonly K[],
  refused: Partial<Record<K, string>>
): K | undefined {
  return order.find((field) => refused[field]);
}
