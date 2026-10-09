"""Finance receipts uploaded as documents under Finance > Receipts
(FILE_STORAGE_HARDENING decision 13).

The finance record decides who attaches and who opens a receipt: the member
who raised it, or a finance officer. The Finance folder opens only to
finance rights, so another member cannot browse to it in Documents.
"""

import io
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.finance import (
    download_expense_line_item_receipt,
    download_purchase_request_receipt,
    upload_expense_line_item_receipt,
    upload_purchase_request_receipt,
)
from app.models.document import Document, DocumentFolder
from app.models.finance import PurchaseRequestStatus
from app.models.user import Organization, Position, User, user_positions
from app.schemas.finance import (
    ExpenseLineItemCreate,
    PurchaseRequestResponse,
    PurchaseRequestUpdate,
)
from app.services import file_storage_service
from app.services.documents_service import DocumentsService
from app.services.finance_service import FinanceService

PDF = b"%PDF-1.4 receipt"


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


async def _user(db_session, org_id, first, *permissions) -> User:
    name = f"{first.lower()}-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org_id,
        username=name,
        first_name=first,
        last_name="Tester",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    position = Position(
        organization_id=org_id, name=name, slug=name, permissions=list(permissions)
    )
    db_session.add(position)
    await db_session.flush()
    await db_session.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db_session.flush()
    return (
        await db_session.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.fixture
async def finance(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Receipts VFD",
        slug=f"rcpt-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    member = await _user(db_session, org.id, "Member", "finance.request")
    other = await _user(db_session, org.id, "Other", "finance.request")
    treasurer = await _user(
        db_session, org.id, "Treasurer", "finance.view", "finance.manage"
    )
    secretary = await _user(
        db_session, org.id, "Secretary", "documents.view", "documents.manage"
    )
    service = FinanceService(db_session)
    fy = await service.create_fiscal_year(
        org_id=org.id,
        created_by=treasurer.id,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    pr = await service.create_purchase_request(
        org_id=org.id,
        requested_by=member.id,
        fiscal_year_id=fy.id,
        title="Hose couplings",
        vendor="Acme Fire Supply",
        estimated_amount=1200.00,
    )
    er = await service.create_expense_report(
        org_id=org.id,
        submitted_by=member.id,
        fiscal_year_id=fy.id,
        title="Conference travel",
        line_items=[
            {
                "description": "Hotel",
                "merchant": "Harbor Inn",
                "amount": 300.00,
                "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
                "expense_type": "travel",
            }
        ],
    )
    return {
        "org": org,
        "member": member,
        "other": other,
        "treasurer": treasurer,
        "secretary": secretary,
        "pr": pr,
        "er": er,
        "item": er.line_items[0],
    }


def _receipt(data: bytes = PDF, name: str = "IMG_0042.pdf") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


async def _attach_to_pr(db_session, f, user, **kw):
    return await upload_purchase_request_receipt(
        pr_id=str(f["pr"].id), file=_receipt(**kw), db=db_session, current_user=user
    )


@pytest.mark.unit
class TestTypedReceiptLinks:
    def test_an_unsafe_link_is_refused_on_the_way_in(self):
        with pytest.raises(ValidationError):
            PurchaseRequestUpdate(receipt_url="javascript:alert(1)")
        with pytest.raises(ValidationError):
            ExpenseLineItemCreate(
                description="x",
                amount=1,
                date_incurred=datetime.now(timezone.utc),
                receipt_url="data:text/html,x",
            )

    def test_an_unsafe_stored_link_is_withheld_on_the_way_out(self):
        now = datetime.now(timezone.utc)
        response = PurchaseRequestResponse(
            id="p1",
            organization_id="o1",
            request_number="PR-1",
            fiscal_year_id="f1",
            requested_by="u1",
            title="x",
            estimated_amount=1,
            status="draft",
            priority="medium",
            receipt_url="javascript:alert(1)",
            created_at=now,
            updated_at=now,
        )
        assert response.receipt_url is None
        assert response.receipt_file_url is None


@pytest.mark.integration
class TestPurchaseRequestReceipts:
    async def test_the_requester_attaches_a_receipt_filed_in_finance(
        self, db_session, uploads, finance
    ):
        response = await _attach_to_pr(db_session, finance, finance["member"])

        document = await db_session.get(Document, response.receipt_document_id)
        folder = await db_session.get(DocumentFolder, document.folder_id)
        root = await db_session.get(DocumentFolder, folder.parent_id)
        assert (root.slug, folder.name) == ("finance", "Receipts")
        assert document.source_type == "finance_receipt"
        assert response.receipt_file_url == (
            f"/api/v1/finance/purchase-requests/{finance['pr'].id}/receipt"
        )

    async def test_the_requester_opens_their_own_receipt(
        self, db_session, uploads, finance
    ):
        await _attach_to_pr(db_session, finance, finance["member"])

        response = await download_purchase_request_receipt(
            pr_id=str(finance["pr"].id), db=db_session, current_user=finance["member"]
        )
        disposition = response.headers["content-disposition"]
        assert "Acme-Fire-Supply_Receipt.pdf" in disposition

    async def test_another_member_neither_attaches_nor_opens(
        self, db_session, uploads, finance
    ):
        await _attach_to_pr(db_session, finance, finance["member"])

        for call in (
            lambda: _attach_to_pr(db_session, finance, finance["other"]),
            lambda: download_purchase_request_receipt(
                pr_id=str(finance["pr"].id),
                db=db_session,
                current_user=finance["other"],
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await call()
            assert exc.value.status_code == 404

    async def test_finance_officers_open_any_receipt(
        self, db_session, uploads, finance
    ):
        await _attach_to_pr(db_session, finance, finance["member"])
        response = await download_purchase_request_receipt(
            pr_id=str(finance["pr"].id),
            db=db_session,
            current_user=finance["treasurer"],
        )
        assert response.headers["content-disposition"].startswith("attachment")

    async def test_the_finance_folder_is_closed_to_other_members_and_librarians(
        self, db_session, uploads, finance
    ):
        response = await _attach_to_pr(db_session, finance, finance["member"])
        document = await db_session.get(Document, response.receipt_document_id)
        docs = DocumentsService(db_session)
        org_id = finance["org"].id

        assert not await docs.can_access_document(document, org_id, finance["member"])
        assert not await docs.can_access_document(
            document, org_id, finance["secretary"]
        )
        assert await docs.can_access_document(document, org_id, finance["treasurer"])

    async def test_a_paid_request_is_closed_to_the_requester_but_not_the_manager(
        self, db_session, uploads, finance
    ):
        finance["pr"].status = PurchaseRequestStatus.PAID
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await _attach_to_pr(db_session, finance, finance["member"])
        assert exc.value.status_code == 400
        response = await _attach_to_pr(db_session, finance, finance["treasurer"])
        assert response.receipt_document_id

    async def test_replacing_a_receipt_keeps_the_first_one(
        self, db_session, uploads, finance
    ):
        first = await _attach_to_pr(db_session, finance, finance["member"])
        second = await _attach_to_pr(db_session, finance, finance["member"])

        assert first.receipt_document_id != second.receipt_document_id
        assert await db_session.get(Document, first.receipt_document_id) is not None

    async def test_only_a_pdf_or_image_is_accepted(self, db_session, uploads, finance):
        with pytest.raises(HTTPException) as exc:
            await _attach_to_pr(
                db_session, finance, finance["member"], data=b"MZ\x90\x00", name="r.exe"
            )
        assert 400 <= exc.value.status_code < 500
        assert not [p for p in uploads.rglob("*") if p.is_file()]


@pytest.mark.integration
class TestExpenseLineItemReceipts:
    async def _attach(self, db_session, f, user):
        return await upload_expense_line_item_receipt(
            er_id=str(f["er"].id),
            item_id=str(f["item"].id),
            file=_receipt(),
            db=db_session,
            current_user=user,
        )

    async def test_the_submitter_attaches_and_opens_a_line_receipt(
        self, db_session, uploads, finance
    ):
        item = await self._attach(db_session, finance, finance["member"])
        assert item.receipt_file_url == (
            f"/api/v1/finance/expense-reports/{finance['er'].id}"
            f"/items/{finance['item'].id}/receipt"
        )

        response = await download_expense_line_item_receipt(
            er_id=str(finance["er"].id),
            item_id=str(finance["item"].id),
            db=db_session,
            current_user=finance["member"],
        )
        assert "2026-03-01_" in response.headers["content-disposition"]
        assert os.path.isfile(response.path)

    async def test_another_member_cannot_reach_the_report(
        self, db_session, uploads, finance
    ):
        with pytest.raises(HTTPException) as exc:
            await self._attach(db_session, finance, finance["other"])
        assert exc.value.status_code == 404

    async def test_an_item_from_another_report_is_not_found(
        self, db_session, uploads, finance
    ):
        with pytest.raises(HTTPException) as exc:
            await upload_expense_line_item_receipt(
                er_id=str(finance["er"].id),
                item_id=str(uuid.uuid4()),
                file=_receipt(),
                db=db_session,
                current_user=finance["member"],
            )
        assert exc.value.status_code == 404
