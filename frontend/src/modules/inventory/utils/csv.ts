/**
 * Escape a value for CSV while preventing spreadsheet formula execution.
 *
 * Re-exported rather than reimplemented: this was a third copy of the same
 * rule, and the shared one additionally looks past leading whitespace, so a
 * cell like " =cmd" could slip through here but not there.
 */
export { escapeCsvCell as csvEscape } from '@/utils/csv';
