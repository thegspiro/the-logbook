## Summary

<!-- What changed and why, in a few sentences. Link the issue it closes, if any. -->

## Changes

<!-- The notable edits, grouped by area. Enough for a reviewer to follow the diff. -->

## Testing

<!-- What you ran and what it proved — name the commands and the test files. -->

## Risk checks

<!--
Delete every line below that this diff does not touch, and answer the ones it
does. An untouched line is meant to be a signal, so leaving all six in place
tells a reviewer nothing.

Nothing here repeats CI: lint, formatting, import order, the migration chain,
the endpoint-permission docs check and the coverage floors are all gated in
.github/workflows/ci.yml. These are the things CI structurally cannot check.
-->

- **Org scoping** — every new by-id query filters `organization_id` (or resolves through an org-scoped parent), and client-supplied FK ids are verified in-org before being stored. `require_permission(...)` alone does not scope the object. (CLAUDE.md pitfall #14)
- **Update payloads** — clearing a field actually persists: `blankToNull` / `numberOrNull` on the frontend, `apply_updates` on the backend. `|| undefined` belongs on create payloads only. (#1)
- **PII/PHI responses** — new endpoints returning member data are added to `UNCACHEABLE_PREFIXES` in `frontend/src/utils/apiCache.ts`.
- **New config switch** — something reads it in this same change; a stored-but-inert setting is labelled in the UI as not yet in effect. (#19)
- **Seed data** — the migration is registered in `SEED_DATA_FILES` (`backend/main.py`), and `organization_id` is nullable for system-level rows. (#8)
- **CSV / spreadsheet export** — written with `SafeCsvWriter`, never bare `csv.writer`. (#15)

## Changelog

<!-- Entry added under `## [Unreleased]` in CHANGELOG.md, or a note on why none is needed. -->
