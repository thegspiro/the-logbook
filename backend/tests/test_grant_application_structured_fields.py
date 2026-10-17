"""A grant application's budget summary and key contacts are structured data.

The form sent both as free text while the API required a dict and a list of
dicts, so any typed value was refused with a 422 and the application would not
save. The form now collects an amount per budget category and a list of named
contacts; these tests pin the request shape the API accepts, that the service
stores it and can clear it, and that the response still reads back any shape
already in the untyped JSON columns.
"""

import json
import uuid

import pytest
from pydantic import ValidationError

from app.models.grant import GrantApplication
from app.models.user import Organization, User
from app.schemas.grant import (
    GrantApplicationCreate,
    GrantApplicationResponse,
    GrantApplicationUpdate,
)
from app.services.grant_service import GrantService

STRUCTURED = {
    "budgetSummary": {"equipment": 85000, "training": 12500.5, "notes": "SCBA"},
    "keyContacts": [
        {"name": "Dana Ruiz", "role": "Program officer", "email": "dana@afg.gov"},
        {"name": "Chief Lee"},
    ],
}


@pytest.mark.unit
class TestRequestShape:
    def test_an_amount_per_category_and_named_contacts_are_accepted(self):
        dumped = GrantApplicationUpdate.model_validate(STRUCTURED).model_dump(
            exclude_unset=True
        )

        assert dumped["budget_summary"] == {
            "equipment": 85000,
            "training": 12500.5,
            "notes": "SCBA",
        }
        assert dumped["key_contacts"] == [
            {"name": "Dana Ruiz", "role": "Program officer", "email": "dana@afg.gov"},
            {"name": "Chief Lee"},
        ]
        # The columns are JSON: what the service stores must serialize.
        json.dumps(dumped)

    def test_create_accepts_the_same_shape(self):
        GrantApplicationCreate.model_validate({**STRUCTURED, "grantProgramName": "AFG"})

    @pytest.mark.parametrize(
        "payload",
        [
            {"budgetSummary": "How the money will be spent"},
            {"keyContacts": "Dana, program officer"},
            {"budgetSummary": {"equipment": -1}},
            {"budgetSummary": {"vehicles": 100}},
            {"keyContacts": [{"role": "Signatory"}]},
            {"keyContacts": [{"name": "Dana", "email": "not-an-email"}]},
        ],
    )
    def test_a_malformed_value_is_refused(self, payload):
        with pytest.raises(ValidationError):
            GrantApplicationUpdate.model_validate(payload)

    def test_null_is_kept_so_an_edit_can_clear_both(self):
        dumped = GrantApplicationUpdate.model_validate(
            {"budgetSummary": None, "keyContacts": None}
        ).model_dump(exclude_unset=True)

        assert dumped == {"budget_summary": None, "key_contacts": None}


@pytest.mark.integration
class TestStoredValues:
    async def _application(self, db):
        org = Organization(name="Grants FD", slug=f"grants-{uuid.uuid4().hex[:8]}")
        db.add(org)
        await db.flush()
        user = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"officer-{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            first_name="Pat",
            last_name="Quinn",
            password_hash="x",
        )
        db.add(user)
        application = GrantApplication(
            organization_id=org.id, grant_program_name="AFG Equipment Grant"
        )
        db.add(application)
        await db.flush()
        return org, user, application

    async def test_the_service_stores_and_then_clears_them(self, db_session):
        org, user, application = await self._application(db_session)
        app_id, org_id, user_id = application.id, org.id, user.id
        service = GrantService(db_session)
        data = GrantApplicationUpdate.model_validate(STRUCTURED).model_dump(
            exclude_unset=True
        )

        await service.update_application(app_id, org_id, data, user_id)
        await db_session.flush()
        db_session.expire_all()
        stored = await service.get_application(app_id, org_id)
        assert stored is not None
        assert stored.budget_summary == data["budget_summary"]
        assert stored.key_contacts == data["key_contacts"]

        cleared = GrantApplicationUpdate.model_validate(
            {"budgetSummary": None, "keyContacts": None}
        ).model_dump(exclude_unset=True)
        await service.update_application(app_id, org_id, cleared, user_id)
        await db_session.flush()
        db_session.expire_all()
        stored = await service.get_application(app_id, org_id)
        assert stored is not None
        assert stored.budget_summary is None
        assert stored.key_contacts is None

    async def test_a_shape_stored_before_the_schema_was_tightened_still_reads(
        self, db_session
    ):
        org, _user, application = await self._application(db_session)
        application.budget_summary = {"total": "about 90k", "breakdown": [1, 2]}
        application.key_contacts = [{"contact": "Dana"}]
        await db_session.flush()

        loaded = await GrantService(db_session).get_application(application.id, org.id)
        response = GrantApplicationResponse.model_validate(loaded).model_dump(
            by_alias=True
        )

        assert response["budgetSummary"] == {
            "total": "about 90k",
            "breakdown": [1, 2],
        }
        assert response["keyContacts"] == [{"contact": "Dana"}]
