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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pages App.tsx renders outside `<AppLayout>`, by the route path that reaches
 * them. Listed rather than parsed: they are a handful, they change rarely, and
 * a parser that got the layout boundary subtly wrong would quietly check
 * nothing.
 */
const PUBLIC_PAGES = [
  'pages/LoginPage.tsx',
  'pages/ForgotPasswordPage.tsx',
  'pages/ResetPasswordPage.tsx',
  'pages/OAuthCallbackPage.tsx',
  'pages/legal/LegalPage.tsx',
];

/** Every component the onboarding router renders, read from the router. */
const onboardingPages = (): string[] => {
  const routes = fs.readFileSync(path.join(SRC, 'modules/onboarding/routes.tsx'), 'utf8');
  const rendered = new Set([...routes.matchAll(/element=\{<([A-Z]\w+)\s*\/?>/g)].map(([, name]) => name ?? ''));
  // `<Navigate>` is react-router's redirect, not a page of this app.
  rendered.delete('Navigate');

  return [...rendered].map((name) => {
    const file = `modules/onboarding/pages/${name}.tsx`;
    if (fs.existsSync(path.join(SRC, file))) return file;
    // A placeholder step or two lives beside the pages rather than among them.
    return 'modules/onboarding/components/PlaceholderPages.tsx';
  });
};

describe('skip link target', () => {
  const pages = [...new Set([...PUBLIC_PAGES, ...onboardingPages()])];

  it('covers the onboarding wizard and the pre-auth pages', () => {
    // A guard against the sweep quietly emptying: if the router is refactored
    // into a shape the matcher does not read, this is what says so.
    expect(pages.length).toBeGreaterThanOrEqual(15);
    for (const page of pages) {
      expect(fs.existsSync(path.join(SRC, page)), `${page} does not exist`).toBe(true);
    }
  });

  it('is present on every page that renders outside AppLayout', () => {
    const missing = pages.filter(
      (page) => !fs.readFileSync(path.join(SRC, page), 'utf8').includes('id="main-content"')
    );

    expect(
      missing,
      "these pages render their own root, so each must provide the skip link's target itself: " +
        'give the content wrapper <main id="main-content"> as the other onboarding steps do'
    ).toEqual([]);
  });
});
