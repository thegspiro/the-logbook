/**
 * The editable fields of an agenda item, their limits and how a form files a
 * refusal against one, shared by the agenda editor and the dialogs that save it.
 */

/** utils/agenda_items.py on the backend: MAX_TITLE, MAX_PRESENTER, MAX_NOTES, MAX_MOTION_TEXT. */
export const AGENDA_ITEM_LIMITS = { title: 200, presenter: 200, notes: 2000, motion_text: 2000 } as const;
export type AgendaItemField = keyof typeof AGENDA_ITEM_LIMITS;

/** The key an item field's refusal is filed under in the editor's `errors`. */
export const agendaErrorKey = (itemKey: string, field: AgendaItemField) => `${itemKey}.${field}`;

/** The id of an item field's control, so a form can focus the first refusal. */
export const agendaFieldId = (idPrefix: string, itemKey: string, field: AgendaItemField) =>
  `${idPrefix}-${itemKey}-${field === 'motion_text' ? 'motion' : field}`;
