"""Fold each department's shift-report call types into its one call-type list.

Until this revision a department had two unrelated call-type vocabularies: the
editable list in Scheduling → Settings → General
(``settings.scheduling.call_tracking.call_types``, slug + label) and a
free-text list in Shift Reports settings
(``training_module_configs.shift_review_call_types``). Training requirements
matched against whichever one a report happened to use, by exact spelling.
From here on the department list is the only one offered anywhere, so any
entry a department typed into the free-text list is carried into it.

* An entry that already names a type — by slug or by label, compared
  case- and separator-insensitively — is skipped.
* A new entry becomes an active type with a slug derived from its label, made
  unique within the department.
* A department with no stored list is reading the built-in defaults; those are
  written out first so the additions extend them rather than replace them.
* The cap of 50 types is respected: entries past it are left out, and the
  free-text column is left intact (it is no longer read), so nothing is lost.

``training_module_configs`` is built by ``create_all`` on some installations,
so the step is guarded on the table existing (CLAUDE.md pitfall #26).

**Downgrade** removes exactly the entries this revision added. Their slugs are
recorded under ``call_tracking.folded_report_types`` for that purpose; a
department that has saved its call types since will have dropped the marker,
and is left as it is — its list is then its own.

Revision ID: edf608b5a8ea
Revises: 84819ea78a79
Create Date: 2026-10-04 15:56:00.000000
"""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "edf608b5a8ea"
down_revision = "84819ea78a79"
branch_labels = None
depends_on = None

_MARKER = "folded_report_types"
_MAX = 50
_RESERVED = "unclassified"

# Frozen copy of DEFAULT_CALL_TYPES as of this revision (pitfall #20): this
# migration must keep writing what it wrote the day it ran.
_DEFAULTS = (
    ("fire", "Fire"),
    ("ems", "EMS"),
    ("mva", "Motor Vehicle Accident"),
    ("rescue", "Rescue"),
    ("hazmat", "Hazmat"),
    ("service", "Service Call"),
    ("alarm", "Alarm / Good Intent"),
    ("mutual_aid", "Mutual Aid"),
    ("other", "Other"),
)

_SEPARATORS = re.compile(r"[\s_\-]+")


def _fold(value):
    return _SEPARATORS.sub(" ", str(value).strip().casefold()).strip()


def _slugify(label):
    slug = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")[:40]
    return slug or "type"


def _load(raw):
    if isinstance(raw, (str, bytes)):
        raw = json.loads(raw or "null")
    return raw


def fold_in(settings, report_types):
    """Return (new_settings, added_slugs), or (None, []) when nothing changes."""
    settings = settings if isinstance(settings, dict) else {}
    texts = [
        t.strip()[:100] for t in report_types or [] if isinstance(t, str) and t.strip()
    ]
    if not texts:
        return None, []

    scheduling = dict(settings.get("scheduling") or {})
    tracking = dict(scheduling.get("call_tracking") or {})
    stored = tracking.get("call_types")
    if isinstance(stored, list) and any(isinstance(e, dict) for e in stored):
        types = [dict(e) for e in stored if isinstance(e, dict)]
    else:
        types = [{"slug": s, "label": l, "active": True} for s, l in _DEFAULTS]

    known = set()
    for entry in types:
        known.add(_fold(entry.get("slug") or ""))
        known.add(_fold(entry.get("label") or ""))
    slugs = {str(e.get("slug")) for e in types} | {_RESERVED}

    added = []
    for text in texts:
        if _fold(text) in known or len(types) >= _MAX:
            continue
        base = _slugify(text)
        slug, n = base, 2
        while slug in slugs:
            slug, n = f"{base}_{n}", n + 1
        types.append({"slug": slug, "label": text, "active": True})
        slugs.add(slug)
        known.add(_fold(text))
        known.add(_fold(slug))
        added.append(slug)

    if not added:
        return None, []
    tracking["call_types"] = types
    tracking[_MARKER] = added
    scheduling["call_tracking"] = tracking
    new_settings = dict(settings)
    new_settings["scheduling"] = scheduling
    return new_settings, added


def unfold(settings):
    """Return settings without this revision's additions, or None to leave."""
    if not isinstance(settings, dict):
        return None
    tracking = (settings.get("scheduling") or {}).get("call_tracking")
    if not isinstance(tracking, dict) or not isinstance(tracking.get(_MARKER), list):
        return None
    added = set(tracking[_MARKER])
    new_tracking = {k: v for k, v in tracking.items() if k != _MARKER}
    new_tracking["call_types"] = [
        e
        for e in tracking.get("call_types") or []
        if not (isinstance(e, dict) and e.get("slug") in added)
    ]
    new_settings = dict(settings)
    new_settings["scheduling"] = dict(
        settings["scheduling"], call_tracking=new_tracking
    )
    return new_settings


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "training_module_configs" not in tables or "organizations" not in tables:
        return
    rows = bind.execute(
        sa.text(
            "SELECT c.organization_id, c.shift_review_call_types, o.settings "
            "FROM training_module_configs c "
            "JOIN organizations o ON o.id = c.organization_id "
            "WHERE c.shift_review_call_types IS NOT NULL"
        )
    ).fetchall()
    for row in rows:
        report_types = _load(row.shift_review_call_types)
        if not isinstance(report_types, list):
            continue
        updated, _added = fold_in(_load(row.settings), report_types)
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps(updated), "id": row.organization_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "organizations" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
    ).fetchall()
    for row in rows:
        restored = unfold(_load(row.settings))
        if restored is None:
            continue
        bind.execute(
            sa.text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps(restored), "id": row.id},
        )
