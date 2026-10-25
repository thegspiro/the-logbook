/**
 * The display label for an action item's status.
 *
 * Covers both kinds of action item the app lists together: a meeting's
 * (`open`, from `ActionItemStatus` in `models/meeting.py`) and a set of
 * minutes' (`pending` and `overdue`, from `MinutesActionItemStatus` in
 * `models/minute.py`). The screens printed the stored code, lower-case and
 * with only its first underscore replaced.
 */
const ACTION_ITEM_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
};

/** An unknown status (added on the server first) still reads, as itself. */
export function actionItemStatusLabel(status: string): string {
  return ACTION_ITEM_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
