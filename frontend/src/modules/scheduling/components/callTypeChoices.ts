/**
 * The vocabulary logic behind `CallTypeChips`, split into its own module.
 *
 * `react-refresh/only-export-components` wants a component file to export
 * only the component: fast refresh cannot tell a component export from a
 * plain value export, so it remounts the whole tree on any edit to either.
 * These two builders and the type they share carry no JSX and are the two
 * non-component exports that used to sit in `CallTypeChips.tsx`.
 */

import type { CallTypeOption } from '../types';

export interface CallTypeChoice {
  /** What is stored when the chip is selected. */
  value: string;
  /** What the officer reads. */
  label: string;
}

/**
 * Choices for a report whose stored values are this department's slugs.
 *
 * Two things beyond the active list, both about not losing what is already on
 * the report:
 *
 * - A **retired** type still on it is offered, so it renders as selected and
 *   can be removed. Retirement stops a type being newly picked; it does not
 *   erase the reports that name it.
 * - A stored value the department no longer configures at all — a type deleted
 *   before deletion was guarded — is offered as itself. There is no label left
 *   for it, but a chip nobody can see is one an officer cannot remove, and
 *   saving without it would drop the value silently.
 *
 * `stored` is the report's saved list rather than the live form, so a chip
 * does not vanish the moment it is deselected.
 */
export const orgCallTypeChoices = (configured: CallTypeOption[], stored: string[]): CallTypeChoice[] => {
  const known = new Set(configured.map((t) => t.slug));
  const onReport = new Set(stored);
  return [
    ...configured.filter((t) => t.active || onReport.has(t.slug)).map((t) => ({ value: t.slug, label: t.label })),
    ...stored.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ];
};

/**
 * Choices for a value stored as text — a report on detailed tracking, a manual
 * report, the call log — drawn from the same department list as everything
 * else, storing each type's **label**.
 *
 * Text rather than the slug because these columns are read as text: the call
 * log's `incident_type` goes out through the NFIRS and NEMSIS exports and comes
 * in through the ePCR import, and a report's text list is shown as written.
 * The server matches requirements by type, so a label and its slug credit the
 * same requirement.
 *
 * As with `orgCallTypeChoices`, a stored value the list does not offer — a
 * retired type, or wording typed before the picker existed — is kept as its
 * own chip so it can still be seen and removed.
 */
export const labelCallTypeChoices = (configured: CallTypeOption[], stored: string[]): CallTypeChoice[] => {
  const offered = configured.filter((t) => t.active || stored.includes(t.label)).map((t) => t.label);
  const known = new Set(offered);
  return [
    ...offered.map((label) => ({ value: label, label })),
    ...stored.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v })),
  ];
};
