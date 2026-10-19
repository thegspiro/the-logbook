/**
 * The display label for an entry's status. W70: the member's list and the
 * officer's All Entries tab printed the raw code ("pending", "active").
 */
const ENTRY_STATUS_LABELS: Record<string, string> = {
  active: 'Clocked in',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/** An unknown status (added on the server first) still reads, as itself. */
export function entryStatusLabel(status: string): string {
  return ENTRY_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
