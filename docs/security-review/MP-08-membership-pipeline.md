# Security Review — Membership Pipeline

**Prefix:** `MP` · **Iteration:** 9 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-02 (pass 4), 2026-09-02 (pass 4 round 2), 2026-09-02 (pass 4 round 3), 2026-09-02 (pass 4 round 4), 2026-09-08 (pass 5), 2026-09-14 (pass 6), 2026-09-16 (pass 7), 2026-10-05 (pass 8), 2026-10-13 (pass 9), 2026-10-15 (pass 10, PR [#3255](https://github.com/thegspiro/the-logbook/pull/3255) — corrected here from the "PR pending" placeholder pass 10's own write-up left unresolved after merge), 2026-10-18 (pass 11, PR [#3420](https://github.com/thegspiro/the-logbook/pull/3420)), 2026-10-23 (pass 12, PR [#3574](https://github.com/thegspiro/the-logbook/pull/3574)), 2026-10-25 (pass 13, PR [#3702](https://github.com/thegspiro/the-logbook/pull/3702) — not recorded here when pass 13 was written; added in pass 14's own commit), 2026-10-28 (pass 14, PR [#3811](https://github.com/thegspiro/the-logbook/pull/3811) — not recorded here when pass 14 was written; added in pass 15's own commit), 2026-11-01 (pass 15) · **PR:** [#1815](https://github.com/thegspiro/the-logbook/pull/1815) (pass 1), [#1950](https://github.com/thegspiro/the-logbook/pull/1950) (pass 2), [#2176](https://github.com/thegspiro/the-logbook/pull/2176) (pass 3), [#2177](https://github.com/thegspiro/the-logbook/pull/2177) (pass 4, pass 4 round 2, pass 4 round 3, and pass 4 round 4), [#2405](https://github.com/thegspiro/the-logbook/pull/2405) (pass 5, plus #2406/#2408/#2413 follow-ups), [#2555](https://github.com/thegspiro/the-logbook/pull/2555) (pass 6), [#2605](https://github.com/thegspiro/the-logbook/pull/2605) (pass 7), [#2955](https://github.com/thegspiro/the-logbook/pull/2955) (pass 8), [#3149](https://github.com/thegspiro/the-logbook/pull/3149) (pass 9), [#3255](https://github.com/thegspiro/the-logbook/pull/3255) (pass 10), [#3420](https://github.com/thegspiro/the-logbook/pull/3420) (pass 11), [#3574](https://github.com/thegspiro/the-logbook/pull/3574) (pass 12), [#3702](https://github.com/thegspiro/the-logbook/pull/3702) (pass 13), [#3811](https://github.com/thegspiro/the-logbook/pull/3811) (pass 14)

---

## Pass 15 (2026-11-01) — watchdog pickup: real delta (case managers/interviewers and `prospective_members.view_all`, the Follow-up Form pipeline stage, case-manager withdraw, coordinator-notes visibility, in-app bell copies for withdrawal/auto-purge notices), 0 fixed, 0 new findings; MP-10 (listing half) and MP-22 re-confirmed OPEN, unchanged

**Step 0/1.** The dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents`). `list_pull_requests` (state=open, all 15 open PRs) found 0
with a head branch starting `claude/security-review-`. PR #3908 (Feature 07,
Users & organizations, pass 14) had already merged (`c262792f`); row 07 was
already `✅` from that PR's own commit. Row 08 (Membership pipeline) was the
next `⬜`, confirmed fresh against the rotation table on a freshly fetched
`main`.

**Scope confirmation.** Rotation table row 08 plus this feature's established
additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`, `frontend/src/modules/prospective-members/`.

**Last reviewed at:** `6e70e60` (pass 14's commit, PR #3811). `git log
--no-merges 6e70e60..HEAD` over the declared scope: 8 non-merge commits, each
read in full via `git show` (not sampled). Two of the eight
(`ab879fc7`, `cf8fdae3`) are pure CSS layout refactors (`split-row`/
`page-header` utilities) with no permission, query, or data-shape change —
confirmed by reading their diffs, not assumed from the commit title — and
are not discussed further below.

**The real delta, by area:**

| Area                                                                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Commits                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Case managers, interviewers, `prospective_members.view_all`         | New `app/services/prospect_access.py` + `app/api/prospect_access.py`: an applicant is now visible either through `view_all` (org-wide) or through a per-applicant assignment (`prospect_assignments`, role `case_manager` or `interviewer`). `require_prospect_access(level)` is a per-route dependency (`SEE`/`FULL`/`WORK`/`MANAGE`/`INTERVIEW`); every route naming a `{prospect_id}` declares one, enforced by `tests/test_prospect_access_routes.py` so a new route cannot silently fall back to "any pipeline permission sees everyone." `ProspectAssignmentService.assign()` validates **both** the applicant and the assignee user belong to the caller's organization before inserting (CLAUDE.md Pitfall #14c, stated in the module's own docstring) — traced directly in `_prospect()` and the `User.organization_id == organization_id` filter, not taken on the docstring's word. Migration `c588f525fdbb` backfills `view_all` onto every position that already held `view`/`manage`, so no existing installation's visibility narrows on upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `92ec254c`             |
| Case-manager withdraw; coordinators' notes hidden from interviewers | `set_prospect_status` admits `Level.WORK` (case managers included) but then explicitly refuses any status other than `withdrawn` for a non-manager (`if not access.can_manage and data.status != WITHDRAWN: 403`) — verified the branch, not the docstring. `get_prospect` nulls `response.notes` when `not access.can_see_full` (an interviewer's assignment is `SEE` only), matching the existing activity-log/election-package visibility line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `183c4234`             |
| Follow-up Form pipeline stage                                       | New public, token-scoped surface: `api/public/follow_up_forms.py` (`GET {token}`, `PUT {token}/draft`, `POST {token}/submit`) and `services/follow_up_form_service.py`. The token is a 43-char `secrets.token_urlsafe(32)` validated by `Path(..., min_length=43, max_length=43, pattern=...)` before any DB work, matched only by SHA-256 hash (`token_hash`, reusing the existing `hash_status_token` the already-reviewed status-page token uses), rate-limited via `validate_ip_rate_limit`, and every response carries `no-store`/`no-referrer`/`noindex`. `resolve()` re-derives the prospect, step and form each by **both** id and `organization_id` (`request.organization_id`, an internal, non-client-supplied value) — a cross-org token cannot exist since the request row itself is created org-scoped. Writeback to the applicant record (`_record_updates`) only ever touches a column named in `FormField.applicant_field`, which is itself validated server-side at form-save time against the fixed `APPLICANT_FIELDS` tuple (`first_name`, `email`, `phone`, address fields, …) via `_enum_check` — confirmed this allowlist contains no tenancy/identity/privilege column, so the public submission path cannot be used for mass assignment onto anything but the twelve safe columns. Sensitive answers (`is_sensitive` fields) are excluded from both the record-writeback path and the pre-fill the applicant sees on return, and the draft itself (which does carry raw sensitive text) is stored in an `EncryptedJSON` column, not plaintext. The reveal-to-staff endpoint (`GET .../follow-up-forms/{request_id}/answers`) returns a sensitive answer only to a `sensitive_answers.view` holder and audit-logs every such reveal (`form_sensitive_answers_viewed`) — traced in the handler, not assumed. An election package may include non-sensitive answers only when the stage explicitly opts in (`package_fields.get("include_follow_up_answers") is True`, with an explicit comment guarding against `None` defaulting to "everything" the way the pre-existing fields do) and `package_answers()` filters `is_sensitive` out regardless of the caller's permissions, because the package snapshot is stored unencrypted. The daily reminder sweep (`send_due_reminders`/`_remind_one`) row-locks (`with_for_update()`) and re-checks each request before sending, and sends before stamping (CLAUDE.md Pitfall #36's "at least once" branch, correctly chosen — a duplicate reminder is a nuisance, a missing one stalls an applicant indefinitely). Migration `f34e25e2c820` (`prospect_form_requests`): both `ondelete="SET NULL"` columns (`step_id`, `form_id`) are `nullable=True`. | `27a363f1`, `a36d27f1` |
| In-app bell copies for withdrawal/auto-purge/other officer alerts   | `officer_alert_copies.add_in_app_copies` writes a bell entry alongside (not instead of) the existing org-scoped email path, for recipients resolved the same way the email's recipient list already was (`_withdrawal_notice_recipients`, itself org-scoped) — no new recipient-resolution logic to re-verify, and no behavior change to who may act on an applicant, only to who is told.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `31f39cf6`             |
| Refusal message length cap                                          | Three more call sites (two in this feature, one shared MCP helper) adopt the pre-existing `list_within_detail_limit()` pattern already used elsewhere in this rotation (FIN, ELEC). No new information disclosed — truncates a list the caller's own data already comprised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `bdf73eba`             |

**Tenant isolation re-derived on every new by-id/by-token site**, not
assumed from the diff's framing: `prospect_access.py`'s `assigned_roles`/
`assigned_prospect_ids` (both filter `ProspectAssignment.organization_id ==
user.organization_id`), `ProspectAssignmentService.assign`/`unassign`/
`list_for_prospect`/`my_applicants` (all filter `organization_id` on both the
prospect and the assignment row), and `FollowUpFormService.resolve`/
`submitted_answers`/`_answers_for`/`package_answers` (each filters
`organization_id` on the request, prospect, submission and form
independently, not inherited from a single earlier check). One dependency,
`require_interview_access`, loads `ProspectInterview` by id with no
`organization_id` filter in the dependency itself; traced whether this is
exploitable and confirmed it is not — `update_interview`/`delete_interview`
in the service layer each re-resolve the interview through
`get_interview(interview_id, organization_id)` (a join to
`ProspectiveMember.organization_id`) before acting, so a cross-org
`interview_id` always ends in the same 404 the dependency's own `_not_found()`
would have produced, whether or not the dependency's own `can_see`/
`can_manage` check (unscoped by design, since it only gates whether the
_caller's own_ permissions/roles qualify) happened to pass first. Noted here
as a verified non-issue, not a finding, since defense-in-depth belongs in the
write-up either way.

**Route enumeration (checklist §1/§2), done fresh via AST walk, not diffed:**
**62 routes** in `membership_pipeline.py` (up from 53 at pass 14 — the 9 new
routes are `/my-applicants`, `/my-access`, the three `/assignments`
routes, `/report-settings`, and three follow-up-form routes under this
router's prefix). Every route resolves to one of `get_current_user`,
`require_permission(...)`, `require_prospect_access(...)`,
`require_view_all(...)`, `require_pipeline_reader`, or
`require_interview_access` — verified by walking each function's full source
with a Python AST script, not a substring match on the decorator line alone
(an earlier, cruder check flagged 14 false positives on routes whose
`Depends(require_permission(...))` simply wraps onto a second line).

**No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`, no raw
`csv.writer`, no `window.confirm`/`alert`/`prompt`** introduced in this
window's commits (grepped fresh over the full diff, not limited to the files
listed above).

### Standing items re-verified this pass

- **MP-10 (listing half)** — `list_election_packages` does not appear
  anywhere in this window's diff. **Still OPEN**, unchanged;
  `docs/KNOWN_LIMITATIONS.md`'s entry still matches.
- **MP-22** — `delete_prospect_document` and `_delete_inactive_prospects`
  likewise do not appear in this window's diff. **Still OPEN**, unchanged;
  owner-accepted tradeoff.

Both re-confirmed by searching the actual diff text for the function names,
not copied from the prior write-up.

### Verified good ✅ (pass 15)

- **The assignment grant cannot be used to plant a foreign-org user on a
  local applicant, or a local user on a foreign-org applicant**:
  `ProspectAssignmentService.assign()` resolves both the prospect and the
  assignee `User` through a query filtered on the caller's own
  `organization_id`, and raises before any row is inserted if either lookup
  misses (CLAUDE.md Pitfall #14c).
- **The public follow-up-form token cannot be replayed across organizations
  or reused after submission**: `resolve()` re-derives prospect/step/form by
  id **and** `organization_id` on every call, and a submitted request raises
  `FollowUpAlreadySubmitted` rather than silently accepting a second
  submission.
- **Sensitive follow-up answers cannot reach the applicant record, an
  unprivileged viewer, or an election package**: excluded from
  `_record_updates`'s writeback (`field.is_sensitive` check), from
  `public_view`'s pre-fill, from the plain answer list unless the viewer
  holds `sensitive_answers.view` (and that reveal is audit-logged), and from
  `package_answers()` regardless of the caller's permissions.
- **The Follow-up Form writeback cannot be redirected onto a non-applicant
  column**: `FormField.applicant_field` is validated against the fixed
  `APPLICANT_FIELDS` allowlist at form-save time, server-side, not read from
  the public submission payload.
- **The daily follow-up-form reminder sweep is safe to run twice**: each
  candidate row is locked and re-checked immediately before sending
  (CLAUDE.md Pitfall #27's locking-read requirement, not just a row lock),
  and `reminder_count`/`last_reminder_at` are capped and stamped so a second
  concurrent run finds nothing due.
- **No regression on any previously-closed finding** (MP-1 through MP-34) —
  none of their call sites appear in this pass's diff.

### Schema & migration notes

Two new migrations since pass 14, both read in full:

- `20261029_0322_f34e25e2c820_follow_up_form_requests.py` — creates
  `prospect_form_requests`. Both `ondelete="SET NULL"` columns (`step_id`,
  `form_id`) are `nullable=True` (Pitfall #2); guarded by `_has_table` checks
  on every table it touches (Pitfall #26).
- `20261031_1200_c588f525fdbb_prospect_assignments_and_view_all.py` —
  creates `prospect_assignments` and backfills `view_all` onto every
  position holding `view`/`manage`. The one `ondelete="SET NULL"` column
  (`assigned_by`) is `nullable=True`; `ondelete="CASCADE"` columns
  (`organization_id`, `prospect_id`, `user_id`) are `nullable=False`, as
  required. Guarded by `_has_table` on `positions` and the new table itself.

`validate_migrations.py --strict`: single head, both revisions chain
correctly from pass 14's baseline.

## Completion gate (pass 15)

Run against CI's pinned toolchain (`flake8==7.4.1`, `black==26.10.1`,
`isort==9.0.2`, confirmed installed at these exact versions) under
`python3.13` (the sandbox's bare `python3` resolves to 3.11); frontend
against the repo's existing `node_modules`.

| Check                                                                                        | Result                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/`                                                         | ✅ 2776 files unchanged                                   |
| `isort --check-only app/ tests/ alembic/`                                                    | ✅ clean                                                  |
| `python3.13 scripts/validate_migrations.py --strict`                                         | ✅ 684 revisions, single head `5781476f2012`              |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                            | ✅ 283 routes, 0 errors, 0 warnings                       |
| scoped backend pytest (`-k "membership or prospect or pipeline or follow_up or assignment"`) | ✅ 1,669 passed, 1 skipped (environment-only, `py_vapid`) |
| `cd frontend && npx tsc --noEmit`                                                            | ✅ 0 errors                                               |
| `cd frontend && npx eslint src/modules/prospective-members`                                  | ✅ 0 errors, 0 warnings                                   |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)                     | ✅ 375 passed (42 files)                                  |

No application source file changed this pass (0 fixes — the real changes
already landed on `main` via the eight commits above, independently tested
and already merged). Every check above verifies that the delta which landed
since pass 14 is sound, not that a new patch applied cleanly.

## Pass 14 (2026-10-28) — watchdog pickup: real delta (phone/address encryption, email-by-fingerprint rewrite across the self-access guard and every SQL email match, stage-linked email templates, applicant-facing next-meeting card + ICS, stale-application coordinator/applicant emails), 0 fixed, 0 new findings; MP-10 (listing half) and MP-22 re-confirmed OPEN, unchanged

**Step 0/1.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results after PR #3810 (Feature 07, Users & organizations, pass 13)
merged — the dedicated review session (`session_011T1ZyyLrD5HagusgK9uDw2`)
remained unreachable throughout (confirmed via `ListAgents`). Rotation row 08
(Membership pipeline) was confirmed the next `⬜` by reading `PROGRESS.md`'s
rotation table directly on freshly fetched `main` (`5e8fa043`, PR #3810's
merge commit).

**Scope confirmation.** Rotation table row 08 plus this feature's established
additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`, `frontend/src/modules/prospective-members/`.

**Last reviewed at:** `507ae1d0` (pass 13's merge commit, PR #3702). `git log
--no-merges 507ae1d0..HEAD` over the declared scope: 12 non-merge commits, each
read in full via `git show` (not sampled, not taken from commit titles alone).
1,209 insertions / 324 deletions across 11 files.

**The real delta, by area:**

| Area                                                         | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Commits                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Phone/address encryption                                     | `prospective_members.phone`/`mobile`/`address_*` now `EncryptedText` (AES-256-GCM), reusing the already-reviewed column type pass 13 verified for `date_of_birth`. Nowhere in this feature's scope filters, sorts, or `LIKE`s these columns in SQL — every site is a plain ORM attribute read/write, which the transparent type handles correctly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `fde3d647`                                                                            |
| Email-by-fingerprint rewrite                                 | Every SQL comparison against `ProspectiveMember.email` (and `User.email` where this feature's service calls into it) now matches `email_hash` against `email_fingerprints()` — an HMAC-SHA256 list keyed on the current and legacy `ENCRYPTION_KEY`s, so lookups survive a key rotation. This is the applicant self-access guard's own matching logic (`prospect_privacy.py::_link_predicate`), plus five more SQL sites in `membership_pipeline_service.py` (search, member-match, bulk existing-member check, single lookup, duplicate check). Each rewrite traced individually against its pre-image; all preserve org-scoping and, for the guard, the exact set of records a caller is hidden from — only the email-matching predicate's implementation changed. `ProspectiveMember.email_hash` widened to nullable (mirrors `User.email_hash`; a raw-SQL insert that bypasses the ORM listener has no fingerprint and simply never matches — fails closed, not open, since `.in_()` excludes NULL).                                                                                                                                                                              | `b48d63f2`, `43c11090`, `d8d4e3f3` (mypy-only)                                        |
| Stage-linked email templates                                 | An automated-email stage can now link a custom `EmailTemplate`; the send path resolves it with an explicit `organization_id` filter and a `template_type == CUSTOM` check (a system template is refused at save time with a 400, and a dangling/switched-off/non-custom link at send time falls back to the stage's own sections, logged as `stage_email_template_unavailable`). The per-stage custom message is pre-escaped (`html.escape`) and substituted into the template as a variable value through `EmailTemplateService.render()`'s `appendix_html` mechanism — not spliced into the template source — so `{{...}}` typed into a coordinator's message is never expanded as a second round of template syntax.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `c91b309d`                                                                            |
| Applicant-facing next-meeting card + `.ics`                  | New `GET /application-status/{token}/next-meeting.ics` (in `api/public/portal.py`, outside this feature's primary file scope but driven entirely by `MembershipPipelineService` methods reviewed here). Reviewed as this feature's surface: same token/length/charset validation and `validate_ip_rate_limit` as the existing status page, same `no-store, private` / `Referrer-Policy: no-referrer` / `X-Robots-Tag: noindex` headers, discloses nothing the status page itself would not (explicitly gated on the same `public_step_ids`/`show_future` checks). The `.ics` body goes through the pre-existing `_escape_ics()` helper (backslash/comma/newline escaping), not reimplemented. Every new event query (`_next_event_for_meeting_config`, `_linked_open_meeting_event`) filters `organization_id`. The nightly `roll_forward_missed_meeting` (called from `scheduled_tasks.py::run_prospect_attendance_advance`, itself outside this feature's scope) is safe to run twice: an open linked event is a no-op, a miss is recorded once per event (keyed in the activity log), and the link is unique on `(prospect_id, event_id)` — checked against CLAUDE.md Pitfall #36. | `2c95e130`                                                                            |
| Applicant emails: from hand-built HTML to editable templates | `send_application_step_completed_email` / `send_application_status_link_email` replace inline `wrap_email_body(...)` construction with new `EmailTemplateType.APPLICATION_STEP_COMPLETED` / `APPLICATION_STATUS_LINK` templates. Confirmed `EmailTemplateService._replace_variables` HTML-escapes every substituted value by default (`escape_html=True`), with only a named allowlist (`_RAW_HTML_VARIABLES`) — system-built, already-safe HTML fragments — exempted; `applicant_name`/`step_name`/`custom_message` are not in that allowlist, so a name or stage name containing `<`/`&` cannot break out of the template markup. Failure logs now carry the prospect id rather than the email address (data-exposure checklist item, incidental fix).                                                                                                                                                                                                                                                                                                                                                                                                                              | `04af8b97`                                                                            |
| Stale-application coordinator/applicant emails               | Closes a standing `KNOWN_LIMITATIONS` gap (Pitfall #19 shape): the pipeline's `notify_coordinator`/`notify_applicant` settings had a UI and were stored but nothing read them. Now sent through `EmailService.send_inactivity_warning_email` / `send_application_going_inactive_email`, org-scoped throughout, recipients filtered through the existing `recipients_for(..., EmailKind.MEMBERSHIP_ADMIN, ...)` preference mechanism (not a bare roster query), sent **before** the commit that records the warning (a reminder — a duplicate on retry is a nuisance, a silently-dropped one is the failure being fixed; CLAUDE.md Pitfall #36's "send, then stamp" branch, correctly chosen for this direction), and wrapped in its own `try/except` so a mail failure cannot fail or roll back the sweep. Log line passes `organization_id`/exception as arguments, not spliced into the message (Pitfall #33).                                                                                                                                                                                                                                                                      | `1a9810fc`, `f1d6b6d5` (docstring-only correction of the gap this commit then closed) |
| Message-length fixes (no security content)                   | Two coordinator-facing `ValueError` messages (meeting-stage attendance refusal) were silently replaced by `safe_error_detail`'s generic fallback once over 300 characters; shortened and long names clipped. Fifteen more refusal messages across the codebase (one path through this feature) now use `list_within_detail_limit` so a long id/name list is truncated with a count instead of pushing the whole message over the cap. Pure UX fixes — the information they disclose (which ids/names) is already the caller's own data, already shown pre-fix when short enough.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `f21d8ea6`, `b4d9388a`                                                                |
| Test fixtures                                                | `StageConfigModal.test.tsx` fixtures gained the `allow_embed` field the forms schema already required; no behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `749f90f4`                                                                            |

**Tenant isolation re-derived on every new/changed by-id or by-email site**,
not assumed from the diff's framing: `_link_predicate`'s rewritten
fingerprint clause, `check_existing_members`, the bulk existing-member check
(`func.lower(ProspectiveMember.email).in_(normalized)` →
`ProspectiveMember.email_hash.in_([...])`), the single-lookup and duplicate-
check sites, `_resolve_stage_template`, `_next_event_for_meeting_config`, and
`_linked_open_meeting_event` — every one carries its pre-existing
`organization_id`/`prospect.organization_id` filter unchanged; the rewrites
only changed the email-matching predicate, never the scoping clause beside
it.

**Route enumeration (checklist §1/§2), done fresh via AST walk, not diffed:**
**53 routes** in `membership_pipeline.py` — unchanged from pass 13 (and pass
12). `git diff 507ae1d0..HEAD -- backend/app/api/v1/endpoints/membership_pipeline.py`
is empty; the one new endpoint this pass (`next-meeting.ics`) was added to
`api/public/portal.py`, outside this router, and is reviewed above as part of
the feature's delta rather than counted in this file's route total.

**No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`** — the email
search site that used to be an `ilike` is now an exact-match fingerprint `IN`
(documented UX tradeoff, consistent with the same change already made this
window to `forms_service.py`, `fundraising_service.py` and
`storefront_service.py` outside this feature's scope). **No raw `csv.writer`,
no `window.confirm`/`alert`/`prompt`** introduced in this window's commits or
present anywhere in this feature's current scope (grepped fresh over the full
frontend diff, not limited by file).

### Standing items re-verified this pass

- **MP-10 (listing half)** — `list_election_packages` does not appear
  anywhere in this window's diff. **Still OPEN**, unchanged;
  `docs/KNOWN_LIMITATIONS.md`'s entry still matches.
- **MP-22** — `delete_prospect_document` and `_delete_inactive_prospects`
  likewise do not appear in this window's diff. **Still OPEN**, unchanged;
  owner-accepted tradeoff.

Both re-confirmed by searching the actual diff text for the function names,
not copied from the prior write-up.

### Verified good ✅ (pass 14)

- **The applicant self-access guard is unweakened by the fingerprint
  rewrite**: `_link_predicate` still ORs the transfer-id clause with the
  email-match clause; only the email clause's implementation changed, from a
  plain lowercase SQL comparison (which would have silently stopped matching
  anything the moment the column became ciphertext) to a fingerprint `IN`
  against the HMAC-keyed `email_hash`. Traced end to end, not assumed from
  the commit message.
- **The new public `.ics` endpoint cannot disclose more than the status page
  it is unlocked by**: same token validation, same rate limit, same
  no-store/no-index headers, and the service method it calls shares the
  exact stage/visibility gate (`_status_page_meeting`) the status page's own
  `next_meeting` field uses — one definition, not two that could drift
  (CLAUDE.md Pitfall #29).
- **The stage-template appendix mechanism cannot be used to inject a second
  round of `{{variable}}` expansion**: a coordinator's custom message is
  substituted as a context value, not concatenated into the template source
  before rendering, confirmed by reading `EmailTemplateService.render()`
  directly rather than trusting the commit message's claim.
- **Every new/changed email-sending path HTML-escapes caller-supplied names
  by default**: confirmed in `_replace_variables` that escaping is the
  default and the raw-HTML allowlist is a named, closed set that none of
  this pass's new context keys (`applicant_name`, `step_name`,
  `prospect_name`, `pipeline_stage`, `coordinator_name`) belong to.
- **The nightly missed-meeting rollforward is idempotent** under CLAUDE.md
  Pitfall #36: re-run with the same prospect/event state, it writes nothing
  twice (checked the recorded-event-id set and the unique link constraint,
  not just the docstring's claim).
- **No regression on any previously-closed finding** (MP-1 through MP-9,
  MP-11 through MP-21, MP-23 through MP-34) — none of their call sites
  appear in this pass's diff.

### Completion gate (pass 14)

Run against CI's pinned toolchain (`flake8==7.4.1`, `black==26.10.1`,
`isort==9.0.2`, confirmed installed at these exact versions before running)
under `python3.13` (the sandbox's bare `python3` resolves to 3.11); frontend
against the repo's existing `node_modules`.

| Check                                                                         | Result                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                 | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/`                                          | ✅ 2714 files unchanged                                   |
| `isort --check-only app/ tests/ alembic/`                                     | ✅ clean                                                  |
| `python3.13 scripts/validate_migrations.py --strict`                          | ✅ 667 revisions, single head `b74bcce55c11`              |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 279 routes, 0 errors, 0 warnings                       |
| scoped backend pytest (`-k "membership or prospect or pipeline or election"`) | ✅ 1,972 passed, 1 skipped (environment-only, `py_vapid`) |
| `cd frontend && npm run typecheck`                                            | ✅ 0 errors                                               |
| `cd frontend && npm run lint`                                                 | ✅ 0 errors, 0 warnings                                   |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)      | ✅ 316 passed (35 files)                                  |

No application source file changed this pass (0 fixes — the real changes
already landed on `main` via the twelve commits above, all independently
tested and already merged). Every check above verifies that the delta which
landed since pass 13 is sound, not that a new patch applied cleanly.

## Pass 13 (2026-10-25) — watchdog pickup: real delta (DOB/emergency-contact encryption, stage-email meeting fallback, 99-column NOT NULL sweep, auto-enrollment prerequisite skip), 0 fixed, 0 new findings; MP-10 (listing half) and MP-22 re-confirmed OPEN, unchanged

**Step 0/1.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results both before PR #3695 (Feature 07, Users & organizations,
pass 12) was merged by this watchdog and again immediately after — the
dedicated review session (`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable
throughout. Rotation row 08 (Membership pipeline) was confirmed the next `⬜`
by reading `PROGRESS.md`'s rotation table directly on freshly fetched `main`
(`223b4ae7`).

**Scope confirmation.** Rotation table row 08 (`membership_pipeline.py`,
`membership_pipeline_service.py`) plus this feature's established additional
scope: `models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, `utils/prospect_fields.py`, and
`frontend/src/modules/prospective-members/`.

**Last reviewed at:** `aa15ccbb` (pass 12's merge commit, PR #3574). `git log
--no-merges aa15ccbb..HEAD` over the declared scope: 8 non-merge commits, all
read in full via `git show` (not sampled, not taken from commit titles alone).

**Two of the eight are already-documented, already-merged follow-up fixes**
(`4352a019` MP-33, `4ce4dd85` MP-34) that this file's own "Follow-up
(2026-10-23)" section — written the same day, ahead of pass 12's own section
in this reverse-chronological file — already covers in full with tests and a
`KNOWN_LIMITATIONS.md` entry. Re-confirmed present in current code
(`get_hidden_prospect_ids` now guards `purge_inactive_prospects`,
`check_existing_members_for_prospect`, and `create_prospect`'s 409, per the
three new `Depends(get_hidden_prospect_ids)` sites found below) rather than
re-derived from scratch.

**The real delta, by area (the remaining six commits):**

| Area                              | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Files                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DOB/emergency-contact encryption  | `prospective_members.date_of_birth` (and `users.date_of_birth`/`users.emergency_contacts`, outside this feature's scope) now stored as AES-256-GCM ciphertext via `EncryptedDate`. The applicant self-match in `prospect_privacy.py` — the guard that keeps an applicant from reading their own interview notes and votes — could no longer compare the date in SQL, so it was rewritten: `_link_predicate` (transfer id + email) still runs in SQL; the name pair is matched in SQL and the decrypted date is compared in Python, and `load_self_prospect_ids` unions both result sets | model, `prospect_privacy.py`, migration                                                                 |
| Stage-email meeting fallback      | `_fetch_meeting_details` now falls back to the next upcoming event of the configured type when the stage's saved `next_meeting_event_id` has passed, been cancelled or deleted, instead of silently dropping the Next Meeting section; a named location is now printed only when `location.organization_id` matches the sending org; the HTML and text email bodies resolve the event once so they cannot disagree; the send-log line now carries the prospect's id, not its email address                                                                                              | service                                                                                                 |
| 99-column NOT NULL sweep          | Three `membership_pipeline` booleans (`public_status_enabled`, `notify_prospect_on_completion`, `public_visible`) tightened from nullable to `NOT NULL` with a `server_default`, as part of a 36-table, repo-wide sweep closing an `apply_updates`-reads-model-nullability gap (CLAUDE.md Pitfall #1's mirror-image bug)                                                                                                                                                                                                                                                                | model (3 columns only; the migration and its own tests are cross-cutting, outside this feature's scope) |
| Auto-enrollment prerequisite skip | Automatic conversion's auto-enrollment into a probationary training program now checks `TrainingProgramService.missing_prerequisites` before enrolling; an unmet prerequisite skips enrollment (the member conversion still proceeds) and emails `training.manage` holders, after commit, naming the member, program and missing items — the same deferred-send pattern already used for the welcome email and directory provisioning                                                                                                                                                   | endpoint, service                                                                                       |

**Tenant isolation re-derived on every new/changed by-id site:** the
rewritten `load_self_prospect_ids` still scopes every query to
`ProspectiveMember.organization_id == user.organization_id` (and, for the
by-id guards, the specific `prospect_id`) before either the SQL-side link
predicate or the Python-side date comparison runs — traced line by line, not
assumed from the docstring. `block_self_interview_access`'s first lookup
(`ProspectInterview.id -> prospect_id`) intentionally carries no org filter
of its own, but it only _resolves an id_, never grants access: the
org-scoped `load_self_prospect_ids(..., prospect_id=owner_id)` call that
follows returns empty for a cross-org interview id, so the function still
falls through to "allow" exactly as the original single-query join did —
re-derived by tracing both branches, not taken from the diff's framing.
`_format_event_location`'s explicit `location.organization_id ==
organization_id` check is itself a new tenant-isolation guard, added so a
stage email can never print another organization's location name or
address however `event.location_id` came to reference it. The
auto-enrollment skip's member lookup (`select(User).where(User.id ==
user_id, User.organization_id == organization_id)`) and the
`missing_prerequisites` call both carry the explicit `organization_id`.

**No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`, no raw
`csv.writer`, no `window.confirm`/`alert`/`prompt`** introduced in this
window's six commits or present anywhere in this feature's current scope
(grepped fresh over the full scope, not limited to the diff). `grep -n
"date_of_birth"` over `membership_pipeline_service.py`,
`membership_pipeline.py` and `schemas/membership_pipeline.py` found no
remaining SQL-level comparison, sort or filter on the now-encrypted column —
only plain ORM attribute reads/writes, which the transparent
encrypt/decrypt type handles correctly; `prospect_privacy.py` was the one
site that needed rewriting, and it is the only one that was.

**Encryption migration (`3f2593e8071e`) read in full for this feature's
column:** idempotent (checks a ciphertext prefix before re-encrypting),
tolerates a table `create_all` would otherwise build (`_has_column` per
CLAUDE.md Pitfall #26), refuses to run without `ENCRYPTION_KEY` when there
are rows to encrypt, and its downgrade decrypts. Not specific to this
feature — `users.date_of_birth`/`users.emergency_contacts` are outside this
rotation row's scope and belong to Feature 07's own pass.

**Route enumeration (checklist §1/§2), done fresh via AST walk, not diffed:**
**53 routes** — unchanged from pass 12. `git diff aa15ccbb..HEAD --
backend/app/api/v1/endpoints/membership_pipeline.py` grepped for
`@router\.`/`Depends`/`require_permission` lines found exactly three added
lines, all `Depends(get_hidden_prospect_ids)` — the already-documented
MP-33/MP-34 fixes — and zero changed `@router.` decorators or
`require_permission(...)` argument lists. No route added, removed, or had
its permission gate changed since pass 12.

### Standing items re-verified this pass

- **MP-10 (listing half)** — `list_election_packages` does not appear
  anywhere in this window's diff (confirmed via `grep` over the diff text,
  not a line-number assumption). **Still OPEN**, unchanged from pass 12's
  description; `docs/KNOWN_LIMITATIONS.md`'s entry still matches.
- **MP-22** — `delete_prospect_document` and `_delete_inactive_prospects`
  likewise do not appear in this window's diff. **Still OPEN**, unchanged;
  owner-accepted tradeoff.

No new flags. Both re-confirmed by searching the actual diff text for the
function names, not copied from the prior write-up.

### Verified good ✅ (pass 13)

- **The applicant self-access guard (`block_self_prospect_access`/
  `block_self_interview_access`) is unweakened by the DOB-encryption
  rewrite**: the set of records a caller is hidden from is unchanged — link
  id OR owned email OR (name pair AND matching decrypted date of birth) —
  only _where_ the date comparison happens moved from SQL to Python, traced
  end to end across both call sites.
- **The stage-email meeting fallback cannot leak another organization's
  event or location**: `_fetch_meeting_details` filters every event query on
  the sending org, and the new `_format_event_location` helper additionally
  refuses to print a location whose own `organization_id` does not match.
- **The auto-enrollment prerequisite skip fails safe**: a missing
  prerequisite skips only the training enrollment, never the member
  conversion itself, and the officer-notification email is deferred to
  after commit with its own try/except so a mail failure cannot roll back
  or fail the conversion.
- **No regression on any previously-closed finding** (MP-1 through MP-9,
  MP-11 through MP-21, MP-23 through MP-32) — none of their call sites
  appear in this pass's diff.

### Completion gate (pass 13)

Run against CI's pinned toolchain (`flake8==7.4.1`, `black==26.10.1`,
`isort==9.0.2`, installed and confirmed at these exact versions before
running) under `python3.13` (the sandbox's bare `python3` resolves to
3.11); frontend against the repo's existing `node_modules`.

| Check                                                                         | Result                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                 | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/`                                          | ✅ 2647 files unchanged                                   |
| `isort --check-only app/ tests/ alembic/`                                     | ✅ clean                                                  |
| `python3.13 scripts/validate_migrations.py --strict`                          | ✅ 652 revisions, single head `3f2593e8071e`              |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 276 routes, 0 errors, 0 warnings                       |
| scoped backend pytest (`-k "membership or prospect or pipeline or election"`) | ✅ 1,916 passed, 1 skipped (environment-only, `py_vapid`) |
| `cd frontend && npm run typecheck`                                            | ✅ 0 errors                                               |
| `cd frontend && npm run lint`                                                 | ✅ 0 errors, 0 warnings                                   |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)      | ✅ 305 passed (35 files)                                  |

No application source file changed this pass (0 fixes — the real changes
already landed on `main` via the six commits above, all independently
tested and already merged). Every check above verifies that the delta which
landed since pass 12 is sound, not that a new patch applied cleanly.

---

## Follow-up (2026-10-23) — route-coverage guard for the MP-32 class; MP-33 and MP-34 fixed

Pass 8 missed `GET /my-sign-offs` because it reviewed changed files only and
did not re-list the routes. Two changes so that miss cannot recur unnoticed:

- **Guard test:** `tests/test_prospect_route_self_access_coverage.py` (unit, no
  database). It walks every route on the membership-pipeline router through
  its `Depends` tree. Any route without `{prospect_id}` must depend on
  `get_hidden_prospect_ids`, carry `block_self_interview_access`, or be listed
  in `EXEMPT` with a reason. A second test fails on a stale `EXEMPT` entry.
- **Command:** `.claude/commands/security-review.md` Step 3 now says a repeat
  pass re-lists the routes by AST and compares the count with the previous
  pass, rather than reviewing only the files in the diff.

Writing the guard turned up two more routes of the MP-32 shape:

### MP-33 — LOW — `purge-inactive` could delete the caller's own application — ✅ FIXED

**What:** `POST /pipelines/{pipeline_id}/purge-inactive` takes applicant ids in
the request body, or none at all to purge the whole Inactive tab. The router
guard cannot see body ids. Both bulk routes exclude the caller's own record
for this reason, but purge did not.

**Failure scenario:** a coordinator whose own application is inactive purges
the tab, or names their own id. Their file is permanently deleted, along with
the interview notes and recommendations other members wrote about them.

**Fix:** the endpoint depends on `get_hidden_prospect_ids`, and
`purge_inactive_prospects` passes the set to `_delete_inactive_prospects`,
which drops it from the locked select through `_apply_prospect_exclusions`.
The scheduled auto-purge passes nothing and is unchanged.

**Test:**
`test_prospect_self_access.py::TestGuardOverHttp::test_purge_inactive_spares_the_callers_own_record`
covers both the named-id and the whole-tab paths. It fails with the fix
stashed and passes with it.

### MP-34 — LOW — the duplicate-email check names the caller's own application — ✅ FIXED

`POST /prospects/check-existing` and the `POST /prospects` 409 both name the
active applicant for an email the caller types, so a caller can type their
own email and see their own application's pipeline and stage. Flagged at
first, then fixed the same day on the owner's decision to hide the match.

**Fix:** both routes depend on `get_hidden_prospect_ids`. `check-existing`
nulls `existing_applicant` when it is the caller's own record, and the
`POST /prospects` 409 for that record carries only the generic
`DuplicateApplicantError` message. Both left `EXEMPT` in the guard test.
The frontend needed no change: a null `existing_applicant` falls through to
the create call, whose 409 detail is shown as a toast.

**Test:**
`test_prospect_self_access.py::TestGuardOverHttp::test_duplicate_email_check_does_not_describe_own_application`
runs through the real dependency stack. It checks that another applicant is
still named while the caller's own application is not, and it fails with
the endpoint change stashed.

## Pass 12 (2026-10-23) — real delta (staff duplicate-applicant refusal, approver-role trimming/labeling, file-storage interface migration, numeric bounds, UTC interview times), 0 fixed, 0 new findings; MP-10 (listing half) and MP-22 re-confirmed OPEN, unchanged

**Step 0/1.** `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results before this iteration started; PR #3569 (Feature 07, Users
& organizations, pass 11) had already merged cleanly into `main`. Rotation row
08 (Membership pipeline) was confirmed the first `⬜` by reading
`PROGRESS.md`'s rotation table directly.

**Scope confirmation.** Rotation table row 08 (`membership_pipeline.py`,
`membership_pipeline_service.py`) plus this feature's established additional
scope: `models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, `utils/prospect_fields.py`, and
`frontend/src/modules/prospective-members/`.

**Last reviewed at:** `3d6ecd20` (pass 11's merge commit, PR #3420).
`git log --no-merges 3d6ecd20..HEAD` over the declared scope: 15 non-merge
commits, all read in full (not diffed-and-trusted) —
`git diff --stat 3d6ecd20..HEAD` on the full scope: 27 files, 800
insertions / 248 deletions (229 changed lines in
`membership_pipeline_service.py`, 59 in the endpoint, 43 in the schema, the
rest frontend). `prospect_privacy.py` and `utils/prospect_fields.py` are
byte-for-byte unchanged since pass 11 (confirmed via `git diff`, empty).

**The real delta, by area:**

| Area                                                     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Files                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Staff duplicate-applicant refusal                        | `create_prospect(reject_duplicate=True)` now raises `DuplicateApplicantError` instead of silently returning the existing row when an active applicant already holds the email; the staff endpoint (`POST /prospects`) maps it to a 409 naming the applicant (name, pipeline, stage — via `describe_existing_applicant`/`duplicate_applicant_message`), writes no `prospect_created` audit entry, and sends no email. `check-existing` gained a parallel `existing_applicant` field so the Add Applicant form can warn before submitting. The public/guest-check-in/form-submission callers (`guest_check_in_service.py`, `forms_service.py`) still call `create_prospect` with the default `reject_duplicate=False`, so the silent-dedup-and-notify behavior for the public application form is unchanged. | endpoint, service, frontend |
| Multi-approval role trimming/labeling                    | `_required_approver_roles()` is now the single point every approval check (gate, sign-off list, `/approve-step`, `/my-sign-offs`) reads a stage's `required_approvers` through, trimming whitespace so a padded stored value (`" chief"`) matches a holder instead of permanently blocking the stage. `office_label()`/the new `approver_labels` computed field let the frontend show "Chief" instead of the raw stored key, through the same `OFFICE_CATALOG` that decides who may sign (no second copy of the catalog). `StageConfigModal` now trims/drops blank roles on save.                                                                                                                                                                                                                          | service, schema, frontend   |
| File-storage interface migration                         | `add_prospect_document`/`download_prospect_document`/`delete_prospect_document`/`_delete_inactive_prospects` now go through `file_storage.delete`/`delete_quietly`/`exists`/`file_response` instead of bare `os.remove`/`os.path.exists`/`stored_file_response`, as part of a repo-wide "route every stored-file read, check and delete through one interface" change. Behavior-preserving: `file_storage.delete` still fails loudly (raises `ValueError` on a real removal failure, `False`/logged on a backend-resolution error) and the row delete still follows the file delete in the same order as before.                                                                                                                                                                                           | endpoint, service           |
| Numeric request-field bounds                             | `PipelineStepBase.sort_order`/`inactivity_timeout_days` (and the `Update` variant) now cap at `INT32_MAX`/`INT32_MIN` via the repo-wide "bound every numeric request field to its column range" sweep — closes a DB-level `OverflowError`-as-500 on a client-supplied out-of-range integer, not a new authorization surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | schema                      |
| UTC interview times                                      | `InterviewCreate.interview_date`/`InterviewUpdate.interview_date` moved from bare `datetime` to `UTCDateTime`, matching CLAUDE.md's UTC-storage convention; part of a repo-wide "Store minutes and interview request times as the UTC instant" change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | schema                      |
| Account-status gate correctness                          | Two `User.status == UserStatus.ACTIVE` comparisons in `_authorized_multi_approval_result`'s approver lookups became `User.status.in_(ACTIVE_ACCOUNT_STATUSES)` (CLAUDE.md Pitfall #32) — a probationary officer holding an approval role can now actually sign off; this _widens_ who can approve to match every other status gate in the app, not a new grant of authority (the role-holding check, `_approval_roles_held`, is unaffected).                                                                                                                                                                                                                                                                                                                                                               | service                     |
| Audit on stage delete                                    | `delete_step` now writes a `membership_pipeline.step_deleted` audit entry (pipeline id, step id) — deleting a stage deletes every applicant's progress record for it, so the trail previously had no record of who did it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | endpoint                    |
| Dead code removed                                        | Frontend `applicantService.deleteApplicant` (called a route that does not exist) removed; confirmed zero remaining call sites.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | frontend                    |
| a11y / correctness, out of this feature's security scope | ~15 color-contrast (`text-X-600` → `text-X-700`/`-800`) fixes and UX copy changes (pipeline/stage delete dialog wording, event-unlink confirmation) across the module's components — read to confirm none touch auth/scoping/validation logic; none do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | frontend                    |

**Tenant isolation re-derived on every new/changed by-id site:**
`find_existing_applicant`/`_find_active_prospect_by_email` (the duplicate
check powering both the 409 and `check-existing`'s new field) is called with
`current_user.organization_id` exactly as the pre-existing lookup was — no
new by-id or by-email query skips an org filter. The file-storage interface
migration changes _how_ a stored path is read/deleted, not _which org's_
files are reachable: every call site still resolves the path through
`prospect_document_path(stored_path, organization_id)` before calling
`file_storage.delete`/`exists` (unchanged by the migration — confirmed by
reading each of the four call sites in the diff above). `office_label()` and
`_required_approver_roles()` operate only on a step's own `config` JSON, no
org/user lookup involved.

**Authorization re-derived for the new refusal path:** `DuplicateApplicantError`
is raised, and the 409 built, strictly _before_ `create_prospect` would have
inserted a row or sent mail — confirmed by reading `create_prospect`'s
control flow: the `reject_duplicate` check at the top of the method (and
again at the second, lock-protected check used for the race with a concurrent
insert) returns before any `ProspectiveMember(...)`/`db.add()`/email call.
`POST /prospects`'s permission gate (`members.create` OR
`prospective_members.manage`) is unchanged, and the new `existing_applicant`
disclosure (name, pipeline, stage — deliberately not email, which the caller
already typed) is proportionate to that gate: `members.create`'s own
docstring in `app/core/permissions.py` describes it as scoped specifically to
"Add prospective members to the recruitment pipeline," so a holder is already
the intended audience for exactly this duplicate-resolution workflow, unlike
MP-7's case (an archived member's _email_ surfacing to a caller who matched
only by name and never typed it). Not a finding.

**No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`** (both
existing sites — `ProspectiveMember.first_name`/`last_name`/`email` search at
`membership_pipeline_service.py:1420-1424`, `TrainingProgram.name` lookup at
`:4766` — re-verified with `escape=LIKE_ESCAPE_CHAR` present), **no raw
`csv.writer`/`csv.DictWriter`, no `window.confirm`/`alert`/`prompt`**
introduced or present anywhere in this feature's current scope (grepped
fresh over the full scope, not limited to the diff).

**Route enumeration (checklist §1/§2), done fresh via AST walk, not diffed:**
**53 routes** — unchanged from pass 11. No route added, removed, or had its
`require_permission(...)` arguments changed by this window's 15 commits
(confirmed: the only endpoint-file hunks touched are `delete_step`'s new
audit call, `check_existing_members_for_prospect`/`create_prospect`'s
duplicate handling, and the four file-storage call sites — none of which is a
decorator or a `Depends(...)` argument). The router-wide
`block_self_prospect_access` dependency (`membership_pipeline.py:117`) is
unchanged. MP-31's target-role ceiling enforcement
(`_enforce_target_role_ceiling`/`_enforce_role_grant_ceiling`, lines
1131–1305) is outside every hunk this window's commits touch — re-confirmed
present and unchanged by direct read, not diff.

### Standing items re-verified this pass

- **MP-10 (listing half)** — `list_election_packages`
  (`membership_pipeline_service.py:7557-7607`) still has no `.limit()`/
  `.offset()` — confirmed by direct read of the full function body, not a
  grep for the word "limit". Unaffected by this window's diff (the function
  does not appear in it). **Still OPEN**; `docs/KNOWN_LIMITATIONS.md`'s entry
  matches current code and line references (updated below for the line-number
  drift since pass 10's `:7421`).
- **MP-22** — `delete_prospect_document` (`membership_pipeline_service.py:6946`)
  and `_delete_inactive_prospects` (`:6481`) both still remove the file from
  disk (now via `file_storage.delete`, migrated this window — see the
  file-storage area above) _before_ the row delete and the caller's commit.
  A commit failure after a successful delete still leaves a DB row (or, for
  the purge path, nothing — the row delete already ran) referencing a file
  that is gone. Read both functions in full this pass (not inferred from the
  file-storage migration's commit message) to confirm the ordering itself —
  the only thing that changed is which function performs the removal, not
  when. **Still OPEN**; owner-accepted tradeoff, unchanged.

No new flags. Both re-derived from current code this pass, not copied from
the prior write-up.

### Verified good ✅ (pass 12)

- **The staff duplicate-applicant refusal fails closed and cannot be used to
  enumerate applicants beyond the caller's existing authority**: traced
  `create_prospect`'s control flow end to end (both the initial check and the
  lock-protected re-check), confirmed no insert/email/audit-write precedes
  the raise, and confirmed the public/guest-check-in/forms paths are
  unaffected (`reject_duplicate` defaults to `False` and only the staff
  endpoint passes `True`).
- **The approver-role trimming change does not weaken the multi-signer gate**:
  `_required_approver_roles()` only normalizes whitespace on both the stored
  config and the comparison side — it does not relax, widen, or bypass the
  "signer must currently hold the role" check, which still lives in
  `complete_step`/`_approval_roles_held` (MP-9's standing concern), re-confirmed
  present and unchanged.
- **The file-storage interface migration preserves tenant-scoping and
  fail-closed semantics on every one of this feature's four call sites**:
  each still resolves the stored path through `prospect_document_path(...,
organization_id)` before calling the new interface, and a real deletion
  failure still raises rather than being swallowed (`file_storage.delete`
  returns `False`, which the caller still treats as fatal — re-confirmed by
  reading the four call sites, not the shared helper's docstring alone).
- **MP-31's target-role ceiling and MP-32's `/my-sign-offs` filter are both
  untouched by this window's diff** (confirmed: neither
  `_enforce_target_role_ceiling`/`_enforce_role_grant_ceiling` nor
  `list_my_sign_offs`/`get_hidden_prospect_ids` appears in any of the 15
  commits' hunks).
- **No regression on any previously-closed finding** (MP-1 through MP-9,
  MP-11 through MP-21, MP-23 through MP-32) — none of their call sites appear
  in this pass's diff.

### Completion gate (pass 12)

Run against CI's pinned toolchain (`flake8==7.3.0`, `black==26.5.1`,
`isort==9.0.1`, installed into this session's Python 3.13 interpreter — the
sandbox's bare `python3` resolves to 3.11, so every command below was run as
`python3.13` explicitly); frontend against the repo's existing
`node_modules` (no lockfile change needed for this pass).

| Check                                                                         | Result                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                                   | pass, 0 violations                                                          |
| `python3.13 -m black --check app/ tests/ alembic/`                            | pass, 2567 files unchanged                                                  |
| `python3.13 -m isort --check-only app/ tests/ alembic/`                       | pass, 0 violations                                                          |
| `python3.13 scripts/validate_migrations.py --strict` (repo root)              | pass — 640 revisions, single head `cc8c16cb6d98` (no migration this pass)   |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)          | pass — 273 routes checked, 0 errors, 0 warnings                             |
| scoped backend pytest (`-k "membership or prospect or pipeline or election"`) | 1876 passed, 1 skipped (environment-only, `py_vapid`/`pywebpush`), 0 failed |
| `cd frontend && npm run typecheck`                                            | pass, 0 errors                                                              |
| `cd frontend && npm run lint`                                                 | pass, 0 errors, 0 warnings                                                  |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)      | 302 passed (35 files)                                                       |

No application source file changed this pass (0 fixes — the real fixes
already landed on `main` via the 15 commits above, all independently tested
and already merged). Every check above verifies that the delta which landed
since pass 11 is sound, not that a new patch applied cleanly.

---

## Pass 11 (2026-10-18) — watchdog pickup: real delta (directory-account provisioning hooked into conversion), 0 fixed, 0 new findings; MP-22 re-confirmed unchanged

**Note on this file's pass numbering running one ahead of its lap-mates:**
pass 10 (above) landed one day after features 00–07's own pass 9, so this
file is a pass ahead of the sibling findings files reviewed in the same
watchdog run (PUB-03/SF-04/FIN-05/ELEC-06/USR-07 are all on their own
pass 10 as of this run). Each findings file's pass count is local to
itself; nothing in the rotation mechanism requires them to stay numerically
aligned across features, and Step 0 reads the truth from GitHub, not from
matching numbers across files.

**Scope.** Pass 10 merged as `b260c519e` (PR #3255). `git log --no-merges
b260c519e..HEAD` over the declared scope (`membership_pipeline.py`,
`membership_pipeline_service.py`, `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`, `utils/
prospect_fields.py`, `frontend/src/modules/prospective-members/`): 5
non-merge commits, all read in full. No prospect/pipeline-table migration
landed this window (the one migration-touching commit in this range,
`90b69e626`, only adds a new, unrelated `google_account_provisions` table
— confirmed by reading the migration file, not just the commit message's
mention of "prospective-members pipeline").

**The real delta is a new directory-account provisioning engine
(Google Workspace, later generalized to also support Microsoft 365)
hooked into `transfer_prospect` — the endpoint that converts an applicant
to a member — read in full across all five commits, not diffed
piecemeal:**

- **Org-scoping, throughout.** Every `DirectoryAccountService` call from
  `membership_pipeline_service.py` passes `prospect.organization_id`
  explicitly (`stage_for_transfer`, `provision`, `mark_credentials_sent`,
  `send_credentials_email`); `DirectoryAccountService.provision()` itself
  loads its row with `_load(organization_id, provision_id=..., lock=True)`
  — org-scoped and row-locked (Pitfall #27's shape) before any mutation.
- **The temporary directory-account password is never stored, confirmed
  by reading the model, not just its docstring's claim.**
  `models/directory_account.py` has no password column at all (its own
  docstring says so: "The temporary password is never stored here: it
  lives only in memory for the [delivery email]"). In the service,
  `provision()` returns the plaintext password as a local return value
  used only to build the welcome/credentials email, then discarded — it
  is never assigned to any ORM attribute. This is a distinct credential
  from the member's own Logbook login password (`temp_password`,
  generated by `generate_temporary_password()` and immediately
  `hash_password()`-ed before storage at `:4305-4310`) — the two are not
  conflated anywhere in the flow.
- **Commit-ordering and failure isolation, traced end to end.** The
  directory-account row is staged _inside_ the same transaction as the
  member conversion (so a crash between commit and the directory API
  call leaves a resumable row, not data loss), but the actual
  provider API call (`provision_directory_account()`) runs only _after_
  that transaction commits — a directory failure can never roll back or
  fail the member conversion itself. A caught exception during
  provisioning explicitly rolls back and refreshes the `prospect` ORM
  object so the welcome email that follows still has a valid, attached
  instance to read.
- **No response ever carries the password.** `result["google_account"]`
  (the pipeline API response) and the retry/status field it mirrors on
  the member's profile both expose only `provider`, `provider_name`,
  `status`, and `email` — confirmed by reading the dict literal directly,
  not inferred from the commit message.
- **Permission gate unchanged.** `transfer_prospect` is still gated by
  `require_permission("members.manage", "prospective_members.manage")` —
  the provisioning hook rides on this already-gated endpoint; no new
  route was added to `membership_pipeline.py` for it (confirmed: still
  53 routes, unchanged from pass 10).
- **A real, narrow fix landed within this window and is correctly in
  place (`2008edbec`):** an earlier commit in this same window
  (`90b69e626`) had provisioned even for a row staged as already-failed
  (an address off the Workspace domain); `2008edbec` restricts
  provisioning to `status == PENDING` rows only. Verified present in the
  current code, not merely claimed by the commit.
- **Other hardening in this same commit** (alias/group-linking rejection,
  suspending by Google's immutable user id rather than a possibly-aliased
  address, 409-recovery, restricting retries once a member has departed,
  redacted error logging) **lives in `directory_account_service.py`**,
  which is outside this feature's declared scope — that file belongs to
  the Integrations rotation entry and will get its own dedicated pass
  there. Noted here only so a future MP-08 pass does not re-derive it as
  this feature's own finding.
- **`3284dc052` — pure correctness fix, no security implication.**
  `PUT /pipelines/{id}` was the one update handler with no
  `except ValueError`, so `apply_updates` raising on a null aimed at a
  `NOT NULL` column (`name`, `public_show_future_stages`) escaped as a
  500; now caught and returned as 400 via `safe_error_detail`. No
  auth/tenancy change.

**All 53 routes re-enumerated** (unchanged from pass 10); no new
`.ilike()`/`.like()` without `escape=`, no raw `csv.writer`, no
`window.confirm`/`alert`/`prompt` introduced this window (grepped the
five commits directly). The router-wide `block_self_prospect_access`
dependency is unchanged.

**Standing item re-verified, unchanged (neither site touched by this
window's delta):**

- **MP-22** (a document delete, or the purge rewrite sharing the same
  helper, can lose a file on disk if the commit fails after a successful
  `os.remove`) — `delete_prospect_document`
  (`membership_pipeline_service.py:6916`) and `_delete_inactive_prospects`
  (`:6444`) are both outside every hunk this window's five commits touch.
  Owner-accepted tradeoff, unchanged.

**0 application-code defects found, 0 fixes needed, 0 new findings.**

### Completion gate (pass 11)

| Check                                                                  | Result                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                          | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/`                                   | ✅ 2438 files unchanged                                    |
| `isort --check-only app/ tests/ alembic/`                              | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                      | ✅ 619 revisions, single head `89723c04ae94`               |
| `python3 scripts/check_route_permissions.py --strict` (repo root)      | ✅ 272 routes, 0 errors, 0 warnings                        |
| `pytest tests/ -q -k "membership or prospect or pipeline or election"` | ✅ 1,734 passed, 1 skipped (environment-only, `pywebpush`) |
| `frontend: npm run typecheck`                                          | ✅ clean                                                   |
| `frontend: npm run lint`                                               | ✅ clean                                                   |
| `npx vitest run src/modules/prospective-members`                       | ✅ 287 passed (34 files)                                   |

---

## Out-of-rotation finding (2026-09-30) — MP-31

Found by a membership-module review outside the rotation, not by a pass. No
other scope was re-read, so the standing FLAGGED items are unchanged.

### MP-31 — HIGH — a stored target role let a pipeline coordinator mint an administrator account — ✅ FIXED

**What:** `target_role_id` (added 2026-09-24, after pass 7) is copied onto the
new member at conversion. `create_prospect` and `update_prospect` checked only
that the role is in the organization. `POST /prospects/{id}/transfer` ran
`_enforce_role_grant_ceiling` only on an explicit `role_ids`, and
`_do_transfer` fell back to the stored role when none was sent. Automatic
conversion (`complete_step` on a final stage with `auto_transfer_on_approval`)
applied the stored role with no check at all.

**Exploit:** a holder of `prospective_members.manage` (no role-management
authority) creates an applicant with an email they control and
`target_role_id` = the organization's `*` position, then converts them with
`role_ids` omitted and a `password` of their choosing. Result: an ACTIVE
account holding `*` whose password they know — full tenant takeover. The same
stored role reached automatic conversion, where the welcome email carries the
generated password to the attacker's address.

**Why it was missed:** `test_privilege_ceiling_wiring.py` pins the ceiling on
the explicit `role_ids` branch only, and
`test_the_stored_role_is_applied_when_the_caller_sends_none` pinned the
unchecked fallback as intended.

**Fix:**

- **Saving is granting.** `create_prospect` / `update_prospect` run the ceiling
  on a target role the caller sets (`_enforce_target_role_ceiling`, alerting
  like any other role grant). An update re-checks only a _change_: the drawer
  re-sends the stored role on every save.
- **Who chose it is recorded server-side**, as `metadata.target_role_set_by`,
  rewritten only when `target_role_id` changes. Client metadata reaches
  `create_prospect` verbatim (a public form's answers land at its top level),
  so any incoming value for that key is discarded (`_with_target_role_setter`).
- **Manual conversion** checks the role actually applied: the explicit
  `role_ids`, or else the stored role, against the caller — without an alert
  in the second case, since the caller did not choose it — and passes it on
  explicitly, so the service fallback never runs on this path.
- **Automatic conversion** applies the stored role only while its recorded
  chooser is still active in the organization and holds every permission it
  grants (`_target_role_setter_may_grant`). Otherwise the member converts with
  the default position and a `target_role_not_applied` activity entry says a
  leader must assign it. Roles stored before this fix have no recorded chooser
  and are not applied automatically.

**Tests:** `tests/test_prospect_target_role_ceiling.py` (14): forged setter
discarded, re-save keeps the chooser, change/clear re-records it; automatic
conversion applies within the chooser's ceiling and refuses beyond it, with no
recorded chooser, and after the chooser left; create/update refuse and report
a role beyond the caller and check before writing; manual conversion holds the
stored role to the caller's ceiling without an alert, and applies one within
it. The endpoint half fails against the unfixed endpoints, reproducing the
exploit. `test_prospect_target_role_and_lifecycle.py` now records the chooser.

**No schema change.** The chooser lives in the existing `metadata` JSON.

---

## Pass 10 (2026-10-15) — 0 fixed, 0 new findings; 2 standing items resolved by other work, 1 re-confirmed unchanged

**Step 0.** PR #3250 (Feature 07, Users & organizations, pass 9) had
already merged (docs-only — confirmed via its own PR body's Changes
section, "No application code changed."); cleared from the Open PR row.
Independently confirmed via `search_pull_requests`
(`repo:thegspiro/the-logbook is:pr is:open head:claude/security-review-`,
0 results) and `list_pull_requests` (state=open, no
`claude/security-review-*` head among the 9 open PRs) that no
security-review PR was open before this iteration started. Rotation row 08
(Membership pipeline) was the first `⬜`.

**Scope confirmation.** Rotation table row 08
(`membership_pipeline.py`, `membership_pipeline_service.py`) plus this
feature's established additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`, and `frontend/src/modules/prospective-members/`.

**Last reviewed at:** `a7a7c47d` (pass 9's merge commit, PR #3149,
2026-10-13T06:47:15Z). `git diff a7a7c47d..HEAD` on the full declared
scope: 4 files touched, 104 insertions / 15 deletions —
`membership_pipeline.py` (+15/-2), `membership_pipeline_service.py`
(+83/-12), `models/membership_pipeline.py` (+6/-0, a `TYPE_CHECKING`-only
annotation for a non-mapped attribute the service already stamps onto
loaded prospects — not a column), and one unrelated frontend test
assertion deleted (`ApplicantDetailDialog.test.tsx`, a stale CSS-class
check for a drawer variant that no longer exists, -0/-1). `schemas/
membership_pipeline.py`, `api/prospect_privacy.py`, `utils/
prospect_fields.py` and the rest of the frontend module are byte-for-byte
unchanged (confirmed via `git diff`, empty). The authoring commit
(`e3f236d8`, titled as an unrelated CSV-export streaming change) carries
an author date of 2026-10-11T22:59Z — two days _before_ pass 9's own merge
commit (`a7a7c47d`, 2026-10-13T06:47Z). That is not a contradiction:
`e3f236d8` was developed on a side branch and merged into `main` only
after `a7a7c47d` landed, so topologically it sits in `a7a7c47d..HEAD` (and
so in this pass's review window) even though it was authored earlier in
wall-clock time — pass 9 correctly described MP-10/MP-26 as still open,
since this commit had not yet reached `main` when pass 9 ran. Read in
full rather than taken on the commit title's word, since a change titled
as a performance fix in an unrelated module carrying a real security fix
in this one is exactly the shape this rotation exists to catch either way.

**The real delta is the owner's 2026-10-05/2026-10-11/2026-10-12 decision
closing MP-10's creation half and MP-26, both already recorded resolved in
`docs/KNOWN_LIMITATIONS.md` but not yet reflected in this feature's own
findings doc** (pass 9, written 2026-10-13, reviewed the point in history
_before_ this commit reached `main` and so correctly described both as
still open at the time):

### MP-10 (creation half) — ✅ RESOLVED 2026-10-11 (owner decision)

`create_election_package` (`membership_pipeline_service.py:6900-7132`) now
deletes the prospect's existing **draft** or **ready**
`ProspectElectionPackage` in the same transaction as it inserts the new
one, under `.with_for_update()` on both the prospect row (via
`get_prospect(..., lock_for_update=True)`) and the replaced-package select
itself — two independent lock sites, traced rather than assumed, closing
the read-then-write race per CLAUDE.md Pitfall #27: two concurrent
regenerate calls for the same applicant now serialize instead of both
reading "nothing to replace" and both inserting, which was the unbounded
growth this finding described. Packages already **added to a ballot,
elected, or not elected** (`ELECTION_PACKAGE_SYSTEM_STATUSES`, distinct
from the caller-settable `ELECTION_PACKAGE_CALLER_STATUSES =
{"draft", "ready"}`) are election history and are correctly left alone —
the delete filters on the caller-settable set only
(`membership_pipeline_service.py:7083-7091`). The coordinator's notes and
package config carry over to the replacement unless the request supplies
its own, via `copy.deepcopy(newest.package_config or {})` (Pitfall #12,
correctly applied — no shared-reference mutation). The activity log's
`election_package_created` entry records `replaced_package_ids` (bare
UUIDs, no PII) — confirmed by reading `_stage_election_package`'s
`details={"package_id": pkg.id, **(activity_details or {})}`
(`:7273`), not assumed. `tests/
test_election_package_regenerate.py::TestRegenerateReplaces` (9 tests)
pins the delete-and-carry-forward behavior, the system-status exclusion,
and the lock ordering.

**Still open, unaffected by this fix:** `list_election_packages`
(`membership_pipeline_service.py:7421-7457`) still has no
`.limit()`/`.offset()` — confirmed by direct read. This is no longer
unbounded by regeneration (at most one open package per applicant now),
but a department's full election history (every decided package, ever) is
still returned in one unpaginated call. `docs/KNOWN_LIMITATIONS.md`'s
entry already correctly describes this narrower residual ("bounded by
applicants × votes held rather than by clicks") — no edit needed there.

### MP-26 — ✅ RESOLVED 2026-10-11 (owner decision)

The sort-order guess fallback is gone for the ambiguous case. When neither
the prospect's `current_step` nor a type-checked `step_id` identifies an
`election_vote` stage, `create_election_package` now counts the
pipeline's `election_vote` stages (`effective_steps`); with more than one,
it raises `ElectionStageAmbiguousError` — a `ValueError` subclass so every
other caller's existing `except ValueError` handling keeps working — which
the endpoint (`membership_pipeline.py:2268-2274`) maps to a dedicated
**422**, naming the request itself as the thing to fix, ahead of the
generic 400 `ValueError` handler. A pipeline with exactly one
`election_vote` stage is unaffected (the lookup is exact, no ambiguity to
raise on) — confirmed by reading the branch: the `ElectionStageAmbiguousError`
path is only reached when `election_stage_count > 1`.
`tests/test_election_package_regenerate.py::TestAmbiguousElectionStage`
and the two updated cases in
`tests/test_membership_pipeline_pass4_round4_codex.py` pin both the 422
and the single-stage pass-through. `docs/KNOWN_LIMITATIONS.md`'s entry
already correctly reflects this as resolved — no edit needed.

**No schema change for either fix** — both are pure behavior changes on
existing nullable/JSON columns; `validate_migrations.py --strict` this
pass shows 596 revisions and a single head, unchanged in shape by this
window's commits in this feature's scope.

**Route enumeration (checklist §1/§2), done fresh, not diffed:** AST walk
of every `@router.(get|post|put|patch|delete)` decorator found **53
routes** — unchanged from pass 9. Every route's `Depends`/
`require_permission` arguments checked individually (not spot-checked);
no permission string added, removed, or widened since pass 9's enumerated
set. The two documented self-scoped exceptions (`list_my_sign_offs`,
`approve_step`) are unchanged.

**Fresh grep across the full current scope, not limited to the diff:** no
`.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR` (both existing
sites — `ProspectiveMember.first_name/last_name/email` search,
`TrainingProgram.name` probationary lookup — still correctly escaped); no
raw `csv.writer`/`csv.DictWriter` anywhere in the two backend scope files;
no `window.confirm`/`alert`/`prompt` in `frontend/src/modules/
prospective-members/`; router-wide `block_self_prospect_access`
(`membership_pipeline.py:116`) still applies to every route with a
`{prospect_id}` path parameter.

### Standing item re-verified this pass

- **MP-22** (a document delete, or the purge rewrite sharing the same
  helper, can lose a file on disk if the commit fails after a successful
  `os.remove`) — `delete_prospect_document` and `_delete_inactive_prospects`
  are both untouched by this pass's diff (confirmed by `git diff` on the
  function names, no hits). Owner-accepted tradeoff, unchanged;
  `docs/KNOWN_LIMITATIONS.md` already records both sites accurately.

No new flags. MP-10 (creation half) and MP-26 move from OPEN to RESOLVED,
re-derived from current code this pass rather than copied from
`KNOWN_LIMITATIONS.md`'s own description of them.

### Verified good ✅ (pass 10)

- **Both owner-decision fixes (MP-10 creation, MP-26) hold up under
  independent re-reading**, traced through their locking, tenant scoping
  (both operate on an already org-scoped `prospect`, resolved via
  `get_prospect(prospect_id, organization_id, ...)` before either fix's
  logic runs), and PII handling (the activity-log detail is UUIDs only)
  rather than taken from the code comments' own account of them.
- **No regression on any previously-closed finding** (MP-1 through MP-9,
  MP-11 through MP-21, MP-23 through MP-25, MP-27 through MP-32) — none of
  their call sites appear in this pass's diff.

### Completion gate (pass 10)

Run against CI's pinned toolchain (`flake8==7.3.0`, `black==26.5.1`,
`isort==9.0.1`) in a fresh Python 3.13 virtualenv with a full
`pip install -r requirements.txt`; frontend against a fresh `npm ci` from
the repo root (`frontend/node_modules/@tiptap/*` was missing before the
install, unrelated to this feature, and `npm ci` restored it per the
committed lockfile — no manifest or lockfile edit made).

| Check                                                                                                                                                                                        | Result                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                                                                     | pass, 0 violations                               |
| `python3 -m black --check app/ tests/ alembic/`                                                                                                                                              | pass, 2310 files unchanged                       |
| `python3 -m isort --check-only app/ tests/ alembic/`                                                                                                                                         | pass, 0 violations                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                            | pass — 596 revisions, single head `f2c5e55e7dda` |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                            | pass — 270 routes checked, 0 errors, 0 warnings  |
| cross-cutting guard tests (org-scoping ratchet, LIKE escaping, CSV sweep, capacity locking, endpoint-auth coverage, upload-scan sweep, `create_all`-table tolerance, baseline member grants) | 161 passed                                       |
| scoped backend pytest (`-k "membership or prospect or pipeline or election"`)                                                                                                                | 1697 passed, 0 failed                            |
| `cd frontend && npm run typecheck`                                                                                                                                                           | pass, 0 errors                                   |
| `cd frontend && npm run lint`                                                                                                                                                                | pass, 0 errors, 0 warnings                       |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)                                                                                                                     | 285 passed (34 files)                            |

No application source file changed this pass (0 fixes — the real fix had
already landed on `main` via `e3f236d8`, authored before this pass began).
Every check above verifies that the delta which landed since pass 9 is
sound and that `docs/KNOWN_LIMITATIONS.md`'s existing description of it is
accurate, not that a new patch applied cleanly.

---

## Pass 9 (2026-10-13) — 0 fixed, 0 new findings; 1 standing item closed by other work, 3 re-confirmed unchanged (watchdog pickup)

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session had
gone quiet — PR #3145 (Feature 07, Users & organizations, pass 8) merged
2026-10-13T03:24:09Z with no new `claude/security-review-*` branch pushed
since. Independently re-confirmed via `gh api
repos/thegspiro/the-logbook/pulls?state=open` (the REST endpoint, not GraphQL
`search_pull_requests`, which this environment blocks for Code sessions) that
no `claude/security-review-*` PR was open before this iteration started.
Rotation row 07 → ✅ (already landed by that merge, recorded in `PROGRESS.md`
riding along with this pass's commit per the rotation's own convention); row
08 was the next due for a fresh look.

**Scope confirmation.** Rotation table row 08
(`membership_pipeline.py`, `membership_pipeline_service.py`) plus this
feature's established additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`, and the module's frontend
(`frontend/src/modules/prospective-members/`).

**Last reviewed at:** PR #2955's merge commit `0b12efb5` (pass 8, including
the second session's MP-32 fix). `git diff 0b12efb5..HEAD` on the four
backend scope files: **961 insertions / 325 deletions** — `membership_pipeline.py`
(254 changed lines), `membership_pipeline_service.py` (566 changed lines),
`models/membership_pipeline.py` (464 changed lines — a pure SQLAlchemy-2.0
`Mapped[...]` typing refactor; every original argument kept, confirmed by
re-checking each `ondelete="SET NULL"` column still carries `nullable=True`
after the rewrite) and `schemas/membership_pipeline.py` (2 lines).
`prospect_privacy.py` and `utils/prospect_fields.py` are byte-for-byte
unchanged since pass 8. Real feature work landed in this window, not a
zero-delta pass — read in full rather than diffed-and-trusted, across 15
commits (two of them merges):

| Area                                                          | What                                                                                                                                                                                                                                                                                                                                                                                                  | Files                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Widget-summary scaling fix                                    | `pipeline_widget_summary` rewritten to count via SQL `GROUP BY`/`CASE` instead of loading every `ProspectiveMember` row, and caps the manager-only `details` list at 10 (`details_truncated` flag) — this is MP-19's standing finding, now fully closed (see below)                                                                                                                                   | endpoint                |
| Stranded-applicant placement (W23-1)                          | `_get_default_pipeline` falls back to the org's first active non-template pipeline when none is marked default; migration `e1a5bfe7a2ed` backfills every already-stranded open (`active`/`on_hold`) applicant onto that pipeline's first stage, one `prospect_step_progress` row per step, an activity-log row recording the backfill, with a symmetric downgrade keyed off that same activity action | service, migration      |
| Referral fields in the drawer                                 | `ProspectResponse.referred_by_name` resolved in `get_prospect` from an eager-loaded `referrer`, filled only when `referrer.organization_id == prospect.organization_id` — an explicit XC-1 guard against a legacy cross-org `referred_by` value naming another organization's member                                                                                                                  | service, schema         |
| Auto-purge warning email                                      | New `warn_upcoming_auto_purges`: per pipeline with Auto-Purge on, emails the department's coordinators 7 days before an inactive application's scheduled purge, org-scoped throughout, `html.escape`d, activity-logged only after a successful send (so a failed send retries rather than silently going dark)                                                                                        | service, scheduled task |
| File-storage hardening (repo-wide, touches this feature)      | Uploads/downloads/deletes for prospect documents now route through `FileStorageService`/`file_storage.resolve(..., StorageArea.APPLICANTS)` (malware-scanned, org-confined, AES-256-GCM encrypted at rest); `download_prospect_document` now returns `stored_file_response` instead of a raw `FileResponse` so encrypted files decrypt on the way out                                                 | endpoint, service       |
| `create_election_package` 500 fix                             | The stale-current-step guard compared `election_step is current_step` with both sides `None` for an applicant whose stage had been deleted, then dereferenced `current_step.id` — `AttributeError` → 500. Guard now requires a current stage, matching its own comment's intent                                                                                                                       | service                 |
| Interview update, deactivated-member uniqueness, display name | Carried over from the original diff-table reading; independently re-confirmed present and unchanged from pass 8's description                                                                                                                                                                                                                                                                         | endpoint, service       |

**Tenant isolation re-derived on every new/changed by-id or aggregate site,**
not assumed: `pipeline_widget_summary`'s new `GROUP BY`/`CASE` queries carry
the same `organization_id`/`hidden_prospect_ids` scope the row-scan version
used; `_get_default_pipeline`'s fallback query and migration
`e1a5bfe7a2ed`'s backfill both filter/group by `organization_id` explicitly
(the migration groups stranded rows by org before picking each org's own
pipeline — verified line by line, not assumed from the docstring);
`warn_upcoming_auto_purges` filters pipelines and prospects by
`organization_id` and resolves recipients through the existing org-scoped
`_withdrawal_notice_recipients`; the referrer-name resolution is explicitly
in-org-or-null, as above. No new by-id query reachable from client input
skips an org filter.

**Race safety:** `auto_purge_inactive_prospects` and
`warn_upcoming_auto_purges` share `_delete_inactive_prospects`'s
`.with_for_update()` locking read (unchanged from pass 8, now exercised by a
second caller) and run the warning before the purge in the same scheduled
task, inside a per-org savepoint, so a failed warning never blocks the purge
and a concurrent manual purge still serializes against the auto-purge job
correctly — re-confirmed by re-reading `run_membership_auto_purge` in
`scheduled_tasks.py` line by line, not re-derived from the commit message.

**Route enumeration (checklist §1/§2):** a fresh AST walk of every
`@router.(get|post|put|patch|delete)` decorator found **53 routes**,
matching pass 8's post-MP-32 count exactly — no route added or removed since.
Every route carries either `require_permission(...)` or (for
`list_my_sign_offs` and `approve_step`, both deliberately self-scoped rather
than manager-gated — see each endpoint's own docstring) `get_current_user`
plus a service-layer check that narrows the caller's authority to a role
they actually hold. No permission string widened from pass 8's set.

**`approve_step` / `record_step_approval` re-traced for a self-approval or
forged-role gap** (the same class MP-32 closed for `/my-sign-offs`): the
endpoint carries no path-level role check, but `router = APIRouter(
dependencies=[Depends(block_self_prospect_access)])` (`membership_pipeline.py:112`)
applies to every route with a `{prospect_id}` path parameter — including
this one — so a signer cannot record an approval against their own
application. Separately, `complete_step` calls
`_authorized_multi_approval_result` (`membership_pipeline_service.py:2452`),
which **discards** the client-claimed `role` and re-derives it from the
authenticated signer's own `positions` via `_approval_roles_held`, raising
if the claimed role is not one the signer currently holds
(`membership_pipeline_service.py:2487`). `record_step_approval` itself only
checks the role against the step's configured `required_approvers` — the
actual "does the signer hold this role" check lives one layer down in
`complete_step`, which every path into this endpoint passes through. Traced
end to end, not assumed from the docstring's claim. Not a finding.

**No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`, no raw
`csv.writer`, no `window.confirm`/`alert`/`prompt`, no bare
`toHaveBeenCalledWith()`** in any file this pass's diff touched or in the
feature's full current scope (grepped fresh, not limited to the diff).

### Standing items re-verified this pass

- **MP-19 — now fully ✅ RESOLVED (closed by other work, 2026-10-11).**
  Previously the last open half of this finding (the `/pipelines`
  `selectinload(...prospects)` sibling was already fixed in pass 3).
  `pipeline_widget_summary` (`membership_pipeline.py:135`) no longer loads
  every `ProspectiveMember` row: `by_status` is a `GROUP BY`, the three aging
  buckets one `CASE` aggregate with the same whole-day boundaries as the
  Python version it replaced, and the manager-only `details` list is capped
  at `PIPELINE_WIDGET_DETAIL_LIMIT` (10) with a `details_truncated` flag
  pointing at `queue_url`. Verified by re-reading the implementation (above),
  not by trusting the commit message; `docs/KNOWN_LIMITATIONS.md`'s entry
  already carries the resolution note, correctly. No further action.
- **MP-10** (unbounded `list_election_packages`/no per-prospect cap on
  `create_election_package`) — `list_election_packages`
  (`membership_pipeline_service.py:7350`) still has no `.limit()`/`.offset()`,
  and `create_election_package` still has no uniqueness/cap check. Unaffected
  by this pass's diff. Still open; `KNOWN_LIMITATIONS.md`'s entry matches
  current code and line references.
- **MP-22** (a document delete, or the pass-8 purge rewrite sharing the same
  helper, can lose a file on disk if the commit fails after a successful
  `os.remove`) — `delete_prospect_document` and `_delete_inactive_prospects`
  (shared by both the manual purge and this pass's new auto-purge caller)
  are both untouched on this ordering by this pass's diff. Owner-accepted
  tradeoff, unchanged; `KNOWN_LIMITATIONS.md` already records both sites.
- **MP-26** (a pipeline with multiple `election_vote` stages has no single
  "current stage" once neither `current_step` nor a supplied `step_id`
  identifies one) — `_election_block_reason`/`_latest_election_package_status`
  do not appear in this pass's diff at all (confirmed by `git diff` on the
  function names). Unaffected, unchanged.

No new flags. All four re-derived from current code this pass (grep/AST
confirmation cited above for each), not copied from the prior write-up.

### Verified good ✅ (pass 9)

- **The auto-purge warning email and the W23-1 stranded-applicant backfill
  are both correctly org-scoped, bounded and idempotent**, traced through
  their queries and migration rather than taken from their commit messages.
- **The file-storage hardening landed for this feature is consistent**:
  upload, download and delete for prospect documents all resolve through the
  same `StorageArea.APPLICANTS`-confined, encrypted, malware-scanned path;
  no site was found still operating on an unconfined raw path.
- **The `create_election_package` 500 fix is a pure correctness fix** that
  tightens an existing guard to match its own documented intent; it does not
  relax any check.
- **The multi-approval self-approval/forged-role gap is closed on two
  independent layers** (router-wide `block_self_prospect_access` for any
  `{prospect_id}` route, plus `complete_step`'s re-derivation of the signer's
  own roles), traced end to end rather than assumed.

### Completion gate (pass 9)

Run against CI's pinned toolchain (`flake8==7.3.0`, `black==26.5.1`,
`isort==9.0.1`) in a fresh Python 3.13 virtualenv with a full
`pip install -r requirements.txt`, not the (unrelated, pre-existing)
system Python the sandbox ships with.

| Check                                                                                                                                                                                                                              | Result                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                                                                                                           | pass, 0 violations                                                        |
| `python3 -m black --check app/ tests/ alembic/`                                                                                                                                                                                    | pass, 2209 files unchanged                                                |
| `python3 -m isort --check-only app/ tests/ alembic/`                                                                                                                                                                               | pass, 0 violations                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                  | pass — 578 revisions, single head `390fa30d0200` (no migration this pass) |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                  | pass — 267 routes checked, 0 errors, 0 warnings                           |
| cross-cutting guard tests (org-scoping ratchet, LIKE escaping, CSV sweep, capacity locking, endpoint-auth coverage, upload-scan sweep, `create_all`-table tolerance, baseline member grants, PII cache pin, JSON-column AST sweep) | 212 passed                                                                |
| scoped pytest (`-k "membership or prospect or pipeline or election"`)                                                                                                                                                              | 1638 passed, 0 failed                                                     |
| full backend unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                         | pass — 14355 passed, 0 failed                                             |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                 | pass, 0 errors                                                            |
| `cd frontend && npm run lint`                                                                                                                                                                                                      | pass, 0 errors, 0 warnings                                                |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)                                                                                                                                                           | 285 passed (34 files)                                                     |

No application source file changed this pass (0 fixes — see above); every
check above verifies that the real delta which landed since pass 8 is still
correct, not that a patch applied cleanly.

---

## Pass 8 (2026-10-05) — 1 fixed (MP-32, LOW/MEDIUM), 0 new flagged, all 4 standing FLAGGED items re-verified unchanged (watchdog pickup, continued by a second session)

**This section was written in two parts.** The first watchdog session wrote
everything below down to "What changed, read in full" plus the
Authorization/Tenant-isolation/Migration analysis — real, independently
verified work that holds up. It did not, however, re-enumerate this
feature's routes (checklist §1's "every route carries an auth dependency —
enumerate them"), which is how a second session, picking up the same
rotation row under the same race (two sessions started Step 0 close enough
together that each found no open PR yet), found a route-level gap the first
pass's diff-bounded review did not surface. Rather than open a competing PR
for the same feature, the second session's finding (MP-32) and its fix are
appended here, in the PR the first session already opened
(per this rotation's own "one PR at a time" / "tends that PR" rule), and the
header count above reflects both sessions' combined result.

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session had
gone quiet — PR #2952 (Feature 07, Users & organizations, pass 7) sat green
and `mergeable_state: clean` for over four hours with no merge and no new
`claude/security-review-*` branch pushed. Independently confirmed via
`list_pull_requests` (state=open) that no security-review PR was open before
merging #2952 and starting this pass. Rotation row 07 → ✅ (already landed by
this merge); row 08 was the first `⬜`.

**Scope confirmation.** Rotation table row 08
(`membership_pipeline.py`, `membership_pipeline_service.py`) plus this
feature's established additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`.

**Last reviewed at:** `9ea6c53a` (MP-31 fix, the 2026-09-30 out-of-rotation
review above — pass 7 itself, PR #2605, made no application-code change).
`git log 9ea6c53a..HEAD -- <scope files>` found a real delta: 543
insertions / 82 deletions across `membership_pipeline.py` (+57/-18),
`models/membership_pipeline.py` (+4), `schemas/membership_pipeline.py`
(+123/-3) and `membership_pipeline_service.py` (+438/-61,
`prospect_privacy.py` and `utils/prospect_fields.py` unchanged), landed in
nine real commits plus two merges. This session's shallow clone does not
reach further back than `109f553a` (2026-09-25), so the diff is bounded at
`9ea6c53a` rather than pass 7's own baseline — the 2026-09-30 out-of-rotation
write-up above already independently covers every commit between the two,
including `9ea6c53a` itself.

**What changed, read in full:**

| Area                            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Files                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Conversion outcomes             | A pipeline can now configure, per applicant track (`operational`/`administrative`), the `(member_class, member_status)` a converted applicant becomes — `PipelineConversionConfig`/`resolve_conversion_outcome` in the schema, a new nullable `conversion_config` JSON column, `_conversion_outcome`/`_do_transfer` reading it, and `TransferProspectRequest.member_class`/`member_status`/`notes` letting the Convert dialog override it explicitly                                | endpoint, service, models, schemas |
| Purge rewrite                   | `purge_inactive_prospects` now matches `INACTIVE` (was `WITHDRAWN` — the button deleted nothing), locks the candidate rows (`with_for_update`), removes each prospect's document files from disk before the row delete, and the endpoint now audit-logs the purge (count + requested ids, never applicant PII)                                                                                                                                                                      | endpoint, service                  |
| Election package on stage entry | A new `ensure_election_package_on_entry`/`_stage_election_package` pair creates the election package the moment an applicant lands on an Election Vote stage — called from every path that moves `current_step_id` (single/bulk advance, skip, Back, stageless placement, a deleted-step fallback, pipeline creation) — instead of only the frontend's old separate post-Advance request. Idempotent via a locked existence check (prospect+step), so no path can double-create one | service                            |
| Election advance gate           | `_assert_election_decided` now also refuses to advance off an Election Vote stage with **no** package at all (previously it only checked a package's _status_)                                                                                                                                                                                                                                                                                                                      | service                            |
| Interview update                | `update_interview` moved from five individually-`is not None`-checked positional params to `InterviewUpdate.model_dump(exclude_unset=True)` through `apply_updates` with a new `_INTERVIEW_PROTECTED_FIELDS` skip list — closing the CLAUDE.md Pitfall #1 "omit vs. explicit null" gap (a cleared note previously didn't persist)                                                                                                                                                   | endpoint, service                  |
| Deactivated-member uniqueness   | The username/email-generation loops and the new pre-insert email-collision check in `_do_transfer` no longer exclude `User.deleted_at.is_(None)` — a deactivated member's username/email now correctly collides rather than being silently reused and failing the insert as a bare 500                                                                                                                                                                                              | service                            |
| Display name                    | `performer_name`/`interviewer_name`/`linker_name` now read `User.display_name` (preferred name) instead of hand-assembling `first_name last_name`; the applicant-match helper (`check_existing_members`) deliberately keeps `full_name` (legal name), with a comment explaining staff compare it against the applicant's legal name                                                                                                                                                 | endpoint, service                  |

**Authorization re-derived, not assumed, for the two new write surfaces:**

- **Conversion outcomes are classification, not a grant.** `member_class`/
  `member_status` are closed `Literal` enums in both
  `PipelineConversionConfig` and `TransferProspectRequest` — no open string
  reaches the column. Tracing `_do_transfer`: choosing `member_class=
"administrative"` does not grant anything by itself — it _refuses_ to
  also apply an operational `rank` (`ADMINISTRATIVE_RANK_MESSAGE`), since
  rank is what resolves to `DEFAULT_POSITIONS`-seeded permissions
  (CLAUDE.md Pitfall #23). The actual permission grant on conversion is
  still `role_ids`, unchanged by this diff and still run through
  `_enforce_role_grant_ceiling` — confirmed the frontend's
  `convertToMember` still sends `role_ids: [data.target_role_id]`
  unconditionally. MP-31's ceiling fix is therefore untouched by this
  surface: there is no path from "pick a conversion class" to "hold a
  permission the caller doesn't already have the ceiling for."
- **`transfer_prospect` and `purge_inactive_prospects` are unchanged on
  authorization** — both still gate on `require_permission("members.manage",
"prospective_members.manage")`, matching pass 7's enumerated set; neither
  permission string widened.
- **Tenant isolation on every new/changed by-id site:** `_conversion_outcome`
  reads `MembershipPipeline.conversion_config` filtered on both
  `pipeline_id` **and** `prospect.organization_id` (defense-in-depth beyond
  the already-org-scoped `prospect`); the new email-collision check in
  `_do_transfer` filters `User.organization_id == prospect.organization_id`;
  `purge_inactive_prospects`'s row-lock select now filters
  `ProspectiveMember.organization_id == organization_id` explicitly (an
  addition — pass 7 had already confirmed the pre-existing `pipeline_id`
  filter was sufficient on its own, since pipelines are exclusively
  single-org, so this is defense-in-depth, not a fix) in addition to
  `pipeline_id`; `ensure_election_package_on_entry`/
  `_stage_election_package` key everything off the already-org-scoped
  `prospect.id`. No new by-id query reachable from client input skips an
  org filter.
- **Race safety on the two new locking reads:** `purge_inactive_prospects`'s
  row-select uses `.with_for_update()` before the file/row deletes
  (Pitfall #27 — a reactivation racing a purge is serialized rather than
  silently losing one side); `ensure_election_package_on_entry`'s
  existence check is itself `.with_for_update()`, so two concurrent moves
  onto the same vote stage for the same prospect cannot both decide "no
  package yet" and double-create one.

**Migration:** `20260930_0111_601fdb28ab8c_add_pipeline_conversion_outcomes.py`
adds the nullable `conversion_config` column, correctly guarded on
`_has_table(...) and not _has_column(...)` for the `create_all`-built-table
case (Pitfall #26); downgrade is symmetric. No seeded-grant change, no
nested-JSON-mutation site (the column is written whole via
`model_dump()`/`copy.deepcopy()`, never mutated in place).

**No new `.ilike()`/`.like()` without `escape=`, no raw `csv.writer`, no
`window.confirm`/`alert`/`prompt`** in any changed backend or frontend file
(grepped fresh over `membership_pipeline*.py` and
`frontend/src/modules/prospective-members/`).

**Route enumeration (added by the second session, checklist §1):** an AST
walk of every `@router.(get|post|put|patch|delete)` decorator through its
`Depends` calls found **53 routes**, not the 52 pass 7 counted — one new
route, `GET /my-sign-offs` (added 2026-09-28, inside this pass's own
reviewed window but not called out by the diff-table above, which tracked
file-level changes rather than route-level ones). That route is where
MP-32, below, was found.

### MP-32 — LOW/MEDIUM — `GET /my-sign-offs` did not hide the caller's own application — ✅ FIXED

**What:** `list_my_sign_offs` (`membership_pipeline.py:1268`) returns, for
each `ACTIVE` applicant on a Multi-Signer Approval stage, the applicant's
name/pipeline/stage when the caller holds a role that stage still needs
signed. The route carries no `{prospect_id}` path parameter, so the
router-level `block_self_prospect_access` dependency
(`membership_pipeline.py:108`) — which exists specifically to stop a member
reading the record that describes _them_ — never runs for it, the same gap
`block_self_interview_access` was added to close for
`/interviews/{interview_id}` (documented in `prospect_privacy.py`'s own
module docstring). Unlike every other list/aggregate route in this file
(`/widget-summary`, the kanban board, `/stats`, `/source-events`,
`/prospects`, both bulk routes, `/election-packages` — all eight depend on
`get_hidden_prospect_ids`), `list_my_sign_offs` applied no such filter.

**Failure scenario:** an officer who holds an approval role a stage asks
for (Chief, President, …) and who also has an `ACTIVE` application of their
own — matched via the same email, or the same first/last name plus date of
birth, that `self_prospect_predicate` already uses for every other
self-access check — on a Multi-Signer Approval stage naming their own role
as a required signer, would see their own name and stage appear in their
own `/my-sign-offs` list: exactly the fact (a pending application, which
pipeline, which stage) `prospect_privacy.py`'s module docstring says a
member "must never be able to read" about their own file.

**Fix:** added the same `hidden_prospect_ids: set[str] =
Depends(get_hidden_prospect_ids)` dependency every sibling list route
already carries, filtering the service's (deliberately unfiltered — other
internal callers may want the whole list) result at the endpoint, matching
`pipeline_widget_summary`'s own in-Python filtering idiom rather than
pushing the exclusion into the service's query (declined for this fix's
size — the result set is already small, bounded by "stages waiting on one
person's signature," unlike the paginated lists that filter in SQL).

**Test:** `tests/test_prospect_conversion_gate.py::TestMySignOffsHidesTheCallersOwnApplication`
— an applicant whose email matches a chief's own, on the Multi-Signer stage
requiring "chief." Confirms the **service** layer (`list_pending_sign_offs`)
still returns the match unfiltered — proving the fix is in the endpoint,
not a service-level change other callers would silently inherit — then
confirms the **endpoint**, called as that chief, returns `[]`. Independently
confirmed to fail against the pre-fix endpoint (`git stash` on
`membership_pipeline.py` only, test left in place — the endpoint returned
the one entry) before the fix, and to pass after.

### `member_class`/`member_status` on transfer — reviewed again for an MP-31-shaped escalation, same conclusion

Re-confirmed the first session's own tracing: no permission grant anywhere
in `app/core/permissions.py` or `app/models/user.py` is keyed on
`member_class`/`member_status` — both are read only by scheduling
eligibility, election voter eligibility, ID-card rendering and
membership-tier accrual. Permission grants on the new account remain
exclusively `role_ids`/`target_role_id`, both still under MP-31's ceiling
check, independently re-confirmed present and unchanged at
`membership_pipeline_service.py:3928-4325`. Not a finding.

### Flagged items re-verified, unchanged (no new fix, no regression)

- **MP-10** (unbounded `list_election_packages`/`create_election_package`) —
  `list_election_packages` (`membership_pipeline_service.py:6909`) still has
  no `LIMIT`/`OFFSET`. Unaffected by this pass's diff. Still open;
  `docs/KNOWN_LIMITATIONS.md`'s entry matches current code.
- **MP-19's `/widget-summary` half** — `pipeline_widget_summary`
  (`membership_pipeline.py:122-178`, shifted from pass 7's `:119` by
  unrelated earlier growth, not this pass's diff) still runs an unbounded
  full-row `ProspectiveMember` scan. Citation refreshed in
  `KNOWN_LIMITATIONS.md`; no content change.
- **MP-22** (a document delete can lose the file if the commit fails after a
  successful `os.remove`) — `delete_prospect_document` untouched by this
  pass's diff; ordering unchanged. **This pass's own `purge_inactive_prospects`
  rewrite carries the same tradeoff** (files removed from disk before the
  row delete/commit) for the same reason — not a second finding, recorded
  in `docs/KNOWN_LIMITATIONS.md` alongside the original so the two sites
  aren't independently rediscovered later.
- **MP-26** (the narrowed multi-`election_vote`-stage ambiguity) —
  `_election_block_reason` was refactored this pass (split into
  `_latest_election_package_status` for reuse by the new no-package advance
  gate) but its return value and callers are unchanged; traced the new
  helper line by line to confirm the extraction is behavior-preserving. The
  new "no package at all" advance refusal added this pass does not touch
  which _stage's_ package counts — a strictly separate question MP-26 already
  isolated — so this finding's own scope is unaffected either way.

No new flags beyond MP-32 above. All four re-derived from current code this
pass, not copied from the prior write-up.

### Verified good ✅ (pass 8)

- **Both new write surfaces (conversion outcomes, purge rewrite) hold up
  under independent re-reading**: the conversion-outcome addition cannot be
  used to acquire a permission beyond the caller's own ceiling (traced
  through `is_administrative`/rank resolution/`role_ids`, not asserted);
  the purge rewrite closes a real correctness bug (`INACTIVE` vs.
  `WITHDRAWN`) while adding a row lock, a file-then-row delete order
  consistent with `delete_prospect_document`'s own established pattern, and
  audit logging it previously lacked.
- **The server-side election-package-on-entry feature removes a real,
  previously-unflagged gap**: every non-single-Advance path onto an
  Election Vote stage (bulk advance, skip, Back, stageless placement, a
  deleted-step fallback, pipeline creation landing directly on a vote
  stage) used to leave the applicant with no package at all unless the
  frontend's old separate request happened to run; it is now created in
  the same transaction as the move, idempotently, under a row lock.
- **The interview-update migration to `apply_updates` and the two
  deactivated-member uniqueness fixes are both correctness fixes matching
  CLAUDE.md's own documented patterns** (Pitfall #1's omit-vs-null
  distinction; a deactivated member's identifiers still occupying the
  unique index), not new findings.

### Completion gate (pass 8)

| Check                                                                                                                                             | Result                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                          | pass, 0 violations                                                        |
| `python3 -m black --check app/ tests/ alembic/`                                                                                                   | pass, 1882 files unchanged                                                |
| `python3 -m isort --check-only app/ tests/ alembic/`                                                                                              | pass, 0 violations                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                 | pass — 512 revisions, single head `34d3d56d1479` (no migration this pass) |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                 | pass — 245 routes checked, 0 errors, 0 warnings                           |
| cross-cutting guard tests (org-scoping ratchet, LIKE escaping, CSV sweep, capacity locking, endpoint-auth coverage, permission-gate branch sweep) | 72 passed                                                                 |
| scoped pytest (`-k "membership or prospect or pipeline or election"`)                                                                             | 1517 passed / 1 skipped (`py_vapid`) / 0 failed (+1 for MP-32's new test) |
| full backend unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                        | pass — 12,660 passed, 1 pre-existing skip (`py_vapid`), 0 failed          |
| `cd frontend && npm run typecheck`                                                                                                                | pass, 0 errors                                                            |
| `cd frontend && npm run lint`                                                                                                                     | pass, 0 errors, 0 warnings                                                |
| scoped frontend suite (`npx vitest run src/modules/prospective-members`)                                                                          | 259 passed (32 files)                                                     |

Application source **did** change in this PR's final form: MP-32's one-line
dependency addition plus the filter in `list_my_sign_offs`
(`membership_pipeline.py`) and its guard test
(`tests/test_prospect_conversion_gate.py`). Every other check above still
verifies the real delta that landed since pass 7/MP-31; the counts in this
table are the final, post-MP-32 numbers (re-run after that fix, not the
first session's own pre-fix numbers).

---

## Pass 7 (2026-09-16) — 0 fixed, 0 new flagged, all 4 standing FLAGGED items re-verified unchanged

**Watchdog note.** This iteration ran as a one-off watchdog pass (the
`/loop 30m /security-review` session that normally drives this rotation had
stalled for over 3.5 hours with no open PR), not a routine lap. Followed the
same Step 0–9 procedure as every other pass.

**Scope confirmation.** Rotation table row 08 (`membership_pipeline.py`,
`membership_pipeline_service.py`) plus this feature's own established
additional scope: `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`,
`utils/prospect_fields.py`.

**Last reviewed at:** `bcbeb9c` (MP-30 fix, PR #2555, merged 2026-09-14).
`git log bcbeb9c..origin/main -- <scope files>` found exactly two commits
touching the declared scope, both ordinary feature work, both independently
tested and merged before this pass, neither previously run through this
rotation:

| Commit    | What                                                                                                                                                                                                                                                                                                                  | Files                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `4b7bd1a` | A repo-wide sweep (`test_permission_gate_branch_sweep.py`) admitting a `.manage` grant to reads that branch on it; the one hit in this feature's scope widened `GET /prospects/{id}/events` from `prospective_members.view` alone to `.view` **or** `.manage`                                                         | `membership_pipeline.py` (+4/-2)                    |
| `70affbf` | Closed a gate bypass: `bulk_advance_prospects` inherited the single-Advance meeting-attendance exemption it should not have, so a bulk selection could walk an applicant past an unattended interview stage with no per-applicant judgement behind it. New `unobserved`/`automated` plumbing, 5 new integration tests | `services/membership_pipeline_service.py` (+40/-11) |

Both were read in full rather than trusted from their commit messages (see
below), since a fix that closes a gate on one path and a widened grant are
exactly the two shapes this rotation exists to catch if done wrong.

### Re-verification performed this pass

Re-enumerated all 52 routes programmatically (AST walk of every
`@router.(get|post|put|patch|delete)` decorator through to its `Depends`,
not a diff against pass 6's count) — **unchanged from pass 6's 52**, every
route still either `require_permission(...)`-gated or the one documented
exception (`approve-step`, MP-11's fix intact, `Depends(get_current_user)`
only with the minimal `StepApprovalResponse` it must return). Router-wide
`block_self_prospect_access` (`membership_pipeline.py:95`) and the dedicated
`block_self_interview_access` on `PUT`/`DELETE /interviews/{id}` both still
present.

**`4b7bd1a`'s widening, read directly:** `list_prospect_event_links` now
requires `prospective_members.view` **or** `.manage`. This corrects an
inconsistency rather than opening a new hole — the sibling write route
(`POST /prospects/{id}/events`, `link_event_to_prospect`) was already gated
on `.manage` alone, so a `.manage`-only holder (four seeded positions:
president, secretary, vice president, membership coordinator — none of which
is separately seeded `.view`) could create a link and not read it back. No
other route in this feature's file was touched by that commit.
`service.list_event_links` remains org-scoped through `get_prospect(...,
organization_id)` before the `ProspectEventLink` query, unchanged.

**`70affbf`'s gate closure, traced end to end:** `bulk_advance_prospects` →
`_bulk_apply` → per-item `advance_prospect(..., unobserved=True)` →
`complete_step(..., automated=unobserved)` → `_validate_step_completion`'s
`elif step_type == MEETING and automated: await
self._assert_meeting_attended(...)`. Confirmed the single-item `POST
/prospects/{id}/advance` path still calls `advance_prospect` with
`unobserved` defaulted to `False` (`automated=False`), so the deliberate,
by-design single-coordinator exemption ("watched somebody walk in") is
unaffected — only the bulk path newly participates in the gate.
`_assert_meeting_attended` itself is unchanged since pass 6 and remains
org-scoped (`Event.organization_id == prospect.organization_id` on the
attendance join, re-read at
`services/membership_pipeline_service.py:1927`).

**Fresh checklist-driven re-read, not limited to the diff** (per this pass's
own honesty requirement — a diff-only read would miss a defect sitting
unchanged in code neither commit touched): re-walked upload/download
(`add_prospect_document`/`download_prospect_document` —magic-byte check via
`magic.from_buffer`, 50MB cap, UUID filename with a MIME-derived extension
never the client's own, realpath-under-`PROSPECT_DOCUMENT_DIR` traversal
guard on download, cleanup-on-failure), the three LIKE sites
(`ProspectiveMember.first_name/last_name/email.ilike` at
`membership_pipeline_service.py:1097-1101` and
`TrainingProgram.name.ilike("%probationary%", ...)` at `:3523` — both use
`like_pattern()`/a static literal with `escape=LIKE_ESCAPE_CHAR`), the two
`= dict(...)` sites (`list_pipelines`' count-tuple dict at `:310`, not a JSON
column; `update_election_package`'s `applied = dict(updates)` at `:5617`,
a plain request-payload copy that reaches `package_config` only through a
`copy.deepcopy(pkg.package_config or {})` merge before `apply_updates` —
Pitfall #12 correctly applied), all `ondelete="SET NULL"` columns in
`models/membership_pipeline.py` (every one paired with `nullable=True`),
`purge_inactive_prospects` (requires `confirm: true`, resolves
`pipeline_id` org-scoped via `get_pipeline` first, and the delete's
`prospect_ids IN (...)` filter is additionally constrained by that same
`pipeline_id` — so a foreign prospect id cannot match even without a direct
`organization_id` predicate, since pipelines are exclusively owned by one
org), and `record_step_approval`/`_authorized_multi_approval_result`
(replaces any client-claimed approver identity with the authenticated
signer, validates the signer is an active member of the caller's own org,
and checks the role against the signer's **own** positions — not a
client-supplied claim).

No new finding surfaced from any of the above; each matches a pattern this
file already established as correct in an earlier pass, re-derived rather
than assumed.

### Flagged items re-verified, unchanged (no new fix, no regression)

- **MP-10** (unbounded `list_election_packages`/`create_election_package`,
  no pagination or per-prospect cap) — `list_election_packages`
  (`membership_pipeline_service.py:5661`) still has no `LIMIT`/`OFFSET`.
  Unaffected by either of this pass's two commits. Still open;
  `docs/KNOWN_LIMITATIONS.md`'s entry matches current code.
- **MP-19's `/widget-summary` half** — `pipeline_widget_summary`
  (`membership_pipeline.py:119`) still runs
  `select(ProspectiveMember).where(organization_id == ...)` with no bound,
  materializing every prospect row (full PII columns) just to count them,
  gating the per-applicant `details` list on `prospective_members.manage`
  via `user_has_permission` rather than the route's own permission
  dependency. Unchanged. The sibling `/pipelines` fix (aggregate `count()`
  query, no eager `prospects` load, confirmed at `:305-312`) remains intact.
- **MP-22** (a document delete can lose the file if the commit fails after a
  successful `os.remove`) — ordering unchanged
  (`delete_prospect_document`/`os.remove` still precedes the DB
  delete/commit); still a deliberate open tradeoff per
  `KNOWN_LIMITATIONS.md`.
- **MP-26** (the narrowed multi-`election_vote`-stage ambiguity) — still
  open exactly as narrowed in pass 4 round 4; the MP-30 gate and its shared
  `_election_block_reason` helper both operate on the prospect's latest
  election package regardless of which stage governs `package_fields`, a
  separate question this item's own narrowing already isolated.

No new flags. All four re-derived from current code this pass, not copied
from the prior write-up.

### Verified good ✅ (pass 7)

- **Route count and gating are unchanged from pass 6 (52/52)**, re-derived
  by a fresh AST walk of the endpoint file rather than trusted from the
  prior count.
- **Both commits landed in this feature's scope since pass 6 hold up under
  independent re-reading**: the permission widening closes an inconsistency
  (a `.manage` holder who could write but not read their own link) without
  opening a new one, and the bulk-advance gate closure removes a real,
  previously-unflagged side door around the meeting-attendance gate without
  weakening the single-item exemption it deliberately preserves.
- **All patterns re-checked this pass (uploads, LIKE escaping, JSON-column
  mutation, SET NULL nullability, the purge/bulk by-id operations, and the
  approval signer's own-role check) still match the correct shape this file
  already established** — named per class above, not asserted in the
  abstract.

### Out-of-scope, discovered incidentally — not fixed here

Running the full backend suite (beyond this feature's own scoped tests, as
an extra check given the size of the service file) surfaced **3 pre-existing
failures in `tests/test_driver_exception_service.py`**
(`TestReviewException::test_approves_a_pending_request`,
`::test_a_concurrent_reviewer_cannot_also_win`,
`::test_the_decision_update_is_conditional_on_still_pending`), reproducible
in isolation with zero code changes applied. Root cause: the fixture hardcodes
`valid_until=date(2026, 9, 15)` and the service correctly refuses to approve
an exception whose end date is already in the past — the fixture's date
rolled into the past between pass 6 (2026-09-14) and this pass (2026-09-16).
This is a time-bomb test bug, not a security defect, and it sits in
`app/services/driver_exception_service.py` / its own test file — no file
either declared or actually touched by this feature. Left unfixed here per
this iteration's scope (fixing an unrelated module's test fixture inside a
membership-pipeline security-review PR would blur the PR's own review
surface); reported here and in the Step 9 summary so it is not silently
dropped. **Escalated, not ignored** — a follow-up (any rotation iteration
touching that file, or a standalone fix) should replace the hardcoded date
with one computed relative to the test's own run time.

### Completion gate (pass 7)

| Check                                                                                                                                                                                               | Result                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/`                                                                                                                                                            | pass, 0 violations                                                                                                                                                                                                           |
| `python3 -m black --check app/ tests/ alembic/`                                                                                                                                                     | pass, 1598 files unchanged                                                                                                                                                                                                   |
| `python3 -m isort --check-only app/ tests/ alembic/`                                                                                                                                                | pass, 0 violations                                                                                                                                                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                   | pass — 444 revisions, single head `6ab7d903fae5` (no schema change this pass)                                                                                                                                                |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                   | pass — 228 routes checked, 0 errors, 0 warnings                                                                                                                                                                              |
| cross-cutting guard tests (org-scoping ratchet, LIKE escaping, CSV sweep, capacity locking, endpoint-auth coverage, permission-gate branch sweep, election-vote gate, bulk-advance attendance gate) | 88 passed                                                                                                                                                                                                                    |
| scoped pytest (`-k "membership or prospect or pipeline or election"`)                                                                                                                               | 1180 passed / 1 skipped (`py_vapid`) / 0 failed                                                                                                                                                                              |
| full backend suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                               | 10196 passed / 1 skipped (pre-existing `py_vapid`) / **3 failed — pre-existing, unrelated, out-of-scope** (`test_driver_exception_service.py`, see above) / 2433 deselected                                                  |
| `cd frontend && npm run typecheck`                                                                                                                                                                  | pass, 0 errors (aliased 7.0.2 compiler) — run because a frontend file inside this feature's module (`modules/prospective-members/types/index.ts`) changed since pass 6, though outside the four declared backend scope files |
| `cd frontend && npm run lint`                                                                                                                                                                       | pass, 0 errors, 0 warnings                                                                                                                                                                                                   |

No source files in this feature's scope changed this pass — every check
above is a re-verification, not a fix. The only defect found (the
driver-exception date fixture) is outside this feature's file set and is
reported rather than fixed, per this iteration's scope.

---

## Pass 6 (2026-09-14) — 1 fixed (MP-30, HIGH), 0 new flagged (4 prior FLAGGED/narrowed items re-verified unchanged)

**Naming note:** this is the rotation tracker's "pass 5" of the current
second-lap cycle (`docs/security-review/PROGRESS.md`'s rotation table and Log
use that label) — but this feature's own history already has a section
titled "Pass 5" (2026-09-08, MP-27/28/29). Numbered **Pass 6** here to keep
this doc's own sequence unambiguous, matching how `USR-07`/`ELEC-06` numbered
their own second-lap sections 5 rather than reusing an earlier number.

**Scope confirmation.** Rotation table row: `08 | Membership pipeline | MP |
membership_pipeline.py, membership_pipeline_service.py | ✅`. Prior passes'
own declared scope additionally covers `models/membership_pipeline.py`,
`schemas/membership_pipeline.py`, `api/prospect_privacy.py`, and
`utils/prospect_fields.py` — kept here for continuity, since the two
rotation-table files do not stand alone (the endpoint imports the schemas,
the service imports the models, and the router installs
`prospect_privacy.py`'s guard).

**Last reviewed at:** `4e281e3b3` (MP-29 round 4, PR #2413, merged
2026-09-08). `git log --oneline 4e281e3b3..origin/main -- <scope files>`
found real, substantial feature growth since then — not a quiet period:

| File                                                  | Diff                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `services/membership_pipeline_service.py`             | +691/-45                                                |
| `api/v1/endpoints/membership_pipeline.py`             | +61/-9                                                  |
| `models/membership_pipeline.py`                       | +19/-1                                                  |
| `schemas/membership_pipeline.py`                      | +15/-0                                                  |
| `api/prospect_privacy.py`, `utils/prospect_fields.py` | byte-identical (confirmed via `git diff --stat`, empty) |

Nine commits (`98d218c6c` through `933640397`), all ordinary feature work —
never run through this rotation — adding: a hard completion gate on the
`election_vote` stage type (nothing previously read
`ProspectElectionPackage.status` when deciding whether an applicant could
advance); a completion gate requiring genuine recorded attendance before an
**automated** advance off a `meeting` stage (manual advance is still an
escape hatch there, by design — unlike the election gate); a new
`POST /prospects/{id}/assign-stage` recovery route for an applicant a
pipeline-edit left on no stage at all; a `UNIQUE(pipeline_id, sort_order)`
constraint plus a full concurrency-locking rework of `add_step`/
`delete_step`/`reorder_steps` (a locked pipeline-row read, then a _separate_
locked, current read of the step list — `_load_steps_for_update` — since a
parent-row lock alone does not refresh a plain SELECT's REPEATABLE READ
snapshot); and resolution of legacy `step_type='action'` stages
(`effective_step_type`) so the new gates and existing auto-advance triggers
apply to them too. Every one of these was already independently reviewed and
hardened through multiple rounds of Codex review before landing — the commit
messages (`933640397`, `41508f9f2`, `5c5a7e966`, `925c13021`, `99e850abf`)
document real defects Codex found and fixed pre-merge (an early-arrival
check-in window bug, a same-slot `add_step` race, a `sort_order`-default
bug, a MySQL-8.0-specific index-drop failure, a `StaleDataError` on
concurrent stage deletion) with guard tests for each, independently spot-
verified rather than trusted on the commit's own say-so — see Verified good.

This pass targeted the three areas named in this iteration's brief plus a
fresh look at the new completion gates, given "can a stage be skipped via a
side door" is exactly what a brand-new hard gate needs checked against.

### MP-30 — HIGH — the election-vote gate protects `complete_step`, not the "Convert" action that is the ordinary way to finish a pipeline — ✅ FIXED

**What:** `933640397`/`c5e30c0a3` added `_assert_election_decided`, called
from `_validate_step_completion` only when the current stage's (resolved)
type is `ELECTION_VOTE` — i.e., only on the path through `complete_step`
(`advance_prospect`, `bulk_advance_prospects`, `approve_step`, the
integration-webhook auto-advance). It does **not** run on
`transfer_to_membership` / `_do_transfer` (`POST /prospects/{id}/transfer`),
which has no stage-awareness at all — it only refuses when
`prospect.status == TRANSFERRED`.

That would be a narrow residual gap if `transfer_to_membership` were a rare,
break-glass path. It is not — it is the **documented, primary** way to
finish a pipeline whose last stage is not on `auto_transfer_on_approval`.
`skip_current_step`'s own refusal message says so directly: `"The final
stage cannot be skipped; convert or reject instead"`. The frontend matches:
`ProspectiveMembersPage.tsx`'s `isLastStage` (current stage equals the
pipeline's last stage by `sort_order`) swaps the primary action button from
Advance to Convert (`ApplicantActionPanels.tsx:150-154`,
`handleAdvance: if (isLastStage) { onConvert(applicant); return; }`), and
Convert opens `ConversionModal`, whose only backend call is
`applicantService.convertToMember` → `POST /prospects/{id}/transfer`. For a
pipeline whose final stage is the `election_vote` stage — the exact
configuration the gate's own commit message names as the motivating,
worst-case scenario ("the one stage whose entire purpose is to make the
membership vote binding") — the frontend's normal completion flow **never
calls `complete_step` at all**, and so never reaches the new gate.

**Failure scenario:** a department configures a pipeline ending in an
`election_vote` stage, holds the vote, and the board rejects the applicant
(`ProspectElectionPackage.status = "not_elected"`). A coordinator (or bulk
sweep, or a compromised `members.manage`/`prospective_members.manage`
session) opens the applicant, clicks the button now reading "Convert" —
exactly the button the UI presents as the normal way to finish this stage —
and the applicant becomes a full `User` record: department email generated,
temporary password issued, welcome email optionally sent, default `member`
role attached. The vote the department just held is worth nothing. The same
gap blocks nothing for `"added_to_ballot"` either — an applicant still
awaiting the vote's outcome can be converted before the ballot even closes.

**Where:** `_do_transfer`, `membership_pipeline_service.py` (pre-fix: no
election check anywhere in the method).

**Fix:** the existing `_ELECTION_BLOCK_REASON` lookup was split out of
`_assert_election_decided` into a shared, non-raising
`_election_block_reason(prospect) -> Optional[str]` — the same
latest-package-by-`created_at` read `get_election_package` uses for the
applicant drawer (CLAUDE.md Pitfall #29: one definition, not a second one
that can drift). `_assert_election_decided` now just raises off it, unchanged
behavior for the `complete_step` path. `_do_transfer` calls the shared
helper first and, on a block, returns `{"success": False, "message": ...}` —
matching this method's own established refusal shape for every other
business-rule block (a rank not configured, an administrative/rank pairing,
a duplicate member match), which is what the endpoint's existing `if not
result.get("success"): raise HTTPException(400, detail=result.get(
"message"))` already surfaces to the caller with no endpoint change needed.
Placed as the very first check in `_do_transfer` — ahead of the rank/
duplicate-member checks — since it is the one board-decision fact that
should end the request before any of that work runs.

This protects both doors uniformly: the `complete_step` → `_do_transfer`
auto-transfer path already passed through `_validate_step_completion`'s gate
before reaching `_do_transfer`, so the added check there is a no-op replay
of a decision already made (verified — see tests below) — and the
previously-unchecked `POST /prospects/{id}/transfer` path is now covered by
the same read, not a re-derived copy of it.

**Considered and declined:** gating only when the prospect's _current_
stage is the `election_vote` stage, to mirror `_validate_step_completion`'s
own dispatch exactly. Declined: `_election_block_reason` is already
prospect-scoped, not stage-scoped (it does not filter by `step_id`), which
is deliberate upstream design — the same "latest package, not the current
stage's package" rule `get_election_package` uses for the drawer, so a
non-elected applicant who has since been manually moved past the vote stage
(by whatever means) is still blocked, rather than only blocked while
literally parked on the vote stage. A pipeline that never uses the election
feature has no `ProspectElectionPackage` rows and this check is a no-op —
confirmed by a dedicated regression test.

Covered by three new integration tests (real MySQL, `db_session`, marked
`integration` per the file's existing `pytestmark`) added to the existing
`backend/tests/test_election_vote_stage_gate.py`, alongside the file's own
`complete_step`-path tests: `test_manual_transfer_refuses_an_undecided_or_
failed_vote` (parametrized `added_to_ballot`/`not_elected`, asserting
`{"success": False, "message": <fragment>}` and that the prospect stays
`ACTIVE` with `transferred_user_id is None`), `test_manual_transfer_still_
works_once_the_vote_clears` (an `"elected"` package still transfers
successfully — the gate narrows, it does not newly block the ordinary
case), and `test_manual_transfer_unaffected_with_no_election_package` (a
pipeline with no election package at all — the overwhelmingly common
case — is unaffected). The two refusal-parametrized cases were independently
confirmed to fail against the pre-fix code (`git stash` on
`membership_pipeline_service.py` only, tests left in place — the transfer
silently succeeded, `result["success"] is True`, exactly the failure
scenario above) before the fix was applied; the unaffected-case tests were
confirmed to already pass unchanged against that same pre-fix code, so the
fix is additive rather than accidentally masking other behavior.

### Verified good ✅ (re-confirmed, and newly reviewed)

- **MP-27/MP-28/MP-29 locks are unchanged.** `update_prospect`,
  `set_prospect_status`, and `bulk_set_prospect_status`'s `_set_status`
  closure all still call `get_prospect(..., lock_for_update=True)` ahead of
  the `TRANSFERRED` guard; `_bulk_apply`'s rejected-item branch still
  `commit()`s (never `rollback()`s) before continuing the loop. Byte-for-byte
  unchanged since pass 5 (confirmed — none of the nine new commits touch
  these methods).
- **The new `add_step`/`delete_step`/`reorder_steps` locking is sound.**
  Independently traced the lock order on all three: `get_pipeline(...,
lock_for_update=True)` (the parent row) always precedes
  `_load_steps_for_update` (the steps, also locked, also
  `populate_existing=True` so a stale identity-mapped instance from this
  transaction's own earlier read is refreshed rather than reused) — the same
  order on every path, so none of the three can deadlock against each other.
  `_renumber_steps_densely`'s two-phase park-on-negatives-then-assign write
  is what makes a reversal or a gap-closing renumber survive the new
  `UNIQUE(pipeline_id, sort_order)` constraint (MySQL checks uniqueness per
  statement, no deferral) — reasoned through by hand against a 3-stage
  reversal and confirmed against `test_prospect_stage_movement.py`/
  `test_pipeline_step_renumber_race.py`, not merely trusted from the commit
  message.
- **The stranded-prospect read in `delete_step` is correctly a locking read
  scoped by `organization_id`, not only `current_step_id`.** Confirmed the
  comment's own claim: `current_step_id` carries no index, and the added
  `ProspectiveMember.organization_id == organization_id` predicate is what
  keeps a stage deletion's `FOR UPDATE` from next-key-locking every
  prospect row in every organization rather than one org's narrow range —
  checked against `idx_prospect_org_status` actually covering
  `(organization_id, status)` in `models/membership_pipeline.py`, which it
  does.
- **`assign_stage` (the new recovery route) cannot be used to skip a gate.**
  It refuses outright when `prospect.current_step_id` is already set
  (`ValueError`, "already on a stage"), so it only ever fires from the one
  state — no stage at all — that `delete_step`'s own fallback can produce
  when a pipeline's last remaining stage is deleted out from under a
  prospect. It performs no completion, no transfer, and no auto-advance
  side effect — only `current_step_id` and a fresh `IN_PROGRESS` progress
  row — so placing an applicant on a later stage this way carries no more
  capability than `transfer_to_membership` already has unconditionally (see
  MP-30): a `members.manage`/`prospective_members.manage` holder was never
  gated stage-by-stage on the transfer path to begin with. Org-scoped via
  the already-org-scoped `get_prospect` call and the step lookup being
  restricted to `prospect.pipeline.steps`, so a cross-org or cross-pipeline
  `step_id` cannot resolve. Carries `log_audit_event` at the endpoint
  (`membership_pipeline.prospect_stage_assigned`) and is a `{prospect_id}`
  route, so it inherits the router-level `block_self_prospect_access`
  guard automatically.
- **`_assert_meeting_attended`'s org-scoping.** The `Event`/
  `EventExternalAttendee` join filters `Event.organization_id ==
prospect.organization_id` before any check-in match is attempted, so an
  attendance record from another organization's event can never satisfy
  this gate for a cross-org prospect id (not reachable anyway, given
  `prospect` is already resolved org-scoped by the caller, but confirmed
  rather than assumed).
- **`add_step`'s new `data.model_dump(exclude_unset=True)`** was re-verified
  against every field `add_step` reads — same fallback behavior as before
  for each (matching the fix commit's own claim), not merely trusted.
- **Route inventory:** re-enumerated programmatically — 52 routes (51 + the
  new `assign-stage`), every route still either `require_permission(...)`-
  gated or the one documented auth-only exception (`approve-step`, MP-11's
  fix intact — still returns the minimal `StepApprovalResponse`), every
  `{prospect_id}` route inherits the router-level self-access guard, and
  `PUT`/`DELETE /interviews/{interview_id}` still carry the dedicated
  `block_self_interview_access` dependency (MP-12).
- **`docs/module-audit/` and `docs/app-review/`** re-checked: no open
  finding tied to this feature in either.

### Flagged items re-verified, unchanged (no new fix, no regression)

- **MP-10** (unbounded `list_election_packages`/`create_election_package`,
  no pagination or per-prospect cap) — still open exactly as documented;
  `docs/KNOWN_LIMITATIONS.md`'s entry matches the current code.
- **MP-19's `/widget-summary` half** (full-table scan for aggregate counts
  and the manager-only `details` list) — **fixed 2026-10-11** (owner
  decision): SQL `GROUP BY`/`CASE` counts and a 10-row most-recent `details`
  list with `details_truncated`; was still open at this pass; the sibling
  `/pipelines` fix (aggregate-count query, no eager `prospects` load) is
  still intact.
- **MP-22** (a document delete can lose the file if the commit fails after
  a successful `os.remove`) — still open, deliberate tradeoff; the ordering
  (`os.remove` before the DB delete/commit) is unchanged.
- **MP-26 / the narrowed multi-`election_vote`-stage ambiguity** — still
  open exactly as narrowed in pass 4 round 4; unaffected by this pass's
  changes (the new `_assert_election_decided` gate and `_election_block_
reason` helper both operate on the latest package regardless of which
  stage governs `package_fields`, a separate question from which package
  is "the" one).

No new flags. Every flagged item above was re-derived from the current code,
not copied from the prior write-up.

### Completion gate (pass 6)

| Check                                                                 | Result                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                         | pass, 0 violations                                                                                                                                                                                                      |
| `black --check app/ tests/ alembic/`                                  | pass, 1592 files unchanged                                                                                                                                                                                              |
| `isort --check-only app/ tests/ alembic/`                             | pass, 0 violations                                                                                                                                                                                                      |
| `python3 scripts/validate_migrations.py --strict`                     | pass — 444 revisions, single head (no schema change this pass)                                                                                                                                                          |
| new guard tests (`test_election_vote_stage_gate.py`, +4)              | 12 passed (8 existing + 4 new); the 2 refusal-parametrized new cases independently confirmed to fail against the pre-fix code (`git stash` on `membership_pipeline_service.py`)                                         |
| scoped pytest (`-k "membership or prospect or pipeline or election"`) | 1177 passed / 1 skipped (`py_vapid`) / 0 failed                                                                                                                                                                         |
| full backend suite (`pytest tests/ -q`)                               | 12563 passed / 21 skipped (pre-existing/environmental — docker, API-contract-needs-server, `py_vapid`) / 0 failed                                                                                                       |
| `npm run typecheck` / `npm run lint` (frontend)                       | not run — no frontend file touched this pass (the fix is entirely server-side; the frontend already surfaces `err.message` from a failed `convertToMember` call via `getErrorMessage`/toast with no code change needed) |

## Pass 5 (2026-09-08) — 3 fixed (MP-27, plus MP-28/MP-29 from Codex review of the PR), 0 flagged (3 prior FLAGGED items re-verified unchanged)

**Scope.** Re-verified this feature is at the current head of a five-pass
rotation and that nothing landed against it since pass 4 round 4 (2026-09-02)
beyond one comment-only touch: `git log` on all six files in scope
(`endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, `utils/prospect_fields.py`) since PR #2177 merged
shows exactly one commit, `f8ea3f6` (2026-09-06) — its only touch to this
feature is a stale-comment fix in `transfer_prospect`
(`users.create_member` → `users.create`, matching a permission rename that
happened elsewhere); no functional line changed. Re-enumerated all 51 routes
programmatically (method + path) — identical set to pass 1's inventory, same
50-of-51 `require_permission(...)` count (the one exception, `/approve-step`,
is the same documented intentional auth-only gate MP-11 fixed the response
shape of). `docs/module-audit/membership-pipeline.md` and
`docs/app-review/membership-pipeline.md` re-read: no open findings in either,
consistent with pass 1's original scope note.

This pass specifically targeted the three angles called out for this
iteration: (1) org-scoping on every prospect/applicant by-id lookup, (2)
whether any part of the pipeline is reachable pre-authentication, and (3)
multi-approval/stage-advancement logic for a TOCTOU or duplicate-advancement
race.

**(1) Org-scoping** — re-confirmed via the route inventory (unchanged) and by
re-reading `app/api/prospect_privacy.py` in full: `block_self_prospect_access`
is still wired as the router-level dependency
(`membership_pipeline.py:105`, `APIRouter(dependencies=[...])`), and
`block_self_interview_access` is still wired on both interview-mutation
routes (MP-12). No regression.

**(2) Pre-authentication surface** — two paths, both already covered by prior
passes and re-verified rather than re-derived:

- `GET /public/v1/portal/application-status/{token}`
  (`app/api/public/portal.py:545`) — the token-scoped application-status
  check documented in `docs/module-audit/membership-pipeline.md`'s Notes
  section. Re-confirmed: 256-bit `secrets.token_urlsafe(32)` token
  (`membership_pipeline_service.py:1138`), globally unique+indexed column
  (`models/membership_pipeline.py:286`), IP rate limit applied before the DB
  lookup, `no-store`/`no-referrer`/`noindex` response headers, a 30-day
  sliding TTL, and a response payload limited to first/last name, status, and
  public-visible stage names — no address/DOB/phone/notes/documents.
- The public-form-to-prospect path: `POST /public/v1/forms/{slug}/submit`
  (`app/api/public/forms.py:139`) can, for a "membership interest" form,
  reach `MembershipPipelineService.create_prospect` via
  `FormsService._process_membership_interest`
  (`forms_service.py:1709`). This boundary is new territory for this
  feature's own review (the public-forms endpoint itself is out of scope —
  it belongs to the forms/public-surface feature — but the prospect-creation
  call it makes is squarely this feature's write path). Traced the full
  chain: `organization_id` is taken from the already-org-scoped `form` row,
  never from client input; `pipeline_id` is resolved server-side
  (`_resolve_pipeline_for_form`); the submission endpoint requires a CAPTCHA,
  a 10/minute per-IP rate limit, a honeypot field, and (via
  `enforce_daily_cap=True`) a per-form daily submission cap. `create_prospect`
  itself (`membership_pipeline_service.py:1053`) validates a client-supplied
  `pipeline_id` in-org (MP-2) and `referred_by` in-org (MP2-2/MP-5), and
  handles the duplicate-email race with `begin_nested()` + an `IntegrityError`
  fallback to the racing insert's own row rather than a 500. No finding —
  this boundary is already hardened to the standard the rest of this feature
  holds.

**(3) TOCTOU / duplicate-advancement races — MP-27, found and fixed below.**
Mapped every writer of `prospect.status` and `prospect.current_step_id`
against whether its read is a locking one. `complete_step`,
`regress_prospect`, and `transfer_to_membership` all correctly lock
(pass 1-2's own work); `update_election_package` and
`assign_package_to_election` correctly lock (pass 3-4's work) — but
`update_prospect`, `set_prospect_status`, and `bulk_set_prospect_status`,
the three writers that can set `prospect.status` to an arbitrary caller-chosen
value, all read the prospect with a **plain, unlocked** `get_prospect` call
before evaluating the exact guard (`prospect.status ==
ProspectStatus.TRANSFERRED`) that MP-9/MP-17 exist to enforce.

### MP-27 — HIGH — `update_prospect`/`set_prospect_status`/`bulk_set_prospect_status` read-then-write the TRANSFERRED guard unlocked, reopening the double-transfer race one layer up — ✅ FIXED

**What:** three status-writing paths — `update_prospect`
(`membership_pipeline_service.py:1219`, MP-9's guard),
`set_prospect_status` (`:2276`), and `bulk_set_prospect_status`'s
`_set_status` closure (`:2185`, via `_apply_status_change`) — each read the
prospect with `get_prospect(prospect_id, organization_id)`, no
`lock_for_update`, then check `prospect.status == ProspectStatus.TRANSFERRED`
against that read before writing a caller-supplied target status. Under
InnoDB REPEATABLE READ a plain `SELECT` answers from the transaction's own
snapshot, which does not advance just because another transaction committed
in the meantime — and the eventual `UPDATE` these methods issue carries no
`WHERE status = :old_status` (SQLAlchemy's ORM UPDATE is keyed on `id` alone),
so nothing at the database layer re-checks the guard's premise at write time
either.

**Failure scenario:** a coordinator calls `POST /prospects/{id}/transfer`
(routes to the correctly-locked `transfer_to_membership`). In the window
between that call's own `SELECT ... FOR UPDATE` read and its commit, a
second, unlocked request — `PUT /prospects/{id}` with any body that includes
`status`, or `POST /prospects/{id}/status`, or a `POST
/prospects/bulk-status` sweep that happens to include this prospect —
performs its own plain read, observes the **pre-transfer** status (e.g.
`active`), passes the `!= TRANSFERRED` guard, and at its own commit issues an
unconditional `UPDATE ... SET status = 'rejected' WHERE id = ...` (or
whatever target it was given). That `UPDATE` is not blocked by the transfer's
already-released lock (the transfer committed and released it before this
second transaction's commit), so it succeeds — silently overwriting the
just-committed `transferred` status back to an ordinary applicant status,
**while the transfer's other effects (`transferred_user_id`, a new `User`
row, a welcome email) already happened and are not rolled back.**

The consequence compounds: `transfer_to_membership`'s **only** re-transfer
guard is `prospect.status == ProspectStatus.TRANSFERRED`
(`membership_pipeline_service.py:2461`) — there is no separate check on
`transferred_user_id is not None`, and no unique constraint on that column
(`models/membership_pipeline.py:290`, a plain nullable FK). So once the race
above has clobbered `status` back to a non-`transferred` value, a **second**
`POST /prospects/{id}/transfer` call passes the guard cleanly and calls
`_do_transfer` again — minting a **second** `User` account for the same
prospect, with the second write to `prospect.transferred_user_id` silently
overwriting the first and orphaning it from the prospect record while both
`User` rows remain live. This is exactly the double-transfer defect pass 2's
`transfer_to_membership` lock (Codex-found, that pass) was written to close,
reopened via a side door the earlier fix never touched.

This is not a hypothetical interleaving unique to malicious timing —
`update_prospect` is the module's single most general write path (the
frontend's edit-applicant form posts through it, `status` included per
pass 1's own MP-9 writeup), and `bulk_set_prospect_status` is a
coordinator-facing bulk sweep that runs one status change per selected
prospect in a loop; either landing in the same few-hundred-millisecond
window as a transfer on the same applicant is a realistic double-click /
concurrent-tab scenario for two coordinators working the same pipeline, not
an exotic attack.

**Where:** `update_prospect` (`membership_pipeline_service.py:1227`,
pre-fix), `set_prospect_status` (`:2290`, pre-fix), `bulk_set_prospect_status`
→ `_set_status` (`:2204`, pre-fix, operating on the unlocked prospect
`_bulk_apply` had already fetched for its own "not found"/`full_name`
bookkeeping).

**Fix:** mirrors the established pattern from `complete_step` /
`regress_prospect` / `transfer_to_membership` / `update_election_package` /
`assign_package_to_election` exactly — add `lock_for_update=True` to the read
that precedes the guard:

- `update_prospect` and `set_prospect_status`: their existing
  `get_prospect(...)` call now passes `lock_for_update=True`. No other line
  changed — the guard logic, the write logic, and the response shape are all
  untouched, so this is pure serialization, not a behavior change for any
  legitimate single-request caller.
- `bulk_set_prospect_status`: `_bulk_apply`'s own per-id fetch (shared with
  `bulk_advance_prospects`, which is unaffected — its writes go through the
  already-locked `complete_step`) is left as-is, since it exists only for
  existence-checking and the result row's `name` field. `_set_status` now
  performs its own additional locked re-fetch of the same prospect
  immediately before calling `_apply_status_change`, so the guard always
  evaluates the row under the lock rather than the outer, unlocked copy.

**Considered and declined:** changing `_bulk_apply`'s own shared fetch to
always lock, instead of adding a second, closure-local locked fetch inside
`_set_status`. Declined because `_bulk_apply` is shared with
`bulk_advance_prospects`, whose actual write path (`advance_prospect` →
`complete_step`) already re-fetches and locks independently — always locking
the shared outer fetch would add a lock acquisition with no corresponding
guard evaluation on that path, and widen a shared helper's contract for the
benefit of only one of its two callers. The extra query the chosen fix adds
per bulk-status item is one additional indexed by-id `SELECT ... FOR UPDATE`
in a path that is not a hot loop (a coordinator-triggered admin action, not a
per-request read), so the tradeoff favors the smaller, caller-local change.

Covered by three new source-inspection tests in
`backend/tests/test_membership_pipeline_flow.py`
(`TestTransferToMembership`), matching the file's own established pattern
for `test_transfer_locks_the_prospect_before_checking_status`:
`test_update_prospect_locks_before_checking_transferred`,
`test_set_prospect_status_locks_before_applying_change`, and
`test_bulk_set_prospect_status_locks_before_applying_change` — each asserts
`lock_for_update=True` appears in the method's source and precedes the
guard it protects (the `ProspectStatus.TRANSFERRED` comparison for
`update_prospect`, the call into `_apply_status_change` for the other two,
since that guard lives in a shared helper rather than inline). All three
were independently confirmed to fail against the pre-fix code (`git stash`
on `membership_pipeline_service.py` only, tests left in place) before the
fix was applied, then confirmed to pass after.

### MP-28 — P2 — `_bulk_apply`'s rejected-item path left the MP-27 row lock held for the rest of the batch (Codex review, PR #2405) — ✅ FIXED

**What:** the MP-27 fix above gave `bulk_set_prospect_status`'s `_set_status`
closure its own locked re-fetch (`get_prospect(..., lock_for_update=True)`)
immediately before `_apply_status_change`'s guard. When that guard rejects
the item — already `TRANSFERRED`, or already at the requested target status
— `_apply_status_change` raises `ValueError`, and `_bulk_apply`'s `except
ValueError` branch caught it and moved straight to the next id in the batch
**without ending the transaction the locked read had opened.** The `FOR
UPDATE` lock, and the open transaction under it, stayed held — not
released until either a later item's own `commit()` (inside a different
iteration's `apply()` call) or the whole request finished.

**Failure scenario:** a coordinator selects a mix of prospects for a bulk
status change, and the selection happens to include one that is already at
the target status (an easy, ordinary mistake — re-submitting a batch, or a
UI multi-select that didn't clear). That single item's rejected pass now
holds `FOR UPDATE` on its row for the remainder of the batch's processing
time. Any other request touching that same prospect — a transfer, a
different status change, another bulk sweep that also happens to include
it — blocks until this batch finishes. At larger batch sizes (a “select
all” sweep of a stale cohort) the hold time grows with the batch, and two
overlapping batches that include overlapping prospects in opposite orders
can deadlock on each other's held locks.

**Where:** `membership_pipeline_service.py`, `_bulk_apply`'s `except
ValueError` branch (the same function MP-27 did not touch, since MP-27's
own new lock acquisition happens inside the `apply` callback passed _into_
`_bulk_apply`, not in `_bulk_apply` itself).

**Fix:** end the transaction in the `except ValueError` branch before
continuing the loop — via `commit()`, not `rollback()`. Every current
`apply` callback (`advance_prospect`, `_apply_status_change`) raises its
`ValueError` from a guard clause before making any change, so there is
nothing pending to discard, and `commit()` releases the lock the same way a
successful item's own `commit()` two lines below already does. `rollback()`
looks like the more obviously "correct" choice for a rejected item and was
tried first — it is **not** safe here: this session can be (and in every
test using the `db_session` fixture, is) bound to an externally-managed
connection with `join_transaction_mode="create_savepoint"`, and a raw
`rollback()` on that combination left the session's async/greenlet bridge
unable to run the next query (`MissingGreenlet: greenlet_spawn has not been
called`) — not a hypothetical, but an actual regression caught by two
**pre-existing** tests that already exercise this exact branch through a
real database:
`test_prospect_bulk_actions.py::TestBulkAdvance::test_one_failure_does_not_abort_the_rest`
and
`test_rejected_prospect_dropped.py::TestSingleStatusChange::test_transferred_cannot_be_set_by_a_status_change`
both failed with that error the moment `rollback()` was added, and both
pass again with `commit()` in its place. A code comment at the call site
records this so a future edit doesn't rediscover it by breaking CI. If a
future `apply` callback needs to write something before it can determine
whether to raise, it must roll that partial write back itself before
raising — this branch commits unconditionally and cannot tell the
difference.

**Guard test:** `test_bulk_apply_releases_the_lock_after_a_rejected_item` in
`test_membership_pipeline_flow.py` — unit-level (mocked `db`) rather than a
real two-connection lock test, asserting the one thing that changed:
`db.commit()` is awaited once and `db.rollback()` is never awaited when
`_bulk_apply`'s callback raises `ValueError`. Confirmed to fail (0 commit
calls) against the code as it stood right after the MP-27 fix, before this
one, and to pass after.

Covered by three new source-inspection tests in
`backend/tests/test_membership_pipeline_flow.py`
(`TestTransferToMembership`), matching the file's own established pattern
for `test_transfer_locks_the_prospect_before_checking_status`:
`test_update_prospect_locks_before_checking_transferred`,
`test_set_prospect_status_locks_before_applying_change`, and
`test_bulk_set_prospect_status_locks_before_applying_change` — each asserts
`lock_for_update=True` appears in the method's source and precedes the
guard it protects (the `ProspectStatus.TRANSFERRED` comparison for
`update_prospect`, the call into `_apply_status_change` for the other two,
since that guard lives in a shared helper rather than inline). All three
were independently confirmed to fail against the pre-fix code (`git stash`
on `membership_pipeline_service.py` only, tests left in place) before the
fix was applied, then confirmed to pass after. A fourth test, MP-28's
`test_bulk_apply_releases_the_lock_after_a_rejected_item`, covers the
`_bulk_apply` fix above.

### MP-29 — P1 — no test drove the MP-27/MP-28 locks through a genuine concurrent transaction (Codex review, PR #2405) — ✅ FIXED

**What:** every guard test above, MP-27's three and MP-28's one, either
source-inspects for `lock_for_update=True` or mocks `db` and asserts
`commit()`/`rollback()` was awaited. None drives two real, overlapping
database transactions against the same row, so none can distinguish a
correct lock from one that is acquired but never actually blocks a second
transaction, or one that blocks but then reads a stale snapshot anyway.
PR #2406's stand-down reply on this thread stated no test in this
repository drives genuine multi-connection concurrency — that was checked
more narrowly than it should have been: `test_facility_document_reference_race.py`
(FAC-29 and neighbors) already does exactly this, with a `two_sessions`
fixture built on `database_manager.session_factory` for two independent,
really-committing sessions, precisely because the savepoint-based
`db_session` fixture never truly commits and so cannot demonstrate
cross-transaction visibility.

**Fix:** added the same `two_sessions` pattern to
`test_membership_pipeline_flow.py` (not hoisted to `conftest.py` — this is
currently the only other file that needs it), in two new test classes:

- `TestStatusWritesBlockOnAndObserveAConcurrentTransfer` — one session
  holds the prospect's row lock exactly as a not-yet-committed
  `transfer_to_membership` would (locked read, status flipped to
  `TRANSFERRED`, no commit yet); the other runs the real
  `set_prospect_status` / `update_prospect` / `bulk_set_prospect_status`
  call as a background task, patched only to signal the instant it
  attempts its own locked read. Each test asserts the task is still
  blocked at that signal, then commits the transfer and asserts the write
  observes the committed `TRANSFERRED` status — raising for the two
  single-record paths, returning a `succeeded: false` result for the bulk
  path, matching each path's real error-reporting shape.
- `TestBulkApplyReallyReleasesTheLockAfterARejectedItem` — a real-database
  counterpart to MP-28's mocked guard test, driving a **two-item** batch
  (one rejected, one deliberately paused mid-processing via a patched
  `_apply_status_change`) so a second, independent session's
  `SELECT ... FOR UPDATE` on the rejected item's row is attempted _while
  the batch is still running_ on the paused item, rather than only after
  the whole call returns — the shape that actually distinguishes a true
  per-item lock release from a regression that commits once after the
  entire loop (both look identical from outside a one-item batch).

Three findings from Codex's own review of this PR's first commit
(`d7f253f`) were fixed before merge, all confirmed against real runs (not
asserted from re-reading the diff):

1. **Wrong cited pre-fix revision.** The original write-up claimed the
   concurrency-race tests were verified to fail against `4107910` — but
   that commit _is_ the MP-27 fix itself (it adds `lock_for_update=True` to
   all three status-writing paths and the three source-inspection tests),
   so it cannot serve as the "unlocked" baseline, and no such verification
   had actually been run. Re-verified against the true parent, `ae4fe98`
   (the last commit before MP-27): all three
   `TestStatusWritesBlockOnAndObserveAConcurrentTransfer` tests fail
   against that revision. This account itself needed a further correction
   in the next Codex round (item 5 below) once the test's own wait logic
   changed — see there for the mechanism that actually reproduces on the
   current test code.
2. **The blocked-check raced scheduling latency, not the lock.**
   `lock_attempted` was set the instant the locked query was _issued_, not
   once it had time to actually resolve — so `assert not
writer_task.done()` immediately afterward could pass for the wrong
   reason if an unlocked regression happened to return before the next
   event-loop tick. Added the same `await asyncio.sleep(0.2)` observation
   window `test_facility_document_reference_race.py`'s FAC-37 fix uses for
   exactly this reason, between the event firing and the "still blocked"
   assertion.
3. **Committed rows were never cleaned up.** Both new test classes use
   real, independently-committing sessions specifically so they can
   demonstrate cross-transaction visibility — but a real commit needs a
   real, explicit delete, and neither class had one. This broke CI outright
   (not merely theoretical): `test_agency_position_seeding.py` and
   `test_onboarding_integration.py` failed with `ValueError: An
organization has already been created`, because
   `OnboardingService.create_organization` refuses to run against a
   database that already has one, and this PR's own concurrency tests were
   leaving several behind. Added `_teardown_membership_race_org`,
   deleting the created `ProspectiveMember` row(s) then the `Organization`
   in a fresh cleanup session, matching
   `test_facility_document_reference_race.py`'s `_teardown_org` — verified
   directly (query the table before/after a run) that no rows survive,
   including when the test itself fails.

All four (the three above, plus MP-29 itself) independently confirmed to
fail against their respective pre-fix states before passing against
current code: the concurrency-race tests against `ae4fe98` (see above), the
lock-release test against the commit before MP-28 (times out attempting
the checker's locked read — surfaced as `asyncio.CancelledError` rather
than `asyncio.TimeoutError` on this environment's aiomysql driver when a
read is cancelled mid-flight, which the `except` clause now catches
explicitly), and the leftover-rows regression by temporarily removing the
teardown call and re-running the full scoped suite, which reproduced the
exact CI failure above.

Two more Codex rounds followed on this same PR, both test-robustness
issues rather than production-code or coverage gaps:

4. **Docstring drift and a swallowed rollback error (round 3).** The class
   docstring's claimed failure point had drifted from the actual behavior
   (it said the "still blocked" assertion fires; the test in fact times out
   earlier, at the `lock_attempted` wait). Corrected. Separately, the
   bulk-lock test's `checker_session.rollback()` after a cancelled-mid-read
   lock check was wrapped in a bare `except Exception: pass`, which could
   silently discard a real connection error and let the outer teardown's
   own `rollback()` either mask the intended `pytest.fail()` behind a
   secondary exception, or succeed and hide that anything went wrong.
   Replaced with `invalidate()` (which SQLAlchemy guarantees does not raise
   even on an already-broken connection) on the failure path, and a normal
   `rollback()` only when the connection is known healthy.
5. **Writer/bulk-task failures could be buried behind a confusing timeout
   (round 4).** In both `_run_against_in_flight_transfer` and the bulk-lock
   test, if the background task raised (or returned) before ever reaching
   the point being tracked — a setup or validation regression, say — the
   test waited out the full 10s for an event that could no longer fire,
   reporting a timeout while the real exception sat unretrieved on the
   task. Both now race the tracked event against the task itself
   (`asyncio.wait(..., return_when=FIRST_COMPLETED)`) and immediately
   propagate the task's result/exception if it finishes first. Cancelling
   either task mid-DB-read can also leave its session's connection
   unusable, so both `finally` blocks now call `invalidate()` instead of
   `rollback()` specifically when the task was cancelled, so the explicit
   row-cleanup teardown always still runs. This round also corrected the
   class docstring again: with the new race in place, the true pre-MP-27
   mechanism is more subtle than "the tracked event times out" alone — the
   unlocked `SELECT` itself returns instantly (MVCC reads never wait on
   another transaction's row lock), but the `UPDATE` the write eventually
   issues at its own flush/commit is a real row-level write, which InnoDB
   always serializes via genuine locks regardless of isolation level, so it
   queues behind the locker's held `FOR UPDATE` and never completes either
   — meaning _neither_ side of the race finishes and the explicit
   `TimeoutError` fires, verified directly against `ae4fe98` after the
   change.

The three pass-5 source-inspection tests and MP-28's mocked guard test are
kept alongside these, per the existing
`test_transfer_locks_the_prospect_before_checking_status` precedent noted
in its own docstring — a fast tripwire for the lock call or the commit
call disappearing entirely, not a substitute for the concurrency proof.

### Completion gate (pass 5, final — after MP-28, MP-29, and rounds 3-4)

| Check                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                              | pass, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `black --check app/ tests/ alembic/`                                                       | pass, 0 files would be reformatted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `isort --check-only app/ tests/ alembic/`                                                  | pass, 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                          | pass — single head, no schema change this pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| new guard tests (8 in `test_membership_pipeline_flow.py`)                                  | 8 passed (4 from MP-27/MP-28, 4 new from MP-29); each independently confirmed to fail against its own correct pre-fix state across all four Codex rounds on this PR (see above)                                                                                                                                                                                                                                                                                                                                                               |
| scoped pytest (`-k "membership or prospect or pipeline or agency_position or onboarding"`) | 806 passed / 1 skipped (`py_vapid`) / 0 failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| full backend suite (`pytest tests/ -q`)                                                    | 11859 passed / 21 skipped / 0 failed. A prior run of this suite (before the leftover-rows fix above) showed 38 failures in `test_agency_position_seeding.py`/`test_onboarding_integration.py`/`test_facilities_onboarding.py`/`test_public_legal.py`, misdiagnosed at the time as pre-existing/environmental — they were this PR's own bug: uncleaned `Organization` rows from the concurrency tests tripping `OnboardingService.create_organization`'s single-org guard. Re-run clean after the fix, and clean again after all later rounds. |
| `npm run typecheck` / `npm run lint` (frontend)                                            | not run this round — no frontend file touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Pass 4, round 4 (2026-09-02) — 1 fixed (Codex review of PR #2177's `0d9a981a`)

Codex reviewed round 3's fix commit (`0d9a981a`, MP-24/MP-25) and posted 1
new finding against `create_election_package`'s fallback branch — the one
MP-23 (round 2) left as a documented residual limitation, not a bug.

#### MP-26 — P2 — the fallback branch discarded an already-validated `step_id` in favor of an arbitrary sort-order guess — ✅ FIXED

> **Residual resolved 2026-10-11 (owner decision 2026-10-05):** the remaining
> sort-order guess — several vote stages, applicant on none, no
> election-stage `step_id` — is now a 422 (`ElectionStageAmbiguousError`)
> asking the caller to name the stage. See `docs/KNOWN_LIMITATIONS.md`.

**What:** MP-23 (round 2) made `create_election_package` prefer
`prospect.current_step` for the PII-minimization policy when `current_step`
is itself an `election_vote` step of the governing pipeline. When it isn't —
e.g. the applicant already advanced past every vote stage — the code falls
back to `next(...)` over `effective_steps`, ordered by `sort_order`: the
first configured `election_vote` step, full stop. That fallback never looked
at a caller-supplied `step_id` at all, even though MP-5 (pass 3) already
validated it to belong to the governing pipeline. In a pipeline with more
than one `election_vote` step (still unconstrained — `add_step` has no
uniqueness check on `step_type`), a request naming the later, stricter of
two such steps — exactly what `advanceApplicant` sends on the same kind of
race MP-24 guards on the `current_step`-governed side — got the earlier,
more permissive stage's policy instead, over-capturing PII the later stage
was configured to exclude.

**Independently verified:** read the current (post-round-3) fallback in
full. It was exactly the unconditional sort-order `next(...)` Codex
described — no reference to `step_id` anywhere in that branch. Re-read
MP-5's check (`membership_pipeline_service.py`, just above the policy
resolution): `if step_id: ... if not any(str(s.id) == str(step_id) for s in
steps): raise ValueError(...)` — pipeline membership only, never
`step_type`. So `step_id`, once supplied, is confirmed to name a real step
of this exact pipeline, but not confirmed to be an `election_vote` step —
using it as a policy source unconditionally would have been wrong (it could
name the pass-4 "wrong step_id" case, a real but non-election step). Traced
the only frontend caller, `advanceApplicant`
(`prospectiveMembersStore.ts:433-483`, unchanged since MP-23): it always
sends `step_id` as the election_vote stage the applicant just entered, and
there is no legitimate frontend path that names a deliberately different
stage — the same fact MP-24's own reasoning already established for the
`current_step`-governed side. Cross-checked against MP-24's mismatch check:
it only fires when `election_step is current_step` (i.e. the policy came
from `current_step`), which is never true once this fallback branch is
reached — no interaction, no conflict.

**Why this doesn't reopen MP-20.** MP-20's fix stopped trusting `step_id`
_unconditionally_ — the bug there was that a bare, type-unchecked `step_id`
could steer policy to any step at all, including a deliberately wrong one,
with no server-side signal that it was actually the applicant's stage. This
fix only extends trust to `step_id` once it clears the same type check
`current_step` itself has to clear (`step_type == ELECTION_VOTE` and
in-pipeline) — a caller with `prospective_members.manage`/`members.manage`
(the permission this endpoint already requires) could reach the same
resolved policy today by calling `regress_prospect` to the desired
`election_vote` stage, creating the package, then `advance_prospect` again;
this fix removes the extra round trip without granting any capability that
role didn't already have via `current_step` itself.

**Where:** `create_election_package`, `membership_pipeline_service.py`,
immediately before the pre-existing sort-order fallback.
**Fix:** inserted a new step between the MP-24 mismatch check and the
sort-order fallback: when `election_step` is still `None` (i.e.
`current_step` didn't govern) and `step_id` was supplied, look it up in
`effective_steps` and — only if it resolves to a step whose `step_type` is
`ELECTION_VOTE` — use it directly as `election_step`, skipping the guess
below entirely. A `step_id` naming a real, in-pipeline step of the wrong
type falls through unchanged to the existing sort-order fallback, so the
pass-4 `test_wrong_step_id_still_honors_the_pipelines_election_stage` case
is unaffected (confirmed by rerunning that suite alongside the new one).
Unlike the old fallback's `next(...)` search, the new step_id-preferred path
does not additionally require the named step to have `package_fields`
configured — it mirrors `current_step`'s own resolution exactly (trust the
step once it is confirmed to be the right _type_; an unconfigured step still
means capture-everything for that step, same as an unconfigured
`current_step` already does), rather than skipping past it to find some
other, unrelated step that merely happens to have a policy saved.

**Residual limitation, narrowed but not closed:** a pipeline with multiple
`election_vote` steps where _neither_ `current_step` _nor_ a supplied
`step_id` identifies one of them (`step_id` omitted, or naming a real but
non-election step) is still genuinely ambiguous — there remains no signal
naming "the" stage, so the sort-order guess is unchanged. This is a strict
narrowing of the case MP-23 documented (previously: any time `current_step`
didn't govern; now: only when `step_id` also doesn't disambiguate), not a
full resolution — `docs/KNOWN_LIMITATIONS.md` updated to match.

**Considered and declined:** rejecting outright (400) in the still-residual
case, as Codex's second suggested option. Declined for the same reason
MP-20's step_id-optional design was kept rather than made required: the
sort-order guess is still exact for the overwhelmingly common
single-`election_vote`-step pipeline (the vast majority of installations,
per MP-23), and turning the still-ambiguous multi-step/no-signal case into a
hard error would make `create_election_package` fail for a legitimate
caller (or a future caller other than `advanceApplicant`) who reasonably
omits `step_id` on a pipeline with only one election stage today, if that
pipeline is later reconfigured to add a second one — a behavior change with
no caller opted into it. Best-effort-guess-with-a-known-limitation, already
this rotation's disposition for the surrounding cases (MP-22, MP-25),
remains the better fit than a new hard failure mode for a case that is rare
by construction (requires a multi-`election_vote` pipeline _and_ a request
with no disambiguating signal).

Covered by `backend/tests/test_membership_pipeline_pass4_round4_codex.py`
(5 tests): the core regression (current_step past every election_vote
stage, step_id names the later/stricter one → that stage's policy governs,
not the sort-order guess); the mirror case (step_id names the earlier,
permissive stage → that stage's policy governs — proving "prefer the named
stage," not "prefer the stricter one"); a step_id naming a real but
wrong-type step → unaffected, still falls through to the sort-order guess;
step_id omitted → unaffected, same residual guess; and a
single-`election_vote`-step regression guard. The core regression test was
independently confirmed to fail against the pre-fix code (`git stash` on
`membership_pipeline_service.py`) before the fix was applied — the other 4
were confirmed to already pass unchanged against that same pre-fix code, so
the fix is additive rather than accidentally masking behavior a broader
diff would have altered.

### Completion gate (pass 4, round 4)

| Check                                                              | Result                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                 |
| `black --check app/ tests/ alembic/`                               | pass (1 new test file needed reformatting, applied, re-check pass)                                                                                 |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                               |
| new guard tests (`test_membership_pipeline_pass4_round4_codex.py`) | 5 passed; the core regression assertion independently confirmed to fail against the pre-fix code (`git stash`)                                     |
| full backend suite (`pytest tests/ -q`)                            | 9877 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9872 passed before this commit; +5 for the new round-4 guard tests) |

---

## Pass 4, round 3 (2026-09-02) — 1 fixed, 1 flagged/refuted (Codex review of PR #2177's `da29d880`)

Codex reviewed round 2's fix commit (`da29d880`, MP-23's `prospect.current_step`
preference) and posted 2 new findings, both against
`membership_pipeline_service.py`.

#### MP-24 — P1 — a supplied `step_id` could still disagree with the `current_step` that governed the snapshot — ✅ FIXED

**What:** `advanceApplicant` (frontend) commits the applicant's stage
advancement in one request, then makes a **separate** request to create the
election package, naming the stage it just entered via `step_id`. Between
those two requests, `prospect.current_step` can change again — a regression,
or another advance landing in the gap. MP-23 (round 2) made
`create_election_package` prefer `prospect.current_step` for the PII policy,
but never checked it against the request's `step_id` — so on this genuine
race, the method would resolve `package_fields` from whatever `current_step`
now is, while still persisting the request's original (now-stale) `step_id`
on the package. The package ends up labeled for one stage while a different
stage's policy actually governed what got captured — the same class of
mismatch MP-23 fixed for the _first-found_ lookup, reopened one layer up by
the request/response race between the two frontend calls.

Independently confirmed by reading `create_election_package`'s full body at
`da29d880`: `step_id` is validated only for belonging to the pipeline (MP-5,
`membership_pipeline_service.py` lines 4613-4616) and is stored verbatim on
`pkg.step_id` (line 4772) — completely independent of which step's
`package_fields` governed the snapshot above it. No existing check compares
the two. Also confirmed `advanceApplicant`
(`prospectiveMembersStore.ts:433-483`) is the only frontend caller of
`create_election_package`, and it always intends `step_id` to equal the
stage the applicant just entered — there is no legitimate frontend path that
names a deliberately different stage, which is what makes rejecting a
mismatch safe rather than a false-positive risk.

**Where:** `create_election_package`, `membership_pipeline_service.py:4649`
(right after `election_step` is resolved from `current_step`, before the
first-found fallback).

**Fix:** when the policy was resolved from `current_step` (i.e.
`election_step is current_step`) and the caller supplied a `step_id` that
disagrees with it, raise `ValueError` (→ 400 via the endpoint's existing
`except ValueError` handler) instead of silently mixing the two. This never
fires when `step_id` is omitted, and never fires for the pass-4 "named step
isn't the pipeline's election step" scenario
(`test_wrong_step_id_still_honors_the_pipelines_election_stage`), because
there the policy comes from the fallback lookup, not from `current_step` —
verified by re-running that suite alongside the new tests. The caller
(`advanceApplicant`) already treats package-creation failure as non-fatal to
the advance (a toast warning, per its own comment about 409s), so a 400 here
degrades the same way; a genuine race is correctly surfaced rather than
silently mis-attributed.

**Considered and declined:** removing `step_id` as a caller-supplied field
entirely, deriving it server-side from `current_step`. Only one caller
exists today and it always intends the two to match, so this would likely be
safe — but it is a request-schema change on an endpoint with its own test
coverage of the "named step is deliberately not the election step" case
(pass 4), and changes the field's meaning for any future caller. Left as a
reject-on-mismatch rather than a schema change, consistent with this
rotation's preference for the smaller, reversible fix on an already
many-times-reviewed surface.

Covered by `backend/tests/test_membership_pipeline_pass4_round3_codex.py` (3
tests): the race itself (current_step moved on after step_id was captured →
`ValueError`); the ordinary matching case (step_id equals current_step →
unaffected); and step_id omitted (never triggers the check). The race
assertion was independently confirmed to fail against the pre-fix code
(`git stash` on `membership_pipeline_service.py`) before the fix was applied.

#### MP-25 — P2 — claimed lock-order deadlock between `update_election_package` and `ElectionService.close_election` — 🚩 REFUTED (no fix)

**What (claim):** `ProspectElectionPackage.election` is
`lazy="joined"` (confirmed: `models/membership_pipeline.py:544`), so
`get_election_package(..., lock_for_update=True)`'s `SELECT ... FOR UPDATE`
(added by MP-21) generates a join that locks both the package row and its
linked election row, package-then-election. The claim was that
`ElectionService.close_election` takes the opposite order — election first,
packages later via `_sync_package_statuses` — creating a classic lock-order
deadlock: `update_election_package` holding the package lock waiting on the
election lock, while a concurrent `close_election` holds the election lock
waiting on the package lock.

**Independently verified, and refuted:** the `lazy="joined"` mechanic is
real — confirmed the relationship declaration, and confirmed (via the
response schema, `schemas/membership_pipeline.py:747-749`,
`election_title`/`election_status`/`election_end_date`) that the eager join
is load-bearing, not incidental: those response fields are `@property`s that
read `self.election` synchronously during Pydantic serialization, so
dropping the eager load on this query without also handling that read would
trade a theoretical deadlock for a real, reproducible `MissingGreenlet` crash
on every successful update.

But the deadlock premise itself does not hold against the actual code.
Traced `ElectionService.close_election` (`election_service.py:4781-4947`)
statement by statement: it takes the election lock at line 4787-4792, then
**commits at line 4827** — before it ever touches `ProspectElectionPackage`.
`_sync_package_statuses` (line 4949, called from `close_election` at line
4928, after several more reads and its own commit boundary) runs in a
transaction that no longer holds the election lock (released at the line
4827 commit) and does not itself lock the package rows it selects (its query
at lines 4969-4973 has no `.with_for_update()` — only the later `UPDATE`
implicit from `pkg.status = new_status` takes a row lock, at commit time,
line 5033). Confirmed grepping `election_service.py` for
`ProspectElectionPackage`: the only two references are both inside
`_sync_package_statuses`, after the election-lock-releasing commit.

A lock-order deadlock requires two transactions to each hold one resource
while waiting on the other, at the same time. Here, `close_election` never
holds the election lock and a package lock simultaneously — the intervening
commit at line 4827 splits it into two separate transactions, one holding
only the election lock, the other (in `_sync_package_statuses`) taking only
a package lock, with no overlap. The two-transaction split makes the
opposite-order interaction Codex described structurally impossible with the
current code: at worst, `_sync_package_statuses`'s package `UPDATE` blocks
briefly behind a concurrent `update_election_package`'s lock (ordinary lock
contention, not a cycle) and proceeds once that transaction commits.

**Disposition:** flagged, not fixed — there is nothing to fix; the claimed
scenario does not reproduce against the actual code. Recorded here (rather
than silently dismissed) because: (1) the underlying "the joined eager load
also locks the election row when present" mechanic is real and worth a
future reviewer knowing about before adding a _new_ election-then-package
code path within a single uncommitted transaction elsewhere — that is the
shape that would actually risk this deadlock; (2) any fix to narrow the lock
scope (e.g. a column-limited raw locking statement instead of the ORM
join) would need to independently guarantee `election` is still loaded
before serialization, which is exactly the kind of behavior-changing,
easy-to-get-subtly-wrong change this rotation's own precedent (MP-22) says
to flag rather than force through same-day on an already many-times-reviewed
surface, especially when the finding it would guard against isn't actually
reachable today.

No test added — there is no reproducible failure to guard against. If a
future change to `close_election` merges its election-lock phase and its
package-write phase into a single transaction (removing the line-4827
commit boundary), the deadlock risk this finding described would become
real; that is the condition a reviewer of such a change should check for.

### Completion gate (pass 4, round 3)

| Check                                                              | Result                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                 |
| `black --check app/ tests/ alembic/`                               | pass, 0 files would be reformatted                                                                                                                 |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                               |
| new guard tests (`test_membership_pipeline_pass4_round3_codex.py`) | 3 passed; the race assertion independently confirmed to fail against the pre-fix code (`git stash`)                                                |
| full backend suite (`pytest tests/ -q`)                            | 9872 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9869 passed before this commit; +3 for the new round-3 guard tests) |

---

## Pass 4, round 2 (2026-09-02) — 1 fixed (Codex review of PR #2177's own fix commit)

Codex reviewed pass 4's fix commit (`6c9bb09e`, still on open PR #2177 — no
branch change needed, unlike the pass-3-to-4 handoff) and posted 1 new
finding against the very code MP-20 just changed.

#### MP-23 — P1 — election-package field policy still assumed a pipeline has at most one `election_vote` step — ✅ FIXED

**What:** MP-20's fix resolves `package_fields` by finding the pipeline's
"own" `election_vote`-typed step via `next(...)` over
`effective_pipeline.steps` (ordered by `sort_order`). That is correct only if
a pipeline has at most one such step — and nothing enforces that. `add_step`
has no uniqueness check on `step_type` (confirmed by reading it directly:
`membership_pipeline_service.py:470-518`, no such constraint), so a pipeline
with two or more `election_vote` stages is a reachable configuration. In that
case `next(...)` always returns the _first_ one found, ordered by
`sort_order` — not necessarily the stage the applicant, and this specific
package, actually reached. An earlier stage configured more permissively (or
left unconfigured, meaning capture-everything) than the later stage the
applicant is really on then silently governs the snapshot, over-capturing PII
the applicant's real stage was configured to exclude.

Codex additionally observed that the frontend's `advanceApplicant` flow
(`prospectiveMembersStore.ts`) already knows the exact stage the applicant
just entered when it triggers package creation. Confirmed by reading it: it
finds `newStage` by matching `advanced.current_stage_id` against the
pipeline's stage list, checks `newStage.stage_type === ELECTION_VOTE`, and
passes `stage_id: newStage.id` through `createElectionPackage` to the
backend's `step_id` parameter — but pass 4 deliberately stopped trusting
`step_id` for this decision (the MP-20 fix, for good reason: a client
supplying an arbitrary in-pipeline `step_id` could otherwise defeat the
policy). A step_id-based fix that simply re-trusts a type-checked `step_id`
would work for this one caller but re-opens exactly the class of bug pass 4
closed for every other caller of `create_election_package`.

**Where:** `create_election_package`, `membership_pipeline_service.py`.
**Fix:** resolve the governing step from `prospect.current_step` first, not
from the client-supplied `step_id`. `current_step_id` is set only by
`create_prospect`/`advance_prospect`/`regress_prospect` and is in
`_PROSPECT_PROTECTED_FIELDS` (excluded from the generic update path), so it
names the stage the applicant has actually, currently reached with nothing
for any caller — trusted or not — to steer. `get_prospect` (called at the top
of `create_election_package`) already eager-loads
`selectinload(ProspectiveMember.current_step)`, so this is available with no
extra query. When `prospect.current_step` is itself an `election_vote` step
belonging to the governing (possibly caller-overridden) pipeline, its
`package_fields` governs. Only when it is _not_ — e.g. a package requested
after the applicant already advanced past the vote stage, or a caller
overriding `pipeline_id` to one the prospect isn't actually on — does the
code fall back to MP-20's original `next(...)` lookup, which remains exactly
correct for the single-`election_vote`-stage case (the overwhelmingly common
one) and is the same best-effort guess as before for the residual ambiguous
case.

**Residual limitation, not fixed:** a pipeline with **multiple**
`election_vote` stages where the prospect's `current_step` matches none of
them (the fallback path) is still genuinely ambiguous — there is no single
correct "the" election stage to resolve, by construction, once the pipeline
itself has more than one and the applicant isn't presently on any of them.
This is a product-design question (should a pipeline even be allowed
multiple `election_vote` stages? if so, does "the applicant's stage" have a
different definition for a package requested after they've moved on?) rather
than a bug fixable in this pass. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

Covered by `backend/tests/test_membership_pipeline_pass4_round2_codex.py`:
a two-`election_vote`-stage pipeline where the prospect's current step is the
later, stricter one (must exclude phone/address/DOB, not the earlier
permissive stage's fields); the mirror case where the current step is the
earlier, permissive one (must include those fields — proving this is "prefer
the actual stage," not "always prefer the stricter one"); and a
single-`election_vote`-stage regression guard. The multi-stage assertion was
independently confirmed to fail against the pre-fix code (`git stash` on
`membership_pipeline_service.py`) before the fix was applied.

### Completion gate (pass 4, round 2)

| Check                                                              | Result                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                           |
| `black --check app/ tests/ alembic/`                               | pass, 0 files would be reformatted                                                                                                                           |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                           |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                                         |
| new guard tests (`test_membership_pipeline_pass4_round2_codex.py`) | 3 passed; the multi-stage assertion independently confirmed to fail against the pre-fix code (`git stash`)                                                   |
| full backend suite (`pytest tests/ -q`)                            | 9869 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9866 passed before this PR's last commit; +3 for the new round-2 guard tests) |

---

## Pass 4 (2026-09-02) — 3 fixed, 1 flagged (Codex review on PR #2177)

> **Branch note:** Codex reviewed pass 3's fix commit while #2176 was still
> open and posted 4 new findings. #2176 merged before the investigation
> finished (this rotation's "one PR at a time" model), so — per CLAUDE.md
> Pitfall #24 and the identical precedent of #2173 against #2162 in the
> elections feature — this pass landed as a fresh branch off `main` and a new
> PR (#2177) rather than a push to the now-closed `claude/security-review-membership-pipeline`
> branch. Replies to the original findings are posted on #2176's threads
> (still open for replies/resolution despite the PR being closed), pointing
> here for the actual fix.

### Findings (Codex review of PR #2176's fix commit)

#### MP-20 — P1 — election-package PII policy trusted the caller's `step_id`, and a new stage had no policy at all — ✅ FIXED

**What:** two angles on the same mechanism — `create_election_package`'s
`package_fields` reader (added in pass 3 for MP-15).

1. The reader resolved policy from whatever `step_id` the _caller_ supplied
   on `ElectionPackageCreate` — optional, and never checked for being the
   pipeline's actual `election_vote`-typed step. Even after a coordinator
   saves a restrictive `package_fields`, a caller could still get full
   capture by omitting `step_id`, or by naming a different, real, in-pipeline
   step (which passes pass 3's own MP-5 in-org/in-pipeline check) — silently,
   with no error and no sign anything was skipped.
2. Separately: a brand-new, never-configured `election_vote` stage had no
   `package_fields` at all, because neither `DEFAULT_STAGE_CONFIGS.election_vote`
   nor the "Membership Vote" preset (`frontend/.../StageConfigModal.tsx`)
   ever set it — even though `ElectionVoteConfig.tsx` displays
   phone/address/DOB as **unchecked** by default. Pass 3's `package_fields is
None -> capture everything` fallback (deliberately conservative, to avoid
   silently narrowing existing pipelines) meant the normal, untouched
   default UI workflow — not just legacy pipelines — still over-captured PII
   the UI visually implies is excluded.

**Where:** `create_election_package`, `membership_pipeline_service.py`;
`StageConfigModal.tsx`, `frontend/src/modules/prospective-members/components/`.
**Fix:**

- Backend: `package_fields` is now resolved by finding the pipeline's own
  `election_vote`-typed step directly (`s.step_type == PipelineStepType.ELECTION_VOTE`),
  not by trusting `step_id` for anything beyond what MP-5 already validated
  it for. A pipeline has at most one election stage in practice, so this
  removes the client's ability to steer which step's config governs the
  snapshot, while `step_id` is unchanged as the package's own step reference
  and pass 3's "absent config -> capture everything" fallback is preserved
  exactly when no `election_vote` step (or one with no saved `package_fields`)
  exists.
- Frontend: the "Membership Vote" preset's `config()` now includes
  `package_fields: { ...DEFAULT_ELECTION_PACKAGE_FIELDS }` — the same object
  `ElectionVoteConfig.tsx` already falls back to for _display_. This is the
  only UI path that can actually produce a _savable_ new `election_vote`
  stage: manually picking the "Election / Vote" type card leaves
  `eligible_voter_roles` empty with no control anywhere in the modal to set
  it (a separate, pre-existing gap, left untouched — out of scope here).
  `DEFAULT_STAGE_CONFIGS.election_vote` itself was deliberately **not**
  touched: it is also the merge base `StageConfigModal.tsx` spreads under an
  _existing_ stage's config when opening it for editing
  (`{ ...defaultStageConfig(editingStage.stage_type), ...editingStage.config }`),
  so adding defaults there would have leaked into every edit of a legacy,
  never-configured stage and silently narrowed its capture-everything
  behavior on an unrelated save (exactly what pass 3 was protecting against).
  Scoping the fix to the preset (rendered only when `!editingStage`) targets
  new-stage creation without touching that merge path at all.

Covered by `TestElectionPackageFieldPolicyIsNotClientChosen` (backend:
omitted `step_id`, wrong-but-real `step_id`, correct `step_id`, and a
pipeline with no election step at all, each against a prospect with real PII)
and 2 new `StageConfigModal.test.tsx` cases (the preset persists the UI's
defaults; editing an existing, never-configured stage leaves `package_fields`
untouched even when saved).

#### MP-21 — P1 — `update_election_package`'s status path reopened the pass-3-fixed assignment race — ✅ FIXED

**What:** pass 3 (MP-16) locked `assign_package_to_election`'s read of the
election package specifically because its status check has to be the
locking read (CLAUDE.md Pitfall #27). `update_election_package` — the other
write path that changes `pkg.status`, guarded by pass 3's MP-17
state-machine check — still read the package with a plain, unlocked
`get_election_package` call. A `{"status": "ready"}` reset racing a
concurrent `assign_package_to_election` could validate against a stale
snapshot of `pkg.status`, reopening the exact compounding scenario the
MP-17 state machine exists to prevent.
**Where:** `update_election_package`, `membership_pipeline_service.py`.
**Fix:** the package is now fetched with `lock_for_update=True`, and the
state-machine check runs against that same locked read — mirroring
`assign_package_to_election` exactly. Covered by
`TestElectionPackageUpdateLocking`: a source-inspection test (matching this
rotation's established lock-wiring-guard pattern) confirming the lock is
acquired before the `ELECTION_PACKAGE_SYSTEM_STATUSES` check, plus
behavioral tests for the ordinary path and the already-`added_to_ballot`
refusal case.

#### MP-22 — P2 — document-deletion fix can still lose a file if a later step fails after `os.remove` succeeds — 🚩 FLAGGED

**What:** pass 3's MP-18 fix reordered `delete_prospect_document` to remove
the file from disk _before_ deleting the DB row and committing — correct for
the `OSError` case that was pass 3's actual finding. But if `_log_activity`,
`db.delete`, or the commit itself fails _after_ a successful `os.remove`, the
transaction rolls back while the file is already irrecoverably gone; the DB
row survives (untouched by the failed transaction) pointing at a file that no
longer exists.
**Where:** `delete_prospect_document`, `membership_pipeline_service.py`.
**Disposition — FLAGGED, not fixed.** This is a genuine reliability
tradeoff, not a one-sided gap: the current ordering is what this exact
method was deliberately reordered _to_ in pass 3, specifically so an
`OSError` on removal leaves the DB row as the one record an operator can
retry cleanup against. Reverting to commit-DB-first (this codebase's more
common pattern elsewhere, e.g. `documents_service.delete_folder`) would
reopen MP-18 — an untracked orphaned PII file with no row left to explain
it, which is strictly worse than the residual risk here: the row surviving a
failed commit is retry-safe (a retry's `os.path.exists` check is already
false, so it proceeds straight to a clean metadata delete). A full
rename-to-trash/restore-on-rollback scheme (stage the file, commit the DB
delete, only then permanently remove the staged file, restoring it if the
commit fails) would close this gap without reopening MP-18, but is
meaningfully more machinery — a new trash-file convention, restore-on-any-
exception handling, and eventually a cleanup job for anything left in trash
by a restore itself failing — than a rare compound failure (an `os.remove`
succeeding immediately followed by a DB commit failing) justifies as a
same-day fix on an already-twice-reviewed, election-adjacent surface.
Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### Completion gate (pass 4)

| Check                                                                                    | Result                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                            | pass, 0 violations                                                                                                                                            |
| `black --check app/ tests/ alembic/`                                                     | pass (1 file needed reformatting, applied, re-check pass)                                                                                                     |
| `isort --check-only app/ tests/ alembic/`                                                | pass, 0 violations                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                        | pass — 409 revisions, single head (no schema change)                                                                                                          |
| new/changed guard tests (`test_membership_pipeline_pass4_codex.py` + one pass-3 fixture) | 33 passed (7 new + 26 pass 3); the 3 new/changed assertions independently confirmed to fail against the pre-fix code (`git stash` on the changed source file) |
| `StageConfigModal.test.tsx`                                                              | 45 passed (43 existing + 2 new); the 1 new save-path assertion confirmed to fail against the pre-fix component (`git stash`)                                  |
| `tsc --noEmit` / `eslint` (frontend files touched this pass)                             | clean                                                                                                                                                         |
| full backend suite (`pytest tests/ -q`)                                                  | 9866 passed / 21 skipped (pre-existing/environmental) / 0 failed                                                                                              |

---

## Pass 3 (2026-09-02) — 5 fixed, 2 flagged (Codex review on PR #2176)

> **Revision note:** the pass as first drafted (below, unedited) concluded
> "no new findings" from a byte-identical diff against pass 2. Codex's review
> of that draft found the diff being byte-identical proved nothing about the
> code's _soundness_ — only that nothing had changed since a pass that never
> looked at this angle either. It posted 6 findings, plus a 7th (mirroring
> MP-10) restated in a review comment: unvalidated cross-tenant form ids in
> step config, an N+1 query in the event-link list, election-package PII
> over-collection ignoring a stage's configured field toggles, an
> election-package assignment race with no row lock, a document-deletion
> path that could orphan a file on disk, no server-side state machine on
> election-package status, and unbounded prospect reads on two endpoints.
> Independently re-traced against the actual current code (not Codex's
> say-so): all 7 were real. 5 were fixed; 2 were flagged as needing a
> migration/product decision, per this rotation's standing discipline. See
> Findings below for what was actually done; the original "no new findings"
> draft is left intact afterward for the record.

### Findings (Codex review on PR #2176)

#### MP-13 — P2 — unvalidated cross-tenant `form_id` in step config — ✅ FIXED

**What:** `add_step`/`update_step` (`membership_pipeline_service.py`) wrote
and committed a step's `config` — including a client-supplied `form_id` — to
the database _before_ calling `_ensure_membership_form_integration`, and
that helper only logs a warning and returns when its own org-scoped lookup
fails; it never rejects the write. `create_pipeline`'s inline steps loop
didn't call the integration helper at all. A manager could submit another
org's form UUID in `config.form_id` and have it persist unchecked — CLAUDE.md
Pitfall #14c (validate client-supplied FK ids belong to the org before
storing them), the same shape already fixed for `email_template_id` on the
same two methods.
**Where:** `add_step` (~line 420), `update_step` (~line 497), `create_pipeline`'s
inline steps loop (~line 249).
**Fix:** added `_assert_form_in_org`, mirroring `_assert_email_template_in_org`
exactly (`assert_in_org` against `Form`, `allow_none=True` since a step need
not reference a form) — called in all three write paths _before_ the step is
persisted. `_ensure_membership_form_integration` is unchanged; it remains a
best-effort bookkeeping call that now only ever runs against an
already-validated in-org form. Covered by `TestStepFormIdOrgValidation` in
`tests/test_membership_pipeline_pass3_codex.py` (all three paths, plus
regression guards that a legitimate same-org `form_id` and a step with no
form config are unaffected).

#### MP-14 — P2 — N+1 query in `list_event_links` — ✅ FIXED

**What:** `list_event_links` (backing `GET /prospects/{id}/event-links`)
loaded every link for a prospect, then issued a separate `Event` query and
(when `linked_by` was set) a separate `User` query per row — a 2N+1 shape.
**Where:** `membership_pipeline_service.py`, `list_event_links`.
**Fix:** batch-fetch every referenced `Event`/`User` with two `.in_()`
queries before the loop, then build the response from `dict` lookups — same
output shape, no behavior change. Covered by a source-inspection test
(`TestEventLinkListBatching.test_list_event_links_does_not_query_per_row`,
walks the function's AST and fails if any `db.execute` call sits inside a
`for` loop) and a behavioral test asserting the enriched output is still
correct with two links, one with a linker and one without.

#### MP-15 — P1 — election-package PII over-collection ignored `package_fields` — ✅ FIXED

**What:** the election-vote stage's config (`ElectionVoteConfig.tsx`'s
"Election Package Contents" panel — `include_email`/`include_phone`/
`include_address`/`include_date_of_birth`/`include_documents`/
`include_stage_history`) had **no backend reader at all** — grepped zero
hits for `package_fields` anywhere under `backend/`. `create_election_package`
unconditionally captured DOB, full address, phone, and documents into
`applicant_snapshot` regardless of what a coordinator configured, and
`ElectionPackageResponse` returns that whole dict to any `elections.manage`
caller. This is CLAUDE.md Pitfall #19 (a config switch shipped with no
reader) applied to a PII-minimization control rather than a notification
toggle.
**Where:** `create_election_package`, `membership_pipeline_service.py`.
**Fix:** the step referenced by a package's `step_id` (when set) is
consulted for `config.package_fields`; each of the six toggled fields is
included in the snapshot only when its flag is true (matching the frontend's
own defaults for a key present in the dict but not itself set). Critically,
`package_fields is None` (no step, or a step whose config was never touched
by a coordinator) preserves the **prior capture-everything behavior exactly**
— this is additive, not a default change, so no existing pipeline's data
collection is altered. Fields with no toggle on the stage-config UI (name,
interest reason, notes, referral source) are always captured, unaffected.
Verified the frontend never reads `address_*`/`date_of_birth` from the
mapped response (`services/api.ts`'s `mapElectionPackageResponse`), so
omitting them carries no frontend regression risk. Covered by
`TestElectionPackagePIIFields` (configured exclusions honored; unconfigured
steps and no-step-id packages both still capture everything).

#### MP-16 — P1 — election-package assignment race, no row lock — ✅ FIXED

**What:** `assign_package_to_election` read the package via a plain
(unlocked) `get_election_package`, checked `pkg.status == "ready"`, then
wrote `election.ballot_items`/`pkg.election_id`/`pkg.status` — a
check-before-write with no lock or version check, CLAUDE.md Pitfall #27's
exact shape (already fixed once in this same file, for
`transfer_to_membership`, in pass 2). Two concurrent assignment calls for
the same package could both observe `"ready"` before either commits and both
append a ballot item to their own (possibly different) elections, landing
the applicant on two ballots with the second write to `pkg.election_id`
silently overwriting the first.
**Where:** `get_election_package`/`assign_package_to_election`,
`membership_pipeline_service.py`.
**Fix:** added `lock_for_update: bool = False` to `get_election_package`
(same signature shape as `get_prospect`'s existing parameter), and
`assign_package_to_election` now locks the package row and runs the
`"ready"` check against that locked read — the lock and the decision are the
same statement, so there is no snapshot gap between acquiring the lock and
reading the value it protects (per Pitfall #27's "the count itself must be a
locking read" requirement). Also locks the target `Election` row for the
same reason: two _different_ packages assigned to the _same_ election
concurrently would otherwise race the identical read-modify-write on
`ballot_items` and silently lose one ballot item. Covered by
`TestElectionPackageAssignmentLocking` — source-inspection tests (matching
this rotation's established pattern for lock-wiring guards,
`test_transfer_locks_the_prospect_before_checking_status`) confirming the
lock is acquired before the status check and that `get_election_package`'s
`lock_for_update` actually calls `with_for_update`, plus a behavioral test
confirming the ordinary path still works and a second assignment attempt is
still refused.

#### MP-17 — P1 — no state machine on election-package `status` — ✅ FIXED

**What:** `ElectionPackageUpdate.status` is an unrestricted `str`, and
`update_election_package` applied it directly with no allowed-value or
valid-transition check. A caller holding only `members.manage` could PUT
`{"status": "ready"}` on a package already `added_to_ballot`, then call
`assign_package_to_election` again — landing the same applicant on a second
ballot with **no race required** (a serial escalation, independent of and
compounding MP-16). A caller could also write `"elected"` directly (no vote
tally behind it) or an arbitrary unknown string, breaking the documented
five-state contract (`draft` → `ready` → `added_to_ballot` →
`elected`/`not_elected`, the last three set only by
`assign_package_to_election` and `election_service._sync_package_statuses`).
**Where:** `update_election_package`, `membership_pipeline_service.py`;
`ElectionPackageUpdate`, `schemas/membership_pipeline.py` (type left
unchanged — see below).
**Fix:** added `ELECTION_PACKAGE_CALLER_STATUSES = {"draft", "ready"}` and
`ELECTION_PACKAGE_SYSTEM_STATUSES = {"added_to_ballot", "elected",
"not_elected"}` module-level constants. `update_election_package` now
refuses a `status` update when the target isn't caller-settable, **or** when
the package's current status is already system-only — mirroring MP-9's fix
for `ProspectStatus.TRANSFERRED` exactly (a status the system derives must
not be settable _or clearable_ through the generic update). The Pydantic
schema field is deliberately left as `Optional[str]` rather than a `Literal`
— the existing module docstring already explains election-package status
was left off the request-schema enum validator list because it isn't a
strict MySQL `ENUM` column (unlike `step_type`/`action_type`/prospect
`status`), and duplicating the caller-settable set as a second literal in
the schema would only invite drift from the service-layer constants that are
now the single source of truth. Covered by
`TestElectionPackageStatusStateMachine`: every system/unknown status is
refused, `draft`/`ready` remain settable, a package already
`added_to_ballot` refuses _any_ status change (the specific compounding
scenario Codex described), and unrelated-field updates (`coordinator_notes`)
are unaffected.

#### MP-18 — P2 — document deletion could orphan the file on `OSError` — ✅ FIXED

**What:** `delete_prospect_document` deleted the `ProspectDocument` metadata
row and **committed** before attempting `os.remove()`; the code comment
directly above claimed the opposite order ("Remove the stored file from disk
before dropping the DB row"). A caught `OSError` (permissions, transient
filesystem error) was logged and swallowed, and the method still returned
`True` — the applicant's file, which can carry PII, survives on disk with no
database row left to retry cleanup against.
**Where:** `delete_prospect_document`, `membership_pipeline_service.py`.
**Fix:** reordered so the file removal is attempted first; a missing file
(`os.path.exists` false — already cleaned up by some earlier partial
failure) is not an error and the metadata delete proceeds as before, but a
file that exists and fails to remove now **raises** `ValueError` instead of
being swallowed — the metadata row survives specifically so it remains the
one record telling an operator this file still needs cleaning up. Added the
matching `except ValueError` → 400 in the endpoint (`membership_pipeline.py`,
which had no error handling on this call at all previously). Covered by
`TestDocumentDeletionDoesNotOrphanTheFile`: normal deletion still removes
both the file and the row; an already-missing file still deletes cleanly; a
mocked `os.remove` failure raises and leaves the metadata row (and the file)
in place.

#### MP-19 — P2 — unbounded prospect reads (`/widget-summary`, `/pipelines`) — PARTIALLY FIXED, PARTIALLY 🚩 FLAGGED

**What:** two read paths materialize every prospect row in an org rather
than aggregating in SQL — the same abuse-resistance class already tracked
as MP-10 for election packages. `GET /pipelines` (`list_pipelines`)
eager-loaded the full `MembershipPipeline.prospects` relationship (every
column of every historical applicant, across every pipeline) solely to
`len()` it per pipeline. `GET /widget-summary` (`pipeline_widget_summary`)
loads every full `ProspectiveMember` row in the org to compute status
counts, aging buckets, and (for managers) a full id/name/status `details`
list.
**Where:** `list_pipelines`, `membership_pipeline_service.py`;
`pipeline_widget_summary`, `membership_pipeline.py:118-168`.
**Disposition — `/pipelines`: FIXED.** Replaced the eager-loaded
`prospects` relationship with one aggregate `GROUP BY pipeline_id` count
query, attached as a non-mapped `prospect_count` attribute (same pattern as
`pipeline_name` on `ProspectiveMember`) — the response shape is unchanged,
so this is a pure efficiency fix with no API contract change, unlike MP-10.
Covered by `TestPipelineListProspectCount` (correct counts, including zero;
asserts via `sqlalchemy.inspect(...).unloaded` that the `prospects`
collection itself is never materialized).
**Disposition — `/widget-summary`: FLAGGED**, mirrored to
`docs/KNOWN_LIMITATIONS.md`. The aggregate counts here could similarly move
to SQL, but the `details` list is a full, uncapped enumeration in the
response contract itself — capping it silently truncates what a manager
sees (a behavior change) and paginating it is a response-envelope/frontend
contract change, the same category of decision MP-10 already declined to
make unilaterally rather than guess at.

### Completion gate (Codex-fix pass)

| Check                                                          | Result                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                  | pass, 0 violations                                                                                                                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                           | pass (2 files needed reformatting, applied, re-check pass)                                                                                                                                                                                                         |
| `isort --check-only app/ tests/ alembic/`                      | pass, 0 violations                                                                                                                                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`              | pass — 409 revisions, single head (no schema change)                                                                                                                                                                                                               |
| new guard tests (`test_membership_pipeline_pass3_codex.py`)    | 26 passed; independently confirmed to fail against the pre-fix code (`git stash` on the two changed source files — 15 of the 26 fail, matching the 5 fixed findings plus MP-19's fixed half; the other 11 are regression guards that correctly still pass pre-fix) |
| scoped election/membership/prospect/pipeline pytest (49 files) | 808 passed / 0 failed                                                                                                                                                                                                                                              |
| full backend suite (`pytest tests/ -q`)                        | 9859 passed / 21 skipped (pre-existing/environmental) / 0 failed (9833 baseline + 26 new guard tests)                                                                                                                                                              |

No frontend file changed in this pass, so `tsc`/`eslint` were not re-run.

### Original pass 3 draft (superseded above)

**Zero code diff, no new findings** — see the Revision note above; the
"no new findings" conclusion below did not hold once Codex's review looked
for the classes of defect this draft's checklist pass didn't specifically
probe (config switches with no reader, read-then-write races, error-path
ordering, and per-row query loops).

**Scope.** Diffed the full domain against pass 2's merge commit (`58535700`,
PR #1950): `endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, `frontend/src/modules/prospective-members/`, and
`frontend/src/utils/membership.ts` are all **byte-identical** to pass 2
(`git diff --stat`, not assumed — confirmed for both the declared backend
files and a broad `git diff --name-only` over all of `frontend/src/`, which
turned up one incidental hit, `RoleSetup.membership.test.ts` in the
onboarding module — a substring match on "membership" in an unrelated test
file, not this feature). Every new migration since pass 2 (24 files) was
content-grepped for `prospect|membership_pipeline|pipeline_stage`; the one
hit, `20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py`, is the
same class of false positive pass 2 already documented — every match is a
`"prospective_members.*"` permission-string literal in an unrelated
position-grant backfill, not a schema change to any table this feature owns.

Given the zero diff, this pass did not re-derive conclusions from the prior
write-up — it independently re-read the current code against all seven
`CHECKLIST.md` dimensions and re-verified, at the cited line, that every
prior fix is still in place:

- **MP-8/MP-9** (`update_prospect`, `membership_pipeline_service.py:1166`) —
  confirmed `apply_updates` is still the write path (explicit `null` clears a
  field rather than being silently dropped) and the `TRANSFERRED`-status
  guard (`:1195-1204`) still refuses to set or clear that status through the
  generic update.
- **MP-11** (`approve-step`, `membership_pipeline.py:1160-1216`) — confirmed
  the route still returns `StepApprovalResponse` (id/step/`step_completed`
  only), not the full `ProspectResponse`.
- **MP-12** (interview self-access, `membership_pipeline.py:2200-2258`) —
  confirmed both `PUT`/`DELETE /interviews/{interview_id}` still carry
  `dependencies=[Depends(block_self_interview_access)]`.
- **Pass 2's two Codex findings** (role-grant ceiling and the transfer row
  lock) — confirmed in `membership_pipeline.py:1543-1561` (role ids resolved
  in-org and run through `_enforce_role_grant_ceiling` before
  `transfer_to_membership` is called) and
  `membership_pipeline_service.py:2402-2404` (`get_prospect(...,
lock_for_update=True)` ahead of the `TRANSFERRED` check).
- **MP-10** (unbounded election-package list/create,
  `membership_pipeline_service.py:4698-4718` /
  `:4512-4631`) — confirmed still open exactly as flagged: `list_election_packages`
  is still a bare `.scalars().all()` with no `limit`/`offset`, and
  `create_election_package` still has no per-prospect ready-package cap. No
  change — still a product decision, already mirrored in
  `KNOWN_LIMITATIONS.md`.

**Fresh checks, not previously written up explicitly, all clean:**

- **Route inventory** re-enumerated from source (51 routes across both
  files): every route carries `Depends(get_current_user)` at minimum, every
  route but `approve-step` (intentional — see pass 1's Verified good) carries
  a `require_permission(...)` gate matching its sensitivity, and every by-id
  route is either explicitly org-scoped in its service call or resolved
  through an org-scoped parent. No new route since pass 1's inventory.
- **Client-supplied FKs** — re-checked every write path that accepts one:
  `update_prospect`'s `referred_by` (`assert_in_org`,
  `membership_pipeline_service.py:1181-1188`), `create_election_package`'s
  `pipeline_id`/`step_id` (`:4535-4544`), `assign_package_to_election`'s
  `election_id` (org-scoped `select`, `:4755-4763`), `link_event`'s
  `event_id` (org-scoped `select`, `:5571-5581`), and
  `transfer_prospect`'s `role_ids` (see above). All validated in-org before
  being stored; none found unvalidated.
- **`ondelete="SET NULL"` nullability** (Pitfall #2) — every `SET NULL`
  foreign key in `models/membership_pipeline.py` (11 occurrences) carries
  `nullable=True`. Read in full, not sampled.
- **LIKE escaping** (Pitfall #25) — the two `.ilike()` call sites in this
  service (`:751-755` name/email search, `:2752` an unrelated
  `TrainingProgram.name` lookup used by a stage-config helper) both pass
  `escape=LIKE_ESCAPE_CHAR`.
- **JSON-column mutation** (Pitfall #12) — `assign_package_to_election`'s
  writes to `election.ballot_items` and `pkg.package_config`
  (`:4814-4825`) both go through `copy.deepcopy()` before reassignment.
- **Injection & output encoding** — no raw SQL (`text()`/f-string `.execute`)
  anywhere in the service; every user-controlled value interpolated into the
  applicant-notification email HTML (title, format, location, org name,
  first name, custom welcome message, FAQ link, status-check URL) is
  `html.escape`d before use (`:2859-2969`).
- **File upload/download** (`add_prospect_document`,
  `download_prospect_document`, `membership_pipeline.py:1706-1857`) — magic-byte
  MIME detection (not the client `Content-Type`), UUID filename with a
  MIME-derived extension, 50 MB size cap, and org+prospect-scoped storage
  path. Download re-validates the stored path resolves inside
  `PROSPECT_DOCUMENT_DIR` via `os.path.realpath` before serving. A failed
  document-metadata write cleans up the file it already wrote to disk
  (`except ValueError` / `except Exception` both call
  `_remove_prospect_document_file`), so a rejected upload cannot leave an
  orphaned file.
- **Bulk actions bounded** — `BulkAdvanceRequest`/`BulkStatusRequest.prospect_ids`
  both declare `max_length=_MAX_BULK_PROSPECTS` (`schemas/membership_pipeline.py:529,561`).
- **Frontend module axios instance** (Pitfall #7) — `services/api.ts` builds
  its client via the shared `createApiClient` factory
  (`frontend/src/utils/createApiClient.ts`), which sets
  `withCredentials: true` and the CSRF header interceptor; not a hand-rolled
  instance missing either.
- **`UNCACHEABLE_PREFIXES`** — `/prospective-members/` is listed in
  `frontend/src/utils/apiCache.ts`, and that is the exact router prefix this
  feature is mounted under (`api/v1/api.py:267-271`).
- **No banned frontend patterns** — zero `window.confirm`/`alert`/`prompt`,
  zero `dangerouslySetInnerHTML`, zero banned `.toLocale*` calls, zero direct
  `fetch()` in `modules/prospective-members/` or `modules/membership/`
  (grepped).

**Conclusion:** no new findings. Every prior finding's fix is intact at its
original mechanism; MP-10 remains correctly OPEN/FLAGGED, unchanged.
Completion gate below. Rotation row 08 -> awaiting PR merge. Next: 09 medical
screening (PHI).

### Completion gate (pass 3)

| Check                                                        | Result                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | pass, 0 violations                                               |
| `black --check app/ tests/ alembic/`                         | pass, 1387 files unchanged                                       |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned) | pass, 0 violations                                               |
| `python3 scripts/validate_migrations.py --strict`            | pass — 409 revisions, single head                                |
| scoped pytest (20 membership/prospect/pipeline test files)   | 322 passed / 0 failed                                            |
| full backend suite (`pytest tests/ -q`)                      | 9833 passed / 21 skipped (pre-existing/environmental) / 0 failed |
| `npx tsc --noEmit`                                           | pass, 0 errors                                                   |
| `npx eslint .`                                               | pass, 0 errors (see below)                                       |

No frontend file in this feature changed, so `tsc`/`eslint` are whole-repo
runs, not a scoped diff check.

---

## Pass 2 (2026-08-27)

> **Revision note:** the backend section below, as first drafted, concluded
> the 2 changed backend files needed no further review since they matched
> already-Codex-reviewed work from PR #1931. That comparison was correct as
> far as it went, but incomplete — Codex's review of this PR's draft found
> two real, separate P1 issues in the same `transfer_prospect`/
> `transfer_to_membership`/`_do_transfer` path that PR #1931's review never
> had reason to look for (it was scoped to the administrative-rank pairing,
> not to `role_ids` or to concurrency): a missing role-grant ceiling on the
> transfer's `role_ids`, and a missing row lock making the transfer's
> already-once-fixed `ProspectStatus.TRANSFERRED` guard a check-before-write
> race. Both are recorded under Findings with what was actually done. The
> original draft's backend paragraph is left below for the record, followed
> by the corrected conclusion.

Scoped to the **full domain** since pass 1's merge commit (`aad49be4`,
PR #1815): `endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, every migration since (checked by content, not
filename, for anything touching prospect/pipeline/stage tables), and —
learning from ELEC-06/USR-07 pass 2's own correction — a `git diff --stat`
against `frontend/src/` broadly rather than only `modules/prospective-members/`,
which also caught `frontend/src/modules/membership/routes.tsx` and the new
`frontend/src/utils/membership.ts`, both outside that directory.

**Backend (2 files changed, both already reviewed):** `endpoints/membership_pipeline.py`
(+42/-1) and `services/membership_pipeline_service.py` (+37) both changed
only for the privilege-ceiling fix already made and Codex-reviewed earlier
in this same rotation, on PR #1931 (feature 02, permissions & roles pass 2)
— `transfer_prospect` resolves and validates the prospect before checking
the administrative-rank ceiling (avoiding a false CRITICAL on an invalid
prospect id), and `_do_transfer` refuses an administrative class paired with
a rank via `is_administrative(...)`, matching
`TestEveryWriterIsCovered.test_the_prospect_transfer_path_refuses_the_pair`
(verified during USR-07 pass 2). This is an INSERT path (a new `User` row
via prospect conversion) rather than an update-in-place, and the
`ProspectStatus.TRANSFERRED` guard already prevents a double-transfer race,
so it does not need the `populate_existing`/row-lock treatment the update
writers required — no finding.

**Corrected backend conclusion (Codex review on this PR):** the two findings
below are both real and both fixed.

- **Missing role-grant ceiling on `transfer_prospect`'s `role_ids`.**
  `TransferProspectRequest` carries a caller-supplied `role_ids` list, and
  `_do_transfer` resolved those ids with only an `organization_id` filter and
  attached every match to the new `User` — `create_member`'s identical
  `role_ids` handling calls `_enforce_role_grant_ceiling` right after the
  same org-scoped resolution; `transfer_prospect` never did. A caller
  holding only `members.manage`/`prospective_members.manage` (neither of
  which implies `roles.manage`) could submit a wildcard or otherwise
  more-privileged role's id and mint an account with permissions beyond
  their own — and since the same request also controls
  `department_email`, they could point the new account's welcome email at
  an address they control and log in as it themselves, a full-tenant
  escalation through the transfer path rather than the (already-guarded)
  direct-create or assign paths. Fixed in `transfer_prospect`
  (`endpoints/membership_pipeline.py`): after the existing rank-ceiling
  check and before calling `service.transfer_to_membership`, resolve
  `data.role_ids` the same way `create_member` does (org-scoped, 400 on any
  id that doesn't resolve) and run `_enforce_role_grant_ceiling` on the
  result. Covered by
  `test_transfer_prospect_calls_role_ceiling` in
  `test_privilege_ceiling_wiring.py`.
- **`transfer_to_membership` is a check-before-write with no row lock.**
  `get_prospect` supports `lock_for_update=True` and the pattern is already
  established elsewhere in this service (`complete_step_for_prospect` locks
  before its own status check, with the exact comment explaining why) — but
  `transfer_to_membership` called `get_prospect` with no lock, checked
  `ProspectStatus.TRANSFERRED`, and only set that status _after_ creating
  the new `User` row in `_do_transfer`. Two concurrent transfer requests
  supplying distinct `username`/`membership_id`/`department_email` values
  (so the `User` table's uniqueness indexes don't conflict) can both observe
  `ACTIVE` before either commits, and both create a separate `User` account
  for the same prospect — the second write to `prospect.transferred_user_id`
  simply overwrites the first, silently orphaning one of the two accounts
  from the prospect record while leaving both live. This is the same
  read-then-write shape CLAUDE.md Pitfall #27 documents for capacity checks,
  applied to a one-time status transition instead of a count. Fixed by
  adding `lock_for_update=True` to `transfer_to_membership`'s `get_prospect`
  call, ahead of the `TRANSFERRED` check (the row lock serializes the
  decision; `get_prospect`'s query already carries
  `.execution_options(populate_existing=True)` unconditionally, so no
  separate staleness fix was needed here). Covered by
  `test_transfer_locks_the_prospect_before_checking_status` in
  `test_membership_pipeline_flow.py`.

**Migrations:** content-grepped (`prospect|membership_pipeline|pipeline_stage`,
case-insensitive) across every migration added since pass 1; the 3 hits are
all false positives — permission-string substring matches in unrelated,
already-reviewed storefront-grant-backfill migrations, not schema changes to
any membership-pipeline table.

**Frontend:** reviewed via a dedicated pass over the diff for `PipelineSettingsPage.tsx`
(527 L changed), `ProspectiveMembersPage.tsx` (237 L changed),
`ApplicantDetailDrawer.tsx`, `ConversionModal.tsx`, `StageConfigModal.tsx`,
`prospective-members/routes.tsx`, `services/api.ts`, `types/index.ts`, the
new `PipelineBuilder.test.tsx`, and the new `frontend/src/utils/membership.ts`
(the frontend counterpart to `backend/app/utils/membership.py`'s class/status
split, diffed line-by-line against it). Findings:

- Most of the diff is `DialogPortal` adoption on every fixed-position dialog
  shell — the established fix for the fixed-dialog-in-a-`backdrop-blur`
  defect (Pitfall #21 family) — structural only, no behavior change.
- `mapStageUpdateToBackend` used `?? undefined` on `inactivity_timeout_days`,
  collapsing an explicit `null` (clear a per-stage override) into an omitted
  key, which the backend's `exclude_unset=True` update path reads as "leave
  alone" — unticking a custom timeout silently failed to persist. Already
  fixed in this diff (forwards `null` verbatim) and covered by new tests in
  `stageMapping.test.ts`/`PipelineBuilder.test.tsx`; the create path
  correctly keeps `null → undefined` since no "leave alone" meaning exists
  on create. No further action.
- `DEFAULT_STAGE_CONFIGS` previously covered only 7 of 12 stage types,
  crashing the editor on a stored `checklist`/`reference_check`/
  `multi_approval`/`medical_screening`/`interview_requirement` stage.
  Already fixed in this diff (one canonical table shared by the editor and
  the read boundary) and covered by new tests. No further action.
- `frontend/src/utils/membership.ts` matches `app/utils/membership.py`'s
  `_SPLIT`/`is_administrative` exactly, including the no-guessing behavior
  for unknown/custom tiers; no label or comment misrepresents backend
  enforcement (the exact bug class `BallotBuilder.tsx` had in ELEC-06 pass 2
  — not repeated here).
- `ConversionModal` disables/clears the Rank input when "Administrative" is
  picked — client-side only, but confirmed backed by the same server-side
  refusal reviewed above (`_do_transfer`'s `is_administrative(...)` check),
  so this is defense-in-depth, not the actual gate.
- Module gating (`requiredModule`/`moduleLabel`) added to
  `prospective-members/routes.tsx` and a training-history route in
  `membership/routes.tsx`. Confirmed in `ProtectedRoute.tsx` that the module
  check runs strictly after the existing `requiredPermission`/`requiredRole`
  checks and is documented as a usability gate, not access control —
  additive, not a weakening.
- No stale-response race: neither page's diff added new fetch/`useEffect`
  logic (both are pure reindentation from the `DialogPortal` change).

Frontend: no confirmed security findings, no code changes needed (the diff's
own bugs were already fixed and tested within it). Backend: 2 real P1
findings, both fixed above and each covered by a guard test confirmed to
fail against the pre-fix code via `git stash` before being counted.
Completion gate: flake8/black/isort clean on every changed file;
`test_membership_pipeline_flow.py` + `test_privilege_ceiling_wiring.py` +
`test_prospect_create_privacy.py` + `test_rejected_prospect_dropped.py` +
`test_administrative_rank_restriction.py` (95 tests) all pass; full backend
suite 9112 passed / 22 skipped (pre-existing, environment-related) / 0
failed. Rotation row 08 -> done.

---

## Pass 1 (2026-08-25)

**Backend:** `endpoints/membership_pipeline.py` (2,255 L, 51 routes), `services/membership_pipeline_service.py` (5,690 L), `models/membership_pipeline.py`, `schemas/membership_pipeline.py`, `api/prospect_privacy.py`
**Frontend:** `modules/prospective-members/` (not re-read in full this pass — see Scope)
**Migrations:** `20260812_0003_restore_active_prospect_uniqueness.py`, `20260814_0003_reconcile_active_prospect_emails.py` — reviewed this iteration, see Schema & migration notes

> **Revision note:** the pass as first drafted (below, unedited) concluded "no
> new findings." Codex's review of that draft found five real issues the
> conclusion had missed, and a sixth (a second, unguarded path to the same
> defect Codex's fourth finding covered) turned up while fixing the fourth.
> All six are recorded under Findings with what was actually done. The
> original draft's Scope, Route inventory and Verified good sections are left
> intact below except where a finding required a correction — the point of
> this note is that the "no defect" conclusion they supported was wrong, not
> that the legwork in them was.

---

## Scope

This is a re-verification pass, not a first read. `docs/module-audit/membership-pipeline.md`
(MP-1 through MP-7, all ✅ FIXED) and `docs/app-review/membership-pipeline.md`
(MP2-1 through MP2-5, all ✅ FIXED) cover the module's history through
2026-08-09; neither doc has an open finding, so this pass did not re-derive
either.

The module grew substantially since that baseline (1,763 L / 44 routes →
2,255 L / 51 routes in the endpoint file; the service file from 4,236 L to
5,690 L) entirely from ordinary feature work — none of it run through the
security-review process. This pass focused on that unreviewed surface:

- **Read in full:** every commit touching `membership_pipeline.py` or
  `membership_pipeline_service.py` since 2026-08-09 (`git log --since
2026-08-09 --until 2026-08-25`), and the current source for every function
  those commits touched — `set_prospect_status`/`_apply_status_change`/
  `_assert_open` (closed-application gating, PR #1811), `record_step_approval`/
  `_authorized_multi_approval_result`/`_accumulate_approvals` (multi-approval
  signer authorization), `complete_current_step_for_integration_event`
  (webhook stage-completion reference matching, 2026-08-17),
  `get_kanban_board`, `list_prospects`/`list_election_packages` (open/closed
  filtering), and `app/api/prospect_privacy.py` in full (self-record access
  guard).
- **Enumerated:** all 51 routes, extracted programmatically (method, path,
  function, permission dependency) — see Route inventory below. This is a
  full listing, not a sample.
- **Verified by grep, not fully re-read line-by-line:** the ~30 endpoint
  functions untouched since the 2026-08-09 baseline (pipeline/step CRUD,
  document upload/download, interviews, event links). These were in scope for
  the prior module-audit and app-review passes and are unchanged since.
- **Not read this pass:** the frontend module
  (`frontend/src/modules/prospective-members/`). PR #1811's own Codex review
  already covered the frontend changes in that PR (findings 2–4, all fixed in
  `f5b1ae6a`); no frontend-only commits landed in this feature since then that
  weren't part of that PR.
- **Explicitly out of scope:** `app/api/public/integrations_webhook.py`. It
  calls into `complete_current_step_for_integration_event` but the webhook
  endpoint itself (auth, secret verification, provider parsing) belongs to
  feature 03 (Public surface & webhooks), already reviewed under
  `PUB-03-public-surface-webhooks.md` / PR #1806. This pass only verified the
  membership-pipeline-side half of that boundary: the service method the
  webhook calls into stays org-scoped and now requires the stage's configured
  reference to match the event (see Verified good).
- **Migrations correction:** the first draft of this pass claimed "no
  migrations touch this feature's tables since the last audit." False —
  `20260812_0003_restore_active_prospect_uniqueness.py` and
  `20260814_0003_reconcile_active_prospect_emails.py` both post-date the
  2026-08-09 baseline and alter `prospective_members` (email normalization,
  reconciling duplicate active rows to `inactive`, and installing the
  `uq_prospect_org_active_email` unique index). Both are now read in full —
  see Schema & migration notes.

## Route inventory

| Method | Path                                                      | Permission                                            | Org-scoped |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| GET    | /widget-summary                                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines                                                | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines                                                | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| PATCH  | /pipelines/{pipeline_id}/report-settings                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/duplicate                        | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/seed-templates                   | members.manage / prospective_members.manage           | yes        |
| GET    | /validate-form/{form_id}                                  | prospective_members.manage                            | yes        |
| GET    | /pipelines/{pipeline_id}/steps                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/steps                            | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/reorder                    | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}/kanban                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines/{pipeline_id}/stats                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/purge-inactive                   | members.manage / prospective_members.manage           | yes        |
| GET    | /source-events                                            | prospective_members.view / .manage                    | yes        |
| GET    | /prospects                                                | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/check-existing                                 | members.create / prospective_members.manage           | yes        |
| POST   | /prospects                                                | members.create / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /prospects/{prospect_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/complete-step                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/approve-step                     | _(auth only — see note)_                              | yes        |
| POST   | /prospects/{prospect_id}/skip-step                        | prospective_members.manage                            | yes        |
| POST   | /prospects/{prospect_id}/advance                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-advance                                   | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/status                           | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-status                                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/regress                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/transfer                         | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/activity                         | prospective_members.view / .manage                    | yes        |
| GET    | /prospects/{prospect_id}/documents                        | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/documents                        | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/documents/{document_id}/download | prospective_members.view / .manage                    | yes        |
| DELETE | /prospects/{prospect_id}/documents/{document_id}          | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/election-package                 | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| PUT    | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| GET    | /election-packages                                        | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package/assign          | elections.manage / prospective_members.manage         | yes        |
| POST   | /prospects/process-inactivity                             | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/interviews                       | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/interviews                       | prospective_members.manage                            | yes        |
| PUT    | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| DELETE | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| GET    | /prospects/{prospect_id}/events                           | prospective_members.view                              | yes        |
| POST   | /prospects/{prospect_id}/events                           | prospective_members.manage                            | yes        |
| DELETE | /prospects/{prospect_id}/events/{link_id}                 | prospective_members.manage                            | yes        |

**Note on `/prospects/{prospect_id}/approve-step`:** the only route with no
`require_permission` gate (`membership_pipeline.py:1155`, `Depends(get_current_user)`
only). This is intentional — see Verified good below — but its response shape
was not (MP-11, FIXED).

Every route also sits behind the router-level `block_self_prospect_access`
dependency (`membership_pipeline.py:95`), so a `{prospect_id}` route is
additionally checked against the caller's own record regardless of permission.
**Correction:** `PUT`/`DELETE /interviews/{interview_id}` carry no
`{prospect_id}` path parameter and were not actually covered by this — see
MP-12.

## Verified good ✅

- **`approve-step`'s missing permission gate is closed by a server-side role
  check, not client input.** `record_step_approval`
  (`membership_pipeline_service.py:1564`) accepts a client-supplied `role`,
  but the string only decides _which_ configured approver role is being
  claimed — it never authorizes anything by itself. `complete_step` routes
  every multi-approval submission through
  `_authorized_multi_approval_result` (`membership_pipeline_service.py:1422`),
  which re-queries the authenticated signer's own `User.positions` (in-org,
  active, not soft-deleted) and rejects any submitted role the signer does not
  actually hold (`"You may only approve for a role you currently hold"`,
  line 1477). A caller cannot claim a role they lack, and cannot claim to be
  someone else — `completed_by`/`signer_id` come from `current_user.id`, never
  from the request body. This claim was correct as far as it went — it is
  about _who may sign_, not about _what the caller gets back_ for signing,
  which is a separate question the first draft conflated with this one and
  answered wrong. See MP-11.
- **Closed-application gating (PR #1811) is applied everywhere a closed
  applicant could otherwise re-enter workflow.** `_assert_open`
  (`membership_pipeline_service.py:133`) is called from
  `create_election_package` (line 4486), `assign_package_to_election`
  (line 4703), and `create_interview` (line 5235) — the three actions the
  commit identifies as consequential (a ballot package, assigning it to an
  election, and a fresh interview against a closed file). `_apply_status_change`
  (line 2156) is the single write path both the single-record and bulk status
  endpoints go through, and it explicitly refuses to set or clear
  `TRANSFERRED` (lines 2180–2188) — closing the P1 Codex found on the PR
  itself (setting `transferred` via status-change bypassed
  `transfer_prospect`'s User-creation side effects; clearing it would return
  an existing member to the applicant board under the active-email unique
  index).
- **The webhook stage-auto-completion path
  (`complete_current_step_for_integration_event`,
  `membership_pipeline_service.py:1861`) is org-scoped and reference-matched.**
  The prospect query filters `organization_id == organization_id` and
  `status == ACTIVE` (lines 1897–1898) before any email match is attempted, so
  a webhook cannot complete a stage for a prospect in a different
  organization even given a colliding email. The 2026-08-17 fix
  (`e1f6ea46`) added the `event_reference`/`reference_config_key` match
  (lines 1924–1931): the step's own configured booking URL / template id must
  match the inbound webhook event, closing the earlier gap where any webhook
  event for a matching email + step type + provider could complete an
  unrelated stage (e.g. a different Cal.com booking for the same applicant).
- **Self-record access is blocked router-wide for every route that carries a
  `{prospect_id}` path parameter — but that claim, as first drafted, silently
  assumed every by-id route in this router carries one.** It doesn't: see
  MP-12. `app/api/prospect_privacy.py`'s `block_self_prospect_access` is
  installed as a router-level dependency (`membership_pipeline.py:95`,
  `APIRouter(dependencies=[Depends(block_self_prospect_access)])`), so a new
  `{prospect_id}` route added later inherits the guard without needing to
  remember it. It answers 404 (not 403) on a match, deliberately, so a 403
  doesn't confirm existence. `get_hidden_prospect_ids` (the list-filtering
  counterpart) is applied at all 8 endpoints that return multiple prospects
  or packages at once: `widget-summary`, `pipelines/{id}/kanban`,
  `pipelines/{id}/stats`, `source-events`, `prospects`, `prospects/bulk-advance`,
  `prospects/bulk-status`, and `election-packages` — confirmed by grep for
  `hidden_prospect_ids` across the endpoint file. The per-prospect
  `{prospect_id}/events` list route does not need it (and doesn't have it):
  it is already covered by the router-level `block_self_prospect_access`
  guard on its own `{prospect_id}` path parameter, same as every other
  by-id route.
- **LIKE search is escaped correctly.** The two `.ilike()` call sites in this
  service (`membership_pipeline_service.py:750-754`, name/email search, and
  `:2708`, a system-generated `"%probationary%"` lookup) both pass
  `escape=LIKE_ESCAPE_CHAR` from `app/utils/sql_search.py`, per Pitfall #25.
- **Prospect-id normalization in the self-access guard resists the
  case/format bypass.** `normalize_prospect_id`
  (`app/api/prospect_privacy.py:82`) routes both the stored id and the
  path-supplied id through `uuid.UUID()` before comparison, so re-casing or
  unhyphenating a caller's own id (MySQL's default collation is
  case-insensitive) cannot walk past the guard.

## Findings

Six, all from the code this pass's own draft had just called sound. Five were
caught by Codex's review of that draft; the sixth turned up while fixing the
fourth. All are fixed except the one flagged.

### MP-8 — MED — `update_prospect` silently dropped explicit nulls — ✅ FIXED

**What:** the generic setattr loop used `if value is not None and
hasattr(prospect, key):` to decide whether to write a field. The endpoint
builds `data` via `ProspectUpdate.model_dump(exclude_unset=True)`, so a key
present in `data` was explicitly sent by the caller — an explicit `null`
means "clear this field," per CLAUDE.md Pitfall #1. The old guard treated it
identically to an omitted key and silently kept the old value.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`).
**Failure scenario:** `PUT /prospects/{id}` with `{"referred_by": null}` (or
`phone`, `date_of_birth`, `address_street`, ...) returns 200. The coordinator
believes the referral was cleared; the stale `referred_by` — a client-supplied
FK — survives, including into a later `transfer_prospect` copy onto the new
User row.
**Impact:** silent data-integrity loss on every nullable field this update
endpoint owns; low severity per-field, but it is the exact class of bug
CLAUDE.md calls the project's most common.
**Fix:** rewrote `update_prospect` to use the repository's `apply_updates`
helper (`app/utils/model_updates.py`), already the pattern for pipeline and
step updates in this same service. It writes an explicit null as a clear, and
raises `ValueError` → 400 (instead of a silent no-op) when the null targets a
`NOT NULL` column (e.g. `email`, `status`) rather than accepting an update
that didn't do what it said. Old values are captured before the write so the
existing `prospect_updated` activity-log diff (including the MP-6
sensitive-field masking for DOB/address) is unchanged.

### MP-9 — HIGH — a second, unguarded path to set or clear `TRANSFERRED` — ✅ FIXED

**What:** discovered while fixing MP-8. `ProspectUpdate` includes `status`,
and the old `update_prospect` loop wrote it with the same bare `setattr` as
every other field — it never routed through `_apply_status_change`, so it
carried none of that function's guards, including the one PR #1811's own
Codex review added (P1: `TRANSFERRED` is derived by `transfer_prospect` and
must not be set or cleared through a status change). The dedicated status
endpoints (`/prospects/{id}/status`, `/prospects/bulk-status`) were fixed;
the older, still-live `PUT /prospects/{id}` was not.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`); the
frontend still sends `status` through this endpoint's payload for some edit
paths (`modules/prospective-members/services/api.ts:744,1098`).
**Failure scenario:** `PUT /prospects/{id}` with `{"status": "transferred"}`
marks an applicant a member with no `transfer_prospect` run — no User row, no
`transferred_user_id`/`transferred_at` stamped — while counting as a
conversion in the stats. The mirror case is worse: `PUT` with
`{"status": "active"}` against a prospect already `TRANSFERRED` returns an
existing member to the applicant board, racing the
`uq_prospect_org_active_email` unique index against their own active-email
prospect record from before they transferred.
**Impact:** the exact state-corruption / membership-integrity issue Codex's
P1 on #1811 was written to close, reachable through a route that predates
that fix and was never touched by it.
**Fix:** `update_prospect` now parses a submitted `status` and refuses it,
with the same message as `_apply_status_change`, when either the target or
the prospect's current status is `TRANSFERRED`. An ordinary status edit
(e.g. `active` → `on_hold`) through this endpoint is unaffected.

### MP-10 — MED — unbounded election-package list and creation — 🚩 FLAGGED (creation ✅ resolved 2026-10-11)

> **Owner decision 2026-10-05, built 2026-10-11:** regenerating replaces the
> prospect's draft/ready package (deleted in the same transaction, under the
> prospect row lock); packages on a ballot or decided are kept, and notes and
> config carry over. The list endpoint stays unpaginated by decision. See
> `docs/KNOWN_LIMITATIONS.md`.

**What:** `list_election_packages` (`membership_pipeline_service.py:4638`)
runs `result.scalars().all()` with no `limit`/pagination, and
`create_election_package` (`:4468`) has no per-prospect or per-organization
cap — no unique constraint on `ProspectElectionPackage.prospect_id`, and no
"already has a ready package" check. Every `POST
/prospects/{id}/election-package` call inserts a new row; the doc snapshot
each carries (documents, coordinator notes, config) persists indefinitely.
**Where:** `membership_pipeline_service.py:4638` (list),
`membership_pipeline_service.py:4468` (create).
**Failure scenario:** repeated legitimate package regeneration (e.g. after
editing coordinator notes) for even one applicant accumulates rows without
bound; `GET /election-packages` — the list an election officer assembles a
ballot from — grows in lockstep, along with the PII-carrying snapshots each
row holds.
**Impact:** same class already tracked elsewhere in this rotation (FIN-9,
ELEC-12, USR-5) — unbounded accumulation of PII-carrying rows and an
ever-growing scan on a route with no natural ceiling.
**Fix:** not applied. Enforcing one ready package per prospect is a behavior
change (could break an intended "regenerate before the vote" flow); adding
pagination to `GET /election-packages` is a response-envelope/API-contract
change for the frontend, same as the other three unbounded-list items this
rotation has flagged rather than fixed. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### MP-11 — HIGH — `/approve-step` returned full prospect PII to a caller with no view permission — ✅ FIXED

**What:** the endpoint authorizes a caller by the role they hold on a
multi-approval stage (`_authorized_multi_approval_result`, see Verified
good) — deliberately not gated by `prospective_members.view`, since a stage's
approver roles (chief, president, ...) are rarely held by anyone with view
access. It nonetheless returned the full `ProspectResponse` — DOB, full
address, phone, `interest_reason`, `notes` (coordinator commentary),
`step_progress` — as the HTTP response body.
**Where:** `membership_pipeline.py:1152` (`response_model=ProspectResponse`,
`return prospect`).
**Failure scenario:** a member holding only a stage's configured office
(e.g. Fire Chief), with no `prospective_members.*` permission at all, submits
their one authorized sign-off and receives the applicant's full confidential
file in the response — everything the role check was designed to keep out of
their hands, as a side effect of an action the role check correctly let them
take.
**Impact:** PII/PHI-adjacent exposure to a caller class this router
specifically does not extend view access to.
**Fix:** added `StepApprovalResponse` (`schemas/membership_pipeline.py`) — a
minimal `{prospect_id, step_id, step_completed}` result — and changed the
route's `response_model` to it. `step_completed` is derived from the
returned prospect's own `step_progress` row for the submitted step
(`status == COMPLETED`), not re-derived business logic. No frontend consumes
this endpoint (checked — no match for `approve-step` anywhere under
`frontend/src/modules/prospective-members` or elsewhere), so the response
shape change has no caller to break.

### MP-12 — HIGH — `PUT`/`DELETE /interviews/{interview_id}` bypassed the self-access guard — ✅ FIXED

**What:** `block_self_prospect_access` is keyed on
`request.path_params.get("prospect_id")`. The two interview-mutation routes
are registered at `/interviews/{interview_id}` — no `{prospect_id}` in their
path — so the guard's lookup always returns `None` and the dependency no-ops
for them. `delete_interview` (`membership_pipeline_service.py:5368`) resolves
purely by `interview_id` + `organization_id`, with no check against who the
interview is about.
**Where:** `membership_pipeline.py:2139` (`update_interview` decorator),
`membership_pipeline.py:2174` (`delete_interview` decorator).
**Failure scenario:** a caller who holds `prospective_members.manage` — a
coordinator role a former applicant can hold once transferred to membership —
knows or guesses the id of an interview filed against their own past
application, and calls `DELETE /interviews/{id}` (no identity check on the
service side at all) or, if they happen to be the recorded interviewer,
`PUT` to alter it. This is exactly the class of self-access the router-level
guard exists to close everywhere else in this feature.
**Impact:** an applicant-turned-coordinator can destroy or alter the record
of their own vetting.
**Fix:** added `block_self_interview_access`
(`app/api/prospect_privacy.py`) — resolves `interview_id` to its owning
`ProspectiveMember` via a join and applies the same `self_prospect_predicate`
check as the router-level guard, answering 404 (not 403) on a match, for the
same reason. Wired as a per-route `dependencies=[...]` on both interview
mutation routes, since they sit outside the router-level guard's path-param
assumption.

## Schema & migration notes

`20260812_0003_restore_active_prospect_uniqueness.py` and
`20260814_0003_reconcile_active_prospect_emails.py` (both post-dating the
2026-08-09 baseline, per Codex — see Scope) were read in full this pass. Both
are org-scoped throughout (`keeper.organization_id = duplicate.organization_id`
in the dedup `UPDATE`, and the unique index itself is on
`(organization_id, active_email)`, not a bare `email` uniqueness that would
leak across tenants), both guard on `prospective_members` existing before
touching it (Pitfall #26), and both are textually-identical copies of the
same repair by design (`20260812_0003`'s own comment explains why: it runs
_before_ `20260814_0003` in the chain, so a fresh install with legacy
duplicate active emails would fail inside `op.create_index` and never reach
the later revision's cleanup without its own copy). No defect found in
either; this is a scope correction to the first draft, not a new finding.

No other migrations touch this feature's tables since the last audit.

## Guard tests added

- `backend/tests/test_rejected_prospect_dropped.py` —
  `TestGenericUpdateStatusGuard` (MP-9: `update_prospect` refuses to set or
  clear `TRANSFERRED`, and an ordinary status edit through the same endpoint
  still works) and `TestGenericUpdateExplicitNull` (MP-8: an explicit null
  clears `referred_by`/`phone`, and an explicit null against the `NOT NULL`
  `email` column is a 400, not a silent no-op).
- `backend/tests/test_prospect_self_access.py` — `TestInterviewRouteGuard`
  (MP-12: the guard is registered on both interview routes; a caller's own
  interview is 404 on `PUT`/`DELETE` while another applicant's is editable).
- `backend/tests/test_approve_step_response.py` (new file, MP-11): the
  response body from a successful approval contains exactly `{prospect_id,
step_id, step_completed}` — no prospect PII field, checked both by key-set
  and by asserting applicant-identifying strings are absent from the raw
  response body — for both a stage-completing approval and a partial one.

## Completion gate

| Check                                                       | Result                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `flake8` (touched files)                                    | pass                                                |
| `black --check` (touched files)                             | 2 files needed reformatting, applied, re-check pass |
| `isort --check-only` (touched files)                        | pass                                                |
| `python3 scripts/validate_migrations.py --strict`           | pass (357 migrations, single head)                  |
| `pytest` — full membership-pipeline test surface (17 files) | 228 passed                                          |
| `pytest tests/test_pii_exposure.py`                         | 37 passed                                           |
| `npx tsc --noEmit`                                          | pass (no frontend files changed)                    |

Test files run: `test_rejected_prospect_dropped.py`, `test_prospect_self_access.py`,
`test_approve_step_response.py`, `test_membership_pipeline_service.py`,
`test_multi_approval_accumulation.py`, `test_prospect_bulk_actions.py`,
`test_membership_pipeline_flow.py`, `test_membership_pipeline_enum_validation.py`,
`test_active_prospect_uniqueness.py`, `test_pipeline_stage_auto_advance.py`,
`test_pipeline_widget_privacy.py`, `test_prospect_create_privacy.py`,
`test_prospect_duplicate_response.py`, `test_prospect_event_source.py`,
`test_prospect_fields.py`, `test_prospect_pipeline_scaling.py`,
`test_prospect_stage_movement.py` — every file under `backend/tests/` whose
name matches `membership`, `prospect`, or `pipeline`, run in full rather than
filtered by `-k`, per this rotation's standing practice of not trusting a
keyword filter's apparent match.
