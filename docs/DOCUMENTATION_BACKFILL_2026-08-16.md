# Documentation backfill — 2026-08-16 history audit

A commit-by-commit audit of the repository's complete first-parent history
(which begins 2026-08-08) against the documentation corpus (CHANGELOG, `docs/`,
`wiki/`, training guides). Roughly 230 commits were checked in three windows;
~40 substantive changes had never been documented, and five were **actively
contradicted** by documentation still in force. This file records the
disposition of every finding so the next audit doesn't re-litigate them.

Method: each window was swept by an independent search pass; every substantive
commit was greped for in the corpus using terms from both the subject and the
diff (endpoint paths, setting names, permission strings, table names).
Findings were re-verified against the code before any doc was changed.

## Contradictions corrected (docs said the opposite of the code)

| Change (merge date)                                                                                         | Was wrong in                                                                                                                                                            | Fixed                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Restock withdrawal / lot swap went manage-only; deployed-lot `lot_number`/`expiration_date` guarded (08-11) | `wiki/Module-Scheduling.md`, `wiki/API-Reference.md`, `APPLICATION_PAGES.md`, `wiki/Module-Apparatus.md` — all said every supply write accepts `equipment_check.submit` | All four corrected with the split (usage reporting stays crew-level)                      |
| `expiration_found` no longer written back onto the template item (08-11)                                    | `wiki/Database-Schema.md`, `ARCHITECTURE.md` said it is written back                                                                                                    | Both corrected; rationale (expired-item auto-fail bypass) recorded                        |
| `prospect_created` removed from guest check-in response (08-11)                                             | `wiki/API-Reference.md` still listed the field                                                                                                                          | Corrected with the enumeration rationale                                                  |
| Shift-report training credit releases only on `approved` (08-11/12)                                         | `wiki/Module-Scheduling.md` said `approved` **or** `pending_review`                                                                                                     | Corrected; trainee-read-at-404 rule added                                                 |
| Un-waive erases `waive_reason` instead of copying it into the audit event (08-13)                           | `docs/FINANCE_MODULE.md`, `wiki/Security-Audit-Logging.md`, `docs/RELEASE_CANDIDATE_PLAN.md` documented the opposite (by design at the time)                            | All three corrected, marked as a deliberate reversal with the privacy-scrubbing rationale |
| Seeder `--password`/`--examiner-password` flags removed (08-11)                                             | `docs/SKILLS_TESTING_DATA_REVIEW.md` instructed passing them                                                                                                            | Corrected (env vars / getpass)                                                            |
| PWA update flow reworked to one-reload (08-12)                                                              | `docs/training/10-mobile-pwa.md` described the old click-to-refresh behavior                                                                                            | Rewritten                                                                                 |
| `RequirementModal` no longer lives only on `TrainingRequirementsPage` (08-08)                               | `docs/COMPLIANCE_CONFIG.md`                                                                                                                                             | Corrected                                                                                 |
| Sidebar "Events Admin" → "Manage Events", `/events/new` retired (08-13)                                     | `docs/training/04-events-meetings.md`, `wiki/Module-Events.md`                                                                                                          | Dated rename note at first use; route table annotated                                     |

## Undocumented changes now recorded

All are written up in the CHANGELOG under **"Documentation backfill: August
8–14 changes recovered by a history audit (2026-08-16)"**, dated by actual
merge date. The ones that also needed a reference-doc home received it:

- Phase↔requirement linking and `owns_requirement` deletion semantics →
  `docs/TRAINING_PROGRAMS.md` (program-editing list)
- Requirements-tab editing → `docs/TRAINING_PROGRAMS.md` (Option B preamble)
- Check-in window settings (`checkin_opens_hours_before` / `_closes_hours_after`)
  → `wiki/Module-Scheduling.md` settings table
- Startup guard refusing destructive fresh-init on unknown revisions →
  `docs/TROUBLESHOOTING.md` ("Migration version mismatch") and
  `docs/ALEMBIC_MIGRATIONS.md` (new section); the stale "current head" banner
  in `ALEMBIC_MIGRATIONS.md` was updated to `20260816_0001` in the same pass
- Onboarding position-editor permission semantics (`_VIEW_ONLY_SUBPERMISSIONS`)
  → `ROLE_SYSTEM_README.md` ("Onboarding Position Editor Semantics")
- Compliance permission tightening (`reports.manage`, `compliance.view`
  dropped) → `docs/COMPLIANCE_CONFIG.md` (note under the endpoint table)
- Bulk checklist-link audit event and `sanitize_path` token redaction →
  `wiki/Security-Audit-Logging.md` event table
- Skill-template duplication copying result-visibility; void suppression for
  never-validated tests → `docs/SKILLS_TESTING_FEATURE.md`

## Assessed and left as changelog-only

Recorded in the CHANGELOG backfill but judged not to need a standing
reference-doc section: the member-import rejected-rows CSV writer, expense
payout crash fix, waived-order balance fix, election feature-flag null
rejection, submission apply-result verification, dues-ledger scoping (the
endpoint doc already implies per-member scope), role-route UUID constraint,
SMTP-outside-session fix, apparatus card gating, camera `Permissions-Policy`
change, prospect step-progress locking/unique index (model-only index — fresh
installs enforce it; existing installs rely on the locking), and the
public-portal timestamp `CONVERT_TZ` repair.

## Assessed as below the documentation bar

- Cosmetic display fixes bundled in screenshot commits (avatar initials,
  pluralization, a check-in stat caption)
- Screen-reader/a11y polish (route-change announcements, aria labels)
- The dashboard "urgent certifications" chip removal (superseded by the
  station-board redesign documented on 08-14)
- `data-page-layout` gutter refactor (internal CSS ownership; a contributor
  note would belong in `wiki/Development-Frontend.md` if it recurs)
- OpenAPI-only additions (e.g. the public-form 401 response block)

## False positives (checked, no action)

- A claim that the Aug 12–14 audit cites the Captain-permission migration with
  the wrong number: the file on disk **is**
  `20260814_0004_revoke_captain_facilities_view_sensitive.py`, matching the
  audit.
- The TypeScript dual-install / `tsc-native.mjs` build change is fully
  documented in `CLAUDE.md` (its intended home).
- `equipment_kit_items.optional` is recorded in `docs/ALEMBIC_MIGRATIONS.md`
  and `docs/app-review/inventory.md`; a `wiki/Module-Inventory.md` mention
  remains open below.

## Remaining open items (small, tracked here)

- Skills scoring model (`score_pass_fail_criteria`) predates the changelog
  entry added today; `docs/SKILLS_TESTING_FEATURE.md` §1.5 remains the
  authoritative description.

(Closed in this pass: `equipment_kit_items.optional` is now noted in
`wiki/Module-Inventory.md`, and instructor-qualification org-scoping in
`wiki/Module-Training.md`.)
