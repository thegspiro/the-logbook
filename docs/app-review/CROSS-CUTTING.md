# Application Review — Cross-Cutting Findings

Patterns that recur across features, aggregated so one sweep can close the whole
class. Numbered `AXC-n` to keep them distinct from the module audit's
[XC-1/2/3](../module-audit/CROSS-CUTTING.md), which remain open and in force.

---

## AXC-1 — `request.client.host` used instead of `get_client_ip(request)` — ✅ CLOSED (2026-08-05)

**Found in:** A2 (auth & session lifecycle), where 6 instances were fixed.
**Swept: the remaining 33 instances across 7 files**, on the owner's call to run
a dedicated pass rather than wait for each file's own iteration.

> The original write-up said "28 sites"; the true count was **33** (5 + 10 + 8 +
> 5 + 2 + 1 + 2). The undercount came from subtracting the `core/audit.py`
> docstring instance twice.

**Verification:** all 7 modules import cleanly, `flake8` and `black` clean, and
the affected test selection returns **151 passed / 145 fixture-errors both
before and after** the sweep (the errors are the sandbox's missing MySQL, and
the identical counts confirm the change is behavior-neutral to the suite).

### Why it matters

The production profile runs behind nginx. `docker-compose.prod.yml` sets
`TRUSTED_PROXY_IPS` to the RFC1918 ranges, so `get_client_ip()` correctly
resolves the real client from the right-most non-proxy `X-Forwarded-For` hop —
but `request.client.host` returns **the proxy's address**. Every record written
with the raw value therefore stores one identical internal IP for all users.

This is not a disclosure bug; it is a *silent-loss-of-signal* bug, which is
worse in the places it appears: the data looks present and is trusted by
features built on top of it.

### Site inventory, by consequence

| File | Sites | Feature / iteration | Consequence |
|---|---|---|---|
| `api/v1/endpoints/elections.py` | 5 ✅ | B5 elections | **HIGH — breaks a documented feature.** Per-vote IPs feed ballot fraud detection. `BALLOT_FORENSICS_GUIDE.md` documents `suspicious_ips` ("any IP that cast more than 5 votes") and `unique_ip_count`. Behind the proxy every ballot carries the same IP, so `unique_ip_count` collapses to 1 and **every election trips the suspicious-IP threshold** — the anomaly detection is not merely degraded, it is inverted into a permanent false positive. |
| `api/v1/endpoints/ip_security.py` | 10 ✅ | B23 security/audit/IP | **MED — the module is *about* IPs.** Requester/admin IPs on exception requests and approvals all record the proxy, so the audit of who requested and approved an IP allowlist entry carries no attribution. |
| `api/v1/endpoints/security_monitoring.py` | 8 ✅ | B23 security/audit/IP | MED — security-event IPs are the primary investigative field. |
| `api/v1/onboarding.py` | 5 ✅ | B25 onboarding | LOW/MED — tenant-provisioning audit trail (owner creation, org creation). |
| `core/public_portal_security.py` | 2 ✅ | B26 public-portal | **MED — unauthenticated surface.** Anonymous callers are the case where the real IP matters most. |
| `api/public/portal.py` | 1 ✅ | B26 public-portal | MED — same. |
| `api/v1/endpoints/error_logs.py` | 2 ✅ | B23 | LOW — error-report attribution. |

`core/audit.py` also carried the pattern in its `log_audit_event` **docstring
example** — no runtime effect, but it is the snippet developers copy, and the
likely origin of the whole class. Fixed in A2 (AUTH-3) with a note explaining
why.

### Fix shape

Mechanical and identical everywhere:

```python
from app.core.security_middleware import get_client_ip   # added to each of the 7 files
...
ip_address=get_client_ip(request)                        # was: request.client.host if request.client else None
```

`get_client_ip` returns `str` (never `None`) and falls back to the peer IP when
`TRUSTED_PROXY_IPS` is unset, so the change is **never worse than the current
behavior** in any deployment.

### One thing the sweep found that the survey had not

`core/public_portal_security.py:469` was not merely losing attribution — the
value fed `check_ip_rate_limit` for the whole public portal. Behind the proxy
every anonymous visitor shared **one rate-limit bucket**, so a single caller
could exhaust the limit for every visitor. That is the H5 global-lockout shape
the red team fixed for login, still live on the public surface. It is now keyed
on the real client, with a comment recording why.

### Follow-up still open

The sweep corrects IPs **going forward only**. Rows already written — session
records, audit events, and per-vote election IPs — still hold the proxy
address, and nothing distinguishes them from real ones. For elections
specifically, an administrator reading `suspicious_ips` on a *past* election
will still see the inverted result. Two options, both owner decisions:

1. Leave historical rows and note the cutover date in
   `BALLOT_FORENSICS_GUIDE.md` (cheap, honest, no migration).
2. Backfill or mark affected rows (accurate, but audit rows are hash-chained
   and deliberately immutable — a marker table is likelier than an update).

Recommend option 1 plus a line in the forensics guide; the audit chain exists
precisely so that historical rows are not rewritten.

### Related documentation gap

No document states that `TRUSTED_PROXY_IPS` **must** be set for client-IP
features to work. `.env.example.full:464` calls it "CRITICAL when behind a
reverse proxy" and `docker-compose.prod.yml` ships a default — but a self-hosted
deployment using the base `docker-compose.yml` behind its own proxy silently
gets proxy IPs everywhere, and nothing warns the operator. Worth a startup
warning (the codebase already has `startup_validators.py`) rather than only a
comment in an example file.
</content>

---

## BXC — pass-2 root-cause sweep (2026-08-06)

After B1–B8 kept surfacing the same two shapes, a targeted sweep ran across the
**remaining** modules (5 parallel readers; every finding verified against source
and, for BXC-2, against frontend rendering). Two classes:

### BXC-1 — blind `setattr`-over-`model_dump` update loops that reassign a client FK without in-org re-validation

Classified by **consequence**, which is what determines severity — not the
presence of the loop:

- **READ-LEAK (MED)** — the FK is eager-loaded / name-projected into a response,
  so a foreign id leaks another org's name. **Fixed inline:**
  - **events `update_future_events` — `location_id`** (`event_service.py:404`).
    `update_event` and `create_event` both validate the location in-org; the
    series-wide bulk update did not, and `location_id` → `location_name` is
    projected (`events.py:97,261`). A foreign location name would leak on every
    event in the series. Fixed by validating once before the loop
    (`ValueError → 400`, endpoint already wraps it). ✅
- **CROSS-ORG-WRITE (MED/HIGH)** — the row has no `organization_id` of its own
  (org-scoped only via this parent FK), so a foreign FK transfers the row into
  another org. **None found in the swept modules** (the one candidate,
  finance `update_chain_step.email_template_id`, keeps org scoping via the parent
  chain and only the stored template id is unchecked → dangling).
- **DANGLING (LOW)** — row keeps its own `organization_id`, FK stored as a raw id
  and never name-projected → integrity only, no disclosure. **Flagged as a batch**
  (a future DiD sweep, same disposition as AP2-2 / INV-4-remainder). ~18 sites:
  - training: `RecertificationPathwayUpdate` (source_requirement_id,
    assessment_course_id), `InstructorQualificationUpdate` (course_id,
    skill_evaluation_id, category_id), `TrainingSubmissionUpdate` (category_id)
  - events: `EventTemplateUpdate` (default_location_id)
  - scheduling: `ShiftTemplateUpdate` (apparatus_id — asymmetry: create_shift /
    update_shift DO validate apparatus_id), `ShiftPatternUpdate` (template_id)
  - meetings: `ActionItemUpdate` (assigned_to — asymmetry: create_action_item
    validates)
  - evoc_level: `EvocLevelUpdate` (training_program_id)
  - membership: `ProspectUpdate` (referred_by — the protected set lists the
    relationship name `referrer`, not the FK column `referred_by`)
  - forms: `FormFieldUpdate` (condition_field_id — within-form ref)
  - finance (6, all keep own org_id, none name-projected): `update_budget_category`
    (parent_category_id), `update_budget` (station_id), `update_approval_chain`
    (budget_category_id), `update_chain_step` (email_template_id),
    `update_purchase_request` (apparatus_id, facility_id), `update_dues_schedule`
    (fiscal_year_id). The money-critical `budget_id` **is** validated in-org on
    both paths via `_validate_finance_fks` — verified, no money-math corruption.

**Verified clean on BXC-1:** grants, fundraising, storefront, admin-hours,
messaging, notifications-rules, organization, operational_rank, org_template,
template, compliance_config, location, member_leave, email_template,
course_syllabus, course_cohort, training_program, training_module_config, and
every `update_*` whose Update schema exposes no FK or whitelists fields.

### BXC-2 — response schemas declaring `*_name` fields the service never populates

The MS2-4 / DOC2-1 class. Classified by whether the frontend renders the field:

- **NAME-RENDERED (live UI defect) — fixed inline where the module is done:**
  - **meetings `MeetingResponse.creator_name`** — `MinutesPage.tsx:350` renders
    "Created by {creator_name}"; the list returned the raw ORM so it never
    appeared. Fixed with `attach_creator_names` (org-scoped batch), wired into the
    list + detail endpoints. ✅ (B6 was already done, so fixed here rather than
    deferred.)
- **NAME-RENDERED — deferred to the module's own upcoming pass-2 iteration**
  (they'll get proper module context there; recorded so they aren't lost):
  - membership `ProspectResponse.pipeline_name` — "Pipeline:" line silently
    omitted on the detail/interview view → **B9 membership pipeline (next).**
  - training `RenewalTaskResponse.pathway_name` (shows literal "Renewal") and
    `InstructorQualificationResponse.user_name` (shows a raw UUID) → **B18
    training.**
- **RELIABILITY (potential 500) — fixed inline:**
  - **notifications `NotificationLogResponse.rule_name`** — `recipient` is
    `lazy="joined"` but `rule` was not, and the `rule_name` property reads
    `self.rule`; a log with a `rule_id` therefore triggered a lazy load during
    async serialization → `MissingGreenlet` (a 500 on `GET /notifications/logs`
    and `/my`). Fixed by making `rule` `lazy="joined"` too (mirrors `recipient`),
    protecting all five serialization paths. ✅
- **NAME-NOT-RENDERED (cosmetic dead field) — flagged, not fixed:** messaging
  `MessageResponse.author_name` (inbox path populates its own schema), meetings
  `ActionItemResponse.assignee_name` / `MeetingAttendeeResponse.user_name`,
  training `course_name` / `skill_name` / `MemberCompetencyResponse.skill_name`,
  finance `ApprovalStepRecordResponse.step_name` / `step_order` (masked by a
  separate structural gap: the PR/Expense/Check models have no `approval_steps`
  relationship, so that timeline never renders at all — an incomplete feature, not
  a name-population fix).

**Verified populated (not defects):** events (location_name, RSVP user_name),
scheduling (apparatus/officer/user/training names via `_enrich_*`), shift-completion
(`@property` on `lazy="joined"` relationships), reports_service hand-built dicts,
storefront/admin-hours/grants/fundraising name fields, forms submitter/org names.

**Net this iteration:** 3 fixed (events read-leak, notifications 500, meetings
creator_name); 2 rendered name defects deferred to their imminent module slots
(B9, B18); ~18 dangling FKs + the cosmetic name batch flagged for a DiD sweep.
