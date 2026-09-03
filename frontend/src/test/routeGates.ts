/**
 * Read the gate a route actually enforces, out of the route source.
 *
 * Nothing in the type system connects a navigation entry's gate to the gate on
 * the route it targets, so the two drift silently and the drift is only ever
 * visible as Access Denied reached from a control the app itself offered.
 * These helpers let a test resolve the real gate and compare.
 *
 * The invariant every caller checks is the same one:
 *
 *   A navigation gate must be a SUBSET of its route's gate.
 *
 * `checkPermission` is exact match plus module wildcard — `inventory.manage`
 * does not imply `inventory.view`, and `storefront.view` does not imply
 * `storefront.manage` — so a superset gate is a promise the router refuses to
 * keep. Narrower than the route only ever hides a control, which is safe.
 *
 * Extracted from `navGateIntegrity.test.ts`, which still owns the nav-surface
 * assertions; the inventory hub's card registry checks itself the same way.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every file that can define a `<Route>`, concatenated once. */
export const routeSources = (): string => {
  const modulesDir = path.join(SRC, 'modules');
  const files = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesDir, entry.name, 'routes.tsx'))
    .filter((file) => fs.existsSync(file));
  return [path.join(SRC, 'App.tsx'), ...files].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
};

export interface RouteGate {
  permissions: string[];
  module: string | null;
  /** False when no `<Route>` declares this path at all. */
  exists: boolean;
}

/**
 * Read the gate a route actually enforces.
 *
 * The slice runs from the `path="…"` attribute to the next `<Route` so a
 * neighbouring route's `ProtectedRoute` cannot bleed in, and only the first
 * `<ProtectedRoute` opening tag inside it is read — that is the one wrapping
 * the element, whatever `<Suspense>` sits either side of it.
 */
export const routeGate = (sources: string, routePath: string): RouteGate => {
  const marker = `path="${routePath}"`;
  const start = sources.indexOf(marker);
  if (start === -1) return { permissions: [], module: null, exists: false };

  const nextRoute = sources.indexOf('<Route', start);
  const block = sources.slice(start, nextRoute === -1 ? sources.length : nextRoute);

  const guardStart = block.indexOf('<ProtectedRoute');
  if (guardStart === -1) return { permissions: [], module: null, exists: true };
  const guard = block.slice(guardStart, block.indexOf('>', guardStart));

  const any = guard.match(/requiredAnyPermission=\{\[([^\]]*)\]\}/);
  const single = guard.match(/requiredPermission="([^"]+)"/);
  const module = guard.match(/requiredModule="([^"]+)"/);

  const permissions = any?.[1]
    ? [...any[1].matchAll(/'([^']+)'/g)].map((match) => match[1] as string)
    : single?.[1]
      ? [single[1]]
      : [];

  return { permissions, module: module?.[1] ?? null, exists: true };
};

/** A navigation target's path with any query string or hash removed. */
export const barePath = (target: string): string => target.split(/[?#]/)[0] ?? target;
