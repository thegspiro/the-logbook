/**
 * The skip link's target exists on every page that owns its own shell
 *
 * `index.html` opens with `<a href="#main-content" class="skip-link">`, which is
 * how a keyboard or screen-reader user gets past the header and navigation into
 * the page — Bypass Blocks, SC 2.4.1. Inside the application that target is
 * `AppLayout`'s single `<main id="main-content">`, so every route behind sign-in
 * gets it for free.
 *
 * The pre-authentication pages do not go through `AppLayout`. Each renders its
 * own full-screen root, so each has to provide the target itself, and a page
 * that forgets leaves the first control on the page pointing at nothing. That
 * is not a visible defect: the link is only revealed on focus, and it silently
 * does nothing when it fails.
 *
 * The mobile ratchet cannot cover this. It measures `/onboarding/start` as the
 * representative onboarding step, on the assumption that the rest render the
 * same shell — and `ModuleConfigTemplate` did not, which is how it shipped
 * without the landmark while the rest of onboarding was being fixed. Reaching
 * that step in a browser needs a seeded onboarding store, or it redirects to
 * step 1 and the pass measures step 1 twice under a second name.
 *
 * So the assumption is checked where it is cheap and exact: in the source. Every
 * page component reachable outside `AppLayout` must render `id="main-content"`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Read a source file under `src/`. */
const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), 'utf8');

/**
 * The page components a chunk of route JSX references.
 *
 * Opening tag names only. Two shapes defeat anything cleverer: a route's
 * element is often wrapped (`element={<Suspense><PublicFormPage /></Suspense>}`),
 * so matching on `element=` reads `Suspense` and reports the page as covered
 * without ever looking at it; and a self-closing matcher (`<([A-Z]\w+)[^>]*\/>`)
 * reads `<Route path="/" element={<Welcome />} />` as a single `Route` tag and
 * swallows the page name inside it. Both fail by finding *fewer* pages, which
 * is why the count assertion in the first test is not decoration.
 */
const renderedComponents = (jsx: string): string[] => {
  const wrappers = new Set([
    'Route',
    'Routes',
    'Suspense',
    'Navigate',
    'React',
    'Fragment',
    'ProtectedRoute',
    'AppLayout',
    'PullToRefreshProvider',
  ]);
  return [...new Set([...jsx.matchAll(/<([A-Z]\w+)/g)].map(([, name]) => name ?? ''))].filter(
    (name) => !wrappers.has(name)
  );
};

/**
 * Everything `App.tsx` renders outside the `AppLayout` route, plus every page
 * the route factories it calls out there render.
 *
 * Derived rather than listed. It was a hardcoded array of five, and that was
 * the same mistake this test exists to catch: five public route factories
 * (`getProspectiveMembersPublicRoutes` and friends) and `FinanceApprovalPage`
 * render outside the layout, none was in the list, and all seven of their pages
 * were missing the landmark while the test passed.
 *
 * The layout boundary is found by removing the one `<Route element={... AppLayout ...}>`
 * block, brace-matched, from the `<Routes>` body. Anything left is public. The
 * count assertion below is what stops a parse that silently matches nothing.
 */
const publicPages = (): Array<{ file: string; component: string }> => {
  const app = read('App.tsx');
  const routesBody = app.slice(app.indexOf('<Routes>'), app.lastIndexOf('</Routes>'));

  // Excise the AppLayout route and its children, by `<Route>` depth.
  //
  // The tag scan has to be brace-aware. A route's `element` prop contains
  // markup — `element={<ProtectedRoute><AppLayout /></ProtectedRoute>}` — so
  // neither `[^>]*>` (which stops at the first `>` inside the prop) nor a bare
  // `/>` token (which matches every self-closing element nested anywhere in the
  // block) finds the right boundary. Both failure modes end the block early and
  // leak the protected routes into the public set.
  const tagEnd = (from: number): { end: number; selfClosing: boolean } => {
    let braces = 0;
    for (let i = from; i < routesBody.length; i++) {
      const char = routesBody[i];
      if (char === '{') braces++;
      else if (char === '}') braces--;
      else if (char === '>' && braces === 0) {
        return { end: i + 1, selfClosing: routesBody[i - 1] === '/' };
      }
    }
    return { end: routesBody.length, selfClosing: false };
  };

  const layoutStart = routesBody.lastIndexOf('<Route', routesBody.indexOf('<AppLayout'));
  let depth = 0;
  let layoutEnd = routesBody.length;
  for (let i = layoutStart; i < routesBody.length;) {
    if (routesBody.startsWith('</Route>', i)) {
      depth--;
      i += '</Route>'.length;
    } else if (routesBody.startsWith('<Route', i)) {
      const tag = tagEnd(i);
      if (!tag.selfClosing) depth++;
      i = tag.end;
    } else {
      i++;
      continue;
    }
    if (depth === 0) {
      layoutEnd = i;
      break;
    }
  }
  const publicJsx = routesBody.slice(0, layoutStart) + routesBody.slice(layoutEnd);

  // Route factories called out here render their own pages; read each one.
  const factories = [...publicJsx.matchAll(/\{(get\w+Routes)\(\)\}/g)].map(([, name]) => name ?? '');
  const factoryJsx = factories.flatMap((factory) => {
    const file = globSync(path.join(SRC, 'modules/*/routes.tsx')).find((candidate) =>
      fs.readFileSync(candidate, 'utf8').includes(`export const ${factory}`)
    );
    if (!file) throw new Error(`no module router exports ${factory}`);
    const source = fs.readFileSync(file, 'utf8');
    const from = source.indexOf(`export const ${factory}`);
    const to = source.indexOf('\nexport ', from + 1);
    return renderedComponents(source.slice(from, to === -1 ? undefined : to));
  });

  const names = [...new Set([...renderedComponents(publicJsx), ...factoryJsx])];

  // The component name travels with the file. A page file often declares
  // helper components beside the page itself, and their returns are indented
  // identically — `OrganizationSetup` has an `AddressForm` that renders *inside*
  // the page's own `<main>`. Treating its root as a render branch put a second
  // `<main id="main-content">` inside the first, which is the exact defect this
  // sweep exists to prevent, committed by the sweep's own fix.
  return names.map((name) => {
    const byFilename = globSync(path.join(SRC, `**/${name}.tsx`));
    // Ambiguity fails loudly rather than checking whichever file sorted first.
    if (byFilename.length > 1) {
      throw new Error(`expected at most one file named ${name}.tsx, found ${byFilename.length}`);
    }
    if (byFilename.length === 1) return { file: path.relative(SRC, byFilename[0] ?? ''), component: name };

    // A component can live in a file named for something else — onboarding's
    // placeholder steps share `components/PlaceholderPages.tsx`.
    const declaring = globSync(path.join(SRC, '**/*.tsx')).filter((file) =>
      new RegExp(`(?:export )?const ${name}\\b|function ${name}\\b`).test(fs.readFileSync(file, 'utf8'))
    );
    if (declaring.length !== 1) {
      throw new Error(`cannot locate ${name}: ${declaring.length} files declare it`);
    }
    return { file: path.relative(SRC, declaring[0] ?? ''), component: name };
  });
};

describe('skip link target', () => {
  const entries = publicPages().filter(
    (entry, index, all) => all.findIndex((other) => other.file === entry.file) === index
  );
  const pages = entries.map((entry) => entry.file);

  it('covers the onboarding wizard and the pre-auth pages', () => {
    // A guard against the sweep quietly emptying: if the router is refactored
    // into a shape the matcher does not read, this is what says so.
    expect(pages.length).toBeGreaterThanOrEqual(25);

    // The pages the hardcoded list missed. Named so a future refactor of the
    // router that stops reaching them fails here rather than silently shrinking
    // the sweep back to the handful it started as.
    for (const page of [
      'pages/LoginPage.tsx',
      'pages/PublicFormPage.tsx',
      'pages/BallotVotingPage.tsx',
      'pages/GuestCheckInPage.tsx',
      'pages/LocationKioskPage.tsx',
      'pages/FinanceApprovalPage.tsx',
      'pages/EventRequestStatusPage.tsx',
      'modules/prospective-members/pages/ApplicationStatusPage.tsx',
      'modules/onboarding/pages/Welcome.tsx',
    ]) {
      expect(pages, `${page} is no longer reached by the sweep`).toContain(page);
    }

    for (const page of pages) {
      expect(fs.existsSync(path.join(SRC, page)), `${page} does not exist`).toBe(true);
    }
  });

  it('is present in every render branch of every page outside AppLayout', () => {
    /**
     * Each component-level `return (<jsx>)`, not "the file mentions the id".
     *
     * Two weaker versions shipped before this one, and both passed a page whose
     * skip link went nowhere. A substring check over the file cleared
     * `ForgotPasswordPage`, which had the target on its success screen and not
     * on the form. Requiring it on every `<main>` then cleared `BallotVotingPage`,
     * whose loading, error and submitted branches render a full-screen `<div>`
     * and no `<main>` at all — so there was no tag for that rule to fail on. A
     * render state with no landmark is the same defect as one with an
     * unlabelled landmark; the user cannot skip to content either way.
     */
    const findings = entries.flatMap(({ file: page, component }) => {
      const source = read(page);
      // Only the page component's own body. A helper declared beside it in the
      // same file returns markup at the same indentation, and that markup is
      // rendered *inside* the page — so its root is not a render branch and
      // must not be given the landmark.
      const declaration = new RegExp(`(?:export\\s+)?(?:const\\s+${component}\\b|function\\s+${component}\\b)`).exec(
        source
      );
      const bodyStart = declaration?.index ?? 0;
      const next = /\n(?:export\s+)?(?:const|function)\s+[A-Z]\w*/.exec(source.slice(bodyStart + 1));
      const bodyEnd = next ? bodyStart + 1 + next.index : source.length;
      const offset = source.slice(0, bodyStart).split('\n').length - 1;
      const lines = source.slice(bodyStart, bodyEnd).split('\n');
      const missing: number[] = [];

      lines.forEach((line, index) => {
        // A component-level return, by indentation: the component body sits at
        // 2, an `if` branch inside it at 4. Deeper is a `.map()` callback or a
        // nested helper, which renders a fragment rather than a page.
        const opener = /^(\s*)return \($/.exec(line);
        if (!opener || (opener[1] ?? '').length > 4) return;

        // Balance the parens to take the whole returned expression.
        let depth = 0;
        const body: string[] = [];
        for (let k = index; k < lines.length; k++) {
          const current = lines[k] ?? '';
          depth += (current.match(/\(/g) ?? []).length - (current.match(/\)/g) ?? []).length;
          body.push(current);
          if (depth <= 0) break;
        }
        const jsx = body.slice(1).join('\n');

        // Only a branch that returns markup directly. A helper returning an
        // object whose fields hold JSX (`{ icon: <Clock /> , title: … }`) is
        // not a render state, and OnboardingCheck has one.
        if (!/^\s*</.test(jsx)) return;
        if (jsx.includes('id="main-content"')) return;

        // A root that is a local component can carry the target itself —
        // `FinanceApprovalPage` renders every branch through one `<Shell>`.
        const root = /<([A-Z]\w+)/.exec(jsx);
        if (root?.[1]) {
          const declaration = new RegExp(`const ${root[1]}[^=]*=[^=]*=>\\s*\\(`).exec(source);
          if (declaration && source.slice(declaration.index, declaration.index + 2000).includes('id="main-content"')) {
            return;
          }
        }
        missing.push(offset + index + 1);
      });

      return missing.length > 0
        ? [`${page} — no skip-link target in the branch(es) returning at line ${missing.join(', ')}`]
        : [];
    });

    expect(
      findings,
      "these pages render their own root, so each must provide the skip link's target itself, " +
        'in every state that renders: give each branch\'s root <main id="main-content">, ' +
        'or route the branches through one shared shell that has it'
    ).toEqual([]);
  });
});
