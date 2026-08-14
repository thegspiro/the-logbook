# August 12–14, 2026 workflow updates

This lesson is the operator-facing companion to the
[technical change audit](../CHANGE_AUDIT_2026-08-12_TO_14.md). It explains what
members and administrators now do differently. Permission names are included
because a control that is absent is usually a permission or module-state issue,
not a rendering failure.

## Elections: reuse a ballot without reusing election data

An election manager can open Ballot Builder, choose **Your saved ballots**, save
the current ballot structure under an organization-unique name, or apply/delete
a saved template. The template includes ballot configuration and election
settings, but never candidates, voters, tokens, votes, attendance, or results.
Applying one creates fresh ballot-item IDs.

**Edge cases:** names compare case-insensitively; replacing and deleting require
confirmation; invalid/duplicate item IDs and voting methods are rejected;
`all` cannot be mixed with another voter type; supermajority needs a percentage;
count quorum can exceed 100 but percentage quorum cannot. Manual paper ballots
must be entered as an attested count and cannot exceed the eligible roster.

> **[SCREENSHOT NEEDED — Ballot Builder → Your saved ballots, showing the visible template name, item count, replacement warning, and action buttons; seed one organization-owned template and no candidate/vote data. Follow with a before/apply/after election-settings capture because preserved settings are applied silently and are not summarized in the picker.]**
>
> **[SCREENSHOT NEEDED — closed election results showing manual paper-ballot count and its roster-bound validation.]**

## Dashboard and admin hours

The dashboard is now a station board. Department Messages shows pending items
and persistent notices rather than an arbitrary recent-history slice. Admin
hours separates calendar-year reporting from rolling periods and displays each
configured category against its own requirement.

**Edge cases:** conditional cards appear only when their module/data applies;
reading a message does not remove it mid-read, but it clears on the next load;
persistent notices remain; calendar year is not “last 365 days.” Mobile cards
and breadcrumb/action targets must remain at least 44px.

> **[SCREENSHOT NEEDED — populated station board with one pending message, one persistent notice, and conditional cards identified in the caption.]**
>
> **[SCREENSHOT NEEDED — Admin Hours Summary on Calendar Year with at least two configured categories and visibly different thresholds.]**

## Storefront

Store administrators now see activity/status counts and can filter the order
list by the corresponding states. Organization settings can hide the store-open
banner. A member can change the external payment method on their own order; the
application records the method/status but does not process the payment.

**Edge cases:** members cannot edit another member's order; payment and
fulfillment remain separate; variant/product locks are canonicalized; notice and
email results do not reveal other recipients; counts and filters are scoped to
the active organization.

> **[SCREENSHOT NEEDED — Store Admin with activity/status cards and a matching filtered order list; seed orders in at least three states.]**
>
> **[SCREENSHOT NEEDED — member order payment-method editor plus the explanatory text that reporting payment is not payment processing.]**

## Room and apparatus QR codes

Authorized administrators can use the Room QR Codes directory to search,
download PNG codes, and print room signs. Facility-room codes and apparatus
shift check-in codes are available from their inline entry points. Regenerating
a location display code immediately invalidates the old code.

**Edge cases:** the bulk directory is restricted; a QR target is organization
bound; a stale printed sign stops working after rotation; sensitive facility
fields require `facilities.view_sensitive`, while editing still requires
`facilities.edit` or `facilities.manage`.

> **[SCREENSHOT NEEDED — Room QR directory search results with Download PNG and Print controls, using non-sensitive demo rooms.]**
>
> **[SCREENSHOT NEEDED — regenerate-code confirmation explicitly warning that the previously printed code becomes invalid.]**

## Apparatus crew seats and scheduling settings

Crew positions now select configured ranks instead of relying on free text.
Shift settings persist per organization and calendar navigation retains its
context. Members retain the completion/report flows they are authorized to use
when equipment-check template administration is restricted.

**Edge cases:** legacy position names remain readable; an incompatible rank
cannot be saved; switching organizations must not reuse the prior organization's
rank or settings cache; finalization resolves apparatus labels in batches.

> **[SCREENSHOT NEEDED — apparatus form crew-position rank picker, including one legacy read-only position in the demo data.]**

## Events and outreach forms

The Event Settings outreach picker discovers only related public-outreach forms
and only for event administrators. Mandatory-event eligibility uses the
organization's configured membership tiers. Early-ended events can be finalized;
reports count reviewed attendance.

**Edge cases:** ordinary form viewers do not receive the administrative catalog;
forms and events from another organization never appear; deleted interviewers
remain as historical names rather than breaking an applicant record.

> **[SCREENSHOT NEEDED — Event Settings outreach-form picker under an event-admin account, with a non-outreach form intentionally absent.]**

## Training sessions, programs, and skills tests

A training-session editor can link the session to a requirement, course, and
program. Approved participation then feeds the owned program requirement.
Program pages have an Admin breadcrumb for managers. A failed skill step may
deduct configured points without forcing the entire test to fail; resume count,
result visibility, and official-test policy remain server enforced.

**Edge cases:** cross-organization and mismatched-program links fail; deleting a
program does not delete a requirement it does not own; undated training cannot
satisfy recency; members cannot read officer-only checklist/sign-off state; a
resume conflict is scoped to the current test and is not blindly retried.

> **[SCREENSHOT NEEDED — training-session edit flow with requirement, course, and program linkage populated from one organization.]**
>
> **[SCREENSHOT NEEDED — skill result illustrating point deduction without automatic whole-test failure; caption the configured pass rule.]**

## Notifications and integrations

Completing related event or scheduling actions archives the matching
notification in the database. It does not archive unrelated notifications.
Salesforce readiness/preview/sync now retains pagination and retries transient
failures while keeping the encrypted client secret out of responses and logs.
Webhook diagnostics redact credentials and unsafe payload fields.

**Edge cases:** relation matching includes organization and action/entity IDs;
Salesforce rejects missing/unsafe configuration; retry is for transient errors,
not invalid credentials; every targeted department message still receives
best-effort email, and Urgent adds SMS only when its consent/configuration gates
pass.

> **[SCREENSHOT NEEDED — same notification before and after completing its related action, with an unrelated notification still present.]**
>
> **[SCREENSHOT NEEDED — Salesforce readiness/preview result with secrets and tokens visibly absent.]**

## Upgrade notes for administrators

Back up the database and encryption keys separately, require a single result
from `alembic heads`, and run `alembic upgrade head`. Production transport TLS
is fail-closed unless the operator explicitly acknowledges a plaintext
configuration. The active-prospect reconciliation may consolidate duplicate
active emails within an organization; review migration logs before and after.
Before upgrading, run the active-prospect duplicate query in the
[technical audit](../CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).
A non-empty result is a hard stop: review linked applications, keep the earliest
record, mark the remaining duplicate active rows inactive, and re-run the query.
The unique index otherwise fails before the later reconciliation can run. Never
downgrade merely to repair a migration fork.
