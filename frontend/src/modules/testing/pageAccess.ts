/**
 * Would this route open for the signed-in member?
 *
 * Mirrors `ProtectedRoute`'s decision — permission, then role, then module —
 * so the checklist can tell a tester *why* a page will refuse before they open
 * it. Two failures look identical from the Access Denied screen and are not
 * the same defect: a missing grant is a positions problem, a switched-off
 * module is a settings one.
 *
 * A permission gate is answered by `checkPermission`, which does exact match
 * plus the `module.*` and global `*` wildcards — `inventory.manage` does not
 * imply `inventory.view`.
 */

import type { TestPageEntry } from './testingRegistry';

export type PageAccess =
  /** No gate beyond a session (or none at all, for a public page). */
  | { kind: 'open' }
  /** Gated, and the signed-in member satisfies every gate. */
  | { kind: 'allowed' }
  /** Gated, and the member holds none of the permissions that would open it. */
  | { kind: 'denied'; missing: readonly string[] }
  /** Permissions are fine; the department has the module switched off. */
  | { kind: 'module-off'; module: string };

export interface AccessContext {
  checkPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  isModuleOn: (module: string) => boolean;
}

export const evaluatePageAccess = (page: TestPageEntry, context: AccessContext): PageAccess => {
  const { checkPermission, hasRole, isModuleOn } = context;

  if (page.permission && !checkPermission(page.permission)) {
    return { kind: 'denied', missing: [page.permission] };
  }
  if (page.anyPermission && page.anyPermission.length > 0 && !page.anyPermission.some((p) => checkPermission(p))) {
    return { kind: 'denied', missing: page.anyPermission };
  }
  if (page.role && !hasRole(page.role)) {
    return { kind: 'denied', missing: [`role: ${page.role}`] };
  }
  if (page.module && !isModuleOn(page.module)) {
    return { kind: 'module-off', module: page.module };
  }
  const gated = Boolean(page.permission || page.anyPermission?.length || page.role || page.module);
  return gated ? { kind: 'allowed' } : { kind: 'open' };
};

/** The gate as written on the route, for display. */
export const describeGate = (page: TestPageEntry): string => {
  const parts: string[] = [];
  if (page.permission) parts.push(page.permission);
  if (page.anyPermission?.length) parts.push(page.anyPermission.join(' or '));
  if (page.role) parts.push(`role: ${page.role}`);
  return parts.join(' + ');
};
