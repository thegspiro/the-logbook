# ADV-02 — Adversarial Pass Over a Month of Commits (2026-11-14)

A one-off review outside the feature rotation, like ADV-01. Everything merged
between 2026-10-14 and 2026-11-14 (diff base `80d92defd`, about 576 non-merge
commits) was attacked from the positions of an outsider, a session thief, a
baseline member, and an officer holding a narrow delegated permission. The
work was split six ways:

- public, token and webhook surfaces;
- authentication, step-up, MFA, passkeys and OAuth integrations;
- uploads, imports, PDF and email rendering;
- two authorization/IDOR sweeps across the new and changed endpoints;
- the frontend and the deployment configuration.

Every finding below was traced in the code end to end before it was accepted,
and every fix ships with a test seen to fail without it. The rotation's
`PROGRESS.md` is not edited by this pass, so it does not contend with the
rotation's own open pull request.

## Findings

| ID      | Persona       | Severity | Finding                                                                                                                                                            | Status |
| ------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| ADV2-1  | Session thief | High     | A passkey-only member's session could enroll an authenticator app with no step-up, replace the recovery codes, then pass step-up with TOTP in place of the passkey | Fixed  |
| ADV2-2  | Session thief | Medium   | A member's own login email changed with no step-up, so a stolen session plus forgot-password set a new password                                                    | Fixed  |
| ADV2-3  | Officer       | Medium   | A shift-report role reviewer could approve a report they filed, and review drafts or already-released reports by id                                                | Fixed  |
| ADV2-4  | Officer       | Medium   | One officer could conduct, calibrate and approve the same personnel evaluation                                                                                     | Fixed  |
| ADV2-5  | Officer       | Low–Med  | The Chief could grant a training-requirement override to themselves                                                                                                | Fixed  |
| ADV2-6  | Officer       | Low      | `members.manage` could repoint the personal email of a member above its ceiling and collect a retried directory-account password                                   | Fixed  |
| ADV2-7  | Member        | Low      | Draft events were still reachable through the QR payload, self-check-in, the event folder and the training-session lookup                                          | Fixed  |
| ADV2-8  | Officer       | Low      | A shift officer without `scheduling.manage` can write their own close-out hours (predates the window)                                                              | Fixed  |
| ADV2-9  | Officer       | Low      | An officer with `members.manage` + `scheduling.assign` can grant themselves a leave, which creates their own training waiver (predates the window)                 | Fixed  |
| ADV2-10 | Applicant     | Low      | An applicant can set their own follow-up-form email (or name and birth date) to a coordinator's, so the coordinator's self-access guard hides the file from them   | Fixed  |
| ADV2-11 | Outsider      | Info     | A Zeffy dues payment credits whichever member's email the payer typed, and overpayment becomes a donation in that member's name                                    | Fixed  |

## Fixes

- **ADV2-1**: `POST /auth/mfa/setup` and `/auth/mfa/verify-setup` now call
  `_require_stepup_once_enrolled`, as the passkey routes already did. A
  first-factor enrollment is unchanged. `verify-setup` checks after the
  idempotent replay, so a retry of a first enrollment is not asked to step up.
  Tests: `TestAuthenticatorEnrollmentNeedsStepUpOverAPasskey` in
  `tests/test_auth_mfa_endpoints.py`.
- **ADV2-2**: `PATCH /users/{id}/contact-info` requires a fresh step-up for
  every email change, the member's own included. A colleague's change keeps its
  ceiling. The frontend's API client already answers `LB-AUTH-013` with the
  step-up prompt and retries, so no UI change is needed. Tests:
  `TestOwnEmailChange` in `tests/test_contact_info_email_takeover.py`.
- **ADV2-3**: For a role reviewer (not `training.manage`), `_not_about_reviewer`
  now also excludes reports the reviewer filed, from the queue as well as from
  review. Both review routes accept only `pending_review` or `flagged` reports
  and answer 409 otherwise, which is the set the read path already limited them
  to. Tests: `tests/test_shift_report_reviewer_role.py`.
- **ADV2-5**: `RequirementOverrideService.grant` refuses
  `user_id == granted_by`. The Chief's own absence goes through the
  attendance-waiver workflow, which routes it to someone else. Test:
  `test_the_chief_cannot_override_their_own_requirement`.
- **ADV2-6**: A colleague's `personal_email` change in `PATCH /users/{id}` takes
  `_enforce_account_reset_ceiling`. Tests: `tests/test_personal_email_ceiling.py`.
- **ADV2-7**: `EventService.get_qr_check_in_data` and `self_check_in` refuse a
  draft outright. Nothing can be checked into before publication, and this
  covers the NFC and kiosk taps that route through the same service. The folder
  and training-session reads answer a non-organizer as for a missing event.
  Tests: `tests/test_draft_event_side_paths.py`.

Separately, `main` had two Alembic heads (`4d8e2b6f1c93` on the History branch,
`c4e81b7a2d95`), so `alembic upgrade head` refused to run. Merge revision
`e2b7d94c1a63` joins them.

## ADV2-4 fix (2026-11-16)

Owner decisions: refuse the evaluator; a manager may name who takes a step,
and the named person is the only one who may; any current member may be
named; one person never signs two approvals on a revision.

- `_signable` refuses the evaluator and anyone who signed another approval on
  the revision. `complete_calibration` refuses the evaluator. Both honour
  `evaluation_steps.assignee_id` (migration `a6c3e8d17f42`) in place of the
  position or `view_all` holders.
- `PUT /evaluations/{id}/steps/{key}/assignee` takes `evaluations.manage`
  and step-up. It is audited at `warning` with both names, and emails the new
  assignee when the step is open. `GET .../assignee-candidates` lists who may
  be named, by the same rules.
- The calibration route moved from a `view_all` gate to sign-in, because a
  named calibrator may hold no `view_all`. The service makes the decision, and
  the route is in `tests/permissionless_route_baseline.txt` with that reason.
- Step notices never ask the evaluator to approve or calibrate their own
  evaluation.
- Tests: `TestSeparationOfDuties` in `tests/test_evaluation_workflow.py`
  (three of its tests failed before the fix) and
  `tests/test_evaluation_step_assignee_migration.py`. For the frontend, the
  step-assignment cases in `EvaluationDetailPage.test.tsx`.

## ADV2-8 fix (2026-11-20)

Owner decision: block a shift officer from recording their own close-out
hours. A holder of `scheduling.manage` is not affected.

- `PATCH /scheduling/shifts/{id}/closeout/attendance` refuses (403) a change
  to the caller's own check-in, check-out or hours. The row is compared to the
  minute, so the wizard sending back the stored values unchanged is not a
  change and is not refused. Nothing is written when it refuses.
- `POST /scheduling/shifts/{id}/finalize` refuses `manual_hours` for the
  caller, and `POST /scheduling/shifts/{id}/attendance` refuses adding the
  caller.
- The close-out state carries `own_hours_locked_user_id`. The wizard disables
  that member's time and hours fields and explains that a scheduling admin can
  correct them.
- Tests: `tests/test_shift_closeout_own_hours.py` (seven tests, each of which
  failed before the fix), and the "officer's own row" cases in
  `ShiftCloseoutWizard.test.tsx`.

## ADV2-9 fix (2026-11-21)

Owner decision: block it. Nobody grants or extends their own leave of absence.

- `MemberLeaveService.create_leave` refuses `user_id == granted_by`, so the
  rule holds for every caller, not only the route.
  `POST /users/leaves-of-absence` answers 400.
- `PATCH /users/leaves-of-absence/{id}` answers 403 on the caller's own leave:
  extending it, or turning its training waiver back on, excuses requirements
  as granting one does.
- The caller's own leave goes through `POST /users/leave-requests`, which they
  cannot decide. An approval creates the leave with the voter as
  `granted_by`, so it never meets the refusal.
- `DELETE /users/leaves-of-absence/{id}` is unchanged: ending one's own leave early
  excuses nothing.
- Tests: `tests/test_member_leave_self_grant.py` (five tests; the three
  refusals failed before the fix).

## ADV2-11 fix (2026-11-21)

Owner decisions: hold a Zeffy dues payment as unmatched until a treasurer
confirms it; the treasurer chooses whether an overpayment becomes the member's
donation; any current member with open dues may be chosen, not only the email
match; `finance.manage` confirms, with no step-up, as for a dues payment
recorded by hand; payments already credited stay as they are.

- `ZeffySyncService` no longer credits dues. A payment to a campaign linked to
  a dues schedule is recorded `unmatched`, with a detail saying whether the
  payer's email matches a current member. The hourly retry re-reads that
  suggestion and never credits.
- `GET /grants/zeffy/payments/{id}/dues-match` (`finance.manage`) returns the
  net amount, the suggested member, and every current member with open dues
  on the schedule with what their oldest open dues still owe.
- `POST /grants/zeffy/payments/{id}/confirm-dues` (`finance.manage`) credits
  the chosen member's oldest open dues under the payment's row lock, with the
  open dues chosen by a locking read. An overpayment is refused unless
  `excessAsDonation`; the treasurer may not credit their own dues; a second
  confirmation answers 409. Audited at `warning` as
  `zeffy_dues_payment_confirmed`.
- The Zeffy page shows **Confirm member** on a held payment to a
  `finance.manage` holder, and the status reads **Awaiting confirmation**.
- Tests: `TestMembershipDues`, `TestTreasurerConfirmsDues` and
  `TestDuesSelection` in `tests/test_zeffy_sync_service.py` (each failed
  against the old service), `TestConfirmDues` in
  `tests/test_zeffy_endpoints.py`, and the confirmation cases in
  `ZeffyPage.test.tsx`.

## ADV2-10 fix (2026-11-21)

Owner decisions: once the applicant edits their email, name or date of birth,
the self-access guard trusts only `transferred_user_id` for that record; only
follow-up form edits count, not the first public application; a coordinator's
correction restores the other identifiers; applications already edited are
backfilled.

- `prospective_members.identity_edited_by_applicant_at` (migration
  `809893462b67`). `FollowUpFormService.submit` stamps it when a change to
  `email`, `first_name`, `last_name` or `date_of_birth` is applied.
  `MembershipPipelineService.update_prospect` clears it when a coordinator
  changes one of them, and refuses it as a client-written field.
- `app/api/prospect_privacy.py` matches by email or by name and birth date only
  while the stamp is empty. The transfer back-link always counts.
- The migration replays `prospect_activity_log`: a follow-up submission whose
  `changed_fields` names an identity field stamps the record, and a later
  `prospect_updated` naming one clears it.
- Left as is: the first public application is still matched on what the
  applicant typed (`docs/KNOWN_LIMITATIONS.md`).
- The migration also joins `main`'s two heads, `67f75ff116ae` and
  `6a94645761c1`.
- Tests: `tests/test_prospect_applicant_edited_identity.py` (four of its seven
  failed before the fix) and `tests/test_prospect_identity_edited_migration.py`.

## Awaiting an owner decision

- **ADV2-4**: resolved 2026-11-16, owner's option 2 (refuse, and add a
  manager's reassign-step action). See "ADV2-4 fix" above.
- **ADV2-8**: resolved 2026-11-20. See "ADV2-8 fix" above.
- **ADV2-9**: resolved 2026-11-21. See "ADV2-9 fix" above.
- **ADV2-10**: resolved 2026-11-21. See "ADV2-10 fix" above.
- **ADV2-11**: resolved 2026-11-21. See "ADV2-11 fix" above.

## Checked and clean

- **Public surfaces**:
  - Zeffy webhook: HMAC over the raw body, replay window, idempotent on the
    payment id.
  - Follow-up form and preceptor links: hashed 256-bit tokens, single use, one
    404 for every refusal.
  - Event guest QR and kiosk.
  - Department and applicant ICS feeds.
  - Finance approval links.
  - Public minutes (allowlisted projection, nh3 plus DOMPurify).
  - Embed origins (exact https origins, re-validated on read).
  - Public portal stats.
- **Authentication**:
  - Passkeys: challenges single use and bound to the user and purpose, rpId and
    origin pinned, UV required.
  - MFA login binding and lockout, refresh rotation.
  - Step-up stamped per session.
  - Admin MFA and passkey reset ceilings.
  - Role and rank grant ceilings.
  - Calendar and QuickBooks OAuth state binding, with PKCE and encrypted tokens.
  - MCP tools mirror the REST visibility filters.
- **Files and rendering**:
  - History media: extension and content agree; ffmpeg runs with forced
    demuxers, `-protocol_whitelist file` and a timeout; images re-encoded and
    EXIF stripped.
  - Path containment in `file_storage_service.resolve`.
  - Content-Disposition built through RFC 5987.
  - Rich text and markdown sanitized with nh3.
  - Every ReportLab field escaped; no URL-fetching renderer.
  - No Jinja.
  - CSV imports byte- and row-capped, with no XLSX or zip parsing.
  - Exports through `SafeCsvChunks`.
- **Authorization**:
  - Finance approvals and the second approval.
  - Elections and proxies.
  - Waivers.
  - Evaluations: reads and the other writes.
  - NFC card issuance.
  - Audit, error and platform analytics: org-scoped.
  - Forms' sensitive answers.
- **Frontend and infrastructure**:
  - DOMPurify instances allowlisted.
  - Post-login redirect same-origin only.
  - No tokens in browser storage.
  - New GET routes covered by `UNCACHEABLE_PREFIXES`.
  - Release workflow: tag-triggered, SHA-pinned actions, no untrusted
    interpolation.
  - The combined image binds uvicorn to loopback and refuses `*` for forwarded
    IPs.
  - Redis requires its password.

## Notes below the bar

- `utils/minutes_pdf_attachments.py` copies a filed PDF's pages, annotations
  included, into the minutes export. Only `minutes.manage` holders upload these
  files, and every reader could already download the original. Flattening or
  stripping `/AA` and JavaScript actions is optional hardening.
- `EMAIL_ATTACHMENT_RULES` accepts SVG. No route serves that storage area from
  the app origin today. If one is ever added, it must serve SVG as an
  attachment.
