/**
 * What a DELETE actually did.
 *
 * A budget category, shift template or basic apparatus that other records
 * still use is deactivated rather than deleted, so that history keeps it. The
 * endpoints still answer 204, and say which happened in the
 * `X-Delete-Outcome` header (`backend/app/utils/delete_outcome.py`).
 */
export type DeleteOutcome = 'deleted' | 'deactivated';

/**
 * Read the outcome off an axios response. A response without the header —
 * a mocked one, or a backend older than the header — reads as `deleted`,
 * which is what every such endpoint did before deactivation existed.
 */
export function readDeleteOutcome(response: { headers?: unknown } | undefined): DeleteOutcome {
  const headers = response?.headers;
  if (typeof headers !== 'object' || headers === null) return 'deleted';
  // Header names are case-insensitive, and an AxiosHeaders object keeps the
  // case it was given, so match the name rather than index one spelling.
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-delete-outcome');
  return entry?.[1] === 'deactivated' ? 'deactivated' : 'deleted';
}
