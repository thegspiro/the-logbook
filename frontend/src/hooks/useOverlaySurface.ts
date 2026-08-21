import { useEffect, useSyncExternalStore } from 'react';

/**
 * Tracks whether any viewport-covering overlay — dialog, drawer or bottom sheet
 * — is on screen, so the mobile bottom navigation can get out of its way.
 *
 * The bar is `fixed bottom-0 z-50` and AppLayout renders it after the page
 * content, so it paints over any dialog sharing z-50 rather than under it.
 * Measured on a 390x844 viewport: a dialog taller than the viewport buries its
 * action row 40px behind the bar, and on a notched phone — where the bar grows
 * by `env(safe-area-inset-bottom)` — even a `max-h-[90dvh]` dialog loses 32px.
 * `elementFromPoint` returns the nav there, so the buttons are not merely hidden
 * but untappable, and the tap navigates the page out from under the dialog.
 *
 * Hiding the bar rather than padding every dialog around it also settles a
 * second defect: the bar sat above the scrim undimmed and fully clickable while
 * `aria-modal="true"` claimed everything outside the dialog was inert.
 *
 * Deliberately a separate stack from useDialog's `openDialogs`, which owns
 * Escape routing and the body scroll lock. A drawer that only wants the bar out
 * of the way must not be able to join that stack and strand the scroll lock —
 * it never locked scroll, so it would have nothing to release on close.
 */
const openSurfaces: symbol[] = [];
const subscribers = new Set<() => void>();

const emit = (): void => {
  for (const notify of subscribers) notify();
};

const subscribe = (onStoreChange: () => void): (() => void) => {
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
};

const getSnapshot = (): boolean => openSurfaces.length > 0;

/**
 * Declare that this component is showing an overlay for as long as it is
 * mounted and `isOpen`. Callers that mount only while open can omit the flag.
 */
export function useOverlaySurface(isOpen = true): void {
  useEffect(() => {
    if (!isOpen) return;

    const id = Symbol('overlay-surface');
    openSurfaces.push(id);
    emit();

    return () => {
      const index = openSurfaces.indexOf(id);
      if (index !== -1) openSurfaces.splice(index, 1);
      emit();
    };
  }, [isOpen]);
}

/** True while at least one overlay is open. Stays true for stacked overlays. */
export function useAnyOverlaySurface(): boolean {
  // Server snapshot is false: nothing is open before hydration, and returning
  // true would render the layout without its bottom bar on first paint.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
