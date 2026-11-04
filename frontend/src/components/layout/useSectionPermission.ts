import { useAuthStore } from '../../stores/authStore';

const DENY_ALL = (): boolean => false;

/**
 * The viewer's permission predicate, denying everything when the store hands
 * back no function — as `Breadcrumbs` does and for the same reason: page suites
 * stub `useAuthStore` with only the slice the page reads, some ignoring the
 * selector and returning the whole stub, and a navigation strip must never be
 * what stops a page rendering.
 */
export function useSectionPermission(): (permission: string) => boolean {
  const storePredicate: unknown = useAuthStore((state) => state.checkPermission);
  return typeof storePredicate === 'function' ? (storePredicate as (permission: string) => boolean) : DENY_ALL;
}
