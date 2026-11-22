/**
 * Lazy-load a component that a page can do without.
 *
 * `lazyWithRetry` is for pages: when a chunk will not load it assumes a new
 * deploy and reloads the whole page, which is right when the page is the
 * thing being loaded. For an optional part of a page that already rendered —
 * a card on the Dashboard — the same reload throws away the page the member
 * is reading because a decoration failed, and on a patchy connection it does
 * so every time the signal drops. So a failed import here renders nothing,
 * and the next full load of the page tries again.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export function lazyOptional<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>
): LazyExoticComponent<ComponentType<P>> {
  const renderNothing: ComponentType<P> = () => null;
  return lazy(() => importFn().catch(() => ({ default: renderNothing })));
}
