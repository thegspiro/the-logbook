"""NFC phase 4b, against the real database: the self-service kiosk.

What is at stake is who ends up holding what — the checkout row, its borrower
and operator, its due date, and every rule that refuses a tap — so a mocked
session would only assert the queries as written.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models.inventory import (
    CheckOutRecord,
    InventoryCategory,
    InventoryItem,
    ItemCondition,
    ItemStatus,
    TrackingType,
)
from app.models.nfc_tag import NfcCredentialType, NfcTag, NfcTagStatus
from app.services.inventory_kiosk_service import InventoryKioskService, KioskRefusal
from app.services.inventory_nfc_service import InventoryNfcService
from app.services.nfc_tag_service import hash_tag_uid, uid_preview

pytestmark = pytest.mark.integration

MEMBER_CARD = "04AA11BB22CC33"
OTHER_CARD = "04DD44EE55FF66"


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


async def _make_user(db, org_id: str, first: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first}-{user_id[:8]}",
            "fn": first,
            "em": f"{first}-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _make_location(db, org_id: str, name: str) -> str:
    loc_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO locations (id, organization_id, name) "
            "VALUES (:id, :org, :name)"
        ),
        {"id": loc_id, "org": org_id, "name": name},
    )
    await db.flush()
    return loc_id


async def _card(db, org_id: str, user_id: str, serial: str, status=NfcTagStatus.ACTIVE):
    db.add(
        NfcTag(
            organization_id=org_id,
            user_id=user_id,
            uid_hash=hash_tag_uid(serial),
            uid_preview=uid_preview(serial),
            credential_type=NfcCredentialType.SERIAL,
            status=status,
        )
    )
    await db.flush()


async def _category(db, org_id: str, *, allow=True, loan_days=None) -> str:
    category = InventoryCategory(
        organization_id=org_id,
        name=f"Loaners {uuid.uuid4().hex[:6]}",
        item_type="equipment",
        allow_self_checkout=allow,
        self_checkout_loan_days=loan_days,
    )
    db.add(category)
    await db.flush()
    return category.id


_tag_counter = iter(range(1, 10_000))


async def _item(
    db,
    org_id: str,
    category_id: str,
    name: str,
    *,
    tracking=TrackingType.INDIVIDUAL,
    status=ItemStatus.AVAILABLE,
    positions=None,
) -> tuple:
    item = InventoryItem(
        organization_id=org_id,
        category_id=category_id,
        name=name,
        condition=ItemCondition.GOOD,
        status=status,
        tracking_type=tracking,
        quantity=1,
        quantity_issued=0,
        active=True,
        restricted_to_positions=positions,
    )
    db.add(item)
    await db.flush()
    serial = f"0477{next(_tag_counter):06d}"
    await InventoryNfcService(db).link_tag(
        organization_id=org_id,
        item_id=item.id,
        tag_uid=serial,
        credential_type=NfcCredentialType.SERIAL,
        label=None,
        linked_by=None,
    )
    return item.id, serial


def _read(serial: str) -> tuple:
    return (None, serial)


@pytest.fixture
async def kiosk(db_session):
    org = await _make_org(db_session, "kiosk-org")
    operator = await _make_user(db_session, org, "Olive")
    member = await _make_user(db_session, org, "Morgan")
    other = await _make_user(db_session, org, "Riley")
    await _card(db_session, org, member, MEMBER_CARD)
    await _card(db_session, org, other, OTHER_CARD)
    loaners = await _category(db_session, org, loan_days=7)
    return {
        "org": org,
        "operator": operator,
        "member": member,
        "other": other,
        "loaners": loaners,
        "service": InventoryKioskService(db_session),
    }


async def _open_checkout(db, item_id: str):
    db.expire_all()
    return (
        await db.execute(
            select(CheckOutRecord).where(
                CheckOutRecord.item_id == item_id,
                CheckOutRecord.is_returned.is_(False),
            )
        )
    ).scalar_one_or_none()


class TestCheckout:
    async def test_checks_out_to_the_card_holder_with_a_due_date(
        self, db_session, kiosk
    ):
        item_id, tag = await _item(db_session, kiosk["org"], kiosk["loaners"], "Radio")
        before = datetime.now(timezone.utc)
        result = await kiosk["service"].checkout(
            kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
        )
        record = await _open_checkout(db_session, item_id)
        assert record.user_id == kiosk["member"]
        assert record.checked_out_by == kiosk["operator"]
        assert record.checkout_reason == "Self-service kiosk"
        due = record.expected_return_at.replace(tzinfo=timezone.utc)
        assert (
            timedelta(days=7) - timedelta(minutes=1)
            < due - before
            < timedelta(days=7, minutes=1)
        )
        assert result["member_name"] == "Morgan Tester"
        item = await db_session.get(InventoryItem, item_id)
        assert item.status == ItemStatus.CHECKED_OUT

    async def test_no_loan_period_means_no_due_date(self, db_session, kiosk):
        open_ended = await _category(db_session, kiosk["org"], loan_days=None)
        item_id, tag = await _item(db_session, kiosk["org"], open_ended, "Light")
        await kiosk["service"].checkout(
            kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
        )
        assert (await _open_checkout(db_session, item_id)).expected_return_at is None

    @pytest.mark.parametrize(
        ("setup", "message"),
        [
            ("not_allowed", "cannot be checked out at the kiosk"),
            ("pool", "issued from stock"),
            ("assigned", "is not available"),
            ("restricted", "restricted by rank or position"),
        ],
    )
    async def test_refusals(self, db_session, kiosk, setup, message):
        category = kiosk["loaners"]
        kwargs = {}
        if setup == "not_allowed":
            category = await _category(db_session, kiosk["org"], allow=False)
        elif setup == "pool":
            kwargs["tracking"] = TrackingType.POOL
        elif setup == "assigned":
            kwargs["status"] = ItemStatus.ASSIGNED
        elif setup == "restricted":
            kwargs["positions"] = ["captain"]
        item_id, tag = await _item(
            db_session, kiosk["org"], category, "Thing", **kwargs
        )
        with pytest.raises(KioskRefusal, match=message):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
            )
        with pytest.raises(KioskRefusal, match=message):
            await kiosk["service"].preview(kiosk["org"], _read(MEMBER_CARD), _read(tag))
        assert await _open_checkout(db_session, item_id) is None

    async def test_a_member_holding_the_position_may_take_it(self, db_session, kiosk):
        position_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, 'Captain', 'captain', :perms)"
            ),
            {"id": position_id, "org": kiosk["org"], "perms": json.dumps([])},
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": kiosk["member"], "p": position_id},
        )
        await db_session.flush()
        item_id, tag = await _item(
            db_session, kiosk["org"], kiosk["loaners"], "SCBA", positions=["captain"]
        )
        await kiosk["service"].checkout(
            kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
        )
        assert (await _open_checkout(db_session, item_id)).user_id == kiosk["member"]

    @pytest.mark.parametrize(
        ("card", "message"),
        [("unknown", "not registered"), ("lost", "no longer works")],
    )
    async def test_a_bad_card_is_refused(self, db_session, kiosk, card, message):
        serial = "04BADBADBAD000"
        if card == "lost":
            await _card(
                db_session, kiosk["org"], kiosk["member"], serial, NfcTagStatus.LOST
            )
        _item_id, tag = await _item(db_session, kiosk["org"], kiosk["loaners"], "Radio")
        with pytest.raises(KioskRefusal, match=message):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read(serial), _read(tag)
            )

    async def test_another_organizations_card_and_tag_are_unknown(
        self, db_session, kiosk
    ):
        other_org = await _make_org(db_session, "other-org")
        stranger = await _make_user(db_session, other_org, "Sam")
        await _card(db_session, other_org, stranger, "04FEEDFACE0001")
        their_category = await _category(db_session, other_org)
        _theirs, their_tag = await _item(
            db_session, other_org, their_category, "Theirs"
        )
        _mine, my_tag = await _item(db_session, kiosk["org"], kiosk["loaners"], "Mine")
        with pytest.raises(KioskRefusal, match="not registered"):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read("04FEEDFACE0001"), _read(my_tag)
            )
        with pytest.raises(KioskRefusal, match="not linked"):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(their_tag)
            )


class TestReturn:
    async def _borrowed(self, db_session, kiosk, name="Radio"):
        item_id, tag = await _item(db_session, kiosk["org"], kiosk["loaners"], name)
        await kiosk["service"].checkout(
            kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
        )
        return item_id, tag

    async def test_preview_says_return_for_the_holder(self, db_session, kiosk):
        _item_id, tag = await self._borrowed(db_session, kiosk)
        preview = await kiosk["service"].preview(
            kiosk["org"], _read(MEMBER_CARD), _read(tag)
        )
        assert preview["action"] == "return"
        assert preview["due_at"] is not None

    async def test_return_keeps_the_condition(self, db_session, kiosk):
        item_id, tag = await self._borrowed(db_session, kiosk)
        await kiosk["service"].return_item(
            kiosk["org"],
            kiosk["operator"],
            _read(MEMBER_CARD),
            _read(tag),
            damaged=False,
            damage_notes=None,
        )
        assert await _open_checkout(db_session, item_id) is None
        item = await db_session.get(InventoryItem, item_id)
        assert item.condition == ItemCondition.GOOD
        assert item.status == ItemStatus.AVAILABLE

    async def test_a_damaged_return_marks_the_item_and_keeps_the_note(
        self, db_session, kiosk
    ):
        item_id, tag = await self._borrowed(db_session, kiosk)
        await kiosk["service"].return_item(
            kiosk["org"],
            kiosk["operator"],
            _read(MEMBER_CARD),
            _read(tag),
            damaged=True,
            damage_notes="  Cracked antenna ",
        )
        db_session.expire_all()
        item = await db_session.get(InventoryItem, item_id)
        assert item.condition == ItemCondition.DAMAGED
        record = (
            await db_session.execute(
                select(CheckOutRecord).where(CheckOutRecord.item_id == item_id)
            )
        ).scalar_one()
        assert record.damage_notes == "Cracked antenna"
        assert record.checked_in_by == kiosk["operator"]

    async def test_damaged_needs_a_note(self, db_session, kiosk):
        _item_id, tag = await self._borrowed(db_session, kiosk)
        with pytest.raises(KioskRefusal, match="what is damaged"):
            await kiosk["service"].return_item(
                kiosk["org"],
                kiosk["operator"],
                _read(MEMBER_CARD),
                _read(tag),
                damaged=True,
                damage_notes="   ",
            )

    async def test_only_the_holder_can_return_it(self, db_session, kiosk):
        item_id, tag = await self._borrowed(db_session, kiosk)
        with pytest.raises(KioskRefusal, match="not checked out to you"):
            await kiosk["service"].return_item(
                kiosk["org"],
                kiosk["operator"],
                _read(OTHER_CARD),
                _read(tag),
                damaged=False,
                damage_notes=None,
            )
        assert (await _open_checkout(db_session, item_id)).user_id == kiosk["member"]

    async def test_someone_else_cannot_check_out_a_borrowed_item(
        self, db_session, kiosk
    ):
        _item_id, tag = await self._borrowed(db_session, kiosk)
        with pytest.raises(KioskRefusal, match="is not available"):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read(OTHER_CARD), _read(tag)
            )

    async def test_the_holder_cannot_check_it_out_twice(self, db_session, kiosk):
        _item_id, tag = await self._borrowed(db_session, kiosk)
        with pytest.raises(KioskRefusal, match="already have"):
            await kiosk["service"].checkout(
                kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
            )


class TestIdentify:
    async def test_lists_the_members_open_loans(self, db_session, kiosk):
        item_id, tag = await _item(db_session, kiosk["org"], kiosk["loaners"], "Radio")
        await kiosk["service"].checkout(
            kiosk["org"], kiosk["operator"], _read(MEMBER_CARD), _read(tag)
        )
        me = await kiosk["service"].identify(kiosk["org"], _read(MEMBER_CARD))
        assert me["member_name"] == "Morgan Tester"
        assert [loan["item_id"] for loan in me["loans"]] == [item_id]
        them = await kiosk["service"].identify(kiosk["org"], _read(OTHER_CARD))
        assert them["loans"] == []
