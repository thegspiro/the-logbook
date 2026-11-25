import { isAxiosError } from 'axios';
import type { ApparatusConflict } from '../../types/apparatusEvent';

/**
 * The apparatus conflicts in a 409 answer, or null for any other failure.
 *
 * Adding a crew and moving a request that has one both answer 409 with the
 * conflicts listed when the coordinator has not acknowledged them, so both
 * read the answer through here.
 */
export const conflictsFrom = (err: unknown): ApparatusConflict[] | null => {
  if (!isAxiosError(err) || err.response?.status !== 409) return null;
  const detail = (err.response.data as { detail?: { conflicts?: ApparatusConflict[] } } | undefined)?.detail;
  return Array.isArray(detail?.conflicts) ? detail.conflicts : null;
};
