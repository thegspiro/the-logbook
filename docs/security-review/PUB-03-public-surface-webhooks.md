# Security Review — Public Surface & Webhooks

**Prefix:** `PUB` · **Iteration:** 03 · **Reviewed:** 2026-08-25 · **PR:** #1806

**Backend:** all 12 files under `app/api/public/` (2317 L total) —
`portal.py`, `core/public_portal_security.py`, `calendar.py`, `display.py`,
`integrations_webhook.py`, `forms.py`, `paypal_webhook.py`,
`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py`
**Frontend:** none touched
**Migrations:** none touched (finding on `ApprovalChain`/`ApprovalChainStep`/
`ApprovalStepRecord` is informational, not a fix)

---

## Scope

Every route here is intentionally unauthenticated — that is what makes it
"public." Six of the twelve files already carry thorough prior coverage
(`docs/module-audit/public-portal.md` + `docs/app-review/public-portal.md`,
4 passes through 2026-08-09, for `portal.py`/`public_portal_security.py`/
`calendar.py`/`display.py`; `docs/module-audit/integrations.md` +
`docs/app-review/integrations.md` for `integrations_webhook.py`;
`docs/module-audit/forms.md` + `docs/app-review/forms.md` for `forms.py`;
`docs/module-audit/storefront.md` for `paypal_webhook.py`). Those were
spot-checked rather than re-derived — full write-up below.

**`display.py` was re-read in full**, not spot-checked: it grew from 119 to
401 lines since the last audit (the entire guest QR check-in feature was
added). **Five files carry no prior audit at all** and were read in full
against all seven checklist dimensions: `finance_approvals.py`, `legal.py`,
`responses.py`, `salesforce_webhook.py`, `security_txt.py`.

Since dimension 1 ("every route carries an auth dependency") is trivially
"no" for every route in this feature by design, it was reframed per-route as:
what is the **compensating control** (rate limit, signed/high-entropy token,
webhook signature, API key, or "truly public, nothing to protect")?

## Route inventory — newly-reviewed files

| File                    | Route                                             | Compensating control                                                   | Org-scoped                           | Notes                             |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| `finance_approvals.py`  | `GET /approvals/{token}`                          | 256-bit token, 30/min/IP                                               | via token→record                     | step name/status only, no amount  |
| `finance_approvals.py`  | `POST /approvals/{token}/approve`                 | same + `.with_for_update()` locking read                               | via token→record                     | only `notes` client-writable      |
| `finance_approvals.py`  | `POST /approvals/{token}/deny`                    | same                                                                   | via token→record                     | same                              |
| `salesforce_webhook.py` | `POST /webhooks/salesforce/{integration_id}`      | HMAC-SHA256, fail-closed if unconfigured, 30/min+lockout, replay guard | via `integration.organization_id`    | see PUB-1                         |
| `legal.py`              | `GET /legal`                                      | 30/min/IP; single-tenant-only guard                                    | n/a (anonymous)                      | see PUB-2 (doc only)              |
| `responses.py`          | n/a — shared OpenAPI response shapes, no route    | n/a                                                                    | n/a                                  | no runtime effect                 |
| `security_txt.py`       | `GET /.well-known/security.txt`                   | none needed — server config only, no request input consumed            | n/a                                  | RFC 9116                          |
| `display.py`            | `GET /display/{code}`                             | 60/min/IP, ASCII code regex                                            | via `location.organization_id`       | unchanged from prior audit        |
| `display.py`            | `GET /display/{code}/events/{id}/guest`           | same                                                                   | via location org **and** location id | new                               |
| `display.py`            | `POST /display/{code}/events/{id}/guest-check-in` | 10/min+lockout, honeypot, per-event daily cap                          | same                                 | new — full guest check-in feature |

## Verified good ✅

- **`finance_approvals.py` token scheme is solid.** 256 bits of entropy
  (`secrets.token_urlsafe(32)`), 7-day TTL, single-use (token cleared to
  `None` on use), status re-validated to `PENDING` before any write, and the
  mutating fetch uses `.with_for_update()` (`finance_service.py:718,753`) —
  correctly following Pitfall #27 (capacity/state check as a locking read),
  closing the double-approve race a plain re-check would miss.
- **`salesforce_webhook.py` matches the audited `integrations_webhook.py`
  pattern exactly.** HMAC-SHA256 via `hmac.compare_digest`
  (`salesforce_webhook.py:94-95` pre-fix numbering), fails closed with 401 if
  no `webhook_secret` is configured, rate-limited (30/min + 5-min lockout)
  before any DB/HMAC work, replay-protected via the same `is_duplicate_webhook`
  helper. Org resolution never trusts the payload: the integration row's own
  `organization_id` is the only source, and inbound sync's `rank` exclusion
  (verified against CHANGELOG 2026-08-11/12) still holds — a forged/leaked
  webhook secret cannot promote a member's rank.
- **`display.py`'s new guest check-in feature is tenant-safe and
  abuse-resistant.** Org+location resolution is display-code-first by
  explicit design (a leaked code for Room A can't be combined with an
  `event_id` from Room B); every failure path (unknown code, wrong room,
  feature disabled) answers an identical 404, so the endpoint can't be used
  to enumerate which rooms/events exist. Honeypot + a per-event/day cap sit
  alongside the per-IP rate limit specifically because a distributed flood
  defeats per-IP limiting alone and each sign-in has a real side effect
  (a pipeline record). `GuestCheckInResponse` correctly omits
  `prospect_created` (verified against the CHANGELOG 2026-08-11 fix closing
  a prospect-existence enumeration channel) — the field is still computed
  for the audit log only.
- **No injection surface, no unbounded cache, no TODO/FIXME** across any of
  the 12 files.
- **Spot-checks all held** — `portal.py`'s org-scoping, `public_portal_security.py`'s
  selective-prefix + rate-limit-before-bcrypt ordering + bounded caches,
  `calendar.py`'s CSPRNG token + full ICS escaping, `integrations_webhook.py`'s
  signature/replay/org-scoping, `forms.py`'s slug validation + CAPTCHA/honeypot,
  and `paypal_webhook.py`'s signature/replay/audit-logging are all present and
  unchanged in mechanism at their current (drifted) line numbers.

## Findings

### PUB-1 — LOW — Salesforce inbound webhook had no cap on payload record count — ✅ FIXED

**What:** `records = payload.get("records", [])` had no length limit before
each record triggered 1-2 DB queries via `sync_service.sync_inbound_contacts`.

**Where:** `app/api/public/salesforce_webhook.py:143` (pre-fix).

**Failure scenario:** the endpoint is rate-limited per-request (30/min), not
per-record. A party in possession of a valid (or compromised/leaked)
`webhook_secret` could send one oversized, validly-signed request to run an
effectively unbounded number of DB round-trips within that same 30/min
budget. This requires the secret already — not reachable by an
unauthenticated attacker — but every other public write in this feature
(guest check-in's daily cap, the API-key rate limiter's bucket caps) has an
explicit ceiling, and this one didn't.

**Fix:** added `MAX_RECORDS_PER_WEBHOOK = 500`; a request exceeding it gets a
422 before any sync work runs, following the same shape as the existing
`MAX_PHOTOS_PER_ITEM` cap pattern in `equipment_check.py`.

**Fix, round 2 (caught by Codex review on the PR, before merge):** the first
version of this fix placed the new cap check _after_ the existing
`is_duplicate_webhook` replay guard. That guard marks a delivery "seen" via
an atomic `SET NX` the moment it's called — so an over-cap request still got
fingerprinted even though it was then rejected with 422. A provider's
identical retry of that same oversized payload would hit the duplicate
branch and get **200**, which stops the provider from retrying — silently
dropping the batch forever instead of ever being retried at a size the cap
allows. Fixed by moving all payload-shape validation (JSON parse, `sobject`/
`records` presence, the record-count cap) **before** the replay check, so
only a request that's actually going to be processed — or already
duplicate-rejected on its own separate merits — gets fingerprinted.

**Guard tests:** `tests/test_salesforce_webhook.py` —
`test_rejects_payload_over_the_cap` (501 records → 422, matches the cap
number), `test_at_the_cap_passes_the_check` (exactly 500 records reaches the
sync path, proving the boundary is inclusive rather than off-by-one), and
`test_over_cap_payload_is_not_fingerprinted_as_seen` (asserts
`is_duplicate_webhook` is never awaited when the cap rejects a request —
fails if the ordering regresses).

### PUB-2 — NIT — `legal.py`'s single-org guard was correct but unexplained — ✅ FIXED (comment only)

`len(orgs) == 1` (`legal.py:75`) is the only thing preventing a multi-tenant
deployment from leaking an arbitrary organization's legal text to every
anonymous caller (this endpoint has no org context at all — no API key, no
subdomain routing). The code was already correct; added a comment naming the
invariant so a future "simplify this to `.first()`" edit doesn't reintroduce
the leak.

### PUB-4 — MED — Finance token-based approval had no self-approval guard, despite the documented invariant — ✅ FIXED

**What:** `approve_by_token`/`deny_by_token` never called
`assert_different_person()` the way the authenticated `approve_step` does.
The initial pass through this file recorded that as **verified safe**,
reasoning that the token path's approver has no Logbook account/id to
compare against a requester id. **A Codex review comment on the PR correctly
identified this reasoning as incomplete**, and it was wrong to close as a
non-finding: for an `approver_type == EMAIL` step, the approver's identity
_is_ knowable — it's the literal email address on `step.approver_value`.

**Where:** `app/services/finance_service.py:711` (pre-fix).

**Failure scenario:** if a chain step's `approver_value` is configured to
the same email address as the person who submits the request it's meant to
gate (plausible in a small department — e.g. a Treasurer step where the
Treasurer is also the usual requester, or simple misconfiguration), that
person receives the approval-request email themselves and can click through
and approve their own purchase/expense/check request with **zero** guard —
directly contradicting `docs/FINANCE_MODULE.md:181`'s documented invariant
("`allow_self_approval`: By default false — prevents the requester from also
being the approver at any step"). `allow_self_approval` exists specifically
to gate this and defaults to `False`, but nothing read it on this path.

**Fix:** `approve_by_token` now eager-loads `record.step` and, when
`step.approver_type == ApproverType.EMAIL` and `not step.allow_self_approval`,
resolves the requester's email (new `_entity_creator_email` helper, mirroring
the existing `_entity_creator_id`) and compares it case-insensitively against
`step.approver_value`. A match raises `SeparationOfDutiesError` (a
`ValueError` subclass — the endpoint's existing `except ValueError → 400`
mapping picks it up unchanged, no endpoint-layer change needed). Steps using
`POSITION`/`PERMISSION`/`SPECIFIC_USER` approver types are untouched by this
check (no email to compare — the original "no Logbook identity to compare
against" reasoning does hold for those three, just not for `EMAIL`).
`deny_by_token` is deliberately left unguarded, matching the existing
`approve_step`/`deny_step` asymmetry: withdrawing your own request is not a
separation-of-duties conflict, only approving it is.

**Guard tests:** `tests/test_finance_approval_tokens.py` —
`TestApproveByTokenSelfApprovalGuard` covers: rejects when the approver email
matches the requester (case-insensitively), allows when the step explicitly
sets `allow_self_approval=True`, allows when the emails differ, and allows
all three non-`EMAIL` approver types unconditionally.

### PUB-3 — INFO — `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord` have no Alembic migration — not a defect, flagging for the record

No migration creates these three tables — they exist only via the
`create_all` + `_add_missing_model_columns` startup path (Pitfall #26
territory, consistent with the ~39 other tables already documented as
`create_all`-only). The schema itself is correct (`SET NULL` FKs are
`nullable=True`, `models/finance.py:365,433,483,486`). Not fixed because
nothing is wrong to fix — recorded so it's an explicit "yes, intentional"
rather than a silent gap the next reviewer has to rediscover.

## Schema & migration notes

No drift found. `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord`
`SET NULL` FKs are correctly `nullable=True` (see PUB-3). No other model
behind these 12 files was touched this iteration.

## Guard tests added

- `test_rejects_payload_over_the_cap` / `test_at_the_cap_passes_the_check` /
  `test_over_cap_payload_is_not_fingerprinted_as_seen`
  (`tests/test_salesforce_webhook.py`) — fail if the record-count cap
  regresses, its boundary becomes off-by-one, or the replay-fingerprint
  ordering regresses.
- `TestApproveByTokenSelfApprovalGuard` (5 tests,
  `tests/test_finance_approval_tokens.py`) — fail if the token-approval
  self-approval guard regresses, stops respecting `allow_self_approval`, or
  starts blocking non-`EMAIL` approver types it shouldn't.

## Completion gate

| Check                                                                   | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged                                                        |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                            |
| `validate_migrations.py --strict`                                       | ✅ single head                                                      |
| backend tests (scoped: finance/legal/public/webhook/salesforce/display) | ✅ 256 passed, 1 skipped (environment-only: py_vapid not installed) |
| `tsc --noEmit`                                                          | ✅ 0 errors (no frontend files touched)                             |
| `eslint .`                                                              | n/a — no frontend files touched                                     |
