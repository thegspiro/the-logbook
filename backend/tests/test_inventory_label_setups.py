"""Saved inventory label print setups, shared across an organization.

Asserts against MySQL that a setup is saved on the organization, that the
same name replaces rather than duplicates, that the cap holds, that one
organization never sees or deletes another's setups, and that a printer id
from another organization is refused before it is stored.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.api.v1.endpoints.inventory import (
    delete_label_setup,
    list_label_setups,
    save_label_setup,
)
from app.schemas.inventory import LabelSetupSave
from app.services.label_service import MAX_LABEL_SETUPS

pytestmark = pytest.mark.integration


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


def _caller(org_id: str):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        positions=[SimpleNamespace(permissions=["inventory.manage"])],
        rank=None,
    )


def _setup(name: str, **overrides) -> LabelSetupSave:
    body = {"name": name, "preset": "rollo_2x1", "symbology": "qr", "copies": 2}
    body.update(overrides)
    return LabelSetupSave(**body)


async def test_saves_lists_and_replaces_by_name(db_session):
    org = await _make_org(db_session, "setups-a")
    user = _caller(org)

    await save_label_setup(_setup("Station Rollo"), db=db_session, current_user=user)
    await save_label_setup(
        _setup("station rollo", copies=3, extra_lines=["size"]),
        db=db_session,
        current_user=user,
    )

    setups = await list_label_setups(db=db_session, current_user=user)
    assert len(setups) == 1
    assert setups[0]["name"] == "station rollo"
    assert setups[0]["copies"] == 3
    assert setups[0]["extra_lines"] == ["size"]
    assert setups[0]["id"]


async def test_another_organization_neither_sees_nor_deletes_them(db_session):
    org = await _make_org(db_session, "setups-home")
    other = await _make_org(db_session, "setups-away")
    saved = await save_label_setup(
        _setup("Ours"), db=db_session, current_user=_caller(org)
    )

    assert await list_label_setups(db=db_session, current_user=_caller(other)) == []
    with pytest.raises(HTTPException) as exc:
        await delete_label_setup(
            saved[0]["id"], db=db_session, current_user=_caller(other)
        )
    assert exc.value.status_code == 404
    assert len(await list_label_setups(db=db_session, current_user=_caller(org))) == 1


async def test_deletes_one(db_session):
    org = await _make_org(db_session, "setups-del")
    user = _caller(org)
    await save_label_setup(_setup("Keep"), db=db_session, current_user=user)
    saved = await save_label_setup(_setup("Drop"), db=db_session, current_user=user)
    drop_id = next(s["id"] for s in saved if s["name"] == "Drop")

    remaining = await delete_label_setup(drop_id, db=db_session, current_user=user)

    assert [s["name"] for s in remaining] == ["Keep"]


async def test_the_cap_holds_for_new_names(db_session):
    org = await _make_org(db_session, "setups-cap")
    user = _caller(org)
    for i in range(MAX_LABEL_SETUPS):
        await save_label_setup(_setup(f"Setup {i}"), db=db_session, current_user=user)

    with pytest.raises(HTTPException) as exc:
        await save_label_setup(_setup("One more"), db=db_session, current_user=user)
    assert exc.value.status_code == 400

    # Replacing an existing name is still allowed at the cap.
    await save_label_setup(
        _setup("Setup 0", copies=5), db=db_session, current_user=user
    )


async def test_refuses_another_organizations_printer(db_session):
    org = await _make_org(db_session, "setups-printer")

    with pytest.raises(HTTPException) as exc:
        await save_label_setup(
            _setup("Foreign", printer_id=str(uuid.uuid4())),
            db=db_session,
            current_user=_caller(org),
        )

    assert exc.value.status_code == 400
    assert await list_label_setups(db=db_session, current_user=_caller(org)) == []


@pytest.mark.parametrize(
    "bad",
    [{"name": "   "}, {"copies": 0}, {"extra_lines": ["custom:" + "x" * 100]}],
)
def test_the_body_rejects_a_malformed_setup(bad):
    body = {"name": "Bad", "preset": "letter", **bad}
    with pytest.raises(ValidationError):
        LabelSetupSave(**body)


@pytest.mark.parametrize("bad", [{"preset": "not-a-size"}, {"symbology": "datamatrix"}])
async def test_saving_rejects_an_unknown_size_or_style(db_session, bad):
    org = await _make_org(db_session, "setups-bad")
    with pytest.raises(HTTPException) as exc:
        await save_label_setup(
            _setup("Bad", **bad), db=db_session, current_user=_caller(org)
        )
    assert exc.value.status_code == 400
