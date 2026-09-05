"""Rename a department's call type that squats the reserved ``unclassified`` slug.

``unclassified`` is the synthetic bucket a call with **no** type falls into
when a breakdown is reported (``UNCLASSIFIED_CALL_TYPE`` in
``app/models/call_tracking.py``). It is never stored on a row: an untyped call
carries ``call_type`` NULL.

A department could nevertheless end up with a configured type of that slug —
by hand-editing ``organizations.settings``, or by naming one before the
schema validator that now refuses it existed. That organization is in a state
nothing can report truthfully:

* ``get_call_tracking_settings`` drops the entry, so the department's own
  label for the type is gone from every screen.
* The call-volume report keys both the department's calls and the genuinely
  untyped remainder to the same ``unclassified`` bucket and labels the
  combined figure "Not categorised" — a count that reconciles to neither
  quantity (CLAUDE.md pitfall #29).
* The settings screen cannot repair it: the schema refuses the slug, so no
  payload the editor can produce mentions the type at all.

So the repair has to happen here. For each affected organization the reserved
slug is renamed — to a slug derived from the entry's own label, falling back
to ``unclassified_type`` — in all three places the slug is persisted:

* ``organizations.settings`` -> ``scheduling.call_tracking.call_types[].slug``
* ``org_calls.call_type``
* ``shift_completion_reports.call_types``, **only** on reports whose
  ``data_sources["call_types"]`` is ``org_calls``. Under ``shift_calls``
  provenance that column holds the incident text an officer typed, where the
  word "unclassified" is prose and not this department's slug.

**Only organizations that still have the configured entry are touched.** Rows
whose type was deleted from settings have no label left to restore, and
renaming them would turn today's "Not categorised" into a raw orphan slug on
the report — worse than the state being repaired. Their calls stay in the
remainder, which is where the report already counts them.

The replacement slug is chosen against every slug the organization has in
use — its other configured entries, its ``org_calls`` history and its filed
report snapshots — so the rename can never merge two distinct histories into
one bucket.

The transform is inlined rather than imported from ``app.utils`` because a
migration must keep transforming rows the way it did the day it ran
(CLAUDE.md pitfall #20). It is done in Python, not SQL JSON functions, so
MySQL 8.0 and MariaDB 10.11 both run it (the CI matrix covers both).

Idempotent: after it runs no organization holds the reserved slug, so a second
run selects nothing.

**This migration is not reversible.** ``downgrade()`` is deliberately a no-op.
Restoring the old value would mean writing the reserved slug back — the very
state the application refuses to accept and cannot display — and the
per-organization mapping is not retained. The information the old shape
carried implicitly, the department's name for the type, is preserved: the
entry keeps its label verbatim and the new slug is derived from it.

Revision ID: c9f4a2b71d38
Revises: a3d7e2f18c45
Create Date: 2026-09-05 19:00:00.000000
"""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "c9f4a2b71d38"
down_revision = "a3d7e2f18c45"
branch_labels = None
depends_on = None

# Frozen copies of the runtime values, on purpose (see module docstring).
_RESERVED_SLUG = "unclassified"
_FROM_ORG_CALLS = "org_calls"
_SLUG_PATTERN = re.compile(r"^[a-z0-9_]{1,50}$")
_MAX_SLUG_LENGTH = 50
# Base for a slug that cannot be derived from the entry's label. Kept short
# enough that the numbered variants below stay inside _MAX_SLUG_LENGTH.
_FALLBACK_BASE = "unclassified_type"
# Numbered variants tried when the base is taken. A department is capped at 50
# configured types, so this cannot be exhausted by a list the editor produced;
# an organization that somehow exhausts it is left untouched rather than
# failing the upgrade for every other one in the database.
_FALLBACK_LIMIT = 100


def _load_json(raw):
    """Normalize JSON values returned by different database drivers.

    MySQL hands back a ``str`` for a JSON column and MariaDB a ``str`` for the
    LONGTEXT it stores one in; a driver may hand back ``bytes``.
    """
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        if not raw.strip():
            return None
        try:
            raw = json.loads(raw)
        except ValueError:
            return None
    return raw


def _entry_slug(entry) -> str:
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("slug") or "").strip()


def _slugify(label) -> str:
    """The entry's label as a storable slug, or "" if nothing survives."""
    slug = re.sub(r"[^a-z0-9]+", "_", str(label or "").strip().lower())
    slug = slug.strip("_")[:_MAX_SLUG_LENGTH].rstrip("_")
    return slug if _SLUG_PATTERN.fullmatch(slug) else ""


def _free_slug(label, taken: set):
    """First unused slug for this entry, or None if none is available."""
    candidate = _slugify(label)
    # A label that slugifies straight back to the reserved value ("Unclassified")
    # is the one case the derived name cannot be used.
    if candidate and candidate != _RESERVED_SLUG and candidate not in taken:
        return candidate
    if _FALLBACK_BASE not in taken:
        return _FALLBACK_BASE
    for n in range(2, _FALLBACK_LIMIT + 1):
        numbered = f"{_FALLBACK_BASE}_{n}"
        if numbered not in taken:
            return numbered
    return None


def _settle_call_types(entries, in_use: set):
    """Rename every reserved-slug entry. ``entries`` is not mutated.

    Returns ``(new_entries, first_new_slug)``. Only the *first* reserved entry
    is what history is filed under — the settings reader keeps the first of
    duplicate slugs and has always ignored the rest — so only its replacement
    is reported back for the call and report rewrites.

    A duplicate reserved entry is renamed too rather than dropped: it becomes a
    configured type with no calls behind it, which a department can retire or
    delete on the settings screen. Deleting it here would remove a row nobody
    can inspect first.
    """
    taken = {
        slug
        for slug in (_entry_slug(e) for e in entries)
        if slug and slug != _RESERVED_SLUG
    } | set(in_use)

    new_entries = []
    first_new_slug = None
    for entry in entries:
        if _entry_slug(entry) != _RESERVED_SLUG:
            new_entries.append(entry)
            continue
        replacement = _free_slug(entry.get("label"), taken)
        if replacement is None:
            new_entries.append(entry)
            continue
        taken.add(replacement)
        renamed = dict(entry)
        renamed["slug"] = replacement
        new_entries.append(renamed)
        if first_new_slug is None:
            first_new_slug = replacement

    return new_entries, first_new_slug


def _stored_call_types(settings):
    """The org's configured call-type list, or None if it has none."""
    if not isinstance(settings, dict):
        return None
    scheduling = settings.get("scheduling")
    if not isinstance(scheduling, dict):
        return None
    call_tracking = scheduling.get("call_tracking")
    if not isinstance(call_tracking, dict):
        return None
    entries = call_tracking.get("call_types")
    return entries if isinstance(entries, list) else None


def _org_call_slugs(bind, org_id: str) -> set:
    rows = bind.execute(
        sa.text(
            "SELECT DISTINCT call_type FROM org_calls "
            "WHERE organization_id = :org_id AND call_type IS NOT NULL"
        ),
        {"org_id": org_id},
    ).fetchall()
    return {str(row[0]) for row in rows if row[0]}


def _org_call_reports(bind, org_id: str):
    """(id, call_types list) for this org's reports that store org slugs."""
    rows = bind.execute(
        sa.text(
            "SELECT id, call_types, data_sources FROM shift_completion_reports "
            "WHERE organization_id = :org_id "
            "AND call_types IS NOT NULL AND data_sources IS NOT NULL"
        ),
        {"org_id": org_id},
    ).fetchall()

    reports = []
    for report_id, raw_types, raw_sources in rows:
        sources = _load_json(raw_sources)
        if not isinstance(sources, dict):
            continue
        if sources.get("call_types") != _FROM_ORG_CALLS:
            continue
        call_types = _load_json(raw_types)
        if isinstance(call_types, list):
            reports.append((report_id, call_types))
    return reports


def upgrade() -> None:
    bind = op.get_bind()
    if "organizations" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(
        sa.text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
    ).fetchall()

    for org_id, raw_settings in rows:
        settings = _load_json(raw_settings)
        entries = _stored_call_types(settings)
        if not entries:
            continue
        if not any(_entry_slug(e) == _RESERVED_SLUG for e in entries):
            continue

        reports = _org_call_reports(bind, org_id)
        in_use = _org_call_slugs(bind, org_id)
        for _report_id, call_types in reports:
            in_use.update(v for v in call_types if isinstance(v, str))

        new_entries, new_slug = _settle_call_types(entries, in_use)
        if new_entries == entries:
            continue

        updated = dict(settings)
        scheduling = dict(updated["scheduling"])
        call_tracking = dict(scheduling["call_tracking"])
        call_tracking["call_types"] = new_entries
        scheduling["call_tracking"] = call_tracking
        updated["scheduling"] = scheduling
        bind.execute(
            sa.text("UPDATE organizations SET settings = :settings WHERE id = :id"),
            {"settings": json.dumps(updated), "id": org_id},
        )

        if new_slug is None:
            continue

        bind.execute(
            sa.text(
                "UPDATE org_calls SET call_type = :new_slug "
                "WHERE organization_id = :org_id AND call_type = :old_slug"
            ),
            {"new_slug": new_slug, "org_id": org_id, "old_slug": _RESERVED_SLUG},
        )

        for report_id, call_types in reports:
            if _RESERVED_SLUG not in call_types:
                continue
            rewritten = [
                new_slug if value == _RESERVED_SLUG else value for value in call_types
            ]
            bind.execute(
                sa.text(
                    "UPDATE shift_completion_reports SET call_types = :call_types "
                    "WHERE id = :id"
                ),
                {"call_types": json.dumps(rewritten), "id": report_id},
            )


def downgrade() -> None:
    # Irreversible by design (see module docstring): restoring the old value
    # means writing back the reserved slug the application refuses to accept
    # and cannot display, and the per-organization mapping is not retained.
    pass
