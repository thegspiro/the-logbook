# Dynamic Security Testing Guide

**Updated:** 2026-08-22<br>
**Audience:** authorized security testers and operators preparing a staging assessment<br>
**Scope:** test planning for the FastAPI application and its supported integrations

This guide turns the application's trust boundaries into a repeatable dynamic
security testing plan. It is not a vulnerability report and does not claim that
the listed abuse cases are exploitable. Run testing only against an isolated,
authorized environment populated with synthetic data. Do not point destructive,
load, webhook-replay, or email tests at production.

For point-in-time source-review findings, see
[`RED_TEAM_REVIEW_2026-08.md`](./RED_TEAM_REVIEW_2026-08.md). For the rotating
tenant-isolation review, see [`../module-audit/PROGRESS.md`](../module-audit/PROGRESS.md).

## Trust boundaries

| Boundary                                        | Credential or control                                                       | Representative surface                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Anonymous client to public API                  | Rate limit, CAPTCHA, API key, display code, or URL token depending on route | Public forms, displays, calendar feeds, application status, finance approvals, legal text  |
| Browser to authenticated API                    | HttpOnly access/refresh cookies plus double-submit CSRF token               | `/api/v1/**`                                                                               |
| Non-browser API client                          | `Authorization: Bearer` token                                               | `/api/v1/**`; CSRF does not apply to header-only authentication                            |
| Member to privileged operation                  | Granular role permission plus record ownership or organization scope        | Users, roles, elections, finance, inventory, scheduling, training, compliance              |
| Organization administrator to platform operator | Organization scoping and platform-only permissions                          | Organization settings, security monitoring, IP policy, platform analytics, scheduled tasks |
| Application to persistence                      | SQLAlchemy session and organization-scoped queries                          | MySQL, Redis, upload volumes, audit archives                                               |
| Application to external service                 | Stored credentials, TLS, destination validation, provider authentication    | OAuth, SMTP, PayPal, Salesforce, Cal.com, Documenso, CAPTCHA, external training            |
| Public provider to application                  | HMAC/shared-secret/provider verification and replay cache                   | Inbound webhooks                                                                           |
| Scheduler to application data                   | Redis worker claim and task-specific idempotency                            | Email, retention, audit, notification, and workflow jobs                                   |

## Authentication, sessions, and CSRF

The normal browser session uses an HttpOnly `access_token` cookie, an HttpOnly
refresh cookie scoped to `/api/v1/auth/`, and a JavaScript-readable
`csrf_token` cookie. Auth cookies use `SameSite=Strict`; production and staging
cookies are `Secure`. State-changing authenticated API requests echo the CSRF
cookie in `X-CSRF-Token`. Header-only Bearer clients are not subject to the
cookie CSRF check.

Test at least:

- concurrent refreshes immediately before, within, and after the refresh grace window;
- access and refresh token replay after logout, password change, role change,
  account disablement, and MFA reset;
- duplicate or conflicting cookie and Authorization credentials;
- missing, blank, duplicated, mismatched, and oversized CSRF values on every
  state-changing verb;
- forced-password-change and required-MFA route restrictions using encoded,
  normalized, and trailing-slash path variants;
- OAuth state replay, parallel login tabs, account-linking collisions, tenant or
  hosted-domain restrictions, and redirect/Host manipulation;
- onboarding session fixation, CSRF replay, out-of-order steps, concurrent
  initial-owner creation, and access after setup completion; and
- WebSocket authentication and Origin enforcement independently of HTTP CORS.

## Authorization and tenant isolation

Declared route permissions are only one layer. Every object lookup must also
enforce organization scope, parent/child relationships, and self-versus-manage
rules. Build a test matrix with anonymous, member, limited officer, module
manager, organization administrator, and platform administrator identities in
**two different organizations**.

For every detail, export, update, action, and delete endpoint, substitute:

1. another member's object in the same organization;
2. an equivalent object in the second organization;
3. a child ID belonging to a different parent;
4. an archived, soft-deleted, or stale object; and
5. an object whose owner or state changes concurrently with the request.

Prioritize identity and role administration; organization/security settings;
medical and applicant records; documents; election ballots, votes, eligibility,
manual ballots, and rollback; finance approvals, dues, and payment events;
inventory issuance/write-off; scheduling finalization; compliance waivers; and
manual scheduled-task execution. Verify exports apply the same row-level rules
as list and detail endpoints. Attempt mass assignment of `organization_id`,
owner/creator IDs, role IDs, approval/payment state, security flags, and audit
fields even when the UI never sends them.

## Public and token-addressed endpoints

Public surfaces include forms, room displays and guest check-in, public portal
API-key routes, application-status links, calendar feeds, finance approval
links, public legal text, health/security metadata, and provider webhooks.
Possession of a calendar, status, approval, display, ballot, or similar token is
authentication for that resource.

Test token entropy, expiry boundaries, single-use behavior under concurrency,
rotation, revocation, and organization binding. Check for leakage through
browser history, `Referer`, redirects, access/error/audit logs, analytics,
email-link scanners, and shared caches. Unknown, expired, and unauthorized
tokens should not provide a useful enumeration oracle. Exercise public-form and
guest-check-in abuse with distributed clients, daily limits, CAPTCHA failure,
duplicate submissions, and downstream email/integration side effects.

## Files, imports, downloads, and exports

Relevant storage trees include general documents, event attachments,
prospective-member documents, training attachments, and email-template
attachments. Other upload surfaces include user photos, storefront images, and
CSV imports for training, inventory, and related modules. Downloads include
stored attachments plus CSV, PDF, ZIP, ballot, report, label, and ICS output.

Test:

- cross-organization and parent/child ID substitution on every download/delete;
- folder ACL enforcement on direct document URLs;
- traversal, absolute paths, double encoding, alternate separators, symlinks,
  and a path changed between validation and file access;
- MIME spoofing, polyglots, active SVG/HTML/PDF content, corrupt images, EXIF,
  decompression or pixel bombs, and archive bombs where applicable;
- concurrent near-limit uploads, failed-transaction orphan files, replacement,
  cleanup, storage exhaustion, and per-organization isolation;
- filename/header injection, MIME sniffing, range requests, and sensitive cache
  headers; and
- spreadsheet formula injection in every CSV import/export using cells beginning
  with `=`, `+`, `-`, or `@`.

## Database and business-logic integrity

The normal data path uses SQLAlchemy, so tenant-scoping and workflow races are
higher-priority targets than generic SQL injection. Nevertheless, fuzz all
search, sort, filter, report, and import fields, particularly any code path that
constructs SQL identifiers or accepts flexible expressions.

Replay and concurrently submit every state-changing operation. Focus on
approval/deny races, duplicate votes and payment events, inventory counts,
unique shift assignments, applicant conversion, publish/archive transitions,
and close/reopen/finalize workflows. Force downstream file, email, webhook, or
provider failures after a database change and verify transaction rollback,
idempotency, and audit accuracy.

## Outbound requests and SSRF

Outbound destinations include OAuth and CAPTCHA providers, SMTP/email APIs,
PayPal, Salesforce, Cal.com, Documenso, external-training providers, push
services, breached-password checks, and configurable audit shipping. Test every
administrator-configurable destination with loopback, RFC1918, link-local and
cloud-metadata addresses; IPv6 and IPv4-mapped forms; alternate numeric IP
notations; user-info; IDNs; multiple DNS answers; public-to-private DNS
rebinding; and redirects from a permitted host to a forbidden host.

Confirm TLS certificate verification, redirect credential handling, timeouts,
response-size limits, proxy-environment behavior, and revalidation immediately
before dispatch. Treat private-destination overrides, including audit shipping,
as explicit high-trust deployment decisions. SMTP connection-test endpoints
must receive the same SSRF attention as HTTP integrations.

## Webhooks and background jobs

Inbound Salesforce, PayPal, Documenso, and Cal.com deliveries are public entry
points. Test missing or malformed signatures, duplicate headers, wrong
integration IDs, cross-organization delivery, old valid signatures, unknown and
out-of-order events, concurrent identical deliveries, and retry after a partial
failure. Repeat a signed event immediately, after the replay-cache window, with
semantically equivalent but differently encoded JSON, and while Redis is
unavailable. Business operations must remain idempotent even if replay caching
cannot make a decision.

Run the application with multiple workers and deliberately interrupt Redis and
workers. Verify that scheduled email, retention, notification, inventory,
audit, and workflow jobs do not duplicate effects when worker claims fail or a
worker dies after an external side effect. Run manual and automatic instances
of the same task concurrently. Confirm every job scopes records by organization
and that poison records cannot permanently block a queue.

## Minimum staging test plan

1. Use synthetic data and two organizations with every privilege tier.
2. Record baseline requests from the supported UI, then replay them directly
   without relying on client-side controls.
3. Run the cross-tenant and nested-object substitution corpus first.
4. Exercise election, finance, session, public-token, upload/download, webhook,
   and SSRF cases before broad scanner coverage.
5. Run scanner discovery with production-like docs, CORS, proxy, TLS, Redis,
   database, storage, and worker settings.
6. Capture application, reverse-proxy, audit, provider, database, and Redis logs
   while testing; verify sensitive tokens and secrets are redacted.
7. Reset all synthetic credentials, API keys, calendar/display links, webhook
   secrets, and provider tokens after the assessment.

Document the tested commit, deployment configuration, identities, organization
relationships, seed data, tool versions, timestamps, and whether Redis or any
external provider was unavailable. A clean scanner report does not replace the
authorization and workflow tests above.
