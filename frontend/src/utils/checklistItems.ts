/**
 * Helpers for the steps of a CHECKLIST requirement.
 *
 * A step carries a stable `id` so an officer's sign-off survives the list being
 * reordered or a neighbouring step reworded, and `member_visible` so a
 * department can keep some steps officer-only without hiding the requirement
 * from the member.
 *
 * A step being authored client-side has no id yet — the server assigns one on
 * save — so `id` is an empty string until then. Read ids only from steps that
 * came back from the API.
 */

import type { ChecklistItem, RequirementProgressRecord } from '../types/training';

/** A blank step for the editor. The server fills in the id on save. */
export const emptyChecklistItem = (): ChecklistItem => ({
  id: '',
  text: '',
  member_visible: true,
});

/** Plain strings as steps — for starter templates authored in code. */
export const toChecklistItems = (texts: string[]): ChecklistItem[] =>
  texts.map((text) => ({ id: '', text, member_visible: true }));

/** The steps a member is allowed to see. */
export const visibleChecklistItems = (items?: ChecklistItem[]): ChecklistItem[] =>
  (items ?? []).filter((item) => item.member_visible);

/** How many steps are officer-only — surfaced to the member as a count, so the
 *  numbers on their progress bar still add up without naming the steps. */
export const hiddenChecklistCount = (items?: ChecklistItem[]): number =>
  (items ?? []).length - visibleChecklistItems(items).length;

/** The ids an officer has ticked on this progress record. */
export const checklistDoneIds = (record: RequirementProgressRecord): string[] =>
  record.progress_notes?.checklist_done ?? [];

/** Whether a given step is ticked on this record. */
export const isChecklistItemDone = (record: RequirementProgressRecord, itemId: string): boolean =>
  checklistDoneIds(record).includes(itemId);
