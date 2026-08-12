"""Deleting an equipment-check template must not 500.

The reported bug: ``DELETE /equipment-checks/templates/{id}`` failed for every
template with an ``IntegrityError`` — MySQL 1452, "Cannot add or update a child
row", on ``fk_template_change_logs_template_id_equipment_check_templates``.

The endpoint deleted the template (and committed), then recorded the deletion
in the template's own changelog. ``template_change_logs.template_id`` is a NOT
NULL foreign key to the row that had just been deleted, so the audit insert
could never succeed and templates could not be deleted at all.

The deletion is now recorded in the org-wide audit log, which has no foreign
key to the template and outlives it. The template's own changelog is only ever
read back per template, so a surviving delete row would have been unreachable
regardless.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import equipment_check as ec


def _user():
    return SimpleNamespace(
        id="user-1",
        username="chief",
        first_name="Ada",
        last_name="Byron",
        organization_id="org-1",
    )


def _service(template):
    service = MagicMock()
    service.get_template = AsyncMock(return_value=template)
    service.delete_template = AsyncMock(return_value=template is not None)
    service.log_template_change = AsyncMock()
    return service


@pytest.fixture
def patched(monkeypatch):
    """Patch the endpoint's service class and audit helper, returning both."""
    template = SimpleNamespace(id="tmpl-1", name="Engine 1 — Daily Check")
    service = _service(template)
    monkeypatch.setattr(ec, "EquipmentCheckService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(ec, "log_audit_event", audit)
    return SimpleNamespace(service=service, audit=audit, template=template)


async def test_delete_does_not_write_a_changelog_row_for_the_deleted_template(
    patched,
):
    """The insert that produced the 1452 is gone."""
    db = MagicMock()
    db.commit = AsyncMock()

    await ec.delete_template(template_id="tmpl-1", db=db, current_user=_user())

    patched.service.delete_template.assert_awaited_once_with("tmpl-1", "org-1")
    assert patched.service.log_template_change.await_count == 0


async def test_delete_records_the_deletion_in_the_org_audit_log(patched):
    """The action is still audited — just somewhere that survives the delete."""
    db = MagicMock()
    db.commit = AsyncMock()

    await ec.delete_template(template_id="tmpl-1", db=db, current_user=_user())

    patched.audit.assert_awaited_once()
    kwargs = patched.audit.await_args.kwargs
    assert kwargs["event_type"] == "equipment_check_template_deleted"
    assert kwargs["organization_id"] == "org-1"
    assert kwargs["user_id"] == "user-1"
    # The name is captured before the row goes; without it the audit entry
    # names a template nobody can look up any more.
    assert kwargs["event_data"]["template_name"] == "Engine 1 — Daily Check"
    assert kwargs["event_data"]["template_id"] == "tmpl-1"
    db.commit.assert_awaited()


async def test_missing_template_is_a_404_and_writes_no_audit_entry(monkeypatch):
    service = _service(None)
    monkeypatch.setattr(ec, "EquipmentCheckService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(ec, "log_audit_event", audit)
    db = MagicMock()
    db.commit = AsyncMock()

    with pytest.raises(ec.HTTPException) as exc:
        await ec.delete_template(template_id="nope", db=db, current_user=_user())

    assert exc.value.status_code == 404
    assert audit.await_count == 0
