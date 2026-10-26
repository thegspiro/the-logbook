"""Form fields marked Sensitive: encrypted at rest, served only by permission.

An answer to a sensitive field is written to ``form_submissions.sensitive_data``
(``EncryptedJSON``) and never to the plain ``data`` JSON. The submission
endpoints return it only to holders of ``sensitive_answers.view`` and audit
each time they do; everyone else receives ``sensitive_withheld``. Integrations
read ``data`` only, so an applicant created from an interest form never
receives one.

Driven over HTTP against the real schema, and asserted against the raw rows,
because the property that matters — that the stored bytes do not contain the
answer — is invisible through the ORM, which decrypts on read.
"""

import json
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import forms as endpoints
from app.core.database import get_db
from app.models.forms import FormField, FormSubmission
from app.models.membership_pipeline import ProspectiveMember
from app.models.user import User
from app.schemas.forms import PublicFormFieldResponse
from app.services.forms_service import FormsService

pytestmark = [pytest.mark.integration]

SECRET = "Convicted of DUI in 2019"


async def _make_user(
    db: AsyncSession, org_id: str, name: str, permissions: list[str]
) -> User:
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{name}-{user_id[:8]}",
            "fn": name,
            "em": f"{name}-{user_id[:8]}@test.example",
        },
    )
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"{name} position",
            "slug": f"{name}_{position_id[:8]}",
            "perms": json.dumps(permissions),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    user = await db.get(User, user_id)
    assert user is not None
    await db.refresh(user, ["positions"])
    return user


class _Bench:
    def __init__(self, db: AsyncSession, org_id: str, client: AsyncClient):
        self.db = db
        self.org_id = org_id
        self.client = client
        self.manager: User
        self.viewer: User
        self.acting: User

    def act_as(self, user: User) -> None:
        self.acting = user

    async def reset(self) -> None:
        """A service rollback expires the caller; reload it before a request."""
        self.db.expire_all()
        await self.db.refresh(self.acting)
        await self.db.refresh(self.acting, ["positions"])

    async def make_form(self, fields: list[dict[str, Any]], **extra: Any) -> dict:
        await self.reset()
        created = await self.client.post(
            "/forms",
            json={
                "name": "Background Questionnaire",
                "category": "administration",
                "fields": fields,
                **extra,
            },
        )
        assert created.status_code == 201, created.text
        form = created.json()
        published = await self.client.post(f"/forms/{form['id']}/publish")
        assert published.status_code == 200, published.text
        return form

    async def submit(self, form_id: str, data: dict[str, Any]) -> dict:
        await self.reset()
        response = await self.client.post(
            f"/forms/{form_id}/submit", json={"data": data}
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def list_submissions(self, form_id: str) -> list[dict]:
        await self.reset()
        response = await self.client.get(f"/forms/{form_id}/submissions")
        assert response.status_code == 200, response.text
        return response.json()["submissions"]

    async def patch_field(self, form_id: str, field_id: str, body: dict):
        await self.reset()
        return await self.client.patch(f"/forms/{form_id}/fields/{field_id}", json=body)

    async def raw(self, submission_id: str) -> tuple[str, str | None]:
        """The stored `data` and `sensitive_data` text, as the database has them."""
        self.db.expire_all()
        row = (
            await self.db.execute(
                text(
                    "SELECT CAST(data AS CHAR), sensitive_data "
                    "FROM form_submissions WHERE id = :i"
                ),
                {"i": submission_id},
            )
        ).one()
        return row[0], row[1]

    async def audit_rows(self, user: User) -> list[dict]:
        rows = (
            await self.db.execute(
                text(
                    "SELECT event_data FROM audit_logs "
                    "WHERE event_type = 'form_sensitive_answers_viewed' "
                    "AND user_id = :u"
                ),
                {"u": str(user.id)},
            )
        ).scalars()
        return [r if isinstance(r, dict) else json.loads(r) for r in rows]


@pytest.fixture
async def bench(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Sensitive Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"sensitive-bench-{org_id[:8]}"},
    )

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/forms")
    app.dependency_overrides[get_db] = lambda: db_session
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        b = _Bench(db_session, org_id, client)
        b.manager = await _make_user(
            db_session, org_id, "manager", ["forms.manage", "forms.view"]
        )
        b.viewer = await _make_user(
            db_session,
            org_id,
            "viewer",
            ["forms.manage", "forms.view", "sensitive_answers.view"],
        )
        b.act_as(b.manager)
        app.dependency_overrides[get_current_user] = lambda: b.acting
        yield b


def _ids(form: dict) -> tuple[str, str]:
    by_label = {f["label"]: f["id"] for f in form["fields"]}
    return by_label["Name"], by_label["History"]


_FIELDS = [
    {"label": "Name", "field_type": "text"},
    {"label": "History", "field_type": "textarea", "is_sensitive": True},
]


class TestStorage:
    async def test_sensitive_answer_is_encrypted_and_kept_out_of_data(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)

        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})

        submission_id = (await bench.list_submissions(form["id"]))[0]["id"]
        data, sealed = await bench.raw(submission_id)
        assert "Pat" in data
        assert SECRET not in data
        assert history_id not in data
        assert sealed is not None
        assert SECRET not in sealed
        stored = await bench.db.get(FormSubmission, submission_id)
        assert stored is not None
        assert stored.sensitive_data == {history_id: SECRET}

    async def test_a_submission_without_sensitive_answers_leaves_the_column_null(
        self, bench
    ):
        form = await bench.make_form(_FIELDS)
        name_id, _ = _ids(form)

        await bench.submit(form["id"], {name_id: "Pat"})

        submission_id = (await bench.list_submissions(form["id"]))[0]["id"]
        _, sealed = await bench.raw(submission_id)
        assert sealed is None

    async def test_the_public_path_seals_too(self, bench):
        form = await bench.make_form(
            _FIELDS, is_public=True, require_authentication=False
        )
        name_id, history_id = _ids(form)
        await bench.reset()
        slug = (await bench.client.get(f"/forms/{form['id']}")).json()["public_slug"]

        submission, error = await FormsService(bench.db).submit_public_form(
            slug=slug, data={name_id: "Pat", history_id: SECRET}
        )

        assert error is None
        assert submission is not None
        data, sealed = await bench.raw(str(submission.id))
        assert SECRET not in data
        assert sealed is not None
        assert SECRET not in sealed

    async def test_the_public_form_tells_the_applicant_which_answers_are_sealed(
        self, bench
    ):
        form = await bench.make_form(_FIELDS)
        fields = (
            (
                await bench.db.execute(
                    select(FormField).where(FormField.form_id == form["id"])
                )
            )
            .scalars()
            .all()
        )

        flags = {
            f.label: PublicFormFieldResponse.model_validate(f).is_sensitive
            for f in fields
        }

        assert flags == {"Name": False, "History": True}


class TestServing:
    async def test_a_manager_without_the_permission_gets_it_withheld(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})

        (row,) = await bench.list_submissions(form["id"])

        assert row["data"] == {name_id: "Pat"}
        assert row["sensitive_answers"] is None
        assert row["sensitive_withheld"] is True
        assert await bench.audit_rows(bench.manager) == []

    async def test_the_submitter_is_not_echoed_their_sensitive_answer(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)

        response = await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})

        assert SECRET not in json.dumps(response)
        assert response["sensitive_withheld"] is True

    async def test_a_holder_sees_it_and_the_reveal_is_audited(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})
        bench.act_as(bench.viewer)

        (row,) = await bench.list_submissions(form["id"])

        assert row["sensitive_answers"] == {history_id: SECRET}
        assert row["sensitive_withheld"] is False
        (audit,) = await bench.audit_rows(bench.viewer)
        assert audit["form_id"] == form["id"]
        assert audit["submission_ids"] == [row["id"]]

    async def test_the_detail_view_follows_the_same_rule(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})
        submission_id = (await bench.list_submissions(form["id"]))[0]["id"]
        path = f"/forms/{form['id']}/submissions/{submission_id}"

        await bench.reset()
        withheld = (await bench.client.get(path)).json()
        bench.act_as(bench.viewer)
        await bench.reset()
        revealed = (await bench.client.get(path)).json()

        assert withheld["sensitive_answers"] is None
        assert withheld["sensitive_withheld"] is True
        assert revealed["sensitive_answers"] == {history_id: SECRET}

    async def test_an_answer_left_in_data_is_withheld_by_the_current_flag(self, bench):
        """A submission committed by a request that loaded the field before it
        was flagged lands in ``data``; the response still withholds it."""
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        bench.db.add(
            FormSubmission(
                organization_id=bench.org_id,
                form_id=form["id"],
                data={name_id: "Pat", history_id: SECRET},
            )
        )
        await bench.db.flush()

        (row,) = await bench.list_submissions(form["id"])

        assert row["data"] == {name_id: "Pat"}
        assert row["sensitive_withheld"] is True


class TestFlagChanges:
    async def test_marking_a_field_sensitive_seals_the_answers_already_stored(
        self, bench
    ):
        form = await bench.make_form(
            [
                {"label": "Name", "field_type": "text"},
                {"label": "History", "field_type": "textarea"},
            ]
        )
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})
        submission_id = (await bench.list_submissions(form["id"]))[0]["id"]

        response = await bench.patch_field(
            form["id"], history_id, {"is_sensitive": True}
        )

        assert response.status_code == 200, response.text
        assert response.json()["is_sensitive"] is True
        data, sealed = await bench.raw(submission_id)
        assert SECRET not in data
        assert sealed is not None
        assert SECRET not in sealed
        stored = await bench.db.get(FormSubmission, submission_id)
        assert stored is not None
        assert stored.data == {name_id: "Pat"}
        assert stored.sensitive_data == {history_id: SECRET}

    async def test_un_marking_is_refused_once_answers_are_sealed(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat", history_id: SECRET})

        response = await bench.patch_field(
            form["id"], history_id, {"is_sensitive": False}
        )

        assert response.status_code == 400
        assert "decrypt" in response.json()["detail"]
        field = await bench.db.get(FormField, history_id)
        assert field is not None
        await bench.db.refresh(field)
        assert field.is_sensitive is True

    async def test_un_marking_is_allowed_while_nothing_is_sealed(self, bench):
        form = await bench.make_form(_FIELDS)
        name_id, history_id = _ids(form)
        await bench.submit(form["id"], {name_id: "Pat"})

        response = await bench.patch_field(
            form["id"], history_id, {"is_sensitive": False}
        )

        assert response.status_code == 200, response.text
        assert response.json()["is_sensitive"] is False

    async def test_an_explicit_null_is_refused(self, bench):
        form = await bench.make_form(_FIELDS)
        _, history_id = _ids(form)

        response = await bench.patch_field(
            form["id"], history_id, {"is_sensitive": None}
        )

        assert response.status_code == 422


class TestIntegrations:
    async def test_an_interest_form_does_not_copy_a_sensitive_answer_to_the_applicant(
        self, bench
    ):
        form = await bench.make_form(
            [
                {"label": "First Name", "field_type": "text"},
                {"label": "Last Name", "field_type": "text"},
                {"label": "Email", "field_type": "email"},
                {"label": "Street Address", "field_type": "text"},
                {
                    "label": "Why do you want to join?",
                    "field_type": "textarea",
                    "is_sensitive": True,
                },
            ],
            integration_type="membership_interest",
        )
        by_label = {f["label"]: f["id"] for f in form["fields"]}
        # The address is the sensitive one here: it is a field the label map
        # would otherwise copy onto the applicant's own column.
        await bench.patch_field(
            form["id"], by_label["Street Address"], {"is_sensitive": True}
        )

        await bench.submit(
            form["id"],
            {
                by_label["First Name"]: "Pat",
                by_label["Last Name"]: "Applicant",
                by_label["Email"]: "pat.applicant@example.org",
                by_label["Street Address"]: "12 Hidden Lane",
                by_label["Why do you want to join?"]: SECRET,
            },
        )

        bench.db.expire_all()
        prospect = (
            await bench.db.execute(
                select(ProspectiveMember).where(
                    ProspectiveMember.organization_id == bench.org_id
                )
            )
        ).scalar_one()
        assert prospect.first_name == "Pat"
        assert not prospect.address_street
        assert not prospect.interest_reason
        assert "12 Hidden Lane" not in json.dumps(prospect.metadata_ or {})
        assert SECRET not in json.dumps(prospect.metadata_ or {})
