import { useEffect, useRef } from 'react';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

/**
 * Brings a list's detail pane into view when a different item opens, on
 * screens where the pane stacks below the list (under Tailwind's `lg`).
 * Without it, tapping a row on a phone changes content far below the fold
 * and nothing visibly happens.
 *
 * Keyed on the loaded item's id, not on the tap, so a notification link that
 * opens straight onto an item lands on it too.
 */
export function useScrollDetailIntoView<T extends HTMLElement>(detailId: string | null | undefined) {
  const ref = useRef<T>(null);
  const sideBySide = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    if (!detailId || sideBySide) return;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [detailId, sideBySide]);

  return ref;
}
