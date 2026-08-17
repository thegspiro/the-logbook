"""
Database-backed tests for vendor tracking.

The companion suite (`test_inventory_vendors.py`) drives the same service with
mocked sessions, which is fast and covers the branching — but it is structurally
blind to anything the ORM decides on its own. It passed in full while merging a
vendor was deleting the contacts it reported as moving, because a cascade is
exactly what a mock cannot have.

So these run against a real database and assert on what is still in it
afterwards: contacts survive a merge, links survive a deactivation, the
case-folded matching that the cleanup screen promises actually matches, and the
row a caller gets back after an update reflects the update.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.inventory import (
    InventoryItem,
    InventoryVendor,
    InventoryVendorContact,
    ReorderRequest,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Vendor FD"):
    org = Organization(name=name, slug=f"vendor-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_vendor(db, org, name, **kwargs):
    vendor = InventoryVendor(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        is_active=kwargs.pop("is_active", True),
        is_preferred=kwargs.pop("is_preferred", False),
        **kwargs,
    )
    db.add(vendor)
    await db.flush()
    return vendor


async def _make_contact(db, org, vendor, name, is_primary=False, **kwargs):
    contact = InventoryVendorContact(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        vendor_id=vendor.id,
        name=name,
        is_primary=is_primary,
        **kwargs,
    )
    db.add(contact)
    await db.flush()
    return contact


async def _make_item(db, org, name, **kwargs):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        active=kwargs.pop("active", True),
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


async def _make_reorder(db, org, item_name, **kwargs):
    reorder = ReorderRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        item_name=item_name,
        quantity_requested=kwargs.pop("quantity_requested", 1),
        **kwargs,
    )
    db.add(reorder)
    await db.flush()
    return reorder


class TestMergeAgainstARealDatabase:
    """The merge moves three kinds of row and deletes one. What survives is the
    whole question, and only a database can answer it."""

    async def test_contacts_survive_the_merge(self, db_session):
        org = await _make_org(db_session)
        target = await _make_vendor(db_session, org, "Galls")
        source = await _make_vendor(db_session, org, "Galls Inc.")
        kept = await _make_contact(db_session, org, source, "Ray Whitfield", True)
        also = await _make_contact(db_session, org, source, "Dana Reyes")
        service = InventoryService(db_session)

        result, error = await service.merge_vendors(target.id, source.id, org.id)

        assert error is None
        assert result["contacts_moved"] == 2

        # The regression this file exists for: the contacts were repointed with
        # a bulk UPDATE while still loaded on the source, whose relationship
        # cascades delete-orphan — so deleting the source deleted them, and the
        # merge cheerfully reported them as moved.
        rows = (
            (
                await db_session.execute(
                    select(InventoryVendorContact).where(
                        InventoryVendorContact.id.in_([kept.id, also.id])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        assert {row.vendor_id for row in rows} == {target.id}

    async def test_items_and_reorders_follow_the_merge(self, db_session):
        org = await _make_org(db_session)
        target = await _make_vendor(db_session, org, "Galls")
        source = await _make_vendor(db_session, org, "Galls Inc.")
        item = await _make_item(db_session, org, "Bunker Coat", vendor_id=source.id)
        reorder = await _make_reorder(
            db_session, org, "Structural Gloves", vendor_id=source.id
        )
        service = InventoryService(db_session)

        result, error = await service.merge_vendors(target.id, source.id, org.id)

        assert error is None
        assert (result["items_moved"], result["reorders_moved"]) == (1, 1)
        await db_session.refresh(item)
        await db_session.refresh(reorder)
        assert item.vendor_id == target.id
        assert reorder.vendor_id == target.id

    async def test_the_duplicate_is_gone_and_its_name_is_free(self, db_session):
        org = await _make_org(db_session)
        target = await _make_vendor(db_session, org, "Galls")
        source = await _make_vendor(db_session, org, "Galls Inc.")
        service = InventoryService(db_session)

        await service.merge_vendors(target.id, source.id, org.id)

        assert await db_session.get(InventoryVendor, source.id) is None
        # Freeing the name is the reason the row is deleted rather than
        # deactivated: the unique constraint would otherwise reserve it forever.
        remade, error = await service.create_vendor(org.id, {"name": "Galls Inc."})
        assert error is None
        assert remade is not None

    async def test_only_one_primary_contact_survives(self, db_session):
        org = await _make_org(db_session)
        target = await _make_vendor(db_session, org, "Galls")
        source = await _make_vendor(db_session, org, "Galls Inc.")
        await _make_contact(db_session, org, target, "Dana Reyes", True)
        await _make_contact(db_session, org, source, "Ray Whitfield", True)
        service = InventoryService(db_session)

        await service.merge_vendors(target.id, source.id, org.id)

        merged = await service.get_vendor(target.id, org.id)
        assert len(merged.contacts) == 2
        assert sum(1 for c in merged.contacts if c.is_primary) == 1

    async def test_a_vendor_from_another_department_cannot_be_merged_in(
        self, db_session
    ):
        ours = await _make_org(db_session, "Ours FD")
        theirs = await _make_org(db_session, "Theirs FD")
        target = await _make_vendor(db_session, ours, "Galls")
        foreign = await _make_vendor(db_session, theirs, "Galls Inc.")
        service = InventoryService(db_session)

        result, error = await service.merge_vendors(target.id, foreign.id, ours.id)

        assert result is None
        assert error == "The vendor to merge was not found"
        assert await db_session.get(InventoryVendor, foreign.id) is not None


class TestAttachingTypedInNames:
    async def test_matching_is_case_and_whitespace_insensitive(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Corner Medical Supply")
        typed = await _make_item(
            db_session, org, "Gauze", vendor="  corner medical supply  "
        )
        reorder = await _make_reorder(
            db_session, org, "Exam Gloves", vendor="CORNER MEDICAL SUPPLY"
        )
        service = InventoryService(db_session)

        result, error = await service.attach_vendor_name(
            vendor.id, org.id, "Corner Medical Supply"
        )

        assert error is None
        assert result == {"items_linked": 1, "reorders_linked": 1}
        await db_session.refresh(typed)
        await db_session.refresh(reorder)
        assert typed.vendor_id == vendor.id
        assert reorder.vendor_id == vendor.id

    async def test_a_row_already_linked_elsewhere_is_left_alone(self, db_session):
        org = await _make_org(db_session)
        keeper = await _make_vendor(db_session, org, "Bound Tree Medical")
        claiming = await _make_vendor(db_session, org, "Corner Medical Supply")
        # Someone attached this by hand to a different supplier. That is a
        # decision, not a leftover.
        decided = await _make_item(
            db_session,
            org,
            "Gauze",
            vendor="Corner Medical Supply",
            vendor_id=keeper.id,
        )
        service = InventoryService(db_session)

        result, _ = await service.attach_vendor_name(
            claiming.id, org.id, "Corner Medical Supply"
        )

        assert result["items_linked"] == 0
        await db_session.refresh(decided)
        assert decided.vendor_id == keeper.id

    async def test_another_departments_rows_are_untouched(self, db_session):
        ours = await _make_org(db_session, "Ours FD")
        theirs = await _make_org(db_session, "Theirs FD")
        vendor = await _make_vendor(db_session, ours, "Corner Medical Supply")
        foreign_item = await _make_item(
            db_session, theirs, "Gauze", vendor="Corner Medical Supply"
        )
        service = InventoryService(db_session)

        result, _ = await service.attach_vendor_name(
            vendor.id, ours.id, "Corner Medical Supply"
        )

        assert result["items_linked"] == 0
        await db_session.refresh(foreign_item)
        assert foreign_item.vendor_id is None


class TestTheCleanupList:
    async def test_spellings_fold_together_and_retired_items_count(self, db_session):
        org = await _make_org(db_session)
        await _make_item(db_session, org, "Gauze", vendor="Corner Medical Supply")
        await _make_item(db_session, org, "Tape", vendor="corner medical supply")
        # Retired, but the purchase still happened — attaching updates it and
        # the vendor's spend counts it, so the cleanup list has to offer it.
        await _make_item(
            db_session, org, "Old Splint", vendor="Corner Medical Supply", active=False
        )
        await _make_reorder(
            db_session, org, "Exam Gloves", vendor="CORNER MEDICAL SUPPLY"
        )
        service = InventoryService(db_session)

        names = await service.list_unlinked_vendor_names(org.id)

        assert len(names) == 1
        assert names[0]["item_count"] == 3
        assert names[0]["reorder_count"] == 1

    async def test_rows_already_linked_are_not_offered(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Galls")
        await _make_item(
            db_session, org, "Bunker Coat", vendor="galls inc", vendor_id=vendor.id
        )
        service = InventoryService(db_session)

        assert await service.list_unlinked_vendor_names(org.id) == []

    async def test_the_list_stops_at_the_department_boundary(self, db_session):
        ours = await _make_org(db_session, "Ours FD")
        theirs = await _make_org(db_session, "Theirs FD")
        await _make_item(db_session, theirs, "Gauze", vendor="Corner Medical Supply")
        service = InventoryService(db_session)

        assert await service.list_unlinked_vendor_names(ours.id) == []


class TestVendorLifecycle:
    async def test_the_unique_name_constraint_is_case_folded_in_practice(
        self, db_session
    ):
        org = await _make_org(db_session)
        service = InventoryService(db_session)
        await service.create_vendor(org.id, {"name": "Galls"})

        vendor, error = await service.create_vendor(org.id, {"name": "GALLS"})

        assert vendor is None
        assert "already exists" in error

    async def test_two_departments_may_each_have_their_own_galls(self, db_session):
        ours = await _make_org(db_session, "Ours FD")
        theirs = await _make_org(db_session, "Theirs FD")
        service = InventoryService(db_session)

        first, first_error = await service.create_vendor(ours.id, {"name": "Galls"})
        second, second_error = await service.create_vendor(theirs.id, {"name": "Galls"})

        assert first_error is None
        assert second_error is None
        assert first.id != second.id

    async def test_deactivating_keeps_every_link(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Cascade Fire Equipment")
        item = await _make_item(db_session, org, "Nozzle", vendor_id=vendor.id)
        service = InventoryService(db_session)

        ok, error = await service.deactivate_vendor(vendor.id, org.id)

        assert (ok, error) == (True, None)
        await db_session.refresh(item)
        # "We don't buy from them anymore" must not erase where a nozzle in
        # service came from.
        assert item.vendor_id == vendor.id

    async def test_removing_a_primary_contact_promotes_another(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Galls")
        primary = await _make_contact(db_session, org, vendor, "Dana Reyes", True)
        await _make_contact(db_session, org, vendor, "Marcus Webb")
        service = InventoryService(db_session)

        assert await service.delete_vendor_contact(primary.id, org.id) is None

        remaining = await service.get_vendor(vendor.id, org.id)
        assert len(remaining.contacts) == 1
        assert remaining.contacts[0].is_primary is True


class TestVendorStats:
    async def test_items_count_the_catalog_while_spend_counts_every_purchase(
        self, db_session
    ):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Galls")
        await _make_item(
            db_session,
            org,
            "Bunker Coat",
            vendor_id=vendor.id,
            purchase_price=Decimal("2480.00"),
        )
        await _make_item(
            db_session,
            org,
            "Retired Coat",
            vendor_id=vendor.id,
            purchase_price=Decimal("1200.00"),
            active=False,
        )
        service = InventoryService(db_session)

        stats = await service.get_vendor_stats(org.id, [vendor.id])

        # The catalog holds one; the department spent on both.
        assert stats[vendor.id]["item_count"] == 1
        assert Decimal(stats[vendor.id]["total_purchase_value"]) == Decimal("3680.00")

    async def test_only_open_reorders_are_counted(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "MSA Safety")
        await _make_reorder(
            db_session, org, "Cylinders", vendor_id=vendor.id, status="ordered"
        )
        await _make_reorder(
            db_session, org, "Masks", vendor_id=vendor.id, status="received"
        )
        await _make_reorder(
            db_session, org, "Harness", vendor_id=vendor.id, status="cancelled"
        )
        service = InventoryService(db_session)

        stats = await service.get_vendor_stats(org.id, [vendor.id])

        assert stats[vendor.id]["open_reorder_count"] == 1


class TestReorderResponseAfterAnUpdate:
    async def test_relinking_returns_the_new_vendors_name(self, db_session):
        org = await _make_org(db_session)
        was = await _make_vendor(db_session, org, "Galls")
        now = await _make_vendor(db_session, org, "MSA Safety")
        reorder = await _make_reorder(db_session, org, "Cylinders", vendor_id=was.id)
        service = InventoryService(db_session)
        # Load it once so the session holds the old vendor on the relationship —
        # the state in which a plain re-read hands back the stale name.
        await service.get_reorder_request(reorder.id, org.id)

        updated, error = await service.update_reorder_request(
            request_id=reorder.id,
            organization_id=org.id,
            data={"vendor_id": now.id},
            current_user_id=None,
        )

        assert error is None
        assert updated.vendor_id == now.id
        assert updated.vendor_record is not None
        assert updated.vendor_record.name == "MSA Safety"

    async def test_unlinking_leaves_no_vendor_on_the_response(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Galls")
        reorder = await _make_reorder(
            db_session, org, "Cylinders", vendor_id=vendor.id, vendor="galls inc"
        )
        service = InventoryService(db_session)
        await service.get_reorder_request(reorder.id, org.id)

        updated, error = await service.update_reorder_request(
            request_id=reorder.id,
            organization_id=org.id,
            data={"vendor_id": None, "vendor": None},
            current_user_id=None,
        )

        assert error is None
        assert updated.vendor_id is None
        assert updated.vendor_record is None
        assert updated.vendor is None


class TestWhatAViewerActuallyReceives:
    """The redaction is unit-tested at the serializer in the mocked suite. That
    proves the function blanks the fields; it does not prove the routes ask it
    to. This drives the real router through `require_permission`, with the
    caller's grant coming from actual position rows, and asserts on the JSON
    that leaves the endpoint."""

    async def _client(self, db_session, caller):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.api.v1.endpoints import inventory as inventory_endpoints
        from app.core.database import get_db

        app = FastAPI()
        app.include_router(inventory_endpoints.router, prefix="/inventory")
        app.dependency_overrides[get_current_user] = lambda: caller
        app.dependency_overrides[get_db] = lambda: db_session
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def _caller(self, db_session, org, *permissions):
        """A user whose grant comes from a real position row.

        Built through the ORM rather than raw INSERTs so `user.positions` is
        already populated in memory: `_collect_user_permissions` walks that
        relationship, and a lazy load there raises MissingGreenlet under the
        async session instead of quietly reporting no permissions.
        """
        from app.models.user import Position, User

        user = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"tester-{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            first_name="Pat",
            last_name="Quinn",
            password_hash="x",
        )
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Tester",
            slug=f"tester-{uuid.uuid4().hex[:8]}",
            permissions=list(permissions),
        )
        user.positions.append(position)
        db_session.add_all([user, position])
        await db_session.flush()
        return user

    async def _seed(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(
            db_session,
            org,
            "Galls",
            account_number="FCFD-2201",
            payment_terms="Net 30",
            phone="703-555-0100",
            email="orders@galls.example",
        )
        await _make_item(
            db_session, org, "Turnout coat", vendor_id=vendor.id, purchase_price=1200
        )
        return org, vendor

    async def test_viewer_gets_the_directory_without_the_money(self, db_session):
        org, vendor = await self._seed(db_session)
        caller = await self._caller(db_session, org, "inventory.view")

        async with await self._client(db_session, caller) as client:
            listed = await client.get("/inventory/vendors")
            detail = await client.get(f"/inventory/vendors/{vendor.id}")

        assert listed.status_code == 200
        assert detail.status_code == 200
        for body in (listed.json()[0], detail.json()):
            assert body["account_number"] is None
            assert body["payment_terms"] is None
            assert body["total_purchase_value"] is None
            # Still a usable directory entry.
            assert body["name"] == "Galls"
            assert body["phone"] == "703-555-0100"
            assert body["email"] == "orders@galls.example"
            # "We buy from them" survives; only the amount is withheld.
            assert body["item_count"] == 1

    async def test_manager_gets_the_money(self, db_session):
        org, vendor = await self._seed(db_session)
        caller = await self._caller(
            db_session, org, "inventory.view", "inventory.manage"
        )

        async with await self._client(db_session, caller) as client:
            detail = await client.get(f"/inventory/vendors/{vendor.id}")

        assert detail.status_code == 200
        body = detail.json()
        assert body["account_number"] == "FCFD-2201"
        assert body["payment_terms"] == "Net 30"
        assert Decimal(str(body["total_purchase_value"])) == Decimal("1200")


class TestCsvImportReportsUnmatchedVendors:
    """A "Vendor" cell naming nothing on file keeps the typed-in name and gets
    no link. That is the right behaviour — importing must not create suppliers
    nobody reviewed — but doing it silently refills the very list the cleanup
    screen exists to drain, and one misspelling in a 200-row sheet does it 200
    times. The import has to say so."""

    async def _import(self, db_session, org, csv_text):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.api.v1.endpoints import inventory as inventory_endpoints
        from app.core.database import get_db
        from app.models.user import Position, User

        user = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"qm-{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            first_name="Sam",
            last_name="Reed",
            password_hash="x",
        )
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Quartermaster",
            slug=f"qm-{uuid.uuid4().hex[:8]}",
            permissions=["inventory.view", "inventory.manage"],
        )
        user.positions.append(position)
        db_session.add_all([user, position])
        await db_session.flush()

        app = FastAPI()
        app.include_router(inventory_endpoints.router, prefix="/inventory")
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db_session
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.post(
                "/inventory/items/import",
                files={"file": ("items.csv", csv_text.encode(), "text/csv")},
            )

    async def test_an_unrecognized_name_is_reported_not_swallowed(self, db_session):
        org = await _make_org(db_session)
        await _make_vendor(db_session, org, "Galls")

        response = await self._import(
            db_session,
            org,
            "Name,Vendor\n"
            "Turnout coat,Galls\n"
            "Helmet,Gals\n"  # the misspelling
            "Gloves,Gals\n",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["imported"] == 3
        # Repeated on two rows, reported once.
        vendor_warnings = [w for w in body["warnings"] if "did not match" in w]
        assert len(vendor_warnings) == 1
        assert '"Gals"' in vendor_warnings[0]
        # The name that did match is not reported.
        assert '"Galls"' not in vendor_warnings[0]

    async def test_a_clean_sheet_says_nothing_about_vendors(self, db_session):
        org = await _make_org(db_session)
        await _make_vendor(db_session, org, "Galls")

        response = await self._import(
            db_session, org, "Name,Vendor\nTurnout coat,Galls\nHelmet,galls\n"
        )

        assert response.status_code == 200
        body = response.json()
        assert [w for w in body["warnings"] if "did not match" in w] == []

    async def test_the_matched_rows_are_actually_linked(self, db_session):
        org = await _make_org(db_session)
        vendor = await _make_vendor(db_session, org, "Galls")

        await self._import(
            db_session, org, "Name,Vendor\nTurnout coat,Galls\nHelmet,Gals\n"
        )

        linked = (
            (
                await db_session.execute(
                    select(InventoryItem).where(InventoryItem.organization_id == org.id)
                )
            )
            .scalars()
            .all()
        )
        by_name = {item.name: item for item in linked}
        assert by_name["Turnout coat"].vendor_id == vendor.id
        # Unmatched keeps the typed name and no link — reported, not invented.
        assert by_name["Helmet"].vendor_id is None
        assert by_name["Helmet"].vendor == "Gals"


class TestUnmatchedVendorReportingIsHonest:
    """Three ways the warning could mislead, each of which sends the reader to
    do work that will not succeed or is not needed. Companion to
    TestCsvImportReportsUnmatchedVendors, which covers the happy path."""

    async def _import(self, db_session, org, csv_text):
        helper = TestCsvImportReportsUnmatchedVendors()
        return await helper._import(db_session, org, csv_text)

    async def test_spellings_of_one_name_are_reported_once(self, db_session):
        org = await _make_org(db_session)

        response = await self._import(
            db_session,
            org,
            "Name,Vendor\nCoat,Gals\nHelmet,gals\nGloves,GALS\n",
        )

        body = response.json()
        warning = next(w for w in body["warnings"] if "did not match" in w)
        # Attach is case-insensitive, so these are one piece of work, not three.
        assert warning.startswith("1 vendor name(s)")
        assert warning.count('"') == 2

    async def test_a_row_that_failed_to_import_is_not_reported(self, db_session):
        org = await _make_org(db_session)
        await _make_item(db_session, org, "Existing", serial_number="SN-1")

        # Second row carries a duplicate serial, so create_item rejects it.
        response = await self._import(
            db_session,
            org,
            "Name,Vendor,Serial Number\nCoat,Gals,SN-1\n",
        )

        body = response.json()
        assert body["imported"] == 0
        assert body["failed"] == 1
        # Nothing was written, so there is nothing to Attach.
        assert [w for w in body["warnings"] if "did not match" in w] == []

    async def test_a_deactivated_vendor_is_linked_not_reported(self, db_session):
        org = await _make_org(db_session)
        retired = await _make_vendor(db_session, org, "Galls", is_active=False)

        response = await self._import(db_session, org, "Name,Vendor\nCoat,Galls\n")

        body = response.json()
        # Reporting it would advise adding a vendor that already exists, which
        # creation rejects as an inactive duplicate — a dead end.
        assert [w for w in body["warnings"] if "did not match" in w] == []
        item = (
            await db_session.execute(
                select(InventoryItem).where(InventoryItem.name == "Coat")
            )
        ).scalar_one()
        # Deactivating keeps every link, so an import naming one links too.
        assert item.vendor_id == retired.id
