"""LIFE-11: what a member erasure does to stored Documents.

Owner decision 2026-11-23: on anonymisation and on permanent delete, the
member's separation letters are redacted (home address and reason for leaving
removed, the property list and values kept), and every folder under Member
Files the member owns is deleted with its documents, the files queued on
pending_file_deletions.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import users as users_endpoint
from app.models.document import (
    Document,
    DocumentFolder,
    DocumentStatus,
    DocumentType,
    FolderVisibility,
    system_folder_fields,
)
from app.models.pending_file_deletion import PendingFileDeletion
from app.models.user import Organization, User, UserStatus
from app.services import file_storage_service
from app.services.member_anonymization_service import MemberAnonymizationService
from app.services.member_documents import (
    ADDRESS_REMOVED,
    TEXT_REMOVED,
    redact_separation_letter,
)
from app.services.property_return_service import PropertyReturnService
from tests.fake_request import fake_request

STREET = "42 Elm Street"
CITY_LINE = "Falls Church, VA 22046"
REASON = "Relocating for a family medical matter"


def _letter_html(name="Pat Firefighter", number="0417", street=STREET):
    data = {
        "member_name": name,
        "member_address": f"{street}\n{CITY_LINE}",
        "member_number": number,
        "organization_name": "Anon FD",
        "organization_address": f"1 Station Way\n{CITY_LINE}",
        "drop_type": "dropped_voluntary",
        "drop_type_display": "Voluntary Separation",
        "effective_date": "November 01, 2026",
        "return_deadline": "November 15, 2026",
        "return_deadline_days": 14,
        "items": [
            {
                "name": "Turnout coat",
                "serial_number": "TC-881",
                "asset_tag": "A-12",
                "condition": "good",
                "type": "assigned",
                "value": Decimal("1850.00"),
            }
        ],
        "total_value": Decimal("1850.00"),
        "performed_by_name": "Chief Officer",
        "performed_by_title": "Chief",
    }
    return PropertyReturnService(None)._render_html(data, reason=REASON)


@pytest.mark.unit
class TestRedactingALetter:
    def test_the_address_and_reason_go_and_the_property_stays(self):
        html = _letter_html()
        assert STREET in html
        assert REASON in html

        redacted = redact_separation_letter(html, street=STREET, reason=REASON)

        assert STREET not in redacted
        assert REASON not in redacted
        assert "<strong>Reason:</strong>" not in redacted
        assert ADDRESS_REMOVED in redacted
        assert "Turnout coat" in redacted
        assert "TC-881" in redacted
        assert "$1,850.00" in redacted
        assert "Pat Firefighter" in redacted
        # The department's own letterhead shares the city line and keeps it.
        assert "1 Station Way" in redacted

    def test_an_unrecognised_layout_still_loses_the_street_and_reason(self):
        html = f"<p>To: {STREET}</p><p>Because: {REASON}</p><p>Coat $10</p>"

        redacted = redact_separation_letter(html, street=STREET, reason=REASON)

        assert redacted == (
            f"<p>To: {TEXT_REMOVED}</p><p>Because: {TEXT_REMOVED}</p><p>Coat $10</p>"
        )

    def test_a_second_pass_changes_nothing(self):
        once = redact_separation_letter(_letter_html(), street=STREET, reason=REASON)

        assert redact_separation_letter(once, street=STREET, reason=REASON) == once


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return tmp_path


async def _world(db, root):
    org = Organization(name="Anon FD", slug=f"life11-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    separations = DocumentFolder(
        organization_id=org.id, **system_folder_fields("member-separations")
    )
    members_root = DocumentFolder(
        organization_id=org.id, **system_folder_fields("members")
    )
    db.add_all([separations, members_root])
    await db.flush()

    def member(**overrides):
        suffix = uuid.uuid4().hex[:8]
        fields = dict(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"m-{suffix}",
            email=f"m-{suffix}@example.org",
            first_name="Pat",
            last_name="Firefighter",
            status=UserStatus.ARCHIVED,
            address_street=STREET,
            address_city="Falls Church",
            address_state="VA",
            address_zip="22046",
            status_change_reason=REASON,
            membership_number="0417",
            deleted_at=datetime.now(UTC),
        )
        fields.update(overrides)
        return User(**fields)

    pat = member()
    # Same legal name, another member: their old letter must not be touched.
    namesake = member(membership_number="0999", address_street="9 Oak Lane")
    admin = member(
        first_name="Ada",
        last_name="Admin",
        membership_number="0001",
        status=UserStatus.ACTIVE,
        deleted_at=None,
    )
    db.add_all([pat, namesake, admin])
    await db.flush()

    def letter(name_member, html, source_id=None):
        return Document(
            organization_id=org.id,
            folder_id=separations.id,
            name=f"Property Return - {name_member.full_name} - 2026-11-01",
            file_type="text/html",
            document_type=DocumentType.GENERATED,
            status=DocumentStatus.ACTIVE,
            content_html=html,
            source_type="property_return_report",
            source_id=source_id,
        )

    linked = letter(pat, _letter_html(), source_id=pat.id)
    legacy = letter(pat, _letter_html())
    other = letter(namesake, _letter_html(number="0999", street="9 Oak Lane"))

    personal = DocumentFolder(
        organization_id=org.id,
        parent_id=members_root.id,
        name="Firefighter, Pat",
        visibility=FolderVisibility.OWNER,
        owner_user_id=pat.id,
    )
    db.add_all([linked, legacy, other, personal])
    await db.flush()
    nested = DocumentFolder(
        organization_id=org.id,
        parent_id=personal.id,
        name="Certificates",
        visibility=FolderVisibility.OWNER,
        owner_user_id=pat.id,
    )
    db.add(nested)
    await db.flush()
    stored = root / str(org.id) / "documents" / f"{uuid.uuid4().hex}.pdf"
    stored.parent.mkdir(parents=True)
    stored.write_bytes(b"%PDF-1.4 personal")
    uploaded = Document(
        organization_id=org.id,
        folder_id=nested.id,
        name="Pat's EMT card",
        file_name="emt.pdf",
        file_path=str(stored),
        file_type="application/pdf",
        document_type=DocumentType.UPLOADED,
        status=DocumentStatus.ACTIVE,
    )
    note = Document(
        organization_id=org.id,
        folder_id=personal.id,
        name="Note",
        file_type="text/html",
        document_type=DocumentType.GENERATED,
        status=DocumentStatus.ACTIVE,
        content_html="<p>Pat's note</p>",
    )
    db.add_all([uploaded, note])
    await db.flush()
    return SimpleNamespace(
        org=org,
        pat=pat,
        admin=admin,
        linked=linked,
        legacy=legacy,
        other=other,
        personal=personal,
        nested=nested,
        uploaded=uploaded,
        note=note,
        stored=stored,
    )


async def _fresh(db, model, row_id):
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _queued(db, org_id):
    return sorted(
        (
            await db.execute(
                select(
                    PendingFileDeletion.path,
                    PendingFileDeletion.area,
                    PendingFileDeletion.reason,
                ).where(PendingFileDeletion.organization_id == str(org_id))
            )
        ).all()
    )


async def _assert_documents_erased(db, w):
    for letter in (w.linked, w.legacy):
        html = (await _fresh(db, Document, letter.id)).content_html
        assert STREET not in html
        assert REASON not in html
        assert "Turnout coat" in html
        assert "$1,850.00" in html
    untouched = (await _fresh(db, Document, w.other.id)).content_html
    assert "9 Oak Lane" in untouched
    assert REASON in untouched
    for model, row in (
        (DocumentFolder, w.personal),
        (DocumentFolder, w.nested),
        (Document, w.uploaded),
        (Document, w.note),
    ):
        assert await _fresh(db, model, row.id) is None


@pytest.mark.integration
class TestAnonymisation:
    async def test_letters_are_redacted_and_the_personal_folder_goes(
        self, db_session, root
    ):
        w = await _world(db_session, root)
        service = MemberAnonymizationService(db_session)

        summary = await service.anonymize_member(w.pat)
        await db_session.flush()

        await _assert_documents_erased(db_session, w)
        assert summary["separation_letters_redacted"] == 2
        assert summary["personal_folders_deleted"] == 1
        assert summary["personal_documents_deleted"] == 2
        assert summary["personal_document_files_queued"] == 1
        assert await _queued(db_session, w.org.id) == [
            (str(w.stored.resolve()), "documents", "member_anonymization")
        ]
        assert len(service.queued_file_deletion_ids) == 1

    async def test_the_endpoint_removes_the_queued_file_after_its_commit(
        self, db_session, root, monkeypatch
    ):
        w = await _world(db_session, root)
        monkeypatch.setattr(
            users_endpoint, "_enforce_account_reset_ceiling", AsyncMock()
        )
        audit = AsyncMock()
        monkeypatch.setattr(users_endpoint, "log_audit_event", audit)

        await users_endpoint.anonymize_member(
            user_id=str(w.pat.id),
            request=fake_request(),
            db=db_session,
            current_user=SimpleNamespace(
                id=w.admin.id, organization_id=w.org.id, username="admin"
            ),
        )

        assert not w.stored.exists()
        assert await _queued(db_session, w.org.id) == []
        events = {
            call.kwargs["event_type"]: call.kwargs["event_data"]
            for call in audit.await_args_list
        }
        anonymized = events["user_anonymized"]
        assert anonymized["separation_letters_redacted"] == 2
        assert anonymized["personal_documents_deleted"] == 2
        assert events["pending_file_deletions_completed"]["files_deleted"] == 1
        for value in anonymized.values():
            assert "/" not in str(value)


@pytest.mark.integration
class TestPermanentDelete:
    async def test_letters_are_redacted_and_the_personal_folder_goes(
        self, db_session, root, monkeypatch
    ):
        w = await _world(db_session, root)
        audit = AsyncMock()
        monkeypatch.setattr(users_endpoint, "log_audit_event", audit)
        monkeypatch.setattr(
            users_endpoint, "_enforce_account_reset_ceiling", AsyncMock()
        )
        monkeypatch.setattr(
            users_endpoint, "assert_not_last_administrator", AsyncMock()
        )

        await users_endpoint.delete_user(
            user_id=UUID(w.pat.id),
            hard=True,
            db=db_session,
            current_user=SimpleNamespace(
                id=w.admin.id, organization_id=w.org.id, username="admin"
            ),
            request=fake_request(),
        )

        assert await _fresh(db_session, User, w.pat.id) is None
        await _assert_documents_erased(db_session, w)
        assert not w.stored.exists()
        deleted = next(
            call.kwargs["event_data"]
            for call in audit.await_args_list
            if call.kwargs["event_type"] == "user_hard_deleted"
        )
        assert deleted["separation_letters_redacted"] == 2
        assert deleted["personal_folders_deleted"] == 1
        assert deleted["personal_documents_deleted"] == 2
        assert deleted["files_queued"] == 1


@pytest.mark.integration
class TestANewLetterRecordsItsMember:
    async def test_save_as_document_stores_the_member_id(self, db_session):
        org = Organization(name="Anon FD", slug=f"life11-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        member_id = str(uuid.uuid4())

        doc = await PropertyReturnService(db_session).save_as_document(
            organization_id=org.id,
            member_name="Pat Firefighter",
            html_content="<p>letter</p>",
            created_by=None,
            member_id=member_id,
        )

        assert doc.source_id == member_id
