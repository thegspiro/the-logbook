/**
 * Open the record a deep link names, once the list holding it has loaded.
 *
 * The inventory hub's "Needs attention" queue is a list of decisions, and each
 * row's action is a link to the page that makes that decision — "Review" on a
 * pending write-off, "Check in" on an overdue loan. Every one of those links
 * carried the record's id as a query parameter, and not one of the six target
 * pages read it: the officer clicked Review on a named request and arrived at
 * an unfiltered list of every request, to find it again by eye.
 *
 * Usage — the page keeps its own list and its own modal state, and this only
 * connects the URL to them:
 *
 *   useDeepLinkedRecord('request', writeOffs, (w) => w.id, (w) =>
 *     setReviewModal({ open: true, item: w })
 *   );
 *
 * Two behaviours worth knowing:
 *
 *  * An id naming no loaded record is a **no-op, not an error**. Between the
 *    queue rendering and the click, somebody else may have resolved the row;
 *    arriving at a working page is the right outcome, an error toast about a
 *    request that no longer needs anyone is not.
 *  * The parameter is **removed once consumed**, with `replace`. That keeps
 *    the URL describing where the reader is rather than how they got there, so
 *    closing the modal and pressing Back does not reopen it, and following the
 *    same link a second time still works.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

export function useDeepLinkedRecord<T>(
  /** Query parameter carrying the record id, e.g. `request` or `checkout`. */
  param: string,
  records: readonly T[],
  idOf: (record: T) => string,
  onOpen: (record: T) => void
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(param);

  // The callbacks are read through a ref so an inline arrow at the call site —
  // which is every call site — does not make this effect a render loop.
  const idOfRef = useRef(idOf);
  const onOpenRef = useRef(onOpen);
  idOfRef.current = idOf;
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!requested) return;
    const match = records.find((record) => idOfRef.current(record) === requested);
    if (!match) return;

    onOpenRef.current(match);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(param);
        return next;
      },
      { replace: true }
    );
  }, [param, requested, records, setSearchParams]);
}

export default useDeepLinkedRecord;
