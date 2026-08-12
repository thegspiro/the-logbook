# Training materials review and screenshot plan

**Review date:** 2026-08-11  
**Scope:** the training index, all 19 numbered training guides, the screenshot
status/currency reports, and the automated screenshot workflow.

## Executive summary

The library is broad, task-oriented, role-aware, and unusually well supported
by an automated screenshot pipeline. Its main learning-design weakness is not
missing feature coverage; it is that the guides often behave like exhaustive
reference manuals rather than lessons. The largest guides are 1,800–2,300 lines
long, while none consistently opens with learning objectives, prerequisites,
estimated time, or a short practice task. A new user can find a feature but has
little help deciding what to learn first or proving that they can complete a
workflow.

The visual backlog is also significant: **323 of 503 planned screenshots are
captured (64%), leaving 180**. The backlog should not be worked strictly in
document order. First capture the screens needed to complete a new member's
first-day journey and the high-risk decision points where the wrong action has
financial, privacy, compliance, voting, or operational consequences. Then fill
the remaining reference screens by module.

## What is already working well

- The index supplies reading paths for members, officers, finance staff, and IT
  managers instead of assuming every reader needs every module.
- Procedures normally use the product's visible labels and navigation paths,
  with permissions, hints, edge cases, and troubleshooting close to the task.
- Worked examples and realistic scenarios already appear in several of the
  operational guides; these are a strong basis for scenario-led lessons.
- Screenshot capture is reproducible: the manifest records route, audience,
  theme, and setup interactions, while seeded demo data avoids misleading empty
  states.
- Filled-screen and currency tracking are deliberately separate. This prevents
  “a file exists” from being mistaken for “the image still teaches the current
  UI.”

## Areas for improvement

### 1. Add a lesson contract to every guide

Immediately below each title, add a compact panel with:

- **Audience and permissions** — who should take the lesson and what role is
  required.
- **Prerequisites** — enabled module, seeded/configured records, and any earlier
  lesson.
- **Time** — a realistic range for the essential path and the full reference.
- **Outcomes** — three to six observable statements beginning “You can…”.
- **Practice environment** — warn readers not to perform destructive exercises
  in production.

This information currently appears inconsistently inside prose. A predictable
contract lets learners self-select before entering a guide and gives instructors
a ready-made briefing.

### 2. Split “learn” from “look up”

Keep the comprehensive guides, but put a **15-minute essential path** before the
table of contents in long modules. The essential path should link only the
minimum end-to-end workflow; everything else remains a reference section.

Recommended first paths:

| Guide           | Essential path                                                        |
| --------------- | --------------------------------------------------------------------- |
| Getting Started | sign in → orient to navigation → update profile/security → find help  |
| Membership      | find a member → add/update a member → change status safely            |
| Training        | submit training → officer review → verify member credit/compliance    |
| Scheduling      | find/open shift → request/accept assignment → report time-off or swap |
| Events          | create/RSVP → check in → confirm attendance                           |
| Inventory       | find item → assign/check out → return and inspect                     |
| Finance         | submit request → approve/reject → verify budget impact                |
| Elections       | configure → preview eligibility → open → vote → certify               |

For the longest guides, consider a future physical split into “member” and
“manager” guides. Until then, audience badges at section headings and the
essential path provide most of the benefit without breaking links.

### 3. Turn procedures into practice

Add at least one safe, realistic exercise per guide. Each exercise should have:

1. a starting state;
2. a task stated without reproducing every click;
3. a visible success criterion;
4. a reset/cleanup instruction; and
5. a short “what would you do if…” variation.

Examples include submitting a two-hour drill and finding it in My Training,
filling one open shift and confirming the roster, checking out a radio and
returning it with a condition note, or previewing an election and explaining why
one member is ineligible. These verify transfer of learning better than reading
another numbered procedure.

### 4. Add knowledge checks at consequential decisions

Use two or three questions after workflows involving permissions, destructive
actions, privacy, money, compliance, or anonymous ballots. Put answers in a
collapsed `<details>` block so the page remains useful as a reference. Mobile,
privacy, and storefront currently need these most; learners should be able to
explain offline limitations, retention/anonymization boundaries, and the fact
that The Logbook records payment rather than processing it.

### 5. Make screenshots instructional, not decorative

Every image should answer one of these questions:

- **Where am I?** Show the page title and enough navigation context.
- **What do I do next?** Show the relevant control and its label.
- **What confirms success?** Show the resulting status, row, toast, or audit
  state.
- **What dangerous distinction matters?** Compare two similar choices or show a
  warning/confirmation state.

Avoid capturing a whole long page merely because it exists. Crop to one task,
keep the page title when orientation matters, and pair “before action” images
with a success-state image only when the result is not obvious. Use numbered
callouts sparingly (three or fewer), with matching numbered explanations in
text; never rely on color alone.

### 6. Improve scanability and terminology

- Add “Member task,” “Officer task,” and “Administrator task” labels at mixed-
  audience sections.
- Standardize UI paths as **Area → Page → Tab** and put raw routes in a technical
  note rather than the primary instruction.
- Use one term for each concept and explicitly introduce unavoidable aliases
  such as “program (pipeline).”
- Move dated release-note paragraphs out of the learning index into a change log
  or “What's new” page. The index should remain a stable launch point.
- Add a glossary for cross-module terms such as requirement, validation,
  assignment, eligibility, closeout, and reconciliation.

### 7. Add maintenance metadata

At the top of each guide, record **last verified**, **application version**, and
**owner**. Verification should cover wording and workflow, not only image
currency. A quarterly spot check should execute the essential path using a
non-admin account; admin-only verification can hide permission and audience
errors.

## Screenshot capture plan

### Priority 0 — first-day and access journey

Capture these first because nearly every learner encounters them and an error
here prevents the rest of the course:

1. **Federated login choices** — login page with username/password, divider,
   Google, and Microsoft options (`00-getting-started.md`).
2. **Actionable dashboard notification** — pinned and collapsed notification
   cards, including the destination button (`00-getting-started.md`).
3. **Mobile install, iOS** — Safari share sheet with Add to Home Screen
   highlighted (`10-mobile-pwa.md`, manual device capture).
4. **Mobile install, Android** — Chrome install prompt and Install action
   (`10-mobile-pwa.md`, manual device capture).
5. **Mobile navigation and permission recovery** — top bar with unread count and
   camera-denied state with Try Again/manual entry (`10-mobile-pwa.md`).

**Acceptance:** use an ordinary member account where applicable; do not expose a
real email, department, notification, or device identifier. Device screenshots
must include enough browser chrome to identify the operating-system action.

### Priority 1 — complete core end-to-end workflows

These screenshots should close gaps in the most common or highest-consequence
tasks:

- **Membership:** import review with accepted/skipped totals and row-level
  reasons; prospect documents; status/leave transition confirmation.
- **Training:** member submission with attachment; officer pending-review queue;
  instructor confirmation; program enrollment/progress; member, program, and
  compliance print layouts.
- **Scheduling:** open-shift claim/request result; swap approval; time-off
  conflict; shift closeout/checklist result; notification settings.
- **Events and elections:** attendance dashboard; ballot preview/voting view;
  send-ballot eligibility summary; receipt verification; certified result.
- **Inventory:** scan/search result; checkout confirmation; return condition;
  bulk-operation summary; low-stock or lifecycle warning.
- **Finance/store:** approval-chain decision; budget impact; dues/payment record;
  PayPal unmatched-payment reconciliation.

**Acceptance:** each workflow needs at least one screenshot of the decision point
and one of the durable success state when a toast alone would disappear. Prefer
specific realistic demo data over generic empty forms.

### Priority 2 — safety, privacy, and compliance

- Medical screening requirement scope, restricted record entry, and overdue/
  expiring compliance dashboard.
- Privacy choices with unanswered choices clearly distinguished from consent;
  retention configuration and anonymization confirmation.
- Election eligibility breakdown, skipped-recipient reasons, anonymous-ballot
  receipt verification, and linked-meeting context.
- Apparatus/facility inspection failure or overdue state and the action required
  to resolve it.
- Training compliance print grid and certification-expiry state.

**Acceptance:** use synthetic names and values. Crop or redact secrets, health
details, tokens, URLs containing credentials, and third-party account IDs before
committing. A caption must explain the state being demonstrated, not merely name
the page.

### Priority 3 — integrations and administrator reference

Capture connection, mapping, sync/error, and recovery states for Salesforce,
calendar, messaging, PayPal, weather/ePCR, and webhooks. A connected “green” card
alone is insufficient: administrators also need the configuration boundary,
last-sync evidence, and a recoverable failure. Use fake endpoints and keys.

### Manual-only capture queue

Some visuals cannot be faithfully produced by desktop Playwright and should be
assigned explicitly rather than left mixed into the automated backlog:

- native iOS and Android install prompts;
- camera permission prompts and a real QR/barcode framing view;
- offline/online transition and queued-item sync notification;
- third-party OAuth consent or provider-hosted screens;
- printed/PDF layouts where pagination and page breaks are the lesson.

Record OS/browser version and viewport in the image review notes. Provider-hosted
screens should be rechecked more frequently because the application does not
control their layout.

## Backlog by guide

The current status report gives the following capture order. The percentage is
included to distinguish a large backlog from a poorly covered guide.

| Guide                      | Captured | Remaining | Coverage | Recommendation                             |
| -------------------------- | -------: | --------: | -------: | ------------------------------------------ |
| Getting Started            |       11 |         2 |      85% | Finish now (Priority 0)                    |
| Membership                 |       18 |        11 |      62% | Core workflow batch                        |
| Training                   |       52 |        30 |      63% | Split member/officer/print batches         |
| Scheduling                 |       41 |        35 |      54% | Largest backlog; capture core states first |
| Events & Meetings          |       27 |        14 |      66% | Attendance and election decisions first    |
| Inventory                  |       37 |        19 |      66% | Transaction/result states first            |
| Apparatus & Facilities     |       14 |         7 |      67% | Inspection exceptions first                |
| Documents & Communications |       13 |         0 |     100% | Currency review only                       |
| Administration & Reports   |       28 |        16 |      64% | Defer reference screens behind core tasks  |
| Skills Testing             |       17 |         6 |      74% | Complete scoring/review workflow           |
| Mobile & PWA               |        6 |         9 |      40% | Lowest coverage; manual Priority 0 batch   |
| Finance                    |       11 |         6 |      65% | Decision and budget-impact states          |
| Grants & Fundraising       |       10 |         4 |      71% | Do not capture routes for unbuilt screens  |
| Medical Screening          |        6 |         4 |      60% | Privacy/compliance Priority 2              |
| Elections                  |        7 |         8 |      47% | High consequence; Priority 1/2             |
| Prospective Members        |       15 |         0 |     100% | Currency review only                       |
| Integrations               |        4 |         8 |      33% | Lowest coverage, but mostly Priority 3     |
| Privacy & Your Data        |        2 |         0 |     100% | Add learning checks; audit currency        |
| Department Store           |        4 |         1 |      80% | Capture unmatched payment state            |
| **Total**                  |  **323** |   **180** |  **64%** |                                            |

## Capture and review checklist

Before accepting any screenshot:

- [ ] The image matches the placeholder's described audience and state.
- [ ] The page title/navigation makes location clear, or the crop intentionally
      focuses on a single control.
- [ ] Text is legible at the rendered documentation width on a laptop and phone.
- [ ] The important control is visible without relying only on color.
- [ ] Synthetic data is realistic, internally consistent, and free of secrets or
      personal information.
- [ ] Modals, dropdowns, tabs, and accordions are in the state the caption claims.
- [ ] A failure/empty state is intentional and teaches a recovery action.
- [ ] Alt text states the task or status shown rather than saying “screenshot.”
- [ ] The image was visually inspected; a successful automation exit is not
      treated as visual approval.
- [ ] `SCREENSHOT_STATUS.md` is regenerated and `SCREENSHOT_CURRENCY.md` is
      updated when the underlying screen was reviewed.

## Recommended rollout

1. **Learning template (implemented 2026-08-11):** Getting Started now has the
   lesson contract, essential path, and first-day exercise. Training and
   Scheduling apply the same pattern to paired member/officer workflows. The
   next step is to validate these three pilots with representative learners.
2. **Decision-check pilot (implemented 2026-08-11):** Mobile now includes
   self-check questions with collapsible answers. Review learner errors before
   adding the planned privacy and storefront checks or deciding how many each
   remaining guide needs.
3. **Priority 0 images:** capture the two automated first-day gaps and schedule
   a paired iOS/Android manual session.
4. **Core pilot images:** capture only the Training and Scheduling workflow
   images listed in Priority 1.
5. **High-consequence pass:** complete elections, finance, privacy, medical, and
   compliance visuals with a subject-matter reviewer.
6. **Reference backlog:** work remaining manifest entries module by module,
   finishing each guide rather than increasing every guide by a few images.
7. **Measure:** ask pilot learners to complete the exercise without assistance;
   record completion, errors, time, and the sections/screenshots they revisit.
   Revise from those observations before expanding the template to all guides.
