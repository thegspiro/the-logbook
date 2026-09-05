"""Keep the ``org_calls`` call-type marker only where the stored values are slugs.

``ShiftCompletionReport.data_sources["call_types"]`` makes exactly one claim:
that ``call_types`` holds this organization's own type slugs rather than the
incident text an officer typed. Readers act on it — ``reports_service`` uses it
to decide whether to replace a stored value with the department's current label
for that type, and ``slugs_locked_by_history`` uses it to decide whether the
report is a reason not to delete a type. A report whose free text is marked
``org_calls`` therefore has an officer's wording rewritten by a later rename.

``a3d7e2f18c45`` set that marker from *sibling rows*: a shift with
``org_call_responses`` and no ``shift_calls``. Those rows are mutable and are
not tied to the report. ``finalize_shift`` reads the organization's **current**
tracking mode (``scheduling_service.py``) and then records calls, so deleting a
detailed shift's incident rows, switching the organization to count-only and
re-finalizing that shift manufactures exactly the evidence the backfill looked
for — on a report whose ``call_types`` is the officer's own text.

This narrows the marker to evidence carried by the report itself:

    a report may claim ``org_calls`` only if every value in its ``call_types``
    is a slug its organization actually has configured.

Checking the claim directly is stronger than inferring it, and unlike a
timestamp test it needs no assumption about the order in which calls are
recorded and reports are filed — the close-out wizard writes the department's
call record at a step *before* finalization, and reports are filed later,
singly or in batch.

**The comparison set is the organization's stored slugs plus the built-in
defaults**, always. An organization that later materialized a custom list still
filed reports under the defaults beforehand, and those values were slugs when
they were written. Types the organization configured and then deleted cannot be
recovered and are not represented; a report naming one is reverted, which costs
it nothing — a value that is not a configured slug has no label to resolve and
no type left to lock.

**What this does not catch:** a report whose officer-typed text happens to equal
a configured slug for *every* value in the list — "fire" typed into a
department that has a ``fire`` type. Such a report keeps the marker and renders
that department's label. The distortion is bounded to a value the department
already uses that name for, and nothing on the row can distinguish the two.

Only rows currently claiming ``org_calls`` are examined, and only ever reverted
to ``shift_calls`` — the value they held before ``a3d7e2f18c45``, and the value
the model documents as "verbatim". Nothing is promoted.

The transform is inlined rather than imported from ``app.utils`` because a
migration must keep transforming rows the way it did the day it ran (CLAUDE.md
pitfall #20). It is done in Python, not SQL JSON functions, so MySQL 8.0 and
MariaDB 10.11 both run it (the CI matrix covers both).

Idempotent: after it runs, every remaining ``org_calls`` row passes the test, so
a second run changes nothing.

**This migration is not reversible.** ``downgrade()`` is deliberately a no-op.
Restoring the marker would re-assert a claim this migration established the row
does not support, and the rows it reverted are indistinguishable from ones that
never carried the marker.

Revision ID: d7c1b95e2a40
Revises: c9f4a2b71d38
Create Date: 2026-09-05 22:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "d7c1b95e2a40"
down_revision = "c9f4a2b71d38"
branch_labels = None
depends_on = None

# Frozen copies of the runtime values, on purpose (see module docstring).
_FROM_ORG_CALLS = "org_calls"
_FROM_SHIFT_CALLS = "shift_calls"
# app.models.call_tracking.DEFAULT_CALL_TYPES as of this revision. In force for
# every organization that has not materialized a list of its own, and therefore
# the slugs its older reports were written under.
_DEFAULT_SLUGS = frozenset(
    {
        "fire",
        "ems",
        "mva",
        "rescue",
        "hazmat",
        "service",
        "alarm",
        "mutual_aid",
        "other",
    }
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


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


def _configured_slugs(settings) -> frozenset:
    """Every slug this organization's reports could have been written under.

    Read defensively: ``settings`` is unvalidated JSON an administrator can
    hand-edit, and raising here would fail the upgrade for every organization
    in the database over one malformed document (pitfall #19).
    """
    stored = set()
    if isinstance(settings, dict):
        scheduling = settings.get("scheduling")
        call_tracking = (
            scheduling.get("call_tracking") if isinstance(scheduling, dict) else None
        )
        entries = (
            call_tracking.get("call_types") if isinstance(call_tracking, dict) else None
        )
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                slug = str(entry.get("slug") or "").strip()
                if slug:
                    stored.add(slug)
    return frozenset(stored | _DEFAULT_SLUGS)


def _all_values_are_slugs(call_types, slugs: frozenset) -> bool:
    """Whether the stored list supports an ``org_calls`` claim.

    A non-string entry is not a slug either. An empty list makes no claim about
    any value, so it is left as it is rather than reverted.
    """
    if not isinstance(call_types, list):
        return False
    return all(isinstance(v, str) and v in slugs for v in call_types)


def upgrade() -> None:
    bind = op.get_bind()
    if not (_has_table("organizations") and _has_table("shift_completion_reports")):
        return

    slugs_by_org = {
        org_id: _configured_slugs(_load_json(raw_settings))
        for org_id, raw_settings in bind.execute(
            sa.text("SELECT id, settings FROM organizations")
        ).fetchall()
    }

    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id, call_types, data_sources "
            "FROM shift_completion_reports "
            "WHERE data_sources IS NOT NULL AND call_types IS NOT NULL"
        )
    ).fetchall()

    for report_id, org_id, raw_types, raw_sources in rows:
        sources = _load_json(raw_sources)
        if not isinstance(sources, dict):
            continue
        if sources.get("call_types") != _FROM_ORG_CALLS:
            continue

        # Scoped to the report's own organization: a slug configured by one
        # department says nothing about another's report (pitfall #14).
        slugs = slugs_by_org.get(org_id, _DEFAULT_SLUGS)
        if _all_values_are_slugs(_load_json(raw_types), slugs):
            continue

        updated = dict(sources)
        updated["call_types"] = _FROM_SHIFT_CALLS
        bind.execute(
            sa.text(
                "UPDATE shift_completion_reports SET data_sources = :data_sources "
                "WHERE id = :id"
            ),
            {"data_sources": json.dumps(updated), "id": report_id},
        )


def downgrade() -> None:
    # Irreversible by design (see module docstring): restoring the marker would
    # re-assert a claim this migration established the row does not support,
    # and a reverted row is indistinguishable from one that never carried it.
    pass
