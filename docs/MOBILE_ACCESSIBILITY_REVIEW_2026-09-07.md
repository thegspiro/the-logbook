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
| `btn-success` | green-600  | **3.30:1 — fails AA** | green-800 | 7.13:1   |
| `btn-warning` | yellow-600 | **2.94:1 — fails AA** | amber-800 | 7.09:1   |
| `btn-info`    | blue-600   | 5.17:1 — AA only      | blue-800  | 8.72:1   |

Between them these carry the confirm, publish, approve and archive actions in
101 files. `btn-warning` moved to amber rather than yellow because yellow-800 is
6.85:1 — short of AAA by a hair.

Beyond the shared utilities, **125 hand-rolled class strings in 60 files** paired
`text-white` with a fill below 4.5:1 — outside the mast CSS entirely, so no
palette change could ever have found them.

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
