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
import { LEGAL_DOCUMENTS_PERMISSIONS } from '../modules/governance/routes';
import { MEDICAL_VIEW_PERMISSIONS } from '../modules/medical-supplies/routes';
import {
  MEMBERS_SETTINGS_ANY_PERMISSION,
  MEMBERS_SETTINGS_EVOC_GATE,
  MEMBERS_SETTINGS_IDS_GATE,
  MEMBERS_SETTINGS_RANKS_GATE,
  MEMBERS_SETTINGS_VISIBILITY_GATE,
} from '../modules/membership/routes';

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

/**
 * Resolve the expression inside `requiredAnyPermission={…}`.
 *
 * It is not always a literal. Routes that share a gate reference an exported
 * constant, and the Members settings routes derive theirs from the section
 * manifest so the permission is written once, beside the endpoint it mirrors.
 *
 * The regex only ever understood the literal form, and returned `[]` for every
 * other — which reads as "this route has no gate", the most permissive possible
 * answer to a question it could not parse. Two routes were already being read
 * that way before these helpers were extended. An expression this cannot
 * resolve now throws instead: a new shared gate has to be registered here, and
 * failing loudly on the way in is the point.
 */
const resolveAnyPermission = (expression: string, routePath: string): string[] => {
  if (expression.startsWith('[')) {
    return [...expression.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
  }

  const constants: Record<string, string[]> = {
    MEMBERS_SETTINGS_ANY_PERMISSION,
    MEMBERS_SETTINGS_VISIBILITY_GATE,
    MEMBERS_SETTINGS_IDS_GATE,
    MEMBERS_SETTINGS_RANKS_GATE,
    MEMBERS_SETTINGS_EVOC_GATE,
    LEGAL_DOCUMENTS_PERMISSIONS,
    MEDICAL_VIEW_PERMISSIONS,
  };
  const named = constants[expression];
  if (named) return named;

  throw new Error(
    `routeGate cannot resolve the gate on ${routePath}: requiredAnyPermission={${expression}}. ` +
      'Register the constant or call form in src/test/routeGates.ts — an unreadable gate must not read as no gate.'
  );
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

  const any = guard.match(/requiredAnyPermission=\{([^}]*)\}/);
  const single = guard.match(/requiredPermission="([^"]+)"/);
  const module = guard.match(/requiredModule="([^"]+)"/);

  const permissions =
    any?.[1] !== undefined ? resolveAnyPermission(any[1].trim(), routePath) : single?.[1] ? [single[1]] : [];

  return { permissions, module: module?.[1] ?? null, exists: true };
};

/** A navigation target's path with any query string or hash removed. */
export const barePath = (target: string): string => target.split(/[?#]/)[0] ?? target;
