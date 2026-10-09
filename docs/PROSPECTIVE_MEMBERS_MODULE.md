# Prospective Members Pipeline Module

Configurable pipeline for managing prospective member applications from initial interest through conversion to full membership.

## Overview

The Prospective Members module provides a complete applicant tracking system for fire departments and emergency services organizations. It enables membership coordinators to define custom pipelines with multiple stage types, track applicants through the process, and convert successful candidates into members.

### Key Capabilities

- **Configurable Pipeline**: Drag-and-drop stage builder with twelve stage types (form submission, document upload, election/vote, manual approval, meeting, status-page toggle, automated email, reference check, checklist, interview requirement, multi-signer approval, and medical screening)
- **Dual View Modes**: Kanban board with drag-and-drop or sortable paginated table
- **Inactivity Timeout System**: Automatic deactivation with configurable timeouts, per-stage overrides and two-phase warnings, and an optional daily auto-purge of applications inactive past a grace period (see [Auto-Purge](#auto-purge))
- **Applicant Lifecycle**: Six statuses (active, on_hold, withdrawn, converted, rejected, inactive) with full audit trail
- **Withdraw / Archive**: A coordinator, or since 2026-09-24 the applicant from their status page, can withdraw; withdrawn applications are kept and reactivatable
- **Election Package Integration**: The server creates an election package whenever an applicant enters an election_vote stage, by any route (2026-09-30), bundling applicant data for the secretary to build a ballot; no package, no advance past the vote
- **Desired Membership Type**: Applicants indicate their preferred membership type (regular or administrative) via the interest form; coordinators can change it inline at any pipeline stage
- **Conversion Flow**: Convert successful applicants with a member class and starting status taken from the pipeline's per-track `conversion_config` (2026-09-30), the application's target role (2026-09-24), and an explicit choice of password delivery (2026-09-27). Held until every Required stage is complete (2026-09-28)
- **Signer sign-off**: Officers named on a Multi-Signer Approval stage sign from a Sign-offs page with no pipeline permission (2026-09-28)
- **Bulk Operations**: Select multiple applicants for batch advance, hold, or reject actions
- **Cross-Module Integration**: Links to Forms (data collection), Elections (membership votes via election packages), and Notifications (alerts)

---

## Architecture

### Frontend Module Structure

```
frontend/src/modules/prospective-members/
├── index.ts                    # Module barrel export
├── routes.tsx                  # Route definitions with lazy-loaded pages
├── types/
│   └── index.ts                # All TypeScript types, enums, constants, helpers
├── services/
│   └── api.ts                  # API service layer (pipelineService, applicantService, electionPackageService)
├── store/
│   └── prospectiveMembersStore.ts  # Zustand store with full state management
├── components/
│   ├── index.ts                # Component barrel exports
│   ├── PipelineBuilder.tsx     # Drag-and-drop stage configuration
│   ├── PipelineKanban.tsx      # Kanban board view
│   ├── PipelineTable.tsx       # Table view with sorting and pagination
│   ├── ApplicantCard.tsx       # Card component for kanban columns
│   ├── ApplicantDetailDrawer.tsx # Slide-out applicant details panel
│   ├── ApplicantActionPanels.tsx # Status-conditional action footer (active/hold/withdrawn/inactive) *(2026-04-11)*
│   ├── ElectionPackageSection.tsx # Election ballot package display and management *(2026-04-11)*
│   ├── LinkedEventsSection.tsx  # Linked events display with search and link/unlink *(2026-04-11)*
│   ├── ConversionModal.tsx     # Convert applicant to member modal
│   └── StageConfigModal.tsx    # Stage configuration with timeout overrides
└── pages/
    ├── ProspectiveMembersPage.tsx   # Main page (active/inactive/withdrawn tabs, stats, views)
    └── PipelineSettingsPage.tsx     # Pipeline builder + inactivity configuration
```

### Types

| Type                      | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| `ApplicantStatus`         | `'active' \| 'on_hold' \| 'withdrawn' \| 'converted' \| 'rejected' \| 'inactive'` |
| `PipelineStageType`       | One of the twelve workflow stage types described in [Stage Types](#stage-types)   |
| `InactivityTimeoutPreset` | `'3_months' \| '6_months' \| '1_year' \| 'never' \| 'custom'`                     |
| `InactivityAlertLevel`    | `'normal' \| 'warning' \| 'critical'`                                             |
| `PipelineTab`             | `'active' \| 'inactive' \| 'withdrawn'`                                           |
| `TargetMembershipType`    | `'regular' \| 'administrative'`                                                   |
| `ElectionPackageStatus`   | `'draft' \| 'ready' \| 'added_to_ballot' \| 'elected' \| 'not_elected'`           |

### Key Interfaces

| Interface                    | Description                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `Pipeline`                   | Pipeline definition with stages and inactivity config                             |
| `PipelineStage`              | Stage with name, type, description, and optional timeout override                 |
| `Applicant`                  | Full applicant record with activity timestamps, deactivation, and withdrawal info |
| `ApplicantListItem`          | Lightweight applicant for list views with alert level                             |
| `InactivityConfig`           | Pipeline-level inactivity settings                                                |
| `PipelineStats`              | Aggregated statistics including inactive/warning/withdrawn counts                 |
| `ElectionPackage`            | Bundled applicant data for election ballot creation                               |
| `ElectionPackageFieldConfig` | Configurable fields for what info to include in election packages                 |

### Constants

| Constant                          | Description                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TIMEOUT_PRESET_DAYS`             | Maps presets to day counts: 3_months=90, 6_months=180, 1_year=365, never/custom=null                       |
| `TIMEOUT_PRESET_LABELS`           | Human-readable labels for timeout presets                                                                  |
| `DEFAULT_INACTIVITY_CONFIG`       | Default config: 3_months, 80% warning, coordinator notifications on                                        |
| `DEFAULT_ELECTION_PACKAGE_FIELDS` | Default included fields: email, documents, stage history on; phone, address, DOB off                       |
| `STAGE_COLORS`                    | _(2026-04-11)_ Centralized stage color map for consistent rendering across Kanban, table, and drawer views |

### Extracted Sub-Components _(2026-04-11)_

The `ApplicantDetailDrawer` was decomposed into focused sub-components:

| Component                | Description                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ApplicantActionPanels`  | Status-conditional action footer. Shows different button sets based on applicant status: Active (back/withdraw/hold/skip/reject/advance/convert), On Hold (withdraw/reject/resume), Withdrawn (reactivate), Inactive (reject/reactivate). Optional notes textarea for action justification |
| `ElectionPackageSection` | Displays election ballot package for applicants in the `election_vote` stage. Shows package status (draft/ready/added_to_ballot/elected/not_elected), applicant snapshot, editable coordinator notes, and election assignment dropdown                                                     |
| `LinkedEventsSection`    | Shows events linked to a prospective member (orientation, interviews, ride-alongs). Supports search-and-link for upcoming events, unlink for existing links, and visual distinction for cancelled events                                                                                   |

### Security & Performance Improvements _(2026-04-11)_

- **FK indexes**: Added indexes on `membership_pipelines.created_by`, `membership_pipeline_steps.email_template_id`, and `prospect_documents.uploaded_by` to prevent slow cascading queries on large pipelines (migration: `20260411_0100_add_membership_pipeline_fk_indexes`)
- **Accessibility**: Added ARIA labels, keyboard navigation, and focus management to the pipeline builder and Kanban board
- **Membership tier service**: Fixed edge cases in tier advancement logic for members transitioning from prospect to active status

---

## Pipeline Configuration

### Stage Types

| Type              | Icon        | Description                                        | Integration                                                                              |
| ----------------- | ----------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `form_submission` | FileText    | Applicant completes a form                         | Links to Forms module                                                                    |
| `document_upload` | Upload      | Applicant uploads required documents               | File storage; optional **Documenso** e-signature                                         |
| `election_vote`   | Vote        | Membership votes on applicant                      | Links to Elections module via election packages                                          |
| `manual_approval` | CheckCircle | Coordinator manually approves                      | Internal action                                                                          |
| `automated_email` | Mail        | Sends configurable email to applicant              | Email template selection, variable interpolation, send delay                             |
| `form_dropdown`   | ListChecks  | Links a form from Forms module for data collection | Links to Forms module via dropdown selector                                              |
| `meeting`         | Calendar    | Schedule interview or orientation meeting          | Links to Events module; auto-links upcoming events; optional **Cal.com** self-scheduling |

### Quick Presets (StageConfigModal)

The StageConfigModal includes quick presets for common stage configurations:

| Preset              | Type      | Description                                                                                |
| ------------------- | --------- | ------------------------------------------------------------------------------------------ |
| President Interview | `meeting` | Pre-configured meeting stage for scheduling a president/chief interview with the applicant |

### Pipeline Builder

The Pipeline Builder (on the Pipeline Settings page) allows coordinators to:

1. **Add stages** using the "Add Stage" button with type selector
2. **Reorder stages** via drag-and-drop
3. **Configure stages** by clicking the pencil icon to open StageConfigModal
4. **Remove stages** with the trash icon
5. **Save pipeline** to persist changes

Each stage can be configured with:

- **Name**: Display name for the stage
- **Description**: Optional description explaining the stage's purpose
- **Type**: One of the seven stage types above
- **Inactivity timeout override**: Optional custom timeout (in days) for this specific stage
- **Auto-advance** (form_submission and document_upload only): When enabled, the prospect is automatically advanced to the next stage when the form is submitted or all required documents are uploaded. Toggled via checkbox: "Auto-advance when form is submitted" / "Auto-advance when documents are uploaded". Default: off
- **Election package fields** (election_vote only): Choose which applicant data to include in election packages (email, phone, address, DOB, documents, stage history, custom coordinator prompt)
- **Email configuration** (automated_email only): Configure email subject, welcome message, FAQ link, next meeting details, custom sections (title + content), and application status tracker. Email is automatically sent when a prospect advances to this stage
- **Form selection** (form_dropdown only): Choose a form from the Forms module for applicant data collection via dropdown selector
- **Event linking** (meeting and others): Link a stage to a specific event for scheduling. Meeting stages auto-link the next upcoming event matching the stage configuration
- **Cal.com scheduling** (meeting only, when the Cal.com integration is connected): Set the stage's scheduling method to _Cal.com_ and provide a booking link. Applicants see a **Schedule** button on their public status page; a `MEETING_ENDED` webhook (with a configured secret) auto-advances the applicant once the booked meeting has finished, ignoring an attendee Cal.com has marked a no-show. When Cal.com is not connected, a "Connect Cal.com" hint links to the Integrations page
- **Documenso e-signature** (document*upload only, when the Documenso integration is connected): Set the stage's collection method to \_Documenso e-signature* and optionally store a template ID. Applicants see a "Documents sent for signature" note; a `DOCUMENT_COMPLETED` webhook (with a configured secret) auto-advances the applicant. When Documenso is not connected, a "Connect Documenso" hint links to the Integrations page
- **Status page visibility**: Toggle whether the stage appears on the public application status page

### Integration Auto-Advance (2026-07-13)

When the **Cal.com** or **Documenso** integrations are connected, meeting and document stages can advance without coordinator action. Public, verified webhook receivers correlate an inbound event to a prospect by the attendee/signer **email** and complete the prospect's current stage only when that stage is configured to use the integration:

| Endpoint                                                  | Trigger              | Advances                                                      |
| --------------------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| `POST /api/public/v1/webhooks/calcom/{integration_id}`    | `MEETING_ENDED`      | A `meeting` stage with `scheduling_provider = calcom`         |
| `POST /api/public/v1/webhooks/documenso/{integration_id}` | `DOCUMENT_COMPLETED` | A `document_upload` stage with `signing_provider = documenso` |

Both endpoints are rate limited and reject any request that fails the per-integration `webhook_secret` verification. See the [Documenso](../wiki/Integration-Documenso.md) and [Cal.com](../wiki/Integration-Calcom.md) integration references for setup.

---

## Event Linking (2026-03-12)

Coordinators can link upcoming department events to individual applicants in the pipeline, enabling tracking of interviews, orientations, and meetings.

### How It Works

1. **Manual linking**: From the ApplicantDetailDrawer, coordinators can search and link any upcoming event to an applicant
2. **Auto-linking**: When a pipeline stage of type `meeting` activates for an applicant, the system automatically links the next upcoming event that matches the stage configuration
3. **Linked event display**: The ApplicantDetailDrawer shows all linked events with date, time, type, and status

### Database Model

| Table                  | Description                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `prospect_event_links` | Links applicants to events with `prospect_id` (FK), `event_id` (FK), `stage_id` (FK, nullable), `linked_by` (FK users), `created_at` |

### API Endpoints

```
GET    /api/v1/prospective-members/prospects/{id}/events       # List linked events
POST   /api/v1/prospective-members/prospects/{id}/events       # Link an event
DELETE /api/v1/prospective-members/prospects/{id}/events/{eid}  # Unlink an event
```

### Edge Cases

| Scenario                                        | Behavior                                                   |
| ----------------------------------------------- | ---------------------------------------------------------- |
| No matching events when meeting stage activates | No link created; coordinator prompted to schedule manually |
| Linked event is cancelled                       | Shows "Cancelled" badge on applicant's event list          |
| Multiple applicants linked to same event        | Supported (e.g., group orientation)                        |
| Event link deleted                              | Only removes the link; event itself is unchanged           |
| Applicant converted to member                   | Event links are preserved for audit trail                  |

---

## Inactivity Timeout System

### How It Works

```
Normal ──(warning threshold)──> Warning ──(timeout reached)──> Inactive ──(purge days)──> Purged
  ^                                                                |
  |                                                                |
  +────────────────── (reactivate) ────────────────────────────────+
```

1. **Normal**: Applicant has recent activity within the timeout window
2. **Warning**: Applicant's idle time has passed the warning threshold percentage (default 80%)
3. **Inactive**: Applicant's idle time has exceeded the timeout — automatically deactivated
4. **Purged**: With Auto-Purge on, an application inactive for at least the purge period is permanently deleted by the daily `membership_auto_purge` task — see [Auto-Purge](#auto-purge)

### Configuration

Pipeline-level inactivity settings are configured on the Pipeline Settings page:

| Setting                   | Default            | Description                                                        |
| ------------------------- | ------------------ | ------------------------------------------------------------------ |
| Timeout Preset            | 3 months (90 days) | How long before an idle applicant is deactivated                   |
| Custom Timeout Days       | —                  | Used when preset is "custom"                                       |
| Warning Threshold         | 80%                | When to show amber warning indicators                              |
| Notify Coordinator        | true               | Send notification to coordinator when applicant approaches timeout |
| Notify Applicant          | false              | Send notification to applicant when approaching timeout            |
| Auto-Purge Enabled        | false              | Automatically purge inactive applicants after a period             |
| Purge Days After Inactive | 365                | Days after deactivation before auto-purge (clamped to 30–1095)     |

### Per-Stage Overrides

Individual stages can override the pipeline default timeout. This is useful for stages that naturally take longer:

- **Background checks**: May take weeks longer than normal stages
- **Election/voting**: Scheduled elections may have fixed timing
- **Document collection**: Applicants may need time to gather required documents

To set a per-stage override:

1. Open stage configuration (pencil icon in Pipeline Builder)
2. Check "Use a custom timeout for this stage"
3. Enter the number of days

The effective timeout for an applicant is determined by: `stage override > pipeline default > null (no timeout)`

Helper function: `getEffectiveTimeoutDays(config)` returns the computed timeout in days, or `null` if set to "never".

### Visual Indicators

| Alert Level | Color | Where Shown                          | Description                               |
| ----------- | ----- | ------------------------------------ | ----------------------------------------- |
| Normal      | —     | —                                    | No indicator                              |
| Warning     | Amber | Card border, card banner, table icon | "Activity slowing" — approaching timeout  |
| Critical    | Red   | Card border, card banner, table icon | "Approaching timeout" — near deactivation |

### Reactivation

**Coordinator reactivation:**

1. Navigate to the Inactive tab on the main page
2. Click "Reactivate" on an individual applicant, or
3. Select multiple applicants and use bulk reactivate
4. Alternatively, open the applicant detail drawer and click "Reactivate"

**Self-service reactivation:**

- An applicant can resubmit an interest form (via the Forms module)
- The system recognizes the existing application and reactivates it

### Auto-Purge

**Auto-purge** _(wired 2026-10-09)_ — the daily `membership_auto_purge` task
calls `MembershipPipelineService.auto_purge_inactive_prospects` per
organization. For each pipeline whose `inactivity_config` has
`auto_purge_enabled: true` (exactly `true`; anything else is off) and a numeric
`purge_days_after_inactive` (clamped to 30–1095; missing or non-numeric skips
the pipeline), it deletes the `inactive` applications whose `inactive_since` is
at least that many days before now (UTC). The delete is the manual purge's own
`_delete_inactive_prospects` — same status filter, row lock and file removal —
run in a savepoint per pipeline, so a pipeline that fails is rolled back and
reported without stopping the others. Each pipeline that purged anything writes
a `membership_pipeline.prospects_purged` audit event with `trigger:
"auto_purge"`, the threshold, the cut-off and the purged ids, in the same
transaction as the delete. No email is sent beforehand (owner's decision).

`inactive_since` is the purge clock, distinct from the historical
`deactivated_at` the drawer shows: it is set on every entry into `inactive`
(`_stamp_lifecycle` for single, bulk and generic-update status changes, and
inline in the inactivity sweep) and cleared on every exit, including transfer.
Migration `feecd81eef2d` set it to the migration's run time for applications
already inactive, so nothing already inactive is purged until a full grace
period after the upgrade. A NULL `inactive_since` is never purged. See
`docs/KNOWN_LIMITATIONS.md` → "Prospective Members — Purge Scope and
Auto-Purge".

**Manual purge** — **Purge Selected** on the Inactive Applications tab →
`POST /prospective-members/pipelines/{pipeline_id}/purge-inactive`
(`prospective_members.manage`). Fixed 2026-09-30 (#2835): the service used to
delete only `withdrawn` rows, which that tab never lists, and the page toasted
"Purged N" from the selection size. It now deletes only rows still `inactive`,
org-scoped and under a row lock; removes each application's uploaded documents
from disk **before** the rows (the DB cascade never reached the files — a file
that cannot be removed raises 400 before any row is deleted, so a retry can
finish); writes an audit event with the count and the requested ids, no
applicant details; and returns the number actually deleted. The store rethrows
failures and the page toasts the server's count, saying when fewer were deleted
than selected.

**Security rationale:**

- Fire department applications contain private information (names, emails, phones, documents)
- Retaining old data unnecessarily increases the impact of potential security incidents
- Auto-purge helps comply with data minimization principles
- The purge confirmation modal warns: "Purging permanently deletes applicant data and cannot be undone"

---

## Applicant Lifecycle

### Statuses

| Status      | Badge Color  | Description                               |
| ----------- | ------------ | ----------------------------------------- |
| `active`    | Emerald      | Actively progressing through the pipeline |
| `on_hold`   | Amber        | Temporarily paused by coordinator         |
| `withdrawn` | Slate        | Applicant withdrew their application      |
| `converted` | Blue         | Successfully converted to a member        |
| `rejected`  | Red          | Application was rejected                  |
| `inactive`  | Slate (dark) | Deactivated due to inactivity timeout     |

#### Lifecycle stamps _(2026-09-24, migration `77d4aa7798dd`)_

`deactivated_at`, `deactivated_reason`, `reactivated_at`, `withdrawn_at` and
`withdrawal_reason` are stored on `prospective_members` (with `target_role_id`).
They had readers — the drawer's "Deactivated:", "Last reactivated:" and
withdrawal lines, and the applicant table's columns — and no producer, so every
one rendered blank. They are **historical, not mirrors of `status`**:
`_apply_status_change`, the single choke point for every transition, single and
bulk, stamps forward and never clears. The migration backfilled them from
`prospect_activity_log` on the same rule, filling only NULLs (re-runnable); a
prospect whose transition predates the log stays NULL rather than being given a
guessed date.

**Clearing a field in an edit form persists** _(2026-09-30, #2859)_. The
drawer's phone, date of birth and address fields, an emptied stage description
in the Pipeline Builder, and every field the Interview form owns now send an
explicit `null` on update (`blankToNull`); `update_interview` writes through
`apply_updates` with the endpoint dumping `exclude_unset`. They used the
create-path `|| undefined`, so an emptied box survived behind a success toast
(CLAUDE.md pitfall #1). The drawer also shows an address with any part set, not
only one with a street and a city.

**Add Applicant needs a pipeline** _(2026-09-28, W16)_. The button is disabled
("Set up a pipeline first") until one exists; it used to open a form whose
submit returned silently.

### Actions

| Action     | Available When            | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advance    | Active                    | Moves applicant to the next pipeline stage; the server creates the election package if the target is an election_vote stage; sends the email if the target is an automated_email stage, and completes that stage once it is sent (2026-09-24). **Refused off an `election_vote` stage with no package** (2026-09-30). **Refused off an `election_vote` stage whose package reads _Added to Ballot_ or _Not Elected_** — see [Stage completion gates](#stage-completion-gates-2026-09-13) |
| Regress    | Active (not first stage)  | Moves applicant back to the previous pipeline stage; resets that stage's progress to `IN_PROGRESS`. Logged as `prospect_regressed`                                                                                                                                                                                                                                                                                                                                                       |
| Hold       | Active                    | Sets status to on_hold                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reject     | Active, On Hold, Inactive | Sets status to rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Withdraw   | Active, On Hold           | Sets status to withdrawn; archives the application                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reactivate | Inactive, Withdrawn       | Returns applicant to active status at their previous stage                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Convert    | Active (final stage)      | Creates member record, sets status to converted. Carries the same `election_vote` gate as Advance _(2026-09-14, MP-30)_, and is refused while any Required stage is not COMPLETED _(2026-09-28)_                                                                                                                                                                                                                                                                                         |

### Withdraw / Archive

When an applicant (or their coordinator) decides to withdraw from the process:

1. Click **Withdraw** in the detail drawer or table action menu
2. Confirm the withdrawal in the confirmation prompt (optional reason field)
3. The application moves to the **Withdrawn** tab
4. Withdrawn applicants can be reactivated by a coordinator at any time

The Withdrawn tab on the main page shows all withdrawn applications with name, last stage, withdrawal date, and reason.

#### Enable Status Page stages are wired _(2026-09-25, #2721)_

The `status_page_toggle` stage shipped with an editor and stored config and no
reader (pitfall #19). `public_status_enabled_for()` now decides per applicant:
the latest Enable Status Page stage they have reached overrides the pipeline's
`public_status_enabled` either way; an applicant who has reached none follows
the switch, so existing pipelines behave as before. It is derived from
position, not stored, so regressing undoes it. The status read, the
self-withdrawal and the stage-email tracker link all ask that one function. On
arrival via `_advance_current_step`, an enabling stage emails the status link
(restarting the link's 30-day inactivity window) and a disabling stage sends
nothing; both then complete through `_complete_on_arrival_step`, the path the
automated-email stage now shares. A failed send, or no applicant email, leaves
the stage open; a final stage never completes itself.

#### Hiding upcoming stages _(2026-09-24)_

`membership_pipelines.public_show_future_stages` (migration `1b52ea3a079e`,
NOT NULL, server default 1 — so no pipeline changes on upgrade; idempotent both
ways because `repair_schema` can add the column first). Pipeline Settings shows
it as **Show upcoming stages** under the status-page switch, disabled while the
page is off and no Enable Status Page stage exists. When off, the public
status response lists only the public-visible stages the applicant has
completed, withholds the current stage name and its action card, and returns
`total_stages: null` — the count alone would say how many remain. The page then
reads "N completed".

**Unavailable is not "not found"** _(2026-09-28, W17-2)_. Only a 404/400/422
reads **Application Not Found**; any other failure reads **Status Unavailable**
with **Try again**. An outage used to tell the applicant their application did
not exist. The withdraw dialog's label no longer reads "Reason (optional)
(optional)".

#### Applicant self-withdrawal _(2026-09-24)_

An applicant can also withdraw from their own public **Application Status** page (`/application-status/:token`). A **Withdraw Application** button opens a confirmation dialog with an optional reason, and calls `POST /api/public/v1/application-status/{token}/withdraw`.

- **Same credential, same conditions as the read.** The emailed status token authenticates it; an unknown or expired token, or a pipeline with public status pages turned off, answers 404 exactly as `GET /application-status/{token}` does.
- **Only an open application.** `active` and `on_hold` can be withdrawn; anything else answers 409. `approved` is excluded deliberately — it is the department's decision awaiting conversion, so an applicant declining at that point contacts the coordinator. The status response carries `can_withdraw`, and the page shows the button only when it is true.
- **Attribution.** The activity-log entry has no `performed_by` user and carries `"by_applicant": true`; an audit event `membership_pipeline.prospect_self_withdrawn` records the organization and client IP. The row is locked for the status check, as coordinator status changes are.
- A coordinator can reactivate a self-withdrawn application exactly like any other.
- **The coordinators are emailed.** After the withdrawal commits, every active member holding the **Membership Coordinator** or **Assistant Membership Coordinator** position receives an email naming the applicant, the pipeline, the stage they were at and any reason they gave. If nobody holds either position, it goes instead to every member who can manage prospective members (`prospective_members.manage`), so a withdrawal is never announced to no one. The send is best-effort: a mail failure is logged and never undoes the withdrawal or errors on the applicant's page. A `withdrawal_notice_sent` activity entry records how many were emailed. Email only — no SMS (CLAUDE.md pitfall #18).
- **The applicant gets a confirmation.** After the coordinator notice, the applicant is emailed that their withdrawal went through, with the date in the department's timezone. It uses the **Application Withdrawn** template (`application_withdrawn`, under _Members & Accounts_ in Communications → Email Templates), so the department can reword it; until someone opens that screen, the built-in default is sent. The two emails are independent — either failing leaves the other, and the withdrawal, untouched — and a `withdrawal_confirmation_sent` activity entry records whether it was delivered. Migration `941e1251ad74` adds the type to the `template_type` enum on `email_templates` and `scheduled_emails`.

### Desired Membership Type

Each applicant has an optional `desired_membership_type` field (`'regular'` or `'administrative'`) indicating what kind of membership they are seeking. The options are presented as **Regular Member** (starts as probationary) and **Administrative Member** (non-operational role). "Probationary" is not offered as a direct choice since it is a transitional status that all regular members pass through, not a membership type applicants select.

**Setting it via forms:** When a Membership Interest Form includes a "Membership Type" question, the answer is auto-mapped to `desired_membership_type` using the form field label mapping system. Recognized labels include: `membership type`, `desired membership type`, `type of membership`, `member type`, `regular or administrative`.

**Changing it in the pipeline:** The Applicant Detail Drawer displays the current membership type as a pair of toggle buttons between the Contact Info and Application Data sections. A coordinator can click the alternate type to change it at any time. The change takes effect immediately via an inline API update.

**How it flows through to conversion** _(changed 2026-09-30)_: the applicant's type picks a **track** — `regular` → operational, `administrative` → administrative — and the pipeline's `conversion_config` says what each track becomes (see [Conversion](#conversion)). The Conversion Modal pre-fills **Member class** and **Starting status** from that rule; it no longer offers Regular / Administrative cards.

### Conversion

When an applicant reaches the final pipeline stage and is approved, the coordinator clicks **Convert** in the drawer. `ConversionModal` is two steps — **Review Applicant**, then **Set Up Account** — and posts to `POST /prospective-members/prospects/{prospect_id}/transfer`.

**What the member becomes — `conversion_config`** _(2026-09-30, #2836, migration `601fdb28ab8c`)_. A nullable JSON column on `membership_pipelines`, one outcome per track: `{"operational": {"member_class", "member_status"}, "administrative": {...}}`, where `member_status` is `probationary` or `regular`. NULL means the defaults, which are what the Convert dialog produced before: operational → probationary operational, administrative → regular administrative. The pipeline response always carries the **effective** outcomes, defaults filled in, so the frontend holds no copy of them. One rule, `resolve_conversion_outcome`, is applied by automatic conversion — which fixes automatic conversion, which used to ignore the applicant's track and make everyone a probationary operational member. Pipeline Settings → **When an Applicant Becomes a Member** edits it; create and duplicate carry it. `_do_transfer` writes `member_class` / `member_status` directly, so outcomes the legacy `membership_type` cannot spell (probationary administrative) survive. Precedence: explicit `member_class` + `member_status`, then a legacy `membership_type` (old API callers, unchanged), then the pipeline rule.

**Target role** _(2026-09-24, #2656, migration `77d4aa7798dd`)_. `target_role_id` (FK to `positions`, `SET NULL`) is stored on the application, settable on Add Applicant, the drawer's contact editor and the Convert dialog; `target_role_name` is serialized from the relationship. `_do_transfer` uses an explicit `role_ids` when given and the stored target role otherwise — which also reaches automatic conversion. Before this, `role_ids` was always empty and every converted member got the default `member` position alone. The Add Applicant form did not actually send the field until #2841 (2026-09-29). **MP-31** (#2829, 2026-09-30): saving a target role runs the role-grant ceiling against the saver (on update, only when it changes), and the server records the chooser in `metadata.target_role_set_by`, discarding any client-supplied value. Manual conversion checks the role actually applied against the converting member. Automatic conversion applies the stored role only while its chooser is active and still holds every permission it grants; otherwise the member gets the default position and the activity log says a leader must assign it. A role saved before 2026-09-30 has no recorded chooser and so is never applied automatically.

**Password delivery** _(2026-09-27, #2751)_. `TransferProspectRequest` takes an optional `password` (checked like `POST /users`) beside `send_welcome_email`. The dialog asks **How will they get their password?** — email a temporary one (withdrawn when `GET /users/welcome-email-available` says email cannot send; that endpoint now also admits `members.manage` and `prospective_members.manage`), set one now, or set it later with Reset Password. The endpoint refuses a welcome email it cannot deliver; neither email nor password stays allowed. The result screen shows the assigned membership number and what is left to do. Automatic conversion sends the welcome email after the approval commits, and when none goes out records it on the activity log and notifies the approver in-app.

**Required stages** _(2026-09-28, #2771, W16-1)_. Transfer — manual and automatic — is refused while any Required stage is not COMPLETED (`_incomplete_required_steps`); a skipped stage does not count. A manual Convert grades the current stage with the same gate Advance uses, so an unsigned Multi-Signer Approval stage returns "Approval still needed from: …".

**Notes** _(2026-09-30, #2859)_. `notes` (max 2000) is passed through `transfer_to_membership` to `_do_transfer` and recorded on the `transferred_to_membership` activity entry, which the drawer's activity log now renders. Before this the dialog's notes were never sent.

**Identifier collisions** _(2026-09-29, #2845 / #2823)_. The username, email and department-email checks count deactivated rows, as the unique indexes do; generated usernames and department emails step past a deactivated one. A typed `membership_id` that belonged to a former member is refused unless it goes back to that member.

On success the system creates the member record, applies class/status/role, sets the applicant to `converted`, links `converted_to_member_id`, and records the conversion.

**Automatic Transfer to Membership** _(2026-10-05)_. `MembershipPipeline.auto_transfer_on_approval` decides whether completing the final stage converts the applicant without a coordinator clicking Convert. The backend always accepted and returned it, but the frontend `Pipeline` type dropped it and nothing sent it, so a department could neither turn it on nor see which way it was set (CLAUDE.md pitfall #19, mirrored). It is now carried on `Pipeline`, `PipelineCreate` and `PipelineUpdate`, mapped from the response, and sent only when given, so an update that does not mention it leaves it alone. **Pipeline Settings** has an **Automatic Transfer to Membership** card with the checkbox "Make applicants members automatically when they complete the final stage". When on: a recorded vote or sign-off on the final stage creates the member (account created and, where email is set up, a welcome email sent, as if Convert had been used); **skipping the final stage never converts anyone**; every Required stage must be complete first. When off, applicants who finish wait for a coordinator.

---

## Election Package Integration

When a pipeline includes an `election_vote` stage, the server creates an **election package** when an applicant enters that stage. This bridges the Prospective Members and Elections modules.

**Server-side creation** _(2026-09-30, #2851)_. `ensure_election_package_on_entry` creates the package for an `election_vote` step on entry, idempotent per prospect + step (a package for that step, or a legacy one with no step, counts as existing). It is called from `_advance_current_step` (single and bulk advance, skip, sign-off, integration auto-advance), `regress_prospect`, `assign_stage`, `delete_step`'s fallback and `create_prospect`, inside the mover's transaction under its prospect row lock, with a locking existence read. The snapshot build moved into `_stage_election_package`, shared with the manual create endpoint; stage history is read after a flush so the stage just completed counts. Before this, only the frontend store's `advanceApplicant` created a package, in a second request, so every other route left applicants on the vote with none (and re-entry by Advance stacked a second draft). The vote-stage gate now refuses to advance or convert off an `election_vote` stage with **no** package; the drawer's **Create Package** fixes an applicant who reached the stage before this. A pipeline with no vote stage is unaffected — the check is in the vote-stage gate, not the shared `_election_block_reason`.

**Ballot identity in the drawer** _(2026-09-24, #2652)_. `mapElectionPackageResponse` now carries `election_title`, `election_status` and `election_end_date`; it copied only `election_id`, so the drawer's link to the deciding ballot never rendered. `mapperFieldIntegrity.test.ts` guards fields a component reads that no mapper assigns.

### How It Works

```
Applicant advances to election_vote stage
  → Election package created server-side on entry (status: draft)
  → Coordinator reviews and edits package
  → Coordinator marks package as "Ready for Ballot" (status: ready)
  → Secretary picks up ready packages in Elections module
  → Secretary adds to ballot (status: added_to_ballot)
  → Election completes (status: elected / not_elected)
```

### Election Package Contents

An election package bundles the following applicant data (configurable per stage):

| Field                   | Default  | Description                                                                 |
| ----------------------- | -------- | --------------------------------------------------------------------------- |
| Applicant name          | Always   | Full name snapshot at package creation                                      |
| Desired membership type | Always   | Administrative or probationary (from applicant's `desired_membership_type`) |
| Target role             | Always   | If assigned                                                                 |
| Email                   | On       | Applicant's email address                                                   |
| Phone                   | Off      | Applicant's phone number                                                    |
| Address                 | Off      | Applicant's mailing address                                                 |
| Date of birth           | Off      | Applicant's date of birth                                                   |
| Documents               | On       | All uploaded documents from previous stages                                 |
| Stage history           | On       | Summary of completed stages and dates                                       |
| Coordinator notes       | Editable | Internal notes (not shown to voters)                                        |
| Supporting statement    | Editable | Statement shown on ballot or to voters                                      |
| Custom fields           | Editable | Additional key-value pairs                                                  |

### Configuring Package Fields

In the Stage Configuration Modal for an `election_vote` stage:

1. Scroll to the "Election Package Contents" section
2. Toggle which applicant fields to include
3. Optionally set a custom coordinator prompt

### Package Statuses

| Status            | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `draft`           | Package created, coordinator can edit notes and statement               |
| `ready`           | Coordinator submitted package; available for secretary to add to ballot |
| `added_to_ballot` | Secretary has added this candidate to an election ballot                |
| `elected`         | Applicant was elected by membership vote                                |
| `not_elected`     | Applicant was not elected                                               |

### Recommended Ballot Item

Each package includes a `recommended_ballot_item` pre-configured from the stage's election settings (voting method, victory condition, anonymous voting, eligible voter roles). The secretary can use these as defaults when building the ballot.

### API Endpoints

| Method  | Path                                                           | Permission | Description                                           |
| ------- | -------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| `GET`   | `/api/v1/prospective-members/applicants/{id}/election-package` | `view`     | Get election package for applicant                    |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage`   | Create election package                               |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage`   | Update election package                               |
| `GET`   | `/api/v1/prospective-members/election-packages`                | `view`     | List election packages (with status/pipeline filters) |

---

## Statistics

The stats bar on the main page shows up to seven metrics:

| Metric              | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| Total Active        | Count of applicants with `status = 'active'`                            |
| Converted           | Count of applicants with `status = 'converted'`                         |
| Avg Days to Convert | Average days from application to conversion (converted applicants only) |
| Conversion Rate     | Converted / (Converted + Rejected), measuring decided applications      |
| Approaching Timeout | Active applicants in warning or critical alert state                    |
| Inactive            | Count of applicants with `status = 'inactive'`                          |
| Withdrawn           | Count of applicants with `status = 'withdrawn'` (shown when > 0)        |

**The stats bar and the applicant list agree** _(2026-09-16)_. They are two
requests, and three things let them drift: mutations that refreshed only the
list (`ConversionModal` called `fetchApplicants` alone, and skip-stage,
assign-stage, advance, regress, hold and bulk reactivate never refreshed the
counts), filters the stats did not count through, and out-of-order responses.
`refreshPipelineView` now refreshes both halves and every mutation goes through
it; `pipelineRefreshIntegrity.test.ts` fails on a new bare `fetchApplicants`
caller. The six list fetches each carry a sequence number, and a stale response
is dropped whole — no rows, no cleared loading flag, no error against a list it
no longer describes.

The leadership Pipeline Overview report additionally provides year-over-year applicant volume and growth, annual conversion and time-to-convert cohorts, referral-source effectiveness, configurable stage-group throughput, and applicant-level detail for authorized users. Date-range filters apply to the application date, so annual cohorts remain tied to the year in which each applicant entered the pipeline.

---

## Permissions

| Permission                   | Description                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `prospective_members.view`   | View pipeline, applicant list, and details                                                  |
| `prospective_members.manage` | Full CRUD: modify pipeline, advance/reject/reactivate applicants, configure settings, purge |

### Default Role Assignments

| Role                                            | Permission                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| IT Administrator                                | Full access (wildcard)                                                                               |
| Secretary                                       | `prospective_members.manage`                                                                         |
| Membership Coordinator                          | `prospective_members.manage`                                                                         |
| Assistant Membership Coordinator _(2026-09-24)_ | `prospective_members.manage` (plus read-only roster, and `members.manage_id_cards` since 2026-10-02) |

**Sign-offs need no module permission** _(2026-09-28)_. `GET /prospective-members/my-sign-offs` and `POST /prospective-members/prospects/{prospect_id}/approve-step` are reachable by any signed-in member with the module on: the officers a Multi-Signer Approval stage names rarely hold `prospective_members.*`. The service lists and accepts only stages asking for a role the caller holds, and returns the applicant's name and stage only — never the record. The last required signature completes the stage and advances the applicant.

**Applicant labels** _(2026-09-28, W17-3/W17-4)_. `/prospective-members/print-labels` takes `prospective_members.view` **or** `.manage` (a manage-only coordinator used to get Access Denied), and labels print `_short_id(id)` — never the status token, which the label preview used to return to staff and every printed badge carried.

---

## Zustand Store

The `useProspectiveMembersStore` manages all module state:

### State

| Field                                          | Type                      | Description                                                                                                                        |
| ---------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `currentPipeline`                              | `Pipeline \| null`        | Current pipeline with stages and config                                                                                            |
| `applicants`                                   | `ApplicantListItem[]`     | Active applicants for current page                                                                                                 |
| `totalApplicants`                              | `number`                  | Total active applicant count                                                                                                       |
| `currentPage` / `totalPages`                   | `number`                  | Active list pagination                                                                                                             |
| `activeTab`                                    | `PipelineTab`             | Current tab (`'active'`, `'inactive'`, or `'withdrawn'`)                                                                           |
| `inactiveApplicants`                           | `ApplicantListItem[]`     | Inactive applicants for current page                                                                                               |
| `inactiveTotalApplicants`                      | `number`                  | Total inactive count                                                                                                               |
| `inactiveCurrentPage` / `inactiveTotalPages`   | `number`                  | Inactive list pagination                                                                                                           |
| `withdrawnApplicants`                          | `ApplicantListItem[]`     | Withdrawn applicants for current page                                                                                              |
| `withdrawnTotalApplicants`                     | `number`                  | Total withdrawn count                                                                                                              |
| `withdrawnCurrentPage` / `withdrawnTotalPages` | `number`                  | Withdrawn list pagination                                                                                                          |
| `currentElectionPackage`                       | `ElectionPackage \| null` | Election package for currently viewed applicant                                                                                    |
| `stats`                                        | `PipelineStats \| null`   | Aggregated pipeline statistics                                                                                                     |
| `currentApplicant`                             | `Applicant \| null`       | Currently selected applicant for detail drawer                                                                                     |
| Loading flags                                  | `boolean`                 | `isLoading`, `isLoadingInactive`, `isLoadingWithdrawn`, `isLoadingElectionPackage`, `isReactivating`, `isPurging`, `isWithdrawing` |

### Actions

| Action                                         | Description                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fetchPipeline()`                              | Load current pipeline with stages                                                                                                 |
| `fetchApplicants(page?)`                       | Load active applicants with pagination                                                                                            |
| `fetchInactiveApplicants(page?)`               | Load inactive applicants with pagination                                                                                          |
| `fetchStats()`                                 | Load pipeline statistics                                                                                                          |
| `advanceApplicant(id)`                         | Move applicant to next stage; auto-creates election package for election_vote stages; auto-sends email for automated_email stages |
| `regressApplicant(id, notes?)`                 | Move applicant back to previous stage; resets previous stage progress to IN_PROGRESS                                              |
| `holdApplicant(id)`                            | Put applicant on hold                                                                                                             |
| `rejectApplicant(id)`                          | Reject applicant                                                                                                                  |
| `withdrawApplicant(id, reason?)`               | Withdraw/archive applicant from pipeline                                                                                          |
| `reactivateApplicant(id)`                      | Reactivate inactive or withdrawn applicant                                                                                        |
| `fetchWithdrawnApplicants(page?)`              | Load withdrawn applicants with pagination                                                                                         |
| `fetchElectionPackage(applicantId)`            | Load election package for current applicant                                                                                       |
| `updateElectionPackage(applicantId, data)`     | Save election package edits                                                                                                       |
| `submitElectionPackage(applicantId)`           | Mark election package as ready for ballot                                                                                         |
| `purgeInactiveApplicants(pipelineId, data)`    | Permanently delete inactive applicants                                                                                            |
| `updateInactivitySettings(pipelineId, config)` | Update pipeline inactivity configuration                                                                                          |
| `setActiveTab(tab)`                            | Switch between active/inactive/withdrawn tabs                                                                                     |

---

## API Endpoints

### Pipeline Endpoints

| Method   | Path                                                          | Permission | Description                                   |
| -------- | ------------------------------------------------------------- | ---------- | --------------------------------------------- |
| `GET`    | `/api/v1/prospective-members/pipelines`                       | `view`     | List pipelines                                |
| `POST`   | `/api/v1/prospective-members/pipelines`                       | `manage`   | Create pipeline                               |
| `GET`    | `/api/v1/prospective-members/pipelines/{id}`                  | `view`     | Get pipeline with stages                      |
| `PATCH`  | `/api/v1/prospective-members/pipelines/{id}`                  | `manage`   | Update pipeline (including inactivity config) |
| `POST`   | `/api/v1/prospective-members/pipelines/{id}/stages`           | `manage`   | Add stage                                     |
| `PATCH`  | `/api/v1/prospective-members/pipelines/{id}/stages/{stageId}` | `manage`   | Update stage                                  |
| `DELETE` | `/api/v1/prospective-members/pipelines/{id}/stages/{stageId}` | `manage`   | Remove stage                                  |
| `POST`   | `/api/v1/prospective-members/pipelines/{id}/purge-inactive`   | `manage`   | Purge inactive applicants                     |

### Applicant Endpoints

| Method  | Path                                                           | Permission | Description                                  |
| ------- | -------------------------------------------------------------- | ---------- | -------------------------------------------- |
| `GET`   | `/api/v1/prospective-members/applicants`                       | `view`     | List applicants (with filtering, pagination) |
| `POST`  | `/api/v1/prospective-members/applicants`                       | `manage`   | Create applicant                             |
| `GET`   | `/api/v1/prospective-members/applicants/{id}`                  | `view`     | Get applicant details                        |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}`                  | `manage`   | Update applicant                             |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/advance`          | `manage`   | Advance to next stage                        |
| `POST`  | `/api/v1/prospective-members/prospects/{id}/regress`           | `manage`   | Move back to previous stage                  |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/hold`             | `manage`   | Put on hold                                  |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/reject`           | `manage`   | Reject applicant                             |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/withdraw`         | `manage`   | Withdraw applicant from pipeline             |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/reactivate`       | `manage`   | Reactivate inactive or withdrawn applicant   |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/convert`          | `manage`   | Convert to member                            |
| `GET`   | `/api/v1/prospective-members/applicants/{id}/election-package` | `view`     | Get election package                         |
| `POST`  | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage`   | Create election package                      |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage`   | Update election package                      |

### Prospect Document Endpoints (2026-05)

These endpoints now persist real files (previously metadata-only). The router
prefix is `/prospective-members`, so the full paths are as shown.

| Method   | Path                                                                                   | Permission                                                                   | Description                                                                |
| -------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET`    | `/api/v1/prospective-members/prospects/{prospect_id}/documents`                        | `members.view` \| `prospective_members.view` \| `prospective_members.manage` | List a prospect's documents (sanitized metadata)                           |
| `POST`   | `/api/v1/prospective-members/prospects/{prospect_id}/documents`                        | `members.manage` \| `prospective_members.manage`                             | Upload a document (multipart: `file`, `document_type`, optional `step_id`) |
| `GET`    | `/api/v1/prospective-members/prospects/{prospect_id}/documents/{document_id}/download` | `members.view` \| `prospective_members.view` \| `prospective_members.manage` | Download the stored file (`FileResponse`, path-traversal guarded)          |
| `DELETE` | `/api/v1/prospective-members/prospects/{prospect_id}/documents/{document_id}`          | `members.manage` \| `prospective_members.manage`                             | Delete the document record **and** remove the file from disk               |

### Election Package Endpoints (Cross-Module)

| Method | Path                                            | Permission | Description                                                |
| ------ | ----------------------------------------------- | ---------- | ---------------------------------------------------------- |
| `GET`  | `/api/v1/prospective-members/election-packages` | `view`     | List election packages (filterable by pipeline_id, status) |

### Statistics Endpoint

| Method | Path                                                        | Permission         | Description             |
| ------ | ----------------------------------------------------------- | ------------------ | ----------------------- |
| `GET`  | `/api/v1/prospective-members/pipelines/{pipeline_id}/stats` | `view` or `manage` | Get pipeline statistics |

Optional query parameters _(2026-09-16)_: `search` and `event_id` narrow the
counted population exactly as they narrow `GET /prospects`, through one shared
predicate builder. Omitting both returns the whole-pipeline counts, so clients
written before they existed are unaffected. `event_id` is confirmed in-org
before it is counted through (pitfall #14c). The status filter is deliberately
**not** accepted: it scopes the open-pipeline view alone, and counting through
it would zero the Rejected / Withdrawn / Converted figures the same response
feeds.

_(Corrected 2026-09-24: this table previously gave the path as
`/api/v1/prospective-members/stats`, which does not exist.)_

### Query Parameters (Applicant List)

| Parameter          | Type              | Description                            |
| ------------------ | ----------------- | -------------------------------------- |
| `page`             | `number`          | Page number (default: 1)               |
| `per_page`         | `number`          | Items per page (default: 20)           |
| `status`           | `string`          | Filter by status                       |
| `stage_id`         | `string`          | Filter by current stage                |
| `search`           | `string`          | Search by name or email                |
| `sort_by`          | `string`          | Sort field                             |
| `sort_order`       | `'asc' \| 'desc'` | Sort direction                         |
| `include_inactive` | `boolean`         | Include inactive applicants in results |

---

## As Built — Board, Bulk Actions & Cross-Tenant Guards _(2026-08-08)_

> The endpoint tables above are the module's design sketch and use
> `/applicants` paths. The **shipped** router is
> `/api/v1/prospective-members` and addresses applicants as `/prospects`. The
> endpoints in this section are verified against the code.

### The Kanban Board Endpoint

`GET /api/v1/prospective-members/pipelines/{pipeline_id}/kanban`
(`prospective_members.view` | `prospective_members.manage`)

**It now declares a response model.** It previously returned a bare `dict`, so
FastAPI serialized **every column** of `ProspectiveMember` — which put
`status_token`, the credential behind the public application-status page, plus
coordinator notes, date of birth and home address into a board view held by
anyone with `prospective_members.view`.

| Response field          | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `pipeline`              | `PipelineResponse`                                                      |
| `columns[]`             | `KanbanColumnResponse` — one per stage                                  |
| `columns[].step`        | `PipelineStepResponse \| null`                                          |
| `columns[].prospects[]` | `ProspectListResponse` — **the same projection as the prospect list**   |
| `columns[].count`       | The **true** number in this column, which can exceed the cards returned |
| `total_prospects`       | Across the whole board                                                  |
| `returned_prospects`    | How many cards were actually sent                                       |
| `truncated`             | `true` when the board is showing less than the whole pipeline           |

Two invariants hold this closed:

1. **The list and kanban endpoints share one mapper**, so the two projections
   cannot diverge and neither can fall back to serializing the raw model.
2. **The kanban query eager-loads what the mapper reads** — the pipeline name
   and step progress. A lazy load from the async response path raises
   `MissingGreenlet` rather than merely being slow, so this is a correctness
   requirement, not an optimization.

**Client side:** the board requests `KANBAN_PAGE_SIZE` (**200**, the ceiling the
list endpoint accepts) rather than `DEFAULT_PAGE_SIZE` (25). It previously
grouped applicants into columns client-side from the same paginated list the
table uses, so a department with more than 25 active applicants saw a board
assembled from a fraction of them — cards simply missing, column counts to
match, and nothing on screen saying so. Switching from the table also carried
whatever page the table had been left on; switching views now **refetches**.
Past the 200 ceiling the board **states how many applicants it is not showing**.

### Bulk Actions

| Method | Path                                                 | Permission                                       | Description                               |
| ------ | ---------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `POST` | `/api/v1/prospective-members/prospects/bulk-advance` | `members.manage` \| `prospective_members.manage` | Advance several applicants in one request |
| `POST` | `/api/v1/prospective-members/prospects/bulk-status`  | `members.manage` \| `prospective_members.manage` | Set status on several applicants          |

Before these existed the UI looped client-side, one request per applicant,
sequentially, discarding every error. Thirty selected applicants meant thirty
round trips — each committing, sending stage email and auto-linking events —
and a partial failure surfaced as a bare count naming nobody.

**Request**

| Field          | Type         | Notes                                                                            |
| -------------- | ------------ | -------------------------------------------------------------------------------- |
| `prospect_ids` | `List[UUID]` | 1–**200** ids. The cap is a guardrail against an unbounded body, not a page size |
| `notes`        | `str?`       | `bulk-advance` only                                                              |
| `status`       | `str`        | `bulk-status` only — `active`, `on_hold`, `approved`, `rejected`, `withdrawn`    |
| `reason`       | `str?`       | `bulk-status` only, max 1000 chars                                               |

**Response** (`BulkActionResponse`)

| Field             | Type                     | Notes                                       |
| ----------------- | ------------------------ | ------------------------------------------- |
| `succeeded_count` | `int`                    |                                             |
| `failed_count`    | `int`                    |                                             |
| `results[]`       | `BulkActionItemResult[]` | `prospect_id`, `name`, `succeeded`, `error` |

**One failure never aborts the rest** — the outcome is itemized so the caller
can name who was skipped and why.

#### One bulk bar for both views _(2026-09-24)_

The page (`ProspectiveMembersPage`) owns the selection and draws the only bulk
bar: **Print Badges**, **Advance All**, **Hold All** and **Reject All**. It
serves the kanban board and the table alike.

`PipelineTable` used to draw a second bar of its own whenever rows were
selected, so Table view stacked two "N selected" bars. Its **Advance** matched
the page's **Advance All** but reached it by a different path: one
`advance` request per applicant, reporting only a count of failures. Its
**Hold** existed nowhere else. The table's bar has been removed. **Hold All**
is now on the page's bar and goes through `bulk-status` with `on_hold`. The
table's selection props are now required, so it cannot draw a bar of its own
again unnoticed.

#### Edge cases

| Situation                                           | Behavior                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The caller's **own** prospect record is in the list | Reported as **"not found"** — indistinguishable from an id that does not exist. Bulk ids arrive in the request _body_, where the router's path-parameter privacy guard cannot see them, so both endpoints filter it explicitly                           |
| An id from another organization                     | Same — "not found", never an existence oracle                                                                                                                                                                                                            |
| A `reason` on `bulk-status`                         | Recorded in the **activity log**. It deliberately does **not** touch the `notes` column — the old client-side path sent it through the update endpoint as `notes`, so a bulk rejection silently overwrote the coordinator notes on every selected record |
| More than 200 ids                                   | `422` from Pydantic's `max_length`                                                                                                                                                                                                                       |

### Checklist Stages Advance With Their Ticks _(2026-10-05)_

A checklist stage with items configured could not be passed: `_validate_step_completion` refuses until `completed_items` covers the items, and nothing in the app ever sent that key (the drawer only read it back, "No checklist data recorded yet"). `POST /prospects/{id}/advance` now accepts an optional `completed_items` list (at most 200 items, each at most 255 characters), which `advance_prospect` passes to `complete_step` as the `action_result` the validator grades. The applicant drawer renders the stage's configured items as checkboxes, seeded from any ticks already stored for the stage, shows "N of M items done", and holds the ticks per applicant and stage so a refetch keeps them; Advance sends them for a checklist stage only. **Dragging a card on the board sends no ticks**, so a checklist stage with items is advanced from the drawer. Skip is unchanged.

### Stale In-Progress Stage Rows Are Reset _(2026-10-05)_

Before `regress_prospect` was fixed, moving an applicant back a stage left the stage they vacated marked `in_progress`. Those rows survive in long-lived databases, and the drawer draws a chip for every non-pending row, so an applicant could show stages they had not reached. Migration `99b16109d44c` resets a row to `pending` (no completion stamp, as `regress_prospect` writes today) only when it is `in_progress`, its step is in the same pipeline as the applicant's current step, and that step sorts after the current one. The current stage, every stage behind it, other pipelines and prospects with no current stage are untouched. It is idempotent, skips a database without the tables, logs how many rows it reset, and its downgrade does nothing.

### Advance Reports What Actually Happened

`POST /prospects/{prospect_id}/advance` previously returned the untouched
prospect when there was nowhere to advance to — already at the final stage, or
no current stage at all. The endpoint saw a non-`None` result, answered `200`,
the drawer said "Advanced" with nothing changed, and a
`membership_pipeline.prospect_advanced` **audit entry was written for a
movement that never occurred**. The audit log exists to reconstruct who moved
whom through membership, so a fabricated entry in it was the worst part.

Both no-op cases now raise, the endpoint answers **`409`** — the request is
well-formed, the prospect simply has nowhere to go — and the audit event is
written **only after a real advance**.

### `referred_by` Is Org-Scoped (XC-1)

`referred_by` is the one client-supplied foreign key that prospect create and
update accept; every other FK is in `_PROSPECT_PROTECTED_FIELDS`. It was stored
straight from the request.

This matters more than a dangling reference on the application, because
`_do_transfer` copies the value onto the new member as
`User.referred_by_user_id` — so an id from another organization did not stay on
the prospect, it **landed in the `users` table and outlived it**. Nothing leaked
only because nothing currently resolves the referrer into a name; the first view
rendering "Referred by …" would have turned it into a leak.

| Path                        | Behavior                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /prospects`           | Validated through the shared `assert_in_org` (fails closed)                                                                                                                                                |
| `PUT /prospects/{id}`       | Same, when `referred_by` is present in the payload                                                                                                                                                         |
| Conversion (`_do_transfer`) | **Drops** an out-of-org referrer rather than copying it, and logs a warning. Legacy data written before this validation existed must not block a member being elected, so it is dropped rather than raised |

`assert_in_org` returns a deliberately **generic** message, so the endpoint is
not a cross-tenant existence oracle — a real id from another org and an invented
one are indistinguishable, and there is a test pinning that.

Both endpoints now translate `ValueError` into **`400`**. They previously let it
reach the catch-all handler as a `500`, which also mistranslated the existing
"Invalid pipeline" rejection.

### Inactivity Processing Is Batched

`POST /prospects/process-inactivity` processes in batches rather than
row-at-a-time, and the kanban query is bounded, so a large pipeline no longer
scales linearly in round trips.

---

## Automated Email System (2026-03-14)

When a prospect advances to an `automated_email` stage, the system automatically sends a configurable email to the applicant's email address.

### Email Configuration (StageConfigModal)

Each `automated_email` stage supports the following configuration in the stage config:

| Setting                  | Type      | Default                                 | Description                                              |
| ------------------------ | --------- | --------------------------------------- | -------------------------------------------------------- |
| `email_subject`          | `string`  | "Update on Your Membership Application" | Email subject line                                       |
| `include_welcome`        | `boolean` | `false`                                 | Include a welcome/introduction section                   |
| `welcome_message`        | `string`  | —                                       | Custom welcome text (shown when include_welcome is true) |
| `include_faq_link`       | `boolean` | `false`                                 | Include a link to the department FAQ                     |
| `faq_url`                | `string`  | —                                       | URL to the FAQ page                                      |
| `include_next_meeting`   | `boolean` | `false`                                 | Include next meeting details                             |
| `next_meeting_details`   | `string`  | —                                       | Meeting date, time, and location text                    |
| `custom_sections`        | `array`   | `[]`                                    | Array of `{title, content, enabled}` sections            |
| `include_status_tracker` | `boolean` | `false`                                 | Include a link to the application status page            |

### How It Works

```
Prospect advances to automated_email stage
  → System loads stage email config
  → Builds HTML email from configured sections
  → Sends via organization's SMTP settings
  → Logs success/failure in prospect activity log
  → On success, completes the stage through complete_step (2026-09-24)
```

**The stage completes itself once its email is sent** _(2026-09-24, #2655)_.
An automated-email stage used to send on arrival and then sit in progress until
a coordinator clicked past it. It now completes through `complete_step` as soon
as the send succeeds — same gates, activity entry and optional completion
notice as a manual completion — and consecutive email stages chain. A failed
send leaves the stage open, so a coordinator can see the applicant never
received it. A stage flagged final is never completed this way: sending an email
is not the approval (and, with `auto_transfer_on_approval`, the conversion) that
stage stands for. Applicants already sitting on an email stage are not completed
retroactively.

**`FRONTEND_URL` reaches the container** _(2026-09-24, #2655)_. The compose
files' backend environment block is a whitelist with no `env_file`, and
`FRONTEND_URL` was not on it, so every emailed link — the status tracker
included — was built from `http://localhost:3000`. It is passed through now;
see `docs/UPGRADING.md` → "`FRONTEND_URL` must be a public address".

### Email Pipeline Architecture

- **Background scheduler**: A background loop in `main.py` polls for pending scheduled emails every 60 seconds
- **Redis coordination**: Uses Redis lock (`lock:run_scheduled_emails`, TTL 120s) to prevent concurrent workers from processing the same emails
- **Worker claim**: A single worker claims the scheduler role via Redis key; claim is released on shutdown and auto-expires on crash
- **Batch processing**: Processes up to 100 pending emails per cycle
- **SMTP provider support**: Gmail (STARTTLS, port 587), Office 365 (STARTTLS, port 587), self-hosted (SSL on 465 or plain on 25)

### Edge Cases

| Scenario                                     | Behavior                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Organization has no SMTP settings configured | No email goes out and the applicant stays on the stage, which is the sign to fix email                                                           |
| Email sending fails (SMTP error)             | The stage stays open (not completed), so the applicant does not move past it _(corrected 2026-10-04: this row said the prospect still advanced)_ |
| Multiple workers running                     | Redis lock ensures only one worker processes emails at a time                                                                                    |
| Worker crashes while holding Redis claim     | Claim auto-expires after TTL; next cycle reclaims                                                                                                |
| Application shutdown                         | Redis claim key is explicitly deleted                                                                                                            |
| Empty custom section content                 | Section is omitted from email body                                                                                                               |
| HTML in user-provided content                | All content is HTML-escaped before inclusion in email template                                                                                   |

---

## Auto-Advance (2026-03-14)

Form submission and document upload stages support auto-advance, which automatically moves the prospect to the next pipeline stage when the stage's condition is met.

### Configuration

In the Stage Configuration Modal:

- **Form submission stages**: Check "Auto-advance when form is submitted"
- **Document upload stages**: Check "Auto-advance when documents are uploaded"

The setting is stored as `auto_advance: boolean` in the stage's `FormStageConfig` or `DocumentStageConfig`.

### Edge Cases

| Scenario                                                  | Behavior                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Auto-advance un-ticked                                    | Coordinator must manually advance the prospect; the submitted answers are still recorded on the stage |
| Auto-advance enabled, form submitted                      | **Only the prospect bound to that submission** moves to the next stage                                |
| Auto-advance enabled, last stage                          | Auto-advance does not trigger conversion — coordinator must manually convert                          |
| Stage config missing auto_advance field                   | Treated as **on** — see [Absence means advance](#absence-means-advance-2026-09-15)                    |
| Several prospects parked on the same auto-advancing stage | Unaffected by another prospect's submission — see below                                               |

> **Fixed 2026-08-17: one submission advanced everybody on the stage.**
> `FormsService._auto_advance_pipeline_step` selected _every_ `ACTIVE` prospect
> whose `current_step_id` matched the stage and completed the step for all of
> them. A single applicant returning a form pushed the whole cohort behind them
> forward, with a history entry on each that named only the form. A submission
> is evidence about its own submitter and nobody else.
>
> The selection now also filters
> `ProspectiveMember.form_submission_id == submission.id`, and the audit
> `action_result` carries `form_submission_id` alongside `form_id` so the cause
> of an advance is legible after the fact.
>
> **If you have prospects who were advanced in error before this date**, the
> tell is a stage-completion history entry reading "Auto-advanced on form
> submission" against a prospect with no matching submission of their own. Use
> [stage regression](#stage-regression-2026-03-14) to move them back.

### Absence means advance _(2026-09-15)_

`auto_advance` is read as `True` when the key is missing. That is deliberate and
is the opposite of what the table above said until this date.

Two paths advance a prospect on a form submission, and they read the setting
differently because they reach different stages:

| Path                             | Reads `auto_advance`         | Reaches                                                                                                               |
| -------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `_auto_advance_pipeline_step`    | Requires an explicit `true`  | Only the submission that **created** the prospect — `form_submission_id` is written once and is protected from update |
| `_complete_form_submission_step` | `.get("auto_advance", True)` | Every later form stage, because the pipeline service stamps each attached form `membership_interest`                  |

Reading a missing key as off would strand every existing installation's
applicants on their first stage at the upgrade: the checkbox writes its key only
once somebody toggles it, and the seeded pipelines store no config at all
(CLAUDE.md Pitfall #19). The checkbox renders ticked by default to match, and a
form stage's default config now stores the key explicitly, so a stage created
from here on says what it means rather than relying on the default.

**Recording is separate from moving on every path.** A submission that does not
advance still stores its answers on the stage's progress row via
`_store_form_answers`, so declining to advance never silently drops what was
submitted.

### Stage completion gates _(2026-09-13)_

`_validate_step_completion` refuses a completion that the stage's own evidence
does not support. Eight stage types carry a gate; two of them changed in this
window, and they are gated differently on purpose.

| Stage type              | Gate                                                                                       | Applies to a coordinator's click? |
| ----------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `election_vote`         | The applicant's latest election package must not read _Added to Ballot_ or _Not Elected_   | **Yes**                           |
| `meeting`               | A settled check-in at an event the stage's config names — see below _(revised 2026-09-16)_ | **Yes**, when the stage names one |
| `document_upload`       | The configured documents are present                                                       | Yes                               |
| `reference_check`       | The configured references are recorded                                                     | Yes                               |
| `checklist`             | The checklist items are ticked                                                             | Yes                               |
| `interview_requirement` | The interview is recorded                                                                  | Yes                               |
| `multi_approval`        | The approvals are recorded                                                                 | Yes                               |
| `medical_screening`     | The screening is recorded                                                                  | Yes                               |

**Why `election_vote` binds the coordinator.** A ballot result is a decision the
department has already made, recorded by the Elections module — a coordinator
clicking past it is overriding the membership, not exercising judgement.

**The `meeting` gate is decided by the stage, not by the caller** _(2026-09-16,
superseding the 2026-09-13 and 2026-09-15 rules)_. The gate used to key on
`automated` — who was advancing — so the same coordinator, applicant and stage
were refused in a bulk advance and allowed one card at a time. Now:

| Stage config                                                       | Every path (Advance, drag, bulk, automatic)                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Names an event (`linked_event_type` or a pinned `linked_event_id`) | Refused until a **settled** check-in exists at a matching event  |
| Names no event                                                     | Never graded — takes the coordinator's word; cannot auto-advance |

A check-in counts as evidence only when **all three** hold:

1. It is at an event `meeting_config_matches_event` accepts for the stage.
2. The event's check-in window was open **at or after the prospect record was
   created**. Measured against the window's _close_, not the check-in instant:
   the kiosk writes the prospect and its attendance within milliseconds in an
   order nothing should depend on, so this keeps the meeting that opened the
   record and excludes attendance from before the application existed.
3. The attendance is **settled** (`attendance_is_settled`): the event's
   attendance is finalized, **or** the event ended more than
   `PIPELINE_ATTENDANCE_SETTLE_DAYS` (default 7, `0` = at the event's end) ago.
   A sign-in at the door is not the department's final roster.

**What advances an applicant now.** The check-in hook is gone from both sign-in
paths (kiosk and staff-entered). Instead:

- **Finalizing an event** advances every checked-in applicant it clears, in one
  pass. End Event and recording an actual end time both finalize, so all three
  routes are covered. `finalize_event_attendance` returns early when no member
  RSVP checked in — the ordinary shape of an open house — so the pass hangs off
  both exits, not only the tail.
- **The nightly `prospect_attendance_advance` task** (05:30, cron
  `30 5 * * *`) re-asks the question for events nobody finalized. It is driven
  from the applicants on meeting stages, not from events, because the active
  applicant set is bounded while an "events that ended N days ago" lookback
  would need a far edge that silently drops the applicant it exists to rescue.
- **Re-finalizing** (after a reopen by an `events.reopen_attendance` holder)
  re-runs the pass and skips anyone already moved.

Two refusals, worded for their remedies. With no evidence, the message names
the three ways out in order: record the attendance, un-tick **Required** and
Skip, or clear the stage's Auto-Link Event Type. With a check-in at an event
that is not yet settled, it names the event and asks for the finalize — the
applicant did everything asked of them and the organizer did not.

Two adjacent defects fixed in the same change:
`complete_current_step_for_integration_event` compared the raw `step_type`, so a
legacy `action` + `schedule_meeting` stage was unreachable from the Cal.com
webhook meant to advance it; it now resolves through `effective_step_type`. And
`GuestCheckInService._meeting_config_matches_event`'s docstring still taught the
pre-2026-09-13 rule.

**The package graded is the one the drawer shows** — latest by `created_at` — so
`ElectionPackageSection` and the Advance button cannot disagree (CLAUDE.md
Pitfall #29). A stage with no package, or one still _Draft_ or _Ready_, advances
as before: a department that holds its vote at a meeting and records the outcome
by hand is unaffected.

**A meeting stage that names no event now matches no event.**
`meeting_config_matches_event` used to fall through to `True` when the config
named neither an event type nor an event id, on the reasoning that a stage which
cannot discriminate should take whatever attendance arrives. Guest check-in is
department-wide and departments enable it on public events, so a stage reading
"Meeting with the Fire Chief" advanced an applicant who signed in at a
fundraiser. That shape is the stage builder's **default**, not an exotic one.
`meeting_type` (`chief_meeting`, `president_meeting`) names the stage's purpose
for whoever reads it and is read nowhere on the backend — it is a label, not a
matcher. The stage builder now refuses to save an auto-advancing meeting stage
with no event type. Cal.com stages are exempt throughout: they advance off the
booking webhook, never off an attendance record.

**Election Vote and Manual Approval became creatable from the stage picker.**
`validate()` required `eligible_voter_roles` and `approver_roles` to be
non-empty, and neither has an input anywhere in the modal — both default to `[]`.
Manual Approval is the modal's default type and its error was never rendered, so
Save failed in silence; Election Vote showed a message with no field to satisfy.
Only the quick-add presets, which seed the keys, could create either. Nothing
reads either key — the ballot item takes `eligible_voter_types` off
`recommended_ballot_item`, and approval authority comes from
`prospective_members.manage` — so both were stored-but-inert config and the
validation is dropped.

---

## Stage Regression (2026-03-14)

Coordinators can move a prospect back to the previous pipeline stage using the "Move Back" action in the Applicant Detail Drawer.

### How It Works

1. Coordinator clicks "Move Back" in the applicant detail drawer
2. Optionally enters notes explaining the reason
3. System moves prospect to the previous step
4. Previous step's progress is reset to `IN_PROGRESS`
5. Activity is logged as `prospect_regressed` with source and target stage details

### API

```
POST /api/v1/prospective-members/prospects/{prospect_id}/regress
Body: { "notes": "optional reason" }
Response: ProspectResponse
```

### Edge Cases

| Scenario                        | Behavior                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Prospect is at the first stage  | Regression is blocked; prospect returned unchanged                                            |
| Prospect is on hold or inactive | Regression only applies to active prospects                                                   |
| Repeated regression             | Prospect can be regressed multiple times until reaching the first stage                       |
| Audit trail                     | All regressions are logged in the prospect's activity history with user, timestamp, and notes |

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#prospective-members-module-issues) for common issues including:

- Inactivity timeout not triggering
- Applicants incorrectly marked inactive
- Cannot reactivate an applicant
- Pipeline statistics showing unexpected values
- Purge operation safety guidance
- Withdraw/archive not appearing
- Election package not auto-created
- Election package stuck in draft
- Form submissions not appearing in pipeline _(fixed 2026-03-04)_
- Reprocessed submissions not updating prospects _(fixed 2026-03-04)_
- Duplicate prospects not detected _(fixed 2026-03-04)_
- ProspectResponse metadata returning SQLAlchemy MetaData object _(fixed 2026-03-04)_
- Automated email not sending when prospect advances to email stage _(fixed 2026-03-14)_
- SMTP credentials not decrypted before use _(fixed 2026-03-13)_
- IntegrityError when system performs automated pipeline actions _(fixed 2026-03-13)_
- Custom section add/edit not persisting in email config _(fixed 2026-03-13)_
- Scheduled email displaying UTC time instead of local time _(fixed 2026-03-14)_
- Scheduled email loop giving up permanently on stale Redis claim _(fixed 2026-03-14)_

---

## Recent Changes (March–May 2026)

### May 2026 — Real Prospect Document Storage

Document upload was metadata-only and is now backed by real file storage
(`backend/app/api/v1/endpoints/membership_pipeline.py`,
`backend/app/services/membership_pipeline_service.py`):

- **Real upload/download/delete**: `POST .../prospects/{id}/documents` (multipart)
  persists the file; `GET .../documents/{document_id}/download` streams it via
  `FileResponse`; delete removes both the DB record and the file from disk. See
  the "Prospect Document Endpoints" table above for paths and permissions.
- **Size limit raised to 50 MB** (was 10 MB), matching the frontend limit.
- **Magic-byte MIME validation**: the file's real content type is detected with
  `python-magic` (not the client `Content-Type` header). Allowed: PDF, Word
  (`.doc`/`.docx`), JPEG, PNG, GIF.
- **Anti double-extension storage**: stored under an org- then prospect-scoped
  path `/app/uploads/prospect-documents/{org_id}/{prospect_id}/{uuid}{ext}`,
  using a random UUID filename with a MIME-derived extension (never the
  user-supplied name) to defeat attacks like `resume.pdf.exe`.
- **Path-traversal guard on download**: the stored path is resolved with
  `os.path.realpath` and must reside under the uploads base directory or the
  request is rejected with 403.
- **Permissions**: upload/delete require `members.manage` or
  `prospective_members.manage`; list/download additionally accept the `.view`
  variants.

### March 15, 2026

- **Pipeline overview report with configurable stage grouping**: New `PipelineOverviewRenderer` report shows prospect counts per pipeline stage. Configurable stage groups (via `ReportStageGroupsEditor`) allow combining multiple stages into labeled groups (e.g., "Early Stages" = Application + Interview). New `report_stage_groups` column on pipeline steps with Alembic migration
- **Drag-and-drop section reordering for pipeline emails**: Email section order in pipeline email configuration can now be rearranged via drag-and-drop. Reordering updates `section_order` array. O(1) lookup optimization for section rendering with narrower `React.memo` dependencies
- **Email preview panel**: Preview rendered email content before sending. Shows subject, sections, and styling as they will appear to the recipient
- **Days-in-stage server-side calculation**: Days-in-stage was previously hardcoded to 0. Now computed server-side as the difference between current time and the prospect's `updated_at` timestamp. Resets when a prospect moves to a new stage
- **Auto-advance for all applicable stage types**: The `auto_advance` boolean option is now available on all applicable pipeline stage types, not just form submission and document upload
- **Automated email trigger reliability**: Fixed 4 separate issues preventing automated emails from sending when prospects advance to email stages: step_type mapping mismatch, auto-advance not triggering email, email config not loading, and missing email content validation
- **Pipeline step hover state fix**: Inactive step buttons had identical base and hover colors, providing no visual feedback. Fixed
- **Ballot email diagnostics**: Admin election page now shows reasons why present members didn't receive a ballot email (no email address, ineligible, already voted)

### March 14, 2026

- **Auto-advance for form submission and document upload stages**: New `auto_advance` config option in `FormStageConfig` and `DocumentStageConfig`. Checkbox in StageConfigModal. When enabled, prospects automatically advance when the form is submitted or documents are uploaded
- **Stage regression (move back)**: New `POST /regress` endpoint and "Move Back" action in the Applicant Detail Drawer. Moves prospect to previous stage, resets progress to `IN_PROGRESS`, logs as `prospect_regressed`
- **Automated email trigger on advance**: Advancing a prospect to an `automated_email` stage now automatically sends the configured email with subject, welcome message, FAQ link, next meeting details, custom sections, and status tracker
- **Email pipeline fixes**: Fixed email not sending on advance, Redis claim recovery, polling interval reduced to 60s, Redis key cleanup on shutdown

### March 13, 2026

- **SMTP provider compatibility**: Fixed sending for Gmail (STARTTLS/587), Office 365 (STARTTLS/587), and self-hosted SMTP servers (SSL/465, plain/25). New `EMAIL_USE_SSL` env var
- **SMTP credential decryption**: Encrypted SMTP passwords are now decrypted before connection
- **Email config from onboarding**: SMTP settings configured during onboarding are persisted to organization settings
- **IntegrityError fix**: Automated actions use `None` instead of `'system'` for `performed_by` FK
- **Custom section reliability**: Fixed custom section add/edit persistence in pipeline email configuration
- **Route ordering**: `GET /scheduled` moved before `GET /{template_id}` to prevent route conflicts
- **Scheduled email date/time fixes**: Removed UTC-based future checks; display times in user's local timezone
- **Message history cleanup**: Added cleanup, date filtering, and email validation to scheduled email pipeline
- **New stage types**: `form_dropdown` (links a Forms module form via dropdown) and `meeting` (schedule interview/orientation with auto-event linking and President Interview preset)

### March 6, 2026

- **Desired membership type field**: Added `desired_membership_type` column to `ProspectiveMember` model (nullable `String(50)`) to track whether an applicant wants to be a regular or administrative member. Options presented as "Regular Member" (starts as probationary) and "Administrative Member" — probationary is not offered as a direct choice since it is a transitional status
- **Form field auto-mapping**: Added label mappings (`membership type`, `desired membership type`, `type of membership`, `member type`) in `prospect_fields.py` so Membership Interest Forms auto-populate the field
- **Inline editing in detail drawer**: Added toggle buttons in the Applicant Detail Drawer between Contact Info and Application Data sections, allowing coordinators to change the desired membership type at any pipeline stage
- **Conversion pre-fill**: The Conversion Modal now pre-selects the membership type from the applicant's `desired_membership_type` instead of always defaulting to probationary
- **Pipeline table column**: The "Target Type" column in the sortable pipeline table displays the applicant's desired membership type

### March 4, 2026

- **Form-to-pipeline integration hardening (13 improvements)**: Label-based field mapping fallback, server-side validation, reprocessing fix, O(N) cleanup query optimization, field compatibility checks, step update lifecycle fix
- **Duplicate prospect detection**: Email-based duplicate detection with coordinator email notification
- **Pipeline form validation**: Pre-save field compatibility check warns about form field / pipeline mapping mismatches
- **Form deletion protection**: Forms linked to active pipelines protected from deletion
- **form.integration_type**: Direct label-mapping path for pipeline integrations
- **ProspectResponse metadata fix**: Changed from `alias="metadata"` to `serialization_alias="metadata"` — Pydantic now reads `metadata_` (JSON column) instead of `metadata` (SQLAlchemy MetaData object)
- **Modal click-through fix**: Modal backdrop no longer intercepts clicks on dialog buttons

---

**Document Version**: 1.6
**Last Updated**: 2026-05-29
**Maintainer**: Development Team

## August 12–14, 2026 data integrity update

Active prospect email uniqueness is enforced on the normalized email within an
organization and applies only to active rows. The upgrade reconciliation keeps
one canonical active record while allowing inactive historical duplicates; it
was intentionally moved out of a previously released migration. Stage progress
uses authenticated multi-approval signers, eagerly loaded interviews, and
skip/advance guards around gated and final stages. Deleted interviewers remain
available for historical display. Transfer/anonymization paths scrub applicant
PII without crossing organization boundaries. Operators must review the
reconciliation migration log around upgrade; see
[the Alembic route](./CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).
