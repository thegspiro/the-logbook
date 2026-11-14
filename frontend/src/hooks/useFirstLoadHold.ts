import { useEffect, useState } from 'react';

/**
 * The longest a page keeps content invisible on first load. Past this it is
 * shown regardless: whatever arrives later still moves what is under it, but a
 * slow request never hides the page's own work for longer than a moment.
 */
export const FIRST_LOAD_HOLD_MS = 1000;

/**
 * Whether content should stay invisible because something above it has not
 * loaded yet and may or may not take up room when it does — a queue drawn only
 * when there are items, a card drawn only while clocked in.
 *
 * Content drawn in the meantime is pushed down when that arrives. Laid out but
 * invisible (`invisible`, never `hidden`), it still mounts, fetches and
 * measures itself, nobody sees it move — nor does the layout-shift metric
 * count it — and it appears already in place.
 *
 * First load only: once `waiting` has been false, or the cap has passed, this
 * stays false, so a refresh later keeps the page on screen.
 */
export function useFirstLoadHold(waiting: boolean): boolean {
  const [released, setReleased] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!waiting) setReleased(true);
  }, [waiting]);

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), FIRST_LOAD_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  return waiting && !released && !expired;
}
