"""NFC tags on equipment-check compartments, against the real database.

Compartments carry no ``organization_id``; every read is scoped through the
template's. What is at stake — that a compartment in another department cannot
be tagged or resolved, that a tap during a check resolves only against that
check's template, that the three-way target constraint and the cascade hold —
is in what MySQL enforces, so these run on it.
"""

import uuid

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import InventoryNfcTag, InventoryNfcTagStatus
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.services.nfc_tag_service import hash_tag_uid

pytestmark = pytest.mark.integration

COMPARTMENT_TAG = "04:a2:24:5b:7c:11:80"
ITEM_TAG = "04:b3:35:6c:8d:22:91"
SHELF_TAG = "04:c4:46:7d:9e:33:a2"


async def _make_org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', '{}')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _make_item(db, org_id: str, name: str, *, active: bool = True) -> str:
    item_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_items "
            "(id, organization_id, name, `condition`, status, tracking_type, "
            "quantity, quantity_issued, active) "
            "VALUES (:id, :org, :name, 'good', 'available', 'individual', "
            "1, 0, :active)"
        ),
        {"id": item_id, "org": org_id, "name": name, "active": active},
    )
    await db.flush()
    return item_id


async def _make_area(db, org_id: str, name: str) -> str:
    area_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO storage_areas "
            "(id, organization_id, name, storage_type, is_active) "
            "VALUES (:id, :org, :name, 'shelf', 1)"
        ),
        {"id": area_id, "org": org_id, "name": name},
    )
    await db.flush()
    return area_id


async def _make_template(db, org_id: str, name: str) -> EquipmentCheckTemplate:
    template = EquipmentCheckTemplate(
        organization_id=org_id, name=name, check_timing="start_of_shift"
    )
    db.add(template)
    await db.flush()
    return template


async def _make_compartment(db, template_id: str, name: str, sort_order: int = 0):
    compartment = CheckTemplateCompartment(
        template_id=template_id, name=name, sort_order=sort_order
    )
    db.add(compartment)
    await db.flush()
    return compartment


async def _make_entry(
    db, compartment_id: str, name: str, inventory_item_id=None, sort_order: int = 0
):
    entry = CheckTemplateItem(
        compartment_id=compartment_id,
        name=name,
        check_type="present",
        inventory_item_id=inventory_item_id,
        sort_order=sort_order,
    )
    db.add(entry)
    await db.flush()
    return entry


async def _link(service, org_id, uid, **target):
    return await service.link_tag(
        organization_id=org_id,
        tag_uid=uid,
        credential_type=NfcCredentialType.SERIAL,
        label=None,
        linked_by=None,
        **target,
    )


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "nfc-comp")


@pytest.fixture
async def other_org(db_session):
    return await _make_org(db_session, "nfc-comp-other")


@pytest.fixture
def service(db_session):
    return InventoryNfcService(db_session)


@pytest.fixture
async def engine_check(db_session, org):
    """A template with two compartments, the second holding a tagged tool
    that appears twice on the list."""
    template = await _make_template(db_session, org, "Engine 1 morning")
    cab = await _make_compartment(db_session, template.id, "Cab", 0)
    d1 = await _make_compartment(db_session, template.id, "Driver side 1", 1)
    halligan = await _make_item(db_session, org, "Halligan 3")
    first = await _make_entry(db_session, d1.id, "Halligan", halligan, 0)
    second = await _make_entry(db_session, d1.id, "Halligan (spare)", halligan, 1)
    await _make_entry(db_session, cab.id, "Flashlight")
    return {
        "template": template,
        "cab": cab,
        "d1": d1,
        "halligan": halligan,
        "entries": [first.id, second.id],
    }


class TestLinking:
    async def test_a_compartment_takes_a_tag(self, service, org, engine_check):
        tag = await _link(
            service,
            org,
            COMPARTMENT_TAG,
            check_compartment_id=engine_check["d1"].id,
        )
        assert tag["check_compartment_id"] == engine_check["d1"].id
        assert tag["item_id"] is None
        assert tag["storage_area_id"] is None

        listed = await service.list_compartment_tags(engine_check["d1"].id, org)
        assert [t["id"] for t in listed] == [tag["id"]]

    async def test_another_departments_compartment_is_not_found(
        self, db_session, service, other_org
    ):
        template = await _make_template(db_session, other_org, "Their engine")
        theirs = await _make_compartment(db_session, template.id, "Cab")
        org_id = await _make_org(db_session, "nfc-comp-third")

        with pytest.raises(LookupError, match="Compartment not found"):
            await _link(
                service, org_id, COMPARTMENT_TAG, check_compartment_id=theirs.id
            )
        with pytest.raises(LookupError, match="Compartment not found"):
            await service.list_compartment_tags(theirs.id, org_id)

    async def test_a_tag_on_an_item_names_the_item(
        self, db_session, service, org, engine_check
    ):
        await _link(service, org, COMPARTMENT_TAG, item_id=engine_check["halligan"])
        with pytest.raises(ValueError, match='already linked to "Halligan 3"'):
            await _link(
                service,
                org,
                COMPARTMENT_TAG,
                check_compartment_id=engine_check["d1"].id,
            )

    async def test_a_tag_on_a_compartment_names_it_and_its_checklist(
        self, service, org, engine_check
    ):
        await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["d1"].id
        )
        with pytest.raises(
            ValueError,
            match='already linked to "Driver side 1" on "Engine 1 morning"',
        ):
            await _link(service, org, COMPARTMENT_TAG, item_id=engine_check["halligan"])
        with pytest.raises(ValueError, match="already linked to this compartment"):
            await _link(
                service,
                org,
                COMPARTMENT_TAG,
                check_compartment_id=engine_check["d1"].id,
            )

    async def test_exactly_one_target(self, service, org, engine_check):
        with pytest.raises(ValueError, match="exactly one"):
            await _link(
                service,
                org,
                COMPARTMENT_TAG,
                item_id=engine_check["halligan"],
                check_compartment_id=engine_check["d1"].id,
            )

    async def test_the_database_refuses_two_targets(
        self, db_session, org, engine_check
    ):
        """The constraint, not only the service, holds the rule.

        DBAPIError: MariaDB reports a failed CHECK as an OperationalError
        (4025) where MySQL uses its own code (see test_inventory_nfc_put_away).
        """

        async def insert_tag_naming_two_targets():
            async with db_session.begin_nested():
                db_session.add(
                    InventoryNfcTag(
                        organization_id=org,
                        item_id=engine_check["halligan"],
                        check_compartment_id=engine_check["d1"].id,
                        uid_hash=hash_tag_uid(COMPARTMENT_TAG),
                        uid_preview="1180",
                        credential_type=NfcCredentialType.SERIAL,
                        status=InventoryNfcTagStatus.ACTIVE,
                    )
                )
                await db_session.flush()

        with pytest.raises(DBAPIError, match="one_target"):
            await insert_tag_naming_two_targets()

    async def test_deleting_the_compartment_removes_its_tags(
        self, db_session, service, org, engine_check
    ):
        """What EquipmentCheckService's delete and replace paths rely on."""
        tag = await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["cab"].id
        )
        await db_session.execute(
            delete(CheckTemplateCompartment).where(
                CheckTemplateCompartment.id == engine_check["cab"].id
            )
        )
        remaining = await db_session.execute(
            select(InventoryNfcTag.id).where(InventoryNfcTag.id == tag["id"])
        )
        assert remaining.scalar_one_or_none() is None


class TestOtherResolversRefuseACompartment:
    async def test_the_item_and_shelf_screens_say_what_it_is(
        self, service, org, engine_check
    ):
        await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["d1"].id
        )
        with pytest.raises(InventoryNfcTagNotFound, match="apparatus compartment"):
            await service.resolve_any(org, (COMPARTMENT_TAG,))
        with pytest.raises(InventoryNfcTagNotFound, match="apparatus compartment"):
            await service.resolve(org, (COMPARTMENT_TAG,))


class TestResolveCheck:
    async def test_a_compartment_tag_jumps_to_its_compartment(
        self, service, org, engine_check
    ):
        await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["d1"].id
        )
        tap = await service.resolve_check(
            org, engine_check["template"].id, (None, COMPARTMENT_TAG)
        )
        assert tap.kind == "compartment"
        assert tap.compartment.id == engine_check["d1"].id

    async def test_an_item_tag_names_every_entry_it_is_linked_to_in_order(
        self, service, org, engine_check
    ):
        await _link(service, org, ITEM_TAG, item_id=engine_check["halligan"])
        tap = await service.resolve_check(org, engine_check["template"].id, (ITEM_TAG,))
        assert tap.kind == "item"
        assert tap.item.name == "Halligan 3"
        assert tap.template_item_ids == engine_check["entries"]

    async def test_another_checklists_compartment_is_refused(
        self, db_session, service, org, engine_check
    ):
        ladder = await _make_template(db_session, org, "Ladder 1 morning")
        await _make_compartment(db_session, ladder.id, "Cab")
        await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["d1"].id
        )
        with pytest.raises(InventoryNfcTagNotFound, match="another checklist"):
            await service.resolve_check(org, ladder.id, (COMPARTMENT_TAG,))

    async def test_an_item_not_on_this_checklist_is_refused(
        self, db_session, service, org, engine_check
    ):
        radio = await _make_item(db_session, org, "Portable radio 7")
        await _link(service, org, ITEM_TAG, item_id=radio)
        with pytest.raises(
            InventoryNfcTagNotFound, match="Portable radio 7 is not on this checklist"
        ):
            await service.resolve_check(org, engine_check["template"].id, (ITEM_TAG,))

    async def test_a_shelf_tag_is_refused(self, db_session, service, org, engine_check):
        area = await _make_area(db_session, org, "Bay shelf")
        await _link(service, org, SHELF_TAG, storage_area_id=area)
        with pytest.raises(InventoryNfcTagNotFound, match="storage shelf"):
            await service.resolve_check(org, engine_check["template"].id, (SHELF_TAG,))

    async def test_a_lost_tag_is_refused(self, service, org, engine_check):
        tag = await _link(
            service, org, COMPARTMENT_TAG, check_compartment_id=engine_check["d1"].id
        )
        await service.update_tag(tag["id"], org, {"status": InventoryNfcTagStatus.LOST})
        with pytest.raises(InventoryNfcTagNotFound, match="marked lost"):
            await service.resolve_check(
                org, engine_check["template"].id, (COMPARTMENT_TAG,)
            )

    async def test_a_tag_from_another_department_is_unknown(
        self, db_session, service, org, other_org, engine_check
    ):
        """The tag lookup is scoped by organization before anything else."""
        template = await _make_template(db_session, other_org, "Their engine")
        theirs = await _make_compartment(db_session, template.id, "Cab")
        await _link(service, other_org, COMPARTMENT_TAG, check_compartment_id=theirs.id)
        with pytest.raises(InventoryNfcTagNotFound, match="not linked to anything"):
            await service.resolve_check(
                org, engine_check["template"].id, (COMPARTMENT_TAG,)
            )
