"""Backfill Public Information on where setup stored it off

Owner decisions 2026-11-03 (workflow review W01-24): Public Information is on
by default, and existing installations are backfilled, **except where an
administrator set it themselves**.

Completing setup used to write every module setting from the wizard's enabled
list, and the wizard never offers Public Information, so every installation
set up before #3986 stored ``settings.modules.public_info = false``. Nobody
chose that.

Which organizations change. Only those whose stored ``public_info`` is
explicitly ``false`` *and* whose audit log holds no Settings → Modules change
touching ``public_info`` (``event_type = 'organization_settings_updated'``
with ``public_info`` among ``event_data.module_updates``). An audit row counts
for an organization when its ``organization_id`` is that organization, or,
for rows written before that column was stamped, when its ``user_id`` is one
of the organization's users. An administrator who switched the module off,
or on and later off, made a choice; switching it off is also how a
department retires its public portal, so turning it back on could resume
publishing to an external website. Those are left alone.

Fails closed. ``audit_logs`` is built by ``create_all``, not by any
migration. If it does not exist, there is no record of who chose what, and
nothing is changed.

Marker. Each organization this changes gets
``settings.modules._public_info_backfilled = <UTC ISO timestamp>``. Stored
module settings are read field by field and a Settings save merges the
existing dict, so the key is inert and survives (as ``_user_configured``
does).

Downgrade. Restores ``false`` for organizations still carrying the marker,
unless an administrator has set ``public_info`` under Settings → Modules
since the backfill; that later choice is kept. The marker is removed either
way.

Safe to run twice: only an explicit ``false`` is changed.
"""

import json
from datetime import datetime, timezone
from typing import Any, Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "289504a34d3c"
down_revision: Union[str, None] = "6b81e95d4157"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MARKER = "_public_info_backfilled"
SETTINGS_EVENT = "organization_settings_updated"


def _load(value: Any) -> Any:
    """JSON columns come back as text on some drivers and decoded on others."""
    if isinstance(value, (str, bytes, bytearray)):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def admin_set_public_info(event_data: Any) -> bool:
    """Did this Settings → Modules audit entry set ``public_info``?"""
    data = _load(event_data)
    if not isinstance(data, dict):
        return False
    updates = data.get("module_updates")
    return isinstance(updates, dict) and "public_info" in updates


def backfilled(settings: Any, stamp: str) -> Optional[dict]:
    """The settings with Public Information turned on, or None to leave them.

    Only an explicit ``false`` is changed: an absent key already reads as the
    default (on), and ``true`` needs nothing.
    """
    settings = _load(settings)
    if not isinstance(settings, dict):
        return None
    modules = settings.get("modules")
    if not isinstance(modules, dict) or modules.get("public_info") is not False:
        return None
    updated = json.loads(json.dumps(settings))  # deep copy (CLAUDE.md #12)
    updated["modules"]["public_info"] = True
    updated["modules"][MARKER] = stamp
    return updated


def restored(settings: Any, admin_changed_since: bool) -> Optional[dict]:
    """The settings with the backfill undone, or None to leave them."""
    settings = _load(settings)
    if not isinstance(settings, dict):
        return None
    modules = settings.get("modules")
    if not isinstance(modules, dict) or MARKER not in modules:
        return None
    updated = json.loads(json.dumps(settings))
    if not admin_changed_since:
        updated["modules"]["public_info"] = False
    del updated["modules"][MARKER]
    return updated


def _admin_entries(bind) -> list:
    """Every Settings audit entry, with the organization it belongs to."""
    rows = bind.execute(
        sa.text(
            "SELECT a.organization_id AS org_id, u.organization_id AS user_org_id, "
            "a.timestamp AS ts, a.event_data AS event_data "
            "FROM audit_logs a "
            "LEFT JOIN users u ON u.id = a.user_id "
            "WHERE a.event_type = :event"
        ),
        {"event": SETTINGS_EVENT},
    ).fetchall()
    return [
        (row.org_id or row.user_org_id, row.ts)
        for row in rows
        if admin_set_public_info(row.event_data)
    ]


def _tables(bind) -> set:
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    _upgrade(op.get_bind())


def downgrade() -> None:
    _downgrade(op.get_bind())


def _upgrade(bind) -> None:
    tables = _tables(bind)
    # Without the audit log there is no telling a setup default from an
    # administrator's choice, so change nothing.
    if not {"organizations", "audit_logs", "users"} <= tables:
        return

    chose_it = {org_id for org_id, _ts in _admin_entries(bind) if org_id}
    stamp = datetime.now(timezone.utc).isoformat()

    rows = bind.execute(
        sa.text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
    ).fetchall()
    for row in rows:
        if row.id in chose_it:
            continue
        updated = backfilled(row.settings, stamp)
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps(updated), "id": row.id},
        )


def _downgrade(bind) -> None:
    tables = _tables(bind)
    if "organizations" not in tables:
        return
    entries = _admin_entries(bind) if {"audit_logs", "users"} <= tables else []

    rows = bind.execute(
        sa.text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
    ).fetchall()
    for row in rows:
        settings = _load(row.settings)
        modules = settings.get("modules") if isinstance(settings, dict) else None
        if not isinstance(modules, dict) or MARKER not in modules:
            continue
        try:
            since = datetime.fromisoformat(str(modules[MARKER]))
        except ValueError:
            since = None
        changed = any(
            org_id == row.id and (since is None or _as_utc(ts) > since)
            for org_id, ts in entries
        )
        updated = restored(settings, admin_changed_since=changed)
        if updated is None:
            continue
        bind.execute(
            sa.text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps(updated), "id": row.id},
        )


def _as_utc(value: Any) -> datetime:
    """Audit timestamps are stored in UTC; some drivers return them naive."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
