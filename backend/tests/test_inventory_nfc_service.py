"""NFC tags on inventory items, against the real database.

What is at stake — that a tag resolves only inside its own organization, that
the unique constraint really holds, that nothing stores the raw identifier —
is in what MySQL stores and returns, so a mocked session would only assert the
queries as written.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.models.inventory import InventoryNfcTag, InventoryNfcTagStatus
from app.models.nfc_tag import NfcCredentialType
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.utils.inventory_nfc import inventory_nfc_enabled

pytestmark = pytest.mark.integration

SERIAL = "04:a2:24:5b:7c:11:80"
CODE = "INVT0123456789ABCDEF0123456789ABCDEF"


async def _make_org(db, name: str, settings: str = "{}") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"{name}-{org_id[:8]}",
            "settings": settings,
        },
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


@pytest.fixture
async def org(db_session):
    return await _make_org(db_session, "nfc-org")


@pytest.fixture
async def other_org(db_session):
    return await _make_org(db_session, "nfc-other")


@pytest.fixture
def service(db_session):
    return InventoryNfcService(db_session)


async def _link(service, org_id, item_id, uid=SERIAL, **kwargs):
    return await service.link_tag(
        organization_id=org_id,
        item_id=item_id,
        tag_uid=uid,
        credential_type=kwargs.get("credential_type", NfcCredentialType.SERIAL),
        label=kwargs.get("label"),
        linked_by=None,
    )


class TestSwitch:
    async def test_an_organization_that_never_set_it_is_off(self, db_session, org):
        assert await inventory_nfc_enabled(db_session, org) is False

    async def test_the_stored_flag_turns_it_on(self, db_session):
        org_id = await _make_org(
            db_session, "nfc-on", '{"inventory": {"nfc_tracking_enabled": true}}'
        )
        assert await inventory_nfc_enabled(db_session, org_id) is True


class TestLinking:
    async def test_the_identifier_is_never_stored_in_clear(
        self, db_session, service, org
    ):
        item_id = await _make_item(db_session, org, "Helmet 12")
        await _link(service, org, item_id)

        row = (
            await db_session.execute(
                select(InventoryNfcTag).where(InventoryNfcTag.item_id == item_id)
            )
        ).scalar_one()
        assert row.uid_preview == "1180"
        assert "04A2245B7C1180" not in row.uid_hash
        assert len(row.uid_hash) == 64

    async def test_an_item_can_carry_several_tags(self, db_session, service, org):
        item_id = await _make_item(db_session, org, "SCBA 4")
        await _link(service, org, item_id, SERIAL, label="Backplate")
        await _link(
            service,
            org,
            item_id,
            CODE,
            credential_type=NfcCredentialType.WRITTEN,
            label="Case",
        )
        tags = await service.list_item_tags(item_id, org)
        assert sorted(t["label"] for t in tags) == ["Backplate", "Case"]

    async def test_one_tag_cannot_name_two_items(self, db_session, service, org):
        first = await _make_item(db_session, org, "Radio 1")
        second = await _make_item(db_session, org, "Radio 2")
        await _link(service, org, first)

        with pytest.raises(ValueError, match='already linked to "Radio 1"'):
            # A different reader spelling of the same chip is the same tag.
            await _link(service, org, second, "04A2245B7C1180")

    async def test_a_simultaneous_link_loses_with_a_400_not_a_500(
        self, db_session, service, org
    ):
        """Two phones linking one tag both pass the pre-check; the constraint
        decides, and the loser must get the same answer as a slow caller."""
        first = await _make_item(db_session, org, "Race 1")
        second = await _make_item(db_session, org, "Race 2")
        await _link(service, org, first)

        real_find = service._find_by_hash
        calls = []

        async def miss_once(*args):
            calls.append(args)
            return None if len(calls) == 1 else await real_find(*args)

        service._find_by_hash = miss_once
        with pytest.raises(ValueError, match='already linked to "Race 1"'):
            await _link(service, org, second)

        # The savepoint kept the session usable for the next request's work.
        tags = await service.list_item_tags(first, org)
        assert len(tags) == 1

    async def test_linking_twice_to_the_same_item_says_so(
        self, db_session, service, org
    ):
        item_id = await _make_item(db_session, org, "Radio 3")
        await _link(service, org, item_id)
        with pytest.raises(ValueError, match="already linked to this item"):
            await _link(service, org, item_id)

    async def test_an_item_in_another_organization_cannot_be_tagged(
        self, db_session, service, org, other_org
    ):
        foreign_item = await _make_item(db_session, other_org, "Their helmet")
        with pytest.raises(LookupError):
            await _link(service, org, foreign_item)

    async def test_the_same_tag_may_be_used_by_two_organizations(
        self, db_session, service, org, other_org
    ):
        """Tenants are separate: linking in one must not be discoverable by
        a refusal in the other."""
        mine = await _make_item(db_session, org, "Mine")
        theirs = await _make_item(db_session, other_org, "Theirs")
        await _link(service, org, mine)
        await _link(service, other_org, theirs)

        _, item = await service.resolve(org, (None, SERIAL))
        assert item.id == mine


class TestResolving:
    async def test_a_serial_resolves_to_its_item(self, db_session, service, org):
        item_id = await _make_item(db_session, org, "Axe")
        await _link(service, org, item_id)
        tag, item = await service.resolve(org, (None, "04A2245B7C1180"))
        assert item.id == item_id
        assert tag.uid_preview == "1180"

    async def test_the_resolved_item_serializes_like_a_barcode_lookup(
        self, db_session, service, org
    ):
        """The endpoint returns the lookup's response shape; building it from
        the resolved row must not need a relationship the query did not load,
        which under async would fail at request time rather than here."""
        from app.schemas.inventory import ScanLookupResponse

        item_id = await _make_item(db_session, org, "Thermal camera")
        await _link(service, org, item_id)
        tag, item = await service.resolve(org, (None, SERIAL))
        body = ScanLookupResponse(
            item=item,
            matched_field="nfc_tag",
            matched_value=f"NFC tag …{tag.uid_preview}",
        ).model_dump(mode="json")
        assert body["item"]["id"] == item_id
        assert body["item"]["name"] == "Thermal camera"

    async def test_the_written_code_wins_over_the_serial_beneath_it(
        self, db_session, service, org
    ):
        """A rewritten tag's old serial link must not shadow its new code."""
        old = await _make_item(db_session, org, "Old owner")
        new = await _make_item(db_session, org, "New owner")
        await _link(service, org, old, SERIAL)
        await _link(service, org, new, CODE, credential_type=NfcCredentialType.WRITTEN)
        _, item = await service.resolve(org, (CODE, SERIAL))
        assert item.id == new

    async def test_an_unlinked_tag_names_nothing(self, service, org):
        with pytest.raises(InventoryNfcTagNotFound, match="not linked"):
            await service.resolve(org, (None, SERIAL))

    async def test_another_organizations_tag_names_nothing(
        self, db_session, service, org, other_org
    ):
        theirs = await _make_item(db_session, other_org, "Theirs")
        await _link(service, other_org, theirs)
        with pytest.raises(InventoryNfcTagNotFound):
            await service.resolve(org, (None, SERIAL))

    async def test_a_lost_tag_names_nothing_until_found(self, db_session, service, org):
        item_id = await _make_item(db_session, org, "Pager")
        tag = await _link(service, org, item_id)
        await service.update_tag(tag["id"], org, {"status": InventoryNfcTagStatus.LOST})
        with pytest.raises(InventoryNfcTagNotFound, match="lost"):
            await service.resolve(org, (None, SERIAL))

        await service.update_tag(
            tag["id"], org, {"status": InventoryNfcTagStatus.ACTIVE}
        )
        _, item = await service.resolve(org, (None, SERIAL))
        assert item.id == item_id

    async def test_a_retired_item_is_not_put_back_into_circulation(
        self, db_session, service, org
    ):
        item_id = await _make_item(db_session, org, "Retired coat", active=False)
        await _link(service, org, item_id)
        with pytest.raises(InventoryNfcTagNotFound, match="no longer active"):
            await service.resolve(org, (None, SERIAL))


class TestChangingAndUnlinking:
    async def test_unlinking_frees_the_tag(self, db_session, service, org):
        first = await _make_item(db_session, org, "Light 1")
        second = await _make_item(db_session, org, "Light 2")
        tag = await _link(service, org, first)
        await service.unlink_tag(tag["id"], org)
        await _link(service, org, second)
        _, item = await service.resolve(org, (None, SERIAL))
        assert item.id == second

    async def test_another_organizations_tag_cannot_be_changed_or_unlinked(
        self, db_session, service, org, other_org
    ):
        theirs = await _make_item(db_session, other_org, "Theirs")
        tag = await _link(service, other_org, theirs)
        with pytest.raises(LookupError):
            await service.update_tag(tag["id"], org, {"label": "Mine now"})
        with pytest.raises(LookupError):
            await service.unlink_tag(tag["id"], org)

    async def test_a_null_status_is_refused_rather_than_written(
        self, db_session, service, org
    ):
        item_id = await _make_item(db_session, org, "Hose")
        tag = await _link(service, org, item_id)
        with pytest.raises(ValueError, match="status"):
            await service.update_tag(tag["id"], org, {"status": None})

    async def test_the_label_can_be_cleared(self, db_session, service, org):
        item_id = await _make_item(db_session, org, "Nozzle")
        tag = await _link(service, org, item_id, label="Bail")
        updated = await service.update_tag(tag["id"], org, {"label": None})
        assert updated["label"] is None
