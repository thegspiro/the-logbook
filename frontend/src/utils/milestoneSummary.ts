/**
 * Plain-language summaries of a training program milestone — what reaches it
 * and who is told — shared by the pipeline page and the member's progress page.
 */
import type { MilestoneMatchMode, ProgramMilestone } from '../types/training';

interface TriggerParts {
  completion_percentage_threshold?: number | null | undefined;
  item_match_mode?: MilestoneMatchMode | undefined;
}

/** "Pump Operations", "all of Pump Operations and Hydraulics Exam", "any of …". */
export function describeItems(names: string[], mode: MilestoneMatchMode | undefined): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  const last = names[names.length - 1] ?? '';
  const list = `${names.slice(0, -1).join(', ')} ${mode === 'any' ? 'or' : 'and'} ${last}`;
  return mode === 'any' ? `any of ${list}` : `all of ${list}`;
}

/** "At 50% complete and after completing all of …". */
export function describeTrigger(milestone: TriggerParts, itemNames: string[]): string {
  const pct = milestone.completion_percentage_threshold;
  const items = describeItems(itemNames, milestone.item_match_mode);
  const percentage = pct === null || pct === undefined ? '' : `At ${Math.round(pct)}% complete`;
  if (percentage && items) return `${percentage} and after completing ${items}`;
  if (percentage) return percentage;
  if (items) return `After completing ${items}`;
  return 'No trigger set — this milestone is never reached';
}

/** Who a milestone tells, as officers see it. */
export function describeRecipients(milestone: ProgramMilestone): string {
  const names: string[] = [];
  if (milestone.notify_member !== false) names.push('the member');
  for (const position of milestone.notify_positions ?? []) names.push(position.name || 'a former position');
  for (const user of milestone.notify_users ?? []) names.push(user.name || 'a former member');
  if (names.length === 0) return 'Nobody is told';
  return `Tells ${names.join(', ')}`;
}

/** Percentage milestones in order, then milestones that wait only on items. */
export function compareMilestones(a: TriggerParts, b: TriggerParts): number {
  const pa = a.completion_percentage_threshold;
  const pb = b.completion_percentage_threshold;
  if (pa === null || pa === undefined) return pb === null || pb === undefined ? 0 : 1;
  if (pb === null || pb === undefined) return -1;
  return pa - pb;
}
