/**
 * Between the form's stored answers and the sweep's.
 *
 * The sweep is a different way to *ask*, not a different thing to store. Every
 * answer still lands in `EquipmentCheckForm`'s `results` and `seals`, which is
 * what the draft persists, what the offline queue carries, and what submit
 * reads — so the two screens can hold the same walk and a crew can be moved
 * between them without losing a tap.
 *
 * That only works while the translation is exact in both directions, which is
 * what this file is for: a bridge with its own tests, rather than a handful of
 * inline casts spread through a 2,700-line component.
 */

import type { CheckItemAnswer } from './CheckItemControls';
import type { AnswerMap, SealState } from './checkLapModel';
import type { ItemResult } from './EquipmentCheckForm';
import type { SealState as FormSealState } from '@/modules/scheduling/components/SealPanel';

/**
 * The form's results, as the sweep reads them.
 *
 * A straight widening: `ItemResult` is `CheckItemAnswer` minus the two fields
 * below, and `CheckItemStatus` is the same union as the answer's `status`.
 */
export function toAnswerMap(results: Record<string, ItemResult>): AnswerMap {
  return results;
}

/**
 * One answer, as the form stores it.
 *
 * `restockNeeded` is deliberately dropped. It is not a fact about the answer —
 * it is "this count came in under par", which `stopRestocks` derives from the
 * quantity and the par every time it is asked. Storing it too would let the
 * two disagree after a par change, and the stored one would be the stale half.
 */
export function toItemResult(patch: Partial<CheckItemAnswer>): Partial<ItemResult> {
  const { restockNeeded: _restockNeeded, ...rest } = patch;
  return rest;
}

/**
 * The seal answer the form should record for a sweep verdict.
 *
 * The sweep asks one question — is the tag on the container the tag on the
 * record — so `intact` and `cleared` move together where it is the one asking.
 * A tag that does not match is answered with the same button as a broken one,
 * because both mean the same thing to the crew: no evidence it stayed shut, so
 * count it. The accordion can still record the finer distinction, and
 * `toLapStops` reads it back faithfully; this only says what the sweep writes.
 */
export function toFormSeal(patch: Partial<SealState>, tagOnRecord: string | null | undefined): FormSealState {
  const intact = patch.status === 'intact';
  return {
    sealNumber: tagOnRecord ?? '',
    intact,
    confirmed: patch.status !== undefined,
    cleared: intact && patch.cleared !== false,
  };
}
