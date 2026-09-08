# Mobile & Accessibility Review — 2026-09-07

A module-by-module review of the application at phone width, checking that what
the codebase claims about its mobile and accessibility posture is true.

The short answer: **the harness was sound, its coverage claim was not.** The
existing `mobile-presentation.spec.ts` measures real defects and its budgets
were genuinely at zero. But a fifth of the application had never been measured,
and a fifth of what it did measure was an error page rather than a feature.

## What was claimed

| Claim                                                   | Where                         | Held?                                                   |
| ------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| Every route has mobile coverage or a reviewed exemption | `mobile-route-inventory.ts`   | **No** — see below                                      |
| No control under 44px, no text under 12px, no overflow  | `mobile-presentation.spec.ts` | Only on routes that actually rendered                   |
| "Contrast is AAA, and the palette is one decision"      | `CLAUDE.md`                   | **No** — three shared fills were below it, two below AA |
| Shared utilities are the standard for controls          | Pitfall #17                   | Mostly; the unmeasured modules had drifted              |

## The three coverage gaps

### 1. Nine modules had no coverage at all

`finance`, `grants-fundraising`, `onboarding`, `medical-supplies`,
`medical-screening`, `ip-security`, `integrations`, `reports` and
`public-portal` — 56 routes — carried no ratchet or workflow entry. All 56 sat
in the inventory as `exempt` with the same generated sentence:

> secondary, parameterized, print, setup, or public route; covered by its
> representative module route

170 of the 196 exemptions used that identical text, and for these nine modules
the representative route it names did not exist. The manifest reported coverage
it did not have.

On first measurement those nine modules carried:

- **one crash** — `/medical-supplies` died through the ErrorBoundary on
  `expiring.map is not a function`
- **41 controls under the 44px touch minimum**
- **8 elements rendering off the side of a 390px screen**

### 2. Eight ratcheted routes were measuring "Access Denied"

`/members/admin`, `/members/check-in-station`, `/forms`, `/store`,
`/prospective-members`, `/events/1/monitoring`, `/admin/audit-log` and
`/training/admin` are gated on grants the fixture user did not hold. Each
rendered `ProtectedRoute`'s refusal screen, which passes every budget while
testing nothing — the state the spec's own comments call "the worst state a
ratchet can be in".

The fingerprint was visible in the run output and had been for some time: eight
routes reporting an identical `tap 0/9, text 474`.

Granting the real permissions exposed **two more crashes** that the refusal
screen had been sitting on top of:

- `AuditLogPage` — `Object.keys(stats.by_category)` on an unverified payload
- `EventCheckInMonitoringPage` — `stats.recent_check_ins.length`, same cause

All three crashes are the class the spec header describes: `api.get<T>` asserts
a wire format rather than verifying it, so a response that is valid JSON but not
the declared type takes the page down. On a phone that is a realistic failure —
a captive portal on station Wi-Fi answers HTTP 200 with an HTML body.

### 3. Nothing measured contrast, ARIA, or 320px

The only contrast check in the repository banned one Tailwind shade
(`bg-red-600`) by source scan. Nothing ran axe. Reflow was measured at 390px,
where WCAG SC 1.4.10 names **320px**.

## The palette claim

`CLAUDE.md` states the palette was raised to AAA "at every call site at once".
The 2026-08-23 sweep searched for a _red_, so it moved `btn-primary` and
`nav-item-active` to red-800 and never looked at the other three fills:

| Utility       | Was        | Measured              | Now       | Measured |
| ------------- | ---------- | --------------------- | --------- | -------- |
| `btn-success` | green-600  | **3.22:1 — fails AA** | green-800 | 7.13:1   |
| `btn-warning` | yellow-600 | **2.94:1 — fails AA** | amber-800 | 7.09:1   |
| `btn-info`    | blue-600   | 5.25:1 — AA only      | blue-800  | 8.82:1   |

Between them these carry the confirm, publish, approve and archive actions in
101 files. `btn-warning` moved to amber rather than yellow because yellow-800 is
6.84:1 — short of AAA by a hair.

Those figures were first computed against Tailwind v3 hexes and are quoted here
as re-measured against the palette this build actually paints. Tailwind v4
authors its colours in OKLCH, so the hex table the guard originally carried was
never what the browser rendered — `amber-700` is `oklch(55.5% 0.163 48.998)`,
not `#b45309`. The guard now reads `node_modules/tailwindcss/theme.css` and
converts, which is also why a future Tailwind upgrade that moves a shade will
be reported here rather than silently changing what these numbers mean. The
drift was small (green-600 3.30 → 3.22, blue-600 5.17 → 5.25) and changed no
conclusion.

Beyond the shared utilities, **125 hand-rolled class strings in 60 files** paired
`text-white` with a fill below 4.5:1 — outside the mast CSS entirely, so no
palette change could ever have found them.

### The gap between the two guards

The static sweep measures `bg-<hue>-<shade>`. axe measures rendered pixels but
abstains on a gradient. A **gradient fill carrying white text falls in the gap
between them** — neither guard sees it — and that is where the worst contrast in
the application was sitting: every onboarding step's primary button, `from-red-600
to-orange-600`, where orange-600 measures **3.60:1** against white. Twenty-two
call sites in all, including green-600 (3.22:1) on the import screens' submit
buttons and red-500 (3.81:1) on the applicant avatars.

None of it was a regression. It had never been measured, by anything, and the
review's own first pass would have reported the same clean result. The sweep now
reads `from-`, `via-` and `to-` alongside `bg-`, so a gradient is held to the
same floor as a flat fill and every stop is checked — the worst stop is the one
the label crosses.

The same shape of gap explains the skip link. The ratchet measures
`/onboarding/start` as the representative onboarding step, on the assumption
that the rest render the same shell. Four pages do not: the Welcome screen at
`/`, the startup check, the module configuration step and the security-check
placeholder each build their own root, and none had `#main-content`. The skip
link — the first thing a keyboard user reaches, on the first screen anyone sees
— pointed at nothing.

Reaching those pages in the browser pass is not the fix: the config step
redirects to step 1 without a seeded onboarding store, so the pass would measure
step 1 twice and count it as coverage of two routes. `skipLinkTarget.test.ts`
checks the assumption where it is exact — in the source, for every page
reachable outside `AppLayout`.

### What axe could not decide

axe reports a node it cannot measure as _incomplete_, not as a violation, and
the first version of this pass read only `violations`. That is a false floor:
every such node counted as clean.

It is not a handful of gradient CTAs. This application paints its page
background as a `linear-gradient`, so axe abstains on essentially every element
sitting directly on it — about **2,200 nodes across the 52 routes**, in all
three themes, starting with the dashboard's `h1`. A per-route budget of those
counts would be noise that moves with the fixture data and would say nothing
about whether the text is readable.

So the pass asserts the _reason_ axe gives (a background gradient or a
background image — anything else fails and wants a person), and the gradient
case is measured by value instead. `themeGradientContrast.test.ts` reads the
three gradient stops and the three text tiers out of `index.css` for each theme
and holds every pairing to 4.5:1. A browser cannot resolve a gradient to one
colour; the stylesheet states both halves exactly, a few lines apart, and the
worst case a gradient can present is one of its stops.

All nine pairings clear AA in every theme. The tightest is `--text-muted` on
the dark theme's red-900 stop.

## What changed

**Crashes fixed (3)** — payloads normalized at the read boundary in
`AuditLogPage`, `EventCheckInMonitoringPage` and `MedicalSuppliesPage`, using the
`Array.isArray` idiom already established in `EventDetailPage`.

**Coverage** — the ratchet grew from 43 routes to 52, adding a representative
route for each of the nine unmeasured modules. Their inventory entries now state
the coverage they actually have instead of the boilerplate.

**Mast CSS** — the three fills above moved to AAA, and one new utility was
added: `touch-target-phone`, the 44px minimum applied on phones only.
`mobile-touch-target` enforces it at every width, which is right for a control
that is cramped everywhere and wrong for a wrapped row of status pills that a
desktop lays out fine.

**Call sites** — 207 token changes across 60 files brought every sub-AA
white-on-fill pairing to at least 4.5:1, hue preserved, minimal shade step
(`red` excepted: it goes to red-800, because red-600 is banned repo-wide).
Controls that had been hand-assembled moved onto `btn-md`, `btn-sm`, `btn-icon`,
`btn-primary`, `btn-success`, `btn-warning` and `form-input`.

`primaryFillContrast.test.ts` now holds that state, matching **per quoted
segment rather than per line**. A ternary puts both branches on one line, so a
line-level match reads `bg-amber-400 text-amber-950` — a deliberately bright
"flashlight on" indicator at 8.97:1 — as white-on-amber and darkens it to
2.98:1. That is not hypothetical: the sweep did it to `FlashlightToggle`, and
auditing the 207 changes for exactly this shape is what caught it. It was the
only one.

**WCAG AA** — the eight axe violations found across the application are fixed:
two invalid `aria-controls` values (the nav submenu id was built from a label
containing spaces, so it parsed as several ids, none of them real), five
unlabelled form controls, and one link with no accessible name.

**Reflow** — four elements overflowed at 320px. Three were `hscroll` strips that
scroll but had never declared themselves intentional; the fourth was the hourly
activity chart, whose 24 columns cannot fit 320px and now scrolls with a legible
minimum bar width.

## What is measured now

`mobile-accessibility.spec.ts` runs over the same 52 routes:

- **axe WCAG 2.1 A + AA — asserted at zero.** Currently zero on every route.
- **Reflow at 320px — asserted at zero.** Currently zero on every route.
- **axe `color-contrast-enhanced` (AAA, 7:1) — ratcheted per route.** 43
  findings remain across 13 routes, all at individual call sites where a colour
  clears AA and not AAA. The budget can fall and never rise.

The route list moved to `mobile-routes.ts`, shared by the presentation ratchet,
this pass and the coverage-integrity check, so a route cannot be measured by one
and missed by another.

Two refinements to the presentation pass, both to stop it demanding something
WCAG does not:

- A marked scroll region must be **keyboard reachable**, which a strip of
  buttons already is. Requiring `tabIndex={0}` on the container regardless adds
  a redundant stop, and is wrong on a `role="tablist"`, which ARIA APG requires
  to stay out of the tab order. The container must be focusable only when
  nothing inside it is — a table, a chart, a timeline.
- SC 2.5.5 and 2.5.8 both exempt a target **in a sentence**. A link inside
  running prose cannot be padded to 44px without breaking the paragraph.
  Detected as an anchor with a sibling _text node_, so a row of adjacent links
  cannot excuse itself.

## Remaining, deliberately

The 43 AAA contrast findings are individual call sites, held at AA by the
budget above rather than fixed. The shared utilities in `index.css` are AAA and
`primaryFillContrast.test.ts` now holds every one of them there — reading the
fills out of the stylesheet, so a new `@utility` pairing `text-white` with a
fill is measured the day it is added and an unknown shade fails loudly rather
than being skipped.

187 inventory entries remain `exempt`. They are secondary, parameterized, print
and redirect routes genuinely represented by a measured sibling — but the
generated sentence still does not distinguish a considered exemption from an
unconsidered one. Naming the representative route in each detail would.

---

# Round two — themes, the wider rule set, and dialogs

The first pass measured WCAG 2.1 A/AA in the light theme on a route's landing
state. Three things were still unmeasured, and each held defects.

## The rule set was narrower than it looked

Running axe with the `wcag2a/2aa/21a/21aa` tags excludes `wcag22aa` — axe's
`target-size` rule — and all 30 `best-practice` rules, which are the
screen-reader _navigation_ rules: heading order, landmarks, region, dialog
names, skip-link. None had ever run. The first run returned **132 findings**,
and they were not spread thin:

| Rule                                         | Count | Cause                                                                                     |
| -------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `aria-allowed-role`                          | 51    | one element: `<aside role="navigation">`, on every route                                  |
| `landmark-*` (four rules)                    | 38    | `AppLayout` declared `role="main"` **and** 41 pages inside it declared their own `<main>` |
| `heading-order`                              | 20    | `EmptyState` rendered an `h3` directly under the page `h1`                                |
| `region` + `landmark-one-main` + `skip-link` | 12    | onboarding step 1 had no `main` at all                                                    |

Four fixes cleared 120 of them:

- **`<nav>` instead of `<aside role="navigation">`.** An `aside` already carries
  the `complementary` role; overriding it with a different landmark role is the
  contradiction axe reports.
- **One main landmark.** `AppLayout` now renders a real `<main id="main-content">`
  and the 41 page-level wrappers became `<div data-page-main>`. Two nested main
  landmarks is not a style question — it is the element a screen reader user
  jumps to, and there were two of them on 12 of the measured routes.
- **`EmptyState` defaults to `h2`.** It was `h3`, and an empty state is usually
  the only thing under the page `h1`, so `h1 → h3` left a hole in the outline on
  twenty routes. A `headingLevel` prop covers the rest: `1` where the empty
  state _is_ the page (a closed storefront, a record that does not exist), `3`
  inside a section titled `h2`, `4` inside one titled `h3`.

  The default alone was not enough, and the correction is worth recording. `h2`
  is right for an empty state that is the page's body and wrong for one that is
  a _section's_ body: "Nobody yet" inside the "Who's going" card then renders as
  a peer of the card rather than as its content, which is exactly what a
  screen-reader user navigating by heading hears. No default gets both cases
  right, so seventeen nested call sites now state their level explicitly —
  found by walking every `EmptyState` in the tree and reading the heading that
  encloses it, not by taking the two examples review offered.

- **A `main` for onboarding.** Step 1 had none, so its content sat outside every
  landmark — and the skip link in `index.html` points at `#main-content`, which
  did not exist. That is Bypass Blocks (SC 2.4.1) broken on the flow a chief
  walks through before the application has any other navigation. Sixteen
  pre-auth pages now provide the target.

Twelve advisory findings remain, ratcheted per route.

## Two themes had never been measured

Everything so far was the light theme. Contrast is the one thing a theme
changes, so that measured a third of the question.

- **Dark holds AA on every route.** No findings.
- **High-contrast did not.** Four AA failures — and it is the mode somebody
  turns on _because_ they need contrast. `text-red-600` measures **4.35:1** on
  its black ground and `text-blue-600` **4.06:1**, both below the 4.5:1 floor.
  Both were raw Tailwind colours used where the theme-aware `--accent-red` /
  `--accent-blue` tokens belong; those tokens already resolve to 6.2:1, 6.1:1
  and better in each theme, and were simply bypassed.

All three themes are now asserted at zero.

## Dialogs were never opened

The ratchet only ever sees a route's landing state, and a dialog is where the
density is: the tightest form layout, a focus trap, and the one surface that can
render taller than the viewport with no reachable end.

`mobile-dialogs.spec.ts` clicks every create-shaped control in each page body
and measures what opens — accessible name, axe A/AA, both ends reachable, no
overflow at 320px. It found three defects on its first run: the **Add Station**
and **Add Requirement** dialogs had no accessible name (a screen reader
announces "dialog" and stops), and **Add Station** and **Add Facility** had
eleven fields between them whose visible labels were never associated with their
inputs. Every dialog it reaches now passes.

It originally took only the _first_ opener per route, and only ones phrased as
an addition. Both were the same mistake the review is about: medical supplies
offers "Add supply" and "Receive delivery", and a pass named "every dialog"
measured one of them. The opener vocabulary now covers `receive`, `issue`,
`assign`, `import` and `generate` alongside the additive verbs, repeats of the
same dialog on one route are measured once, and a per-route ceiling keeps a long
toolbar from turning one pass into a hundred dialogs.

Two mistakes in building it are worth recording, because both produced a
confident wrong answer:

- Searching the whole document for the opener meant the bottom navigation's
  global "Add" sorted first on nearly every route. The pass measured one
  quick-add sheet **42 times** and reported it as 42 dialogs — the same
  "measuring the shell" failure this whole review was about.
- `querySelector('[role="dialog"]')` returns the first dialog in source order,
  not the one that just opened. On a page holding three, that reported a working
  focus trap as broken.

## A regression this work introduced, and what caught it

Converting the 41 page-level `<main>` elements to `<div>` silently broke a
stylesheet rule keyed to the tag:

```css
[data-page-layout="application"] > :first-child > main {
  padding: 0;
}
```

Those pages got their outer padding back, which narrowed the scheduling
calendar until its day cells measured **41px** — under the touch minimum. The
rule is now keyed to `[data-page-main]`.

Nothing about the change looked risky, and no type or lint check could have
seen it. The presentation ratchet caught it on the next run, which is the
argument for the ratchet: a CSS selector matching on a tag name is coupled to
markup nobody thinks of as an interface.

## A ninth Access Denied route

`page-has-heading-one` surfaced one the first round missed: `/apparatus` was
still measuring the refusal screen, whose heading is an `h2`. A route stuck on
it therefore has no `h1` at all — which is how a rule about headings found a
coverage gap. The count in the first half of this document should read nine,
not eight.
