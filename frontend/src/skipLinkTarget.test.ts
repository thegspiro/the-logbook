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
 * Does this markup set the skip link's target id?
 *
 * JSX spells one attribute four ways — `id="main-content"`, `id='main-content'`,
 * and either of those wrapped in braces as an expression — and every one of
 * them renders the same DOM. An exact substring test recognises one, so
 * `id={'main-content'}` reads to this file as no target at all, which is wrong
 * in both directions at once: a page written that way is reported as missing a
 * landmark it has, and a page *nested inside* AppLayout that writes it that way
 * duplicates the id without the sweep below noticing.
 *
 * Matching on the attribute rather than the bare string is what keeps the
 * second direction honest — `href="#main-content"` (the skip link itself) and a
 * `getElementById('main-content')` call are not landmarks and must not read as
 * ones.
 *
 * The leading `(?<![\w-])` is doing real work, not defensive padding: a `\b`
 * there matches after the hyphen in `data-id=`, so `data-id="main-content"`
 * read as the landmark while creating no such DOM id at all. That is this
 * file's own failure mode in miniature — a check satisfied by something that
 * merely looks like the thing it is checking for.
 */
const carriesTarget = (markup: string): boolean =>
  /(?<![\w-])id=(?:["']main-content["']|\{\s*(['"`])main-content\1\s*\})/.test(markup);

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
const routeJsx = (): { publicJsx: string; layoutJsx: string } => {
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
  return {
    publicJsx: routesBody.slice(0, layoutStart) + routesBody.slice(layoutEnd),
    layoutJsx: routesBody.slice(layoutStart, layoutEnd),
  };
};

/** Every page component a slice of route JSX renders, its route factories included. */
const componentsRenderedIn = (jsx: string): string[] => {
  const factories = [...jsx.matchAll(/\{(get\w+Routes)\(\)\}/g)].map(([, name]) => name ?? '');
  const fromFactories = factories.flatMap((factory) => {
    // Both declaration forms. Matching only `export const` was latent while
    // this ran on the public slice alone — every public factory happens to be
    // a const — and threw the moment it was pointed at the layout slice, where
    // `getMedicalScreeningRoutes` is an `export function`.
    const declaration = new RegExp(String.raw`export\s+(?:const|function)\s+${factory}\b`);
    const file = globSync(path.join(SRC, 'modules/*/routes.tsx')).find((candidate) =>
      declaration.test(fs.readFileSync(candidate, 'utf8'))
    );
    if (!file) throw new Error(`no module router exports ${factory}`);
    const source = fs.readFileSync(file, 'utf8');
    const from = declaration.exec(source)?.index ?? 0;
    const to = source.indexOf('\nexport ', from + 1);
    return renderedComponents(source.slice(from, to === -1 ? undefined : to));
  });
  return [...new Set([...renderedComponents(jsx), ...fromFactories])];
};

const publicPages = (): Array<{ file: string; component: string }> => {
  const names = componentsRenderedIn(routeJsx().publicJsx);

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

/**
 * Markup with its comments removed.
 *
 * `{/* <main id="main-content"> *\/}` renders nothing, and leaving one behind
 * while removing the real landmark satisfied a check for the landmark — a
 * guard passing on the *remains* of the thing it checks for, which is the
 * defect this whole file exists to prevent. Line comments are stripped only
 * when they are the whole line, so a `//` inside `href="https://…"` cannot
 * take a real `id` written after it on the same line.
 */
const withoutComments = (markup: string): string =>
  markup
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

/**
 * The render states one return can produce.
 *
 * Exactly one shape is split: a return whose entire body is a conditional,
 * bare or wrapped in a fragment. That is a choice between two documents, and
 * each must carry the landmark. A conditional anywhere else chooses *content*
 * — `<main id="main-content">{ready ? <Table/> : <Empty/>}</main>` is correct
 * and commonplace — so splitting every ternary would report dozens of pages
 * that render their landmark exactly once.
 *
 * A root-level `&&` is deliberately not split. Its false state renders
 * nothing, so requiring a target in it would report `<>{banner && <Banner/>}
 * <main id="main-content"/></>`, where the landmark is a sibling and the page
 * is right.
 */
const renderStates = (markup: string): string[] => {
  // A branch arrives with the return's own punctuation still attached — the
  // extraction keeps the `);` that closes `return (`. Left on, it defeats the
  // fragment match below and every conditional root fell through unsplit,
  // which is this function silently doing nothing at all.
  const trimmed = markup.replace(/[\s;)]+$/, '').trim();
  const fragment = /^<>([\s\S]*)<\/>$/.exec(trimmed) ?? /^<React\.Fragment>([\s\S]*)<\/React\.Fragment>$/.exec(trimmed);
  const inner = (fragment?.[1] ?? trimmed).trim();
  if (!inner.startsWith('{') || !inner.endsWith('}')) return [markup];

  const body = inner.slice(1, -1);
  let depth = 0;
  let question = -1;
  let colon = -1;
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at];
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth -= 1;
    else if (depth !== 0) continue;
    else if (character === '?' && question === -1) question = at;
    // The first depth-zero `:` after the `?` closes it. A nested ternary in
    // either arm is parenthesised in this codebase's formatting, so its colon
    // is not at depth zero.
    else if (character === ':' && question !== -1 && colon === -1) colon = at;
  }
  if (question === -1 || colon === -1) return [markup];
  return [body.slice(question + 1, colon), body.slice(colon + 1)];
};

/**
 * The line numbers of every component-level render branch in `page` that does
 * not provide the skip-link target.
 *
 * Shared by both directions of the sweep, deliberately. It was inlined in the
 * public-page check and the replacing-shell check used a file-wide
 * `includes()` instead — which is the *first* defect this whole sweep was
 * written to fix ("the file mentions the id" is not "every branch has it"),
 * reintroduced in the check meant to supersede it. `AppLayout` renders the
 * target in two branches, at its left-nav and bottom-nav roots; deleting it
 * from either one left the other, and a substring check stayed green while
 * that layout's skip link dangled.
 */
const branchesMissingTarget = (page: string, component: string): number[] => {
  const source = read(page);
  // Only this component's own body. A helper declared beside it in the same
  // file returns markup at the same indentation, and that markup is rendered
  // *inside* the component — so its root is not a render branch and must not
  // be given the landmark.
  const declaration = new RegExp(
    `(?:export\\s+)?(?:const\\s+${component}\\b|function\\s+${component}\\b|class\\s+${component}\\b)`
  ).exec(source);
  const bodyStart = declaration?.index ?? 0;
  const next = /\n(?:export\s+)?(?:const|function|class)\s+[A-Z]\w*/.exec(source.slice(bodyStart + 1));
  const bodyEnd = next ? bodyStart + 1 + next.index : source.length;
  const offset = source.slice(0, bodyStart).split('\n').length - 1;
  const lines = source.slice(bodyStart, bodyEnd).split('\n');

  // How deep a component-level return sits. A function component's body is at
  // 2 and an `if` branch inside it at 4; a class puts its returns inside
  // `render()`, two levels further in. Deeper than that is a `.map()` callback
  // or a nested helper, which renders a fragment rather than a page.
  const maxIndent = /^(?:export\s+)?class\b/.test(declaration?.[0] ?? '') ? 6 : 4;
  const missing: number[] = [];

  lines.forEach((line, index) => {
    // Both return forms. `return (` wrapping is a formatting choice, and this
    // repository already writes the other one — `return <SkeletonPage />;` in
    // StorefrontPage. Recognising only the parenthesised form would make
    // Prettier's line-length threshold part of an accessibility invariant, and
    // would silently skip a one-line loading branch in a replacement shell.
    const parenthesised = /^(\s*)return \($/.exec(line);
    const direct = /^(\s*)return (<.*)$/.exec(line);
    // A concise arrow body has no `return` at all: `const Page = () => <div/>`
    // and `= () => (` are both render branches, and this repository writes
    // them — every placeholder page in `PlaceholderPages.tsx` is one. Keying
    // solely on the `return` keyword skipped such a component silently, which
    // is the same defect as the unparenthesised-return gap one step further
    // along: a formatting choice deciding what the guard looks at.
    // …but only the component under test. An inner helper is written this way
    // far more often than a page root is — every icon in `FileStorageChoice`
    // and `AuthenticationChoice` is a `const Icon = () => (<svg …>)` inside the
    // page body — and those render *inside* the page, so their roots must not
    // carry the landmark. Indentation cannot separate the two (a helper sits at
    // the same depth as the component's own return), but the declared name can.
    const conciseHead = String.raw`^(\s*)(?:export\s+)?const\s+${component}\b[^=]*=\s*(?:\([^)]*\)|\w+)\s*=>\s*`;
    const conciseParen = new RegExp(`${conciseHead}\\($`).exec(line);
    const conciseDirect = new RegExp(`${conciseHead}(<.*)$`).exec(line);
    const opener = parenthesised ?? direct ?? conciseParen ?? conciseDirect;
    if (!opener || (opener[1] ?? '').length > maxIndent) return;

    const body: string[] = [];
    if (parenthesised ?? conciseParen) {
      // Balance the parens to take the whole returned expression.
      let depth = 0;
      for (let k = index; k < lines.length; k++) {
        const current = lines[k] ?? '';
        depth += (current.match(/\(/g) ?? []).length - (current.match(/\)/g) ?? []).length;
        body.push(current);
        if (depth <= 0) break;
      }
    } else {
      // An unparenthesised return ends at the statement's semicolon.
      for (let k = index; k < lines.length; k++) {
        body.push(lines[k] ?? '');
        if ((lines[k] ?? '').trimEnd().endsWith(';')) break;
      }
    }
    // The markup comes from the opener's own capture group rather than by
    // stripping a prefix off the joined text: `export const X: React.FC = () =>
    // <div/>` has an `=` before the arrow, so a prefix strip either misses the
    // arrow or eats into the JSX depending on how greedy it is. The group
    // already knows exactly where the markup starts.
    const jsx =
      (parenthesised ?? conciseParen) ? body.slice(1).join('\n') : [opener[2] ?? '', ...body.slice(1)].join('\n');

    // Only a branch that returns markup directly. A helper returning an object
    // whose fields hold JSX (`{ icon: <Clock /> , title: … }`) is not a render
    // state, and OnboardingCheck has one.
    if (!/^\s*</.test(jsx)) return;
    const cleaned = withoutComments(jsx);
    // Every render state this branch can produce, not the branch as one string.
    // `carriesTarget` answers "does the text contain the landmark anywhere",
    // and a conditional at the *root* of a return produces two documents of
    // which only one may have it: `<>{ready ? <main id="main-content"/> :
    // <div/>}</>` satisfied the whole-expression check while its second state
    // rendered no target at all.
    if (renderStates(cleaned).every(carriesTarget)) return;

    // A root that is a local component can carry the target itself —
    // `FinanceApprovalPage` renders every branch through one `<Shell>`.
    //
    // Comment-stripped like the branch above. This second call scanned the raw
    // slice, so commenting out the shell's landmark left all four tests green —
    // the same "satisfied by the remains" defect the branch check was fixed for
    // one round earlier, sitting in its other copy. That is why the strip is a
    // named helper now rather than an inline `replace` at one of two sites.
    const root = /<([A-Z]\w+)/.exec(cleaned);
    if (root?.[1]) {
      const rootDeclaration = new RegExp(`const ${root[1]}[^=]*=[^=]*=>\\s*\\(`).exec(source);
      if (
        rootDeclaration &&
        carriesTarget(withoutComments(source.slice(rootDeclaration.index, rootDeclaration.index + 2000)))
      ) {
        return;
      }
    }
    missing.push(offset + index + 1);
  });

  return missing;
};

/**
 * The source file a component name refers to, resolved through the file that
 * renders it.
 *
 * A route file often renames the page it imports: `modules/inventory/routes.tsx`
 * declares `ImportInventoryPage` for `pages/ImportInventory.tsx`. Comparing a
 * rendered *name* against a file *basename* therefore misses that page
 * entirely — which mattered because the comparison guards the shell exemption,
 * so a real routing shape could have slipped a nested page past it.
 */
const componentFile = (name: string, declaredIn: string): string | null => {
  const source = read(declaredIn);
  const from = (specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const resolved = path.resolve(path.dirname(path.join(SRC, declaredIn)), specifier);
    for (const candidate of [`${resolved}.tsx`, path.join(resolved, 'index.tsx')]) {
      if (fs.existsSync(candidate)) return path.relative(SRC, candidate);
    }
    return null;
  };

  const lazy = new RegExp(
    String.raw`const\s+${name}\s*=\s*lazyWithRetry\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]`
  ).exec(source);
  if (lazy?.[1]) return from(lazy[1]);

  const imported = new RegExp(
    String.raw`import\s+(?:\{[^}]*\b${name}\b[^}]*\}|${name})\s+from\s+['"]([^'"]+)['"]`
  ).exec(source);
  if (imported?.[1]) return from(imported[1]);

  const byFilename = globSync(path.join(SRC, `**/${name}.tsx`));
  return byFilename.length === 1 ? path.relative(SRC, byFilename[0] ?? '') : null;
};

/** Every page file rendered inside the AppLayout route, aliases resolved. */
const layoutPageFiles = (): Set<string> => {
  const { layoutJsx } = routeJsx();
  const files = new Set<string>();

  for (const name of renderedComponents(layoutJsx)) {
    const file = componentFile(name, 'App.tsx');
    if (file) files.add(file);
  }

  for (const [, factory] of layoutJsx.matchAll(/\{(get\w+Routes)\(\)\}/g)) {
    const declaration = new RegExp(String.raw`export\s+(?:const|function)\s+${factory}\b`);
    const routesPath = globSync(path.join(SRC, 'modules/*/routes.tsx')).find((candidate) =>
      declaration.test(fs.readFileSync(candidate, 'utf8'))
    );
    if (!routesPath) continue;
    const relative = path.relative(SRC, routesPath);
    const source = fs.readFileSync(routesPath, 'utf8');
    const start = declaration.exec(source)?.index ?? 0;
    const stop = source.indexOf('\nexport ', start + 1);
    for (const name of renderedComponents(source.slice(start, stop === -1 ? undefined : stop))) {
      const file = componentFile(name, relative);
      if (file) files.add(file);
    }
  }
  return files;
};

/**
 * Shells outside the public page set that provide the target themselves.
 *
 * What they have in common is that each *replaces* whatever else would hold the
 * landmark, so exactly one `#main-content` is ever in the DOM while they render
 * — which is precisely what the two wrappers in `PRE_LAYOUT_WRAPPERS` below
 * cannot promise. Membership here is a requirement, not a permission: the test
 * that follows asserts each of these really does carry the target, so a file
 * cannot be parked in this list to silence the inverse sweep.
 */
const REPLACING_SHELLS: Record<string, string> = {
  'components/layout/AppLayout.tsx': 'the shell every route behind sign-in renders through',
  'components/ErrorBoundary.tsx':
    'the top-level fallback — an error boundary unmounts the tree it caught, AppLayout included',
};

describe('skip link target', () => {
  // Deduplicated by file AND component, not by file alone. This repository
  // colocates page components — `PlaceholderPages.tsx` declares several — so
  // collapsing on the file dropped every component after the first, and a
  // colocated page missing the landmark was never looked at. Only a component
  // routed twice should collapse.
  const entries = publicPages().filter(
    (entry, index, all) =>
      all.findIndex((other) => other.file === entry.file && other.component === entry.component) === index
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
      const missing = branchesMissingTarget(page, component);
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

  it('is not duplicated by a page that already sits inside AppLayout', () => {
    /**
     * The inverse of the rule above, and the one that actually regressed.
     *
     * A page reached through `AppLayout` inherits the landmark, so giving it one
     * of its own nests a second `<main>` inside the first and puts the id on two
     * elements — `document.getElementById` then answers with whichever the
     * browser met first, and the skip link lands somewhere arbitrary. Twice now
     * a sweep for "pages missing the target" has over-collected: once a helper
     * component declared beside a public page, once `ShiftReportPrintPage`,
     * which is mounted by `getSchedulingRoutes()` well inside the layout route.
     *
     * Neither was visible to the sweep above, which only ever asks whether a
     * public page is missing the target — never whether a protected one has
     * acquired it.
     */
    const owners = new Set([...pages, ...Object.keys(REPLACING_SHELLS)]);

    /**
     * Wrappers that render *before* `AppLayout` — and sometimes inside it.
     *
     * These are the tempting place to close the remaining gap: the skip link
     * genuinely points at nothing while the app is loading its first chunk or
     * checking the session. Neither can own the target, and the reason is the
     * same both times — each renders in **two** positions, so a static id is
     * right in one and a duplicate in the other:
     *
     * - `PageLoadingFallback` is the fallback of the one `<Suspense>` wrapping
     *   every route. React does not unmount the children it is standing in for
     *   on an update — it hides them with `display: none` and leaves them in
     *   the DOM, and `getElementById` then answers with the *hidden*
     *   `AppLayout` main rather than the visible fallback. That is reachable,
     *   not theoretical: finance, grants-fundraising and training route to
     *   `lazyWithRetry` pages with no inner `<Suspense>`, so navigating to one
     *   suspends against this boundary with `AppLayout` already mounted.
     *   Focusing a `display: none` element is worse than focusing nothing.
     * - `ProtectedRoute`'s auth-loading branches render outside the layout on a
     *   cold load, but module routes nest `<ProtectedRoute requiredModule=…>`
     *   *inside* the layout route, so the same branch can render within
     *   `AppLayout`'s `<main>` — a nested landmark and a duplicate id.
     *
     * They are named rather than merely excluded so the offender message can
     * say this, instead of reading as an oversight. See
     * `docs/KNOWN_LIMITATIONS.md` for the gap that is left open.
     */
    const PRE_LAYOUT_WRAPPERS: Record<string, string> = {
      'App.tsx':
        'PageLoadingFallback can render while AppLayout is suspended-but-mounted, ' +
        'where the hidden AppLayout main would win getElementById',
      'components/ProtectedRoute.tsx':
        'its loading branches also render inside AppLayout, via the nested ' + 'ProtectedRoute in every module route',
    };

    // Comments discuss the id (this file's own header does); only markup counts.
    const stripComments = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');

    const offenders = globSync(path.join(SRC, '**/*.tsx'))
      .map((file) => path.relative(SRC, file))
      .filter((file) => !owners.has(file) && !file.endsWith('.test.tsx'))
      .filter((file) => carriesTarget(stripComments(read(file))));

    expect(
      offenders.map((file) => {
        const wrapper = PRE_LAYOUT_WRAPPERS[file];
        return wrapper ? `${file} — ${wrapper}` : file;
      }),
      'these files render inside AppLayout, which already provides ' +
        '<main id="main-content">; a second one duplicates the id and makes the skip ' +
        'link target ambiguous'
    ).toEqual([]);
  });

  it('is provided by every shell that replaces the tree holding it', () => {
    /**
     * The other half of `REPLACING_SHELLS`: being listed there exempts a file
     * from the inverse sweep, so the list has to cost something. Without this,
     * the way to silence a duplicate-id failure would be to add the file to the
     * exemption — which is the failure mode this whole series has been about,
     * a check that can be satisfied without the thing it checks for being true.
     *
     * `ErrorBoundary` is here because its fallback is a full-screen page of
     * reload and navigation controls that the skip link should reach. It can
     * hold the landmark where a Suspense fallback cannot: an error boundary
     * unmounts the subtree it caught, so `AppLayout`'s main is gone rather than
     * hidden.
     */
    // Membership has to be earned by something other than the symptom.
    //
    // Being on this list exempts a file from the inverse sweep, and the branch
    // check below is satisfied by the id being present — which is exactly what
    // is wrong when a *nested* page acquires one. So a protected page that
    // accidentally gained the target could be "fixed" by adding it here, and
    // both halves would go green on the strength of the duplicate itself.
    //
    // This derives the disqualifying fact independently of the id: the set of
    // components `App.tsx` renders *inside* the AppLayout route, factories
    // expanded. Anything in there is nested by construction and cannot be a
    // replacement shell, whatever its markup says.
    const nested = layoutPageFiles();
    const misfiled = Object.keys(REPLACING_SHELLS).filter((file) => nested.has(file));

    expect(
      misfiled,
      'these are rendered inside the AppLayout route, so they cannot be replacement ' +
        'shells; a nested page with a duplicate id is the defect, not an exemption'
    ).toEqual([]);

    const missing = Object.entries(REPLACING_SHELLS).flatMap(([file, why]) => {
      const component = path.basename(file, '.tsx');
      const branches = branchesMissingTarget(file, component);
      return branches.length > 0 ? [`${file} — branch(es) at line ${branches.join(', ')} (${why})`] : [];
    });

    expect(
      missing,
      'these shells replace whatever else would hold the landmark, so each must ' +
        'render <main id="main-content"> itself'
    ).toEqual([]);
  });
});
