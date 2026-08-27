/**
 * Testing registry integrity
 *
 * The registry restates, by hand, both the set of routes the app declares and
 * the gate each one enforces. Nothing in the type system ties either half to
 * the routers it describes, so both drift the moment a module gains a screen
 * or an officer's grant is narrowed — and the drift is invisible: a tester
 * reads "needs events.manage", finds the page opens anyway, and files a bug
 * against the gate rather than against this list.
 *
 * So it is checked the way routeIntegrity.test.ts checks navigation targets:
 * by walking the same sources.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TEST_PAGES, TESTING_GROUPS, buildTestUrl, routeParams } from './testingRegistry';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SRC, '../..');

/** Every file that declares routes: App.tsx plus each module's routes.tsx. */
const routeSources = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...routeSources(full));
    } else if (entry.name === 'routes.tsx') {
      found.push(full);
    }
  }
  return found;
};

interface DeclaredRoute {
  path: string;
  file: string;
  permission?: string;
  anyPermission?: string;
  role?: string;
  module?: string;
}

/**
 * The gate belonging to one route.
 *
 * Read from a window that starts at the `<Route` tag and stops at the next
 * one, so a sibling route's `<ProtectedRoute>` cannot be mistaken for this
 * one's — the routers declare these back to back.
 */
const declaredRoutes = (): DeclaredRoute[] => {
  const files = [...routeSources(SRC), path.join(SRC, 'App.tsx')];
  const seen = new Map<string, DeclaredRoute>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<Route\b/g)) {
      const window = source.slice(match.index, match.index + 900);
      const routePath = window.match(/path=(?:"([^"]+)"|'([^']+)')/);
      if (!routePath) continue;
      const declared = routePath[1] ?? routePath[2] ?? '';
      if (declared === '*' || seen.has(declared)) continue;
      const nextRoute = window.slice(1).search(/<Route\s/);
      const scope = nextRoute > -1 ? window.slice(0, nextRoute + 1) : window;
      seen.set(declared, {
        path: declared,
        file: path.relative(SRC, file),
        ...(scope.match(/requiredPermission="([^"]+)"/)
          ? { permission: scope.match(/requiredPermission="([^"]+)"/)?.[1] }
          : {}),
        ...(scope.match(/requiredAnyPermission=\{([^}]*)\}/)
          ? { anyPermission: scope.match(/requiredAnyPermission=\{([^}]*)\}/)?.[1] }
          : {}),
        ...(scope.match(/requiredRole="([^"]+)"/) ? { role: scope.match(/requiredRole="([^"]+)"/)?.[1] } : {}),
        ...(scope.match(/requiredModule="([^"]+)"/) ? { module: scope.match(/requiredModule="([^"]+)"/)?.[1] } : {}),
      });
    }
  }
  return [...seen.values()];
};

const routes = declaredRoutes();
const registry = new Map(ALL_TEST_PAGES.map((page) => [page.path, page]));

describe('testing registry', () => {
  it('finds the routers', () => {
    // Guards the walk itself: a parser that matches nothing would make every
    // assertion below vacuously true.
    expect(routes.length).toBeGreaterThan(150);
  });

  it('lists every route the application declares', () => {
    const missing = routes.filter((route) => !registry.has(route.path)).map((route) => `${route.path} (${route.file})`);
    expect(missing, 'routes exist that the testing home would never show').toEqual([]);
  });

  it('lists no route the application does not declare', () => {
    const declared = new Set(routes.map((route) => route.path));
    const orphans = ALL_TEST_PAGES.filter((page) => !declared.has(page.path)).map((page) => page.path);
    expect(orphans, 'the testing home offers links the router would send to the dashboard').toEqual([]);
  });

  it('records each route only once', () => {
    const paths = ALL_TEST_PAGES.map((page) => page.path);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it('repeats each route gate exactly', () => {
    const wrong: string[] = [];
    for (const route of routes) {
      const page = registry.get(route.path);
      if (!page) continue;

      if ((route.permission ?? undefined) !== (page.permission ?? undefined)) {
        wrong.push(
          `${route.path}: route requires ${route.permission ?? 'nothing'}, registry says ${page.permission ?? 'nothing'}`
        );
      }
      if ((route.module ?? undefined) !== (page.module ?? undefined)) {
        wrong.push(`${route.path}: route module ${route.module ?? 'none'}, registry says ${page.module ?? 'none'}`);
      }
      if ((route.role ?? undefined) !== (page.role ?? undefined)) {
        wrong.push(`${route.path}: route role ${route.role ?? 'none'}, registry says ${page.role ?? 'none'}`);
      }

      if (!route.anyPermission) {
        if (page.anyPermission) wrong.push(`${route.path}: registry invents an any-of gate`);
        continue;
      }
      const literals = [...route.anyPermission.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (literals.length > 0) {
        // A literal list is compared entry for entry.
        const recorded = [...(page.anyPermission ?? [])];
        if (recorded.join(',') !== literals.join(',')) {
          wrong.push(
            `${route.path}: any-of gate is ${literals.join(' or ')}, registry says ${recorded.join(' or ') || 'nothing'}`
          );
        }
      } else if (!page.anyPermission?.length) {
        // A shared constant (FACILITY_ENTRY_PERMISSIONS and friends) — the
        // registry imports the same one, so only its presence is checkable.
        wrong.push(`${route.path}: route has an any-of gate the registry drops`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('marks a route as a redirect only when it redirects', () => {
    const files = [...routeSources(SRC), path.join(SRC, 'App.tsx')].map((file) => fs.readFileSync(file, 'utf8'));
    for (const page of ALL_TEST_PAGES) {
      if (!page.redirectsTo) continue;
      const target = `<Navigate to="${page.redirectsTo}"`;
      expect(
        files.some((source) => source.includes(target)),
        `${page.path} claims to redirect to ${page.redirectsTo}, which no route does`
      ).toBe(true);
    }
  });

  it('points only at sections TESTING_CHECKLIST.md actually has', () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, 'TESTING_CHECKLIST.md'), 'utf8');
    for (const group of TESTING_GROUPS) {
      if (!group.checklistSection) continue;
      expect(doc, `no "## ${group.checklistSection}" heading`).toContain(`## ${group.checklistSection}`);
    }
  });

  it('gives every group a unique id and every page a label', () => {
    const ids = TESTING_GROUPS.map((group) => group.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const page of ALL_TEST_PAGES) {
      expect(page.label.trim().length, `${page.path} has no label`).toBeGreaterThan(0);
    }
  });
});

describe('route parameters', () => {
  it('reads every :param in order', () => {
    expect(routeParams('/display/:code/events/:eventId/guest')).toEqual(['code', 'eventId']);
    expect(routeParams('/events')).toEqual([]);
  });

  it('withholds the link until every parameter has a value', () => {
    expect(buildTestUrl('/events/:id/edit', {})).toBeNull();
    expect(buildTestUrl('/events/:id/edit', { id: '   ' })).toBeNull();
    expect(buildTestUrl('/events/:id/edit', { id: 'abc' })).toBe('/events/abc/edit');
  });

  it('escapes a value that would otherwise change the path', () => {
    expect(buildTestUrl('/members/:userId', { userId: 'a/b' })).toBe('/members/a%2Fb');
  });

  it('needs no parameters for a plain route', () => {
    expect(buildTestUrl('/dashboard', {})).toBe('/dashboard');
  });
});
