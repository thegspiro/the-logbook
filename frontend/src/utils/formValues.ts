/**
 * Coercions for turning form state into API payloads.
 *
 * Create and update payloads want *opposite* things from a blank field, and
 * conflating them is the reason a cleared field silently comes back:
 *
 * - On **create**, a blank optional field should be omitted (`undefined`) so
 *   it never reaches a Pydantic validator as `""`. That is the `|| undefined`
 *   idiom documented in CLAUDE.md, and it stays correct there.
 * - On **update**, omitting is wrong. The backend dumps update payloads with
 *   `exclude_unset`, so an omitted key means "leave this alone" — the user
 *   emptied the box, the key never left the browser, and the old value
 *   survives behind a success toast.
 *
 * `blankToNull` is the update-path counterpart: it sends an explicit `null`,
 * which the backend's `apply_updates` writes through as a clear.
 */

/**
 * Trim a text input for an update payload, sending `null` when it is blank.
 *
 * Use on update/edit forms. Use `|| undefined` on create forms.
 */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse a numeric text input for an update payload, sending `null` when the
 * field is blank so the stored value is cleared rather than left stale.
 *
 * Returns `null` for a blank or non-numeric entry.
 */
export function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The create/edit pair of coercions for a form that builds one payload for both.
 *
 * Most edit forms in this codebase reuse a single `…Create` payload shape, and
 * the mode is the only thing that decides what a blank box means. Reaching for
 * `blankToNull` per field means every field is a separate chance to forget —
 * which is exactly how the inventory item form ended up with two fields fixed
 * and sixteen still dropping the user's clear.
 *
 *   const { text, pick, num } = formCoercions(Boolean(editItem));
 *   description: text(f.description),   // trimmed string
 *   category_id: pick(f.category_id),   // select / date, already exact
 *   reorder_point: num(f.reorder_point) // numeric text
 *
 * Fields the backend cannot take a null for — a NOT NULL enum column, or one a
 * service guard dereferences — must stay `|| undefined` with a comment saying
 * which, since nothing here can tell.
 */
export function formCoercions(isEdit: boolean): {
  text: (value: string) => string | null | undefined;
  pick: (value: string) => string | null | undefined;
  num: (value: string) => number | null | undefined;
} {
  return {
    text: (value) => (isEdit ? blankToNull(value) : value.trim() || undefined),
    pick: (value) => (isEdit ? value || null : value || undefined),
    num: (value) => (isEdit ? numberOrNull(value) : value ? Number(value) : undefined),
  };
}
