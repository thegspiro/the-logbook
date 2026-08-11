# Communications Module

The Communications module covers how the department reaches its members:
**Department Messages** (internal announcements with read/acknowledgment
tracking and multi-channel delivery), **Email Templates**, and the outbound
**Message History** log. This page focuses on Department Messages; notification
_rules_ and the member notification inbox are covered under
[Events](Module-Events) and the Notifications page.

## Key Features

- **Department Messages** — leadership announcements targeted to everyone, to
  specific roles, to member statuses, or to hand-picked members.
- **Priority-based escalation** — every targeted member gets an in-app
  notification (bell inbox, dashboard card, Messages page); **important /
  acknowledgment-required** messages are also emailed; **urgent** messages add
  SMS (when Twilio is configured and the member has a mobile number).
- **Required acknowledgment** — messages that members must confirm they've read.
  They stay "pending" until acknowledged, and officers get a per-recipient
  report of who has and has not acknowledged (with an audience denominator).
- **Scheduled send** — schedule a message to publish (and escalate) at a future
  time; it stays hidden until then.
- **Persistent messages** — stay visible until an admin clears them.
- **Editing & soft delete** — edit a message in place; deleting hides it from
  members but preserves read/acknowledgment records as compliance evidence.
- **Rename-safe role targeting** — role-targeted messages follow the role's
  identity, so renaming a role never silently stops delivery.
- **Member controls** — members opt out of email or urgent-SMS escalation under
  Settings → Notifications; the in-app notification is always delivered.

## Pages

| Page                        | Route                                         | Audience    | Permission                                                                                  |
| --------------------------- | --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Messages (inbox)            | `/messages`                                   | All members | Authenticated                                                                               |
| Department Messages (admin) | `/communications/messages`                    | Officers    | `notifications.manage`                                                                      |
| Email Templates             | `/communications/email-templates`             | Admins      | `settings.manage`                                                                           |
| ↳ **Footers** tab           | `/communications/email-templates?tab=footers` | Admins      | `settings.manage` **or** `organization.update_settings` _(2026-08-10; linkable 2026-08-11)_ |

Members also see recent messages on the **dashboard** "Department Messages" card
and in the notification **bell**.

## API Endpoints

```
# Admin (notifications.manage)
GET    /api/v1/messages                         # List (include_inactive, search, priority, pagination)
POST   /api/v1/messages                         # Create (optional scheduled_at defers publish)
GET    /api/v1/messages/roles                   # Roles available for targeting (id, name, slug)
GET    /api/v1/messages/{id}                     # Get one
PATCH  /api/v1/messages/{id}                     # Edit / reschedule
DELETE /api/v1/messages/{id}                     # Soft-delete (read/ack records preserved)
GET    /api/v1/messages/{id}/stats               # Read/ack counts + audience denominator
GET    /api/v1/messages/{id}/acknowledgments     # Per-recipient read/ack breakdown

# Member (authenticated)
GET    /api/v1/messages/inbox                    # Messages targeted to me
GET    /api/v1/messages/inbox/unread-count        # My unread/pending count
POST   /api/v1/messages/{id}/read                # Mark read
POST   /api/v1/messages/{id}/acknowledge         # Acknowledge (ack-required messages)
```

## Delivery matrix

| Priority / flag         | In-app | Email | SMS |
| ----------------------- | :----: | :---: | :-: |
| Normal / Important      |   ✅   |   —   |  —  |
| Requires acknowledgment |   ✅   |  ✅   |  —  |
| Urgent                  |   ✅   |  ✅   | ✅  |

Escalation runs as a background task (posting stays instant) and is
**rate-limited per organization** on the email/SMS channels so a runaway or
compromised account can't blast the whole department; the limiter fails open so
real urgent alerts still go out if the limiter is unavailable.

## Scheduled publishing

A message with a future `scheduled_at` is created hidden and published by the
`publish_scheduled_messages` scheduled task (runs every ~15 minutes), which marks
it live and escalates it. An already-published message cannot be moved back to a
future time (that would re-send it); pending messages remain reschedulable.

## Recent Changes (2026-07-17)

### Features

- Cross-channel escalation (in-app + email + SMS) by priority.
- Required-acknowledgment enforcement + per-recipient acknowledgment report.
- Scheduled send; in-place editing; soft delete preserving ack evidence.
- Rename-safe role-id targeting (existing messages backfilled).
- Admin search / priority filter / pagination; clickable links in bodies.
- Member `sms_notifications` preference for urgent-message SMS.

### Data Model Changes

`department_messages` gained `deleted_at` (soft delete), `scheduled_at`
(deferred publish), and an `idx_dept_msg_scheduled_at` index; role targeting now
stores role **ids** rather than names. `department_message_reads` continues to
track per-user `read_at` / `acknowledged_at` and is retained on soft delete.

### Safety

- Message content is escaped on every surface (web, email subject/body); SMS is
  plain capped text — no injection path via a malicious message.
- The delivery path is fully failure-isolated: one bad message can't halt the
  scheduled-publish batch.

See the member/officer how-to in the
[Documents, Forms & Communications training guide](../docs/training/07-documents-forms.md#department-messages).

## Email Templates (2026-08-07)

### Catalogue Categories

The template catalogue had grown past three dozen entries rendered as a single
flat scroll. Templates are now grouped into collapsible categories with
per-category counts: **Members & Accounts, Events & Scheduling, Training,
Elections, Inventory, Department Store, Other**.

Two behaviours that keep the grouping from getting in the way:

- An active **search expands every group**, so a hit is never hidden behind a
  collapsed header.
- The category holding the **selected** template is force-expanded, so the
  selection cannot scroll out of view.

### Officer Signature Variables

A notice sent by a member-services clerk, or by a nightly scheduled task, had no
way to be signed by the officer whose name belongs on it.

A **department office directory** now backs every template. Each catalogued
office — President, Vice President, Chief, Deputy Chief, Assistant Chief,
Secretary, Assistant Secretary, Treasurer, Safety Officer, Training Officer,
Quartermaster — exposes `{{<office>_name}}`, `{{<office>_title}}`,
`{{<office>_email}}` and `{{<office>_phone}}`.

**Resolution order** for a holder: an admin override on the office → the member
the office is linked to (so the values track that member's profile) →
auto-detection from members carrying the matching position slug. The last of
these means a department that never opens the Officers tab still signs its
notices correctly.

**Caching.** The resolved values are flattened into
`Organization.settings["officer_directory"]`, which the _synchronous_
`EmailTemplateService.render()` reads from the organization it already receives —
avoiding an async lookup threaded through all ten render call sites. Only
catalogued variable names are injected, so a hand-edited settings blob cannot
introduce arbitrary template variables. The cache is rebuilt on every office
write, when the Officers tab loads, and nightly by `officer_directory_sync` — the
last of which catches a change made to the _member behind_ an office rather than
to the assignment.

See [DEPARTMENT_OFFICERS.md](../docs/DEPARTMENT_OFFICERS.md) for the full catalogue
and API.

## Email Footer Library (2026-08-10)

The footer was copy-pasted into all 35 default bodies: 32 copies of "This is an
automated message from …" and 25 of the contact line. Changing the wording meant
opening 35 templates one at a time — and once a template had been edited by hand,
the only way back was **Reset**, which discards the rest of that template's edits
too.

It is now a **named library on the organization**, with each template naming the
footer it closes with. Named rather than singular because a department does not
want to say the same thing to everybody:

| Seeded footer       | Audience                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Internal**        | Members. The routine "do not reply" close. The default                                                                                                                                                                                                                              |
| **Public**          | Outside the department. Invites a reply and carries the mailing address. Event requesters and applicants get this one — telling somebody who asked the station to visit their school not to reply was wrong, and a physical address is what mail to the public is expected to carry |
| **Official notice** | On the record: separations, property return, election results                                                                                                                                                                                                                       |

Departments can rename, reword, add and delete these; a footer names its own
lines and toggles the contact and address blocks.

### How it renders

Mechanically the footer is two more variables, `{{footer_html}}` and
`{{footer_text}}`, that `build_context` injects like the organization ones — so
**every** render path picks it up, including the code defaults behind a template
row and the one-off bodies `wrap_email_body` builds for scheduled tasks.

It is resolved **a step before** the template body, because rendering is a single
substitution pass: a `{{organization_name}}` sitting inside an already-substituted
`{{footer_html}}` would mail as those literal braces.

### Storage and API

- `email_templates.footer_key VARCHAR(32) NULL` — which footer this template
  closes with. **NULL means "the one marked default"**, so a department that
  changes its default reaches every template that has not overridden it, without
  a data migration.
- The library itself lives in `Organization.settings`, like the officer directory
  and for the same reason: rendering is synchronous and already receives the
  organization, so it needs no extra query on any send path.

> **All five tabs on this page are addressable** as of 2026-08-11:
> `?tab=templates`, `?tab=footers`, `?tab=officers`, `?tab=scheduled`,
> `?tab=history`. They were plain component state, so the footer library — the
> tab a colleague is most likely to be pointed at — could not be linked, and the
> screenshot harness could only ever capture the default. Same fix as the
> Notifications page took on 2026-08-10, and for the same two reasons.

```
GET    /api/v1/email-templates/footers        # The library, seeded on first read,
                                              #   with a live per-footer usage count
PUT    /api/v1/email-templates/footers        # Replace the library (whole, not per-footer)
```

### Edge cases

| Scenario                                        | Behavior                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A template names a footer that has been deleted | Resolves to the **default**, not to nothing. Deleting a footer should cost the templates naming it their _choice_, not their footer. The screen says how many templates use each one before you delete it |
| `Organization.settings` is malformed            | Falls back to the seeded library rather than raising. **Mail has to keep going out**                                                                                                                      |
| An admin types HTML into a footer line          | Footer text is escaped before its variables are substituted, and the substituted values are escaped too                                                                                                   |
| A per-footer save                               | Not offered. The library saves **whole**, because a partial save could leave `default_key` naming a footer the same request deleted                                                                       |

## Organization Variables (2026-08-10)

Seven fields a department fills in on Organization Settings could not be put in
an email or a footer. All are now `{{organization_*}}` variables available to
every template and to footer lines:

| Variable                                                            | Why                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization_tax_id`                                               | A 501(c)(3) asking for money is expected to state its EIN on the message that asks                                                                                                       |
| `organization_identifier` / `organization_identifier_label`         | Whichever of FDID / state ID / department ID the department nominated, **with the name of the scheme**, so an official notice can read "FDID 12345" and be right about which one that is |
| `organization_founded_year`, `organization_county`                  | The "Serving X County since 1923" line departments write by hand today                                                                                                                   |
| `organization_fax`, `organization_description`, `organization_type` | Completeness                                                                                                                                                                             |

Which columns reach templates is a **two-map ledger** —
`ORGANIZATION_FIELD_VARIABLES` for the ones offered and
`ORGANIZATION_FIELDS_WITHOUT_VARIABLES` for the ones deliberately withheld, with
the reason. A column in neither is one nobody ruled on, and the catalogue test
names it. That is what keeps the gap from silently regrowing the next time a
column is added.

The address composer now appends the **country**, except when it is the `"USA"`
the column defaults to — printing it unconditionally would put a line of noise
under every US department's own address.

## Email Design & Rendering (2026-08-10)

- **One stylesheet, one document shell, one table style.**
  `app/services/email_theme.py` is shared by the template service, the storefront
  and the election report, replacing three copies with drifting hex codes. The
  design is a white card on a grey page — system font stack, rounded header band,
  consistent paragraph rhythm, light table headers.
- **Untouched templates track the built-in stylesheet.** `create_template` used
  to copy `DEFAULT_CSS` into every row, freezing an organization's templates on
  whatever shipped the day they signed up. The service stores NULL and falls back
  at render time; migration `20260810_0003` clears the rows still holding a
  verbatim copy of a shipped default and leaves edited ones alone.
- **The preview endpoint runs the CSS inliner**, so what an admin approves is
  what ships.
- **Three notices gained template rows.** `shift_assignment`, `shift_decline` and
  `shift_reminder` were listed by the enum and the screen but composed in code —
  **the mail departments send most often was the mail they could not reword.**

### Fixed (2026-08-10)

- **The CSS inliner styled the first paragraph of every email and nothing after
  it.** `".parent child"` rules stopped at the first closing tag inside the
  parent. Gmail strips `<style>`, so that was the spacing most recipients
  actually saw. It now scopes by element depth, and declarations are normalised
  so a quoted font name cannot close the style attribute it lands in.
- **`items_removed_html` and `recipients_html` were missing from
  `_RAW_HTML_VARIABLES`**, so those lists were escaped and mailed as visible
  angle brackets.
- **The code-default fallback never filled in the organization variables** — and
  that path is the normal one until somebody opens the Email Templates screen,
  which is the only thing that creates the rows. Those departments were receiving
  footers reading a literal `{{organization_phone}}`.
- **The event-request status notice labelled Scheduled Date, Reason and Message
  unconditionally**, so a member of the public was getting bare "Reason:" lines.
- **The event-request fallback fed values to `re.sub` as replacement strings**, so
  a backslash in a public contact name was read as a group reference. Routing it
  through `_render_with_fallback` also gets these sends into Message History for
  the first time.
- **Three header colours failed WCAG AA against their white text** (`#f59e0b`
  2.2:1, `#d97706` 3.2:1, `#059669` 3.8:1), as did the 11px `#9ca3af` contact
  line in every footer.
- **"Send Test Email to Me" posted a blank recipient.** SMTP rejected it, the
  endpoint returned 200, and the UI reported success for an email nobody
  received.
- The duplicate-application notice printed its contact line twice.

### Fixed

- `inventory_notification_service` passed **no organization** to `render()`, so
  every `{{organization_*}}` variable was silently dropped from inventory change
  emails.
