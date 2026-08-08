/**
 * Route integrity
 *
 * A navigation target that matches no declared route does not fail loudly: the
 * catch-all `<Route path="*" element={<Navigate to="/" replace />} />` in
 * App.tsx swallows it and drops the user on the dashboard. That is
 * indistinguishable from a button that simply does not work, and it is what
 * the Members Administration "Add Member" button did for as long as it pointed
 * at /admin/members/add — a path that never existed, since only the exact path
 * /admin/members is redirected to the hub.
 *
 * Nothing in the type system connects a `to=` string to a `path=` string, so
 * this walks the source and checks the one against the other.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Create screens that are reachable from a button but have never been built —
 * the module's API client and store expose the create call, but no page or
 * route exists to drive it. Listed rather than silently tolerated so the two
 * broken buttons stay visible; remove an entry when its screen ships.
 */
const KNOWN_MISSING_ROUTES = ['/grants/donations/new', '/grants/opportunities/new'];

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // e2e specs drive a real browser against a running app, not this router.
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const files = collectSourceFiles(SRC);

const declaredRoutes = new Set<string>();
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<Route\s[^>]*?path=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\})/gs)) {
    declaredRoutes.add(match[1] ?? match[2] ?? match[3] ?? '');
  }
}

interface NavTarget {
  file: string;
  line: number;
  target: string;
}

const navTargets: NavTarget[] = [];
for (const file of files) {
  const relative = path.relative(SRC, file);
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      // Only literal in-app paths are checkable; a template literal carrying an
      // interpolation has no fixed value to compare against a route pattern.
      for (const match of line.matchAll(/(?:\bto=|navigate\(|<Navigate\s+to=)\s*\{?\s*['"`](\/[^'"`$\n]*)['"`]/g)) {
        navTargets.push({ file: relative, line: index + 1, target: match[1] ?? '' });
      }
    });
}

/** Turns a route pattern into a matcher: `:id` accepts one segment, `*` any tail. */
const routeMatcher = (routePath: string): RegExp =>
  new RegExp(`^${routePath.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+')}$`);

const matchers = [...declaredRoutes].filter((routePath) => routePath !== '*').map(routeMatcher);

const pathOf = (target: string): string => target.split(/[?#]/)[0] || '/';

describe('route integrity', () => {
  it('finds the routes and navigation targets it is meant to check', () => {
    // Guards the regexes themselves: a silent zero-match sweep would pass every
    // assertion below while checking nothing at all.
    expect(declaredRoutes.size).toBeGreaterThan(100);
    expect(navTargets.length).toBeGreaterThan(100);
  });

  it('has no navigation target that falls through to the catch-all', () => {
    const dead = navTargets.filter((nav) => {
      const target = pathOf(nav.target);
      if (KNOWN_MISSING_ROUTES.includes(target)) return false;
      return !matchers.some((matcher) => matcher.test(target));
    });

    expect(
      dead.map((nav) => `${nav.file}:${nav.line} -> ${nav.target}`),
      'these links redirect to the dashboard instead of going anywhere'
    ).toEqual([]);
  });

  it('still reaches the Add Member tab from Members Administration', () => {
    const source = fs.readFileSync(path.join(SRC, 'pages/MembersAdminPage.tsx'), 'utf8');

    expect(source).toContain('to="/members/admin?tab=add"');
    // Matched as a link target specifically: the comment above the fix names
    // the dead path, and a bare substring check would trip over it.
    expect(source).not.toContain('to="/admin/members/add"');
  });

  it('keeps every known-missing route genuinely missing', () => {
    // Once one of these screens ships, its entry has to go, or the allowance
    // silently outlives the gap it was covering.
    for (const missing of KNOWN_MISSING_ROUTES) {
      expect(
        matchers.some((matcher) => matcher.test(missing)),
        `${missing} now has a route — drop it from KNOWN_MISSING_ROUTES`
      ).toBe(false);
    }
  });
});
