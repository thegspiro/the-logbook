"""The one-time malware scan of files and images stored before scanning.

Runs against the real database (rolled back per test) and a temporary
directory standing in for the uploads volume, with a fake scanner in place of
clamd: content holding ``EICAR`` is reported infected, anything else clean.
"""

import base64
import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models.document import Document
from app.models.stored_file_scan import ScanVerdict, StoredFileScan
from app.models.storefront import StoreProduct, StoreProductImage
from app.models.training import ShiftEquipmentCheck, ShiftEquipmentCheckItem
from app.services import file_storage_service, malware_scan_service
from app.services import stored_file_rescan as rescan_module
from app.services.malware_scan_service import MalwareScanUnavailable, ScanResult
from app.services.scheduled_tasks import (
    SCHEDULE,
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
)
from app.services.stored_file_rescan import StoredFileRescan

CLEAN = b"%PDF-1.4 a certificate"
INFECTED = b"%PDF-1.4 EICAR-STANDARD-ANTIVIRUS-TEST-FILE"


class FakeScanner:
    """Stands in for clamd. ``down`` makes every call fail the way an
    unreachable daemon does."""

    def __init__(self):
        self.calls: list[bytes] = []
        self.down = False

    async def __call__(self, data: bytes, **_kwargs) -> ScanResult:
        self.calls.append(data)
        if self.down:
            raise MalwareScanUnavailable("clamd is unreachable")
        if b"EICAR" in data:
            return ScanResult(infected=True, signature="Eicar-Test-Signature")
        return ScanResult(infected=False)


@pytest.fixture
def scanner(monkeypatch):
    fake = FakeScanner()
    monkeypatch.setattr(malware_scan_service, "scan_bytes", fake)
    monkeypatch.setattr(settings, "CLAMAV_ENABLED", True)
    return fake


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _data_uri(content: bytes) -> str:
    return f"data:image/webp;base64,{base64.b64encode(content).decode()}"


async def _org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Rescan VFD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"rescan-{org_id[:8]}"},
    )
    return org_id


async def _member(db_session, org_id: str, photo_url: str | None = None) -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, photo_url) VALUES "
            "(:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active', :photo)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@test.com",
            "photo": photo_url,
        },
    )
    return user_id


async def _document(db_session, root, org_id: str, content: bytes) -> Document:
    """A document whose file sits in the org's documents area."""
    doc_id = str(uuid.uuid4())
    directory = root / org_id / "documents" / doc_id
    directory.mkdir(parents=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(content)
    document = Document(
        id=doc_id,
        organization_id=org_id,
        name="Stored before scanning",
        file_name="report.pdf",
        file_path=str(path),
        file_size=len(content),
        file_type="application/pdf",
    )
    db_session.add(document)
    await db_session.flush()
    return document


async def _ledger(db_session, org_id: str) -> list[StoredFileScan]:
    rows = await db_session.execute(
        select(StoredFileScan).where(StoredFileScan.organization_id == org_id)
    )
    return list(rows.scalars().all())


async def _detections(db_session, org_id: str) -> list[dict]:
    rows = await db_session.execute(
        text(
            "SELECT event_data FROM audit_logs WHERE organization_id = :org "
            "AND event_type = 'upload_malware_detected'"
        ),
        {"org": org_id},
    )
    found = []
    for (data,) in rows.fetchall():
        found.append(json.loads(data) if isinstance(data, str) else data)
    return found


async def _run(db_session, org_id: str, **kwargs) -> dict:
    return await StoredFileRescan(db_session).run(organization_id=org_id, **kwargs)


@pytest.mark.integration
class TestScanOnce:
    async def test_stored_files_and_images_are_scanned_and_recorded(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        await db_session.execute(
            text("UPDATE organizations SET logo = :logo WHERE id = :id"),
            {"logo": _data_uri(b"logo-bytes"), "id": org_id},
        )
        await _member(db_session, org_id, photo_url=_data_uri(b"photo-bytes"))
        document = await _document(db_session, upload_root, org_id, CLEAN)

        result = await _run(db_session, org_id)

        assert result["scanned"] == 3
        assert result["infected"] == 0
        assert sorted(scanner.calls) == sorted([CLEAN, b"logo-bytes", b"photo-bytes"])
        ledger = await _ledger(db_session, org_id)
        assert {(row.source, row.verdict) for row in ledger} == {
            ("documents.file_path", ScanVerdict.CLEAN.value),
            ("organizations.logo", ScanVerdict.CLEAN.value),
            ("users.photo_url", ScanVerdict.CLEAN.value),
        }
        assert {
            row.row_id for row in ledger if row.source == "documents.file_path"
        } == {document.id}

    async def test_a_second_run_scans_nothing(self, db_session, upload_root, scanner):
        org_id = await _org(db_session)
        await _member(db_session, org_id, photo_url=_data_uri(b"photo-bytes"))
        await _document(db_session, upload_root, org_id, CLEAN)

        await _run(db_session, org_id)
        calls_after_first = len(scanner.calls)
        second = await _run(db_session, org_id)

        assert calls_after_first == 2
        assert len(scanner.calls) == calls_after_first
        assert second["scanned"] == 0
        assert len(await _ledger(db_session, org_id)) == 2

    async def test_a_replaced_photo_is_scanned_again(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        user_id = await _member(db_session, org_id, photo_url=_data_uri(b"first"))
        await _run(db_session, org_id)
        await db_session.execute(
            text("UPDATE users SET photo_url = :p WHERE id = :id"),
            {"p": _data_uri(b"second"), "id": user_id},
        )

        result = await _run(db_session, org_id)

        assert result["scanned"] == 1
        assert scanner.calls[-1] == b"second"

    async def test_the_per_run_budget_resumes_where_it_stopped(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        for _ in range(3):
            await _document(db_session, upload_root, org_id, CLEAN)

        first = await _run(db_session, org_id, max_scans=2)
        second = await _run(db_session, org_id, max_scans=2)
        third = await _run(db_session, org_id, max_scans=2)

        assert (first["scanned"], second["scanned"], third["scanned"]) == (2, 1, 0)
        assert first["remaining"] == 1
        assert second["remaining"] == 0
        assert len(scanner.calls) == 3

    async def test_a_file_outside_its_organizations_storage_is_not_read(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        other_org = await _org(db_session)
        foreign = upload_root / other_org / "documents" / "x"
        foreign.mkdir(parents=True)
        path = foreign / "theirs.pdf"
        path.write_bytes(CLEAN)
        db_session.add(
            Document(
                organization_id=org_id,
                name="Points elsewhere",
                file_path=str(path),
            )
        )
        await db_session.flush()

        result = await _run(db_session, org_id)

        assert scanner.calls == []
        assert result["outside_storage"] == 1
        assert await _ledger(db_session, org_id) == []


@pytest.mark.integration
class TestInfected:
    async def test_an_infected_file_is_deleted_and_audited_like_an_upload(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        document = await _document(db_session, upload_root, org_id, INFECTED)
        stored_path = document.file_path

        result = await _run(db_session, org_id)

        assert result["infected"] == 1
        assert not await file_storage_service.exists(stored_path)
        (row,) = await _ledger(db_session, org_id)
        assert row.verdict == ScanVerdict.INFECTED.value
        assert row.signature == "Eicar-Test-Signature"
        assert row.removed_at is not None
        (event,) = await _detections(db_session, org_id)
        assert event["signature"] == "Eicar-Test-Signature"
        assert event["upload"] == "stored_file_rescan"
        assert event["file_size"] == len(INFECTED)
        assert event["record"] == "documents.file_path"
        assert event["record_id"] == document.id
        # Ids and a digest, never the member's file name.
        assert "report.pdf" not in json.dumps(event)

    async def test_an_infected_photo_is_cleared(self, db_session, upload_root, scanner):
        org_id = await _org(db_session)
        user_id = await _member(
            db_session, org_id, photo_url=_data_uri(b"EICAR in a photo")
        )

        await _run(db_session, org_id)

        photo = (
            await db_session.execute(
                text("SELECT photo_url FROM users WHERE id = :id"), {"id": user_id}
            )
        ).scalar_one()
        assert photo is None
        (event,) = await _detections(db_session, org_id)
        assert event["record"] == "users.photo_url"
        assert event["record_id"] == user_id

    async def test_an_infected_product_image_is_removed(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        product = StoreProduct(organization_id=org_id, name="Station shirt")
        db_session.add(product)
        await db_session.flush()
        db_session.add(
            StoreProductImage(
                organization_id=org_id,
                product_id=product.id,
                data=b"EICAR in an image",
                byte_size=17,
            )
        )
        await db_session.flush()

        result = await _run(db_session, org_id)

        assert result["infected"] == 1
        remaining = await db_session.execute(
            select(StoreProductImage.id).where(
                StoreProductImage.product_id == product.id
            )
        )
        assert remaining.first() is None

    async def test_only_the_infected_equipment_check_photo_is_removed(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        check = ShiftEquipmentCheck(
            organization_id=org_id,
            check_timing="start_of_shift",
            overall_status="pass",
        )
        db_session.add(check)
        await db_session.flush()
        kept = _data_uri(b"a clean photo")
        item = ShiftEquipmentCheckItem(
            check_id=check.id,
            compartment_name="Cab",
            item_name="SCBA",
            status="pass",
            photo_urls=[kept, _data_uri(b"EICAR in a photo")],
        )
        db_session.add(item)
        await db_session.flush()

        result = await _run(db_session, org_id)

        assert result["infected"] == 1
        await db_session.refresh(item)
        assert item.photo_urls == [kept]
        (event,) = await _detections(db_session, org_id)
        assert event["record"] == "shift_equipment_check_items.photo_urls"

        # The shortened list is a new value, scanned once more and found clean.
        again = await _run(db_session, org_id)
        assert (again["scanned"], again["infected"]) == (1, 0)

    async def test_an_interrupted_removal_is_finished_without_a_second_audit(
        self, db_session, upload_root, scanner, monkeypatch
    ):
        org_id = await _org(db_session)
        document = await _document(db_session, upload_root, org_id, INFECTED)
        real_delete = file_storage_service.delete

        async def failing_delete(_ref):
            return False

        monkeypatch.setattr(file_storage_service, "delete", failing_delete)
        await _run(db_session, org_id)
        (row,) = await _ledger(db_session, org_id)
        assert row.removed_at is None
        assert await file_storage_service.exists(document.file_path)

        monkeypatch.setattr(file_storage_service, "delete", real_delete)
        result = await _run(db_session, org_id)

        assert result["removals_finished"] == 1
        assert not await file_storage_service.exists(document.file_path)
        await db_session.refresh(row)
        assert row.removed_at is not None
        assert len(await _detections(db_session, org_id)) == 1
        # Scanned once: the finished removal did not scan the file again.
        assert len(scanner.calls) == 1


@pytest.mark.integration
class TestNoVerdict:
    async def test_scanner_down_records_nothing_and_retries_later(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        for _ in range(5):
            await _document(db_session, upload_root, org_id, CLEAN)
        scanner.down = True

        result = await _run(db_session, org_id)

        assert result["scanned"] == 0
        assert result["scanner_unavailable"] is True
        # Gives up after a few consecutive failures rather than trying all.
        assert len(scanner.calls) == rescan_module.MAX_CONSECUTIVE_UNAVAILABLE
        assert await _ledger(db_session, org_id) == []

        scanner.down = False
        retry = await _run(db_session, org_id)
        assert retry["scanned"] == 5
        assert {row.verdict for row in await _ledger(db_session, org_id)} == {
            ScanVerdict.CLEAN.value
        }

    async def test_disabled_scanning_records_nothing(
        self, db_session, upload_root, scanner, monkeypatch
    ):
        org_id = await _org(db_session)
        await _document(db_session, upload_root, org_id, INFECTED)
        monkeypatch.setattr(settings, "CLAMAV_ENABLED", False)

        result = await _run(db_session, org_id)

        assert result["skipped"] == "malware scanning is disabled"
        assert scanner.calls == []
        assert await _ledger(db_session, org_id) == []
        assert await _detections(db_session, org_id) == []

        monkeypatch.setattr(settings, "CLAMAV_ENABLED", True)
        enabled = await _run(db_session, org_id)
        assert enabled["infected"] == 1

    async def test_a_missing_file_is_recorded_as_missing_not_clean(
        self, db_session, upload_root, scanner
    ):
        org_id = await _org(db_session)
        document = await _document(db_session, upload_root, org_id, CLEAN)
        await file_storage_service.delete(document.file_path)

        await _run(db_session, org_id)

        (row,) = await _ledger(db_session, org_id)
        assert row.verdict == ScanVerdict.MISSING.value
        assert scanner.calls == []


@pytest.mark.unit
class TestWiring:
    async def test_disabled_scanning_does_not_touch_the_database(
        self, scanner, monkeypatch
    ):
        monkeypatch.setattr(settings, "CLAMAV_ENABLED", False)

        class NoDatabase(SimpleNamespace):
            def __getattr__(self, name):
                raise AssertionError(f"the database was used: {name}")

        result = await StoredFileRescan(NoDatabase()).run()

        assert result["skipped"] == "malware scanning is disabled"

    def test_registered_with_the_in_process_scheduler(self):
        assert "stored_file_malware_scan" in TASK_RUNNERS
        assert TASK_INTERVALS_SECONDS["stored_file_malware_scan"] == 3600
        assert "stored_file_malware_scan" in SCHEDULE
