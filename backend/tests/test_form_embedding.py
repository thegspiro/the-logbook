"""
Embeddable public forms: which websites may frame /embed/f/<slug>.

The answer is written into a ``Content-Security-Policy: frame-ancestors``
header by nginx, so three things are under test: the origin rule (only an
exact https origin may reach that header), the settings round trip (a stored
entry that breaks the rule is dropped, never raised), and the embed-policy
endpoint's decision (the department's own websites, and only for a published,
public form with embedding switched on).
"""

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import app.api.public.forms as public_forms
from app.core.database import get_db
from app.models.forms import Form, FormStatus
from app.schemas.forms import FormUpdate
from app.schemas.organization import FormsSettings
from app.services.organization_service import OrganizationService
from app.utils.embed_origins import (
    MAX_EMBED_ORIGINS,
    normalize_embed_origin,
    valid_embed_origins,
)


@pytest.mark.unit
class TestOriginRule:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("https://example.org", "https://example.org"),
            ("  HTTPS://Example.ORG/ ", "https://example.org"),
            (
                "https://www.station-1.example.org:8443",
                "https://www.station-1.example.org:8443",
            ),
        ],
    )
    def test_accepts_an_exact_https_origin(self, value, expected):
        assert normalize_embed_origin(value) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "http://example.org",
            "example.org",
            "https://*.example.org",
            "https://example.org/apply",
            "https://example.org?x=1",
            "https://example.org; script-src *",
            "https://example.org 'unsafe-inline'",
            "https://example.org\nX-Injected: 1",
            "https://-bad.example.org",
            "https://example.org:0",
            "https://example.org:70000",
            "'none'",
            "*",
            "",
            42,
        ],
    )
    def test_refuses_anything_else(self, value):
        with pytest.raises(
            ValueError, match=r"website address|invalid port|must be text"
        ):
            normalize_embed_origin(value)

    def test_reading_drops_bad_entries_and_duplicates(self):
        stored = [
            "https://a.org",
            "javascript:alert(1)",
            "https://A.org/",
            None,
            "https://b.org",
        ]
        assert valid_embed_origins(stored) == ["https://a.org", "https://b.org"]

    def test_reading_caps_the_list(self):
        stored = [f"https://s{i}.example.org" for i in range(MAX_EMBED_ORIGINS + 5)]
        assert len(valid_embed_origins(stored)) == MAX_EMBED_ORIGINS


@pytest.mark.unit
class TestSchemas:
    def test_settings_normalize_and_deduplicate(self):
        settings = FormsSettings(
            embed_allowed_origins=["https://Example.org/", "https://example.org"]
        )
        assert settings.embed_allowed_origins == ["https://example.org"]

    def test_settings_refuse_a_bad_origin(self):
        with pytest.raises(ValidationError):
            FormsSettings(embed_allowed_origins=["https://example.org/apply"])

    def test_settings_refuse_too_many(self):
        with pytest.raises(ValidationError):
            FormsSettings(
                embed_allowed_origins=[
                    f"https://s{i}.example.org" for i in range(MAX_EMBED_ORIGINS + 1)
                ]
            )

    def test_allow_embed_cannot_be_nulled(self):
        with pytest.raises(ValidationError):
            FormUpdate(allow_embed=None)


# ---- Integration ----


async def _org(db_session: AsyncSession, settings: dict | None = None) -> str:
    import json

    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Embed Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"embed-{org_id[:8]}",
            "settings": json.dumps(settings or {}),
        },
    )
    await db_session.flush()
    return org_id


async def _form(db_session, org_id, **overrides) -> Form:
    values = dict(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Volunteer Interest",
        status=FormStatus.PUBLISHED,
        is_public=True,
        allow_embed=True,
        public_slug=uuid.uuid4().hex[:12],
    )
    values.update(overrides)
    form = Form(**values)
    db_session.add(form)
    await db_session.flush()
    return form


SITE = {"forms": {"embed_allowed_origins": ["https://station1.example.org"]}}


@pytest.fixture
def client(db_session: AsyncSession, monkeypatch):
    # The view limiter is a Redis counter shared across the run.
    monkeypatch.setattr(
        public_forms, "public_rate_limit", AsyncMock(return_value=(False, None))
    )
    app = FastAPI()
    app.include_router(public_forms.router)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _policy(client, slug) -> tuple[int, str, str]:
    async with client as c:
        r = await c.get(f"/public/v1/forms/{slug}/embed-policy")
    return (
        r.status_code,
        r.headers.get("x-embed-frame-ancestors"),
        r.json()["frame_ancestors"],
    )


@pytest.mark.integration
class TestEmbedPolicy:
    async def test_embeddable_form_names_the_departments_websites(
        self, db_session, client
    ):
        org = await _org(
            db_session,
            {
                "forms": {
                    "embed_allowed_origins": [
                        "https://station1.example.org",
                        "https://join.example.org",
                    ]
                }
            },
        )
        form = await _form(db_session, org)

        status, header, body = await _policy(client, form.public_slug)

        assert status == 200
        assert header == "https://station1.example.org https://join.example.org"
        assert body == header

    @pytest.mark.parametrize(
        "overrides",
        [
            {"allow_embed": False},
            {"is_public": False},
            {"status": FormStatus.DRAFT},
            {"status": FormStatus.ARCHIVED},
        ],
    )
    async def test_form_that_may_not_be_embedded_is_none(
        self, db_session, client, overrides
    ):
        org = await _org(db_session, SITE)
        form = await _form(db_session, org, **overrides)

        status, header, _ = await _policy(client, form.public_slug)

        assert status == 200
        assert header == "'none'"

    async def test_department_without_websites_is_none(self, db_session, client):
        org = await _org(db_session, {})
        form = await _form(db_session, org)

        _, header, _ = await _policy(client, form.public_slug)

        assert header == "'none'"

    async def test_unknown_or_malformed_slug_is_none_not_an_error(self, client):
        status, header, _ = await _policy(client, "0123456789ab")
        assert (status, header) == (200, "'none'")

    async def test_stored_entries_that_break_the_rule_never_reach_the_header(
        self, db_session, client
    ):
        org = await _org(
            db_session,
            {
                "forms": {
                    "embed_allowed_origins": [
                        "https://ok.example.org",
                        "https://evil.example.org; script-src *",
                        "*",
                    ]
                }
            },
        )
        form = await _form(db_session, org)

        _, header, _ = await _policy(client, form.public_slug)

        assert header == "https://ok.example.org"

    async def test_another_departments_websites_are_not_used(self, db_session, client):
        await _org(db_session, SITE)
        mine = await _org(db_session, {})
        form = await _form(db_session, mine)

        _, header, _ = await _policy(client, form.public_slug)

        assert header == "'none'"


@pytest.mark.integration
class TestSettingsRead:
    async def test_bad_stored_entries_are_dropped_not_raised(self, db_session):
        org = await _org(
            db_session,
            {"forms": {"embed_allowed_origins": ["https://ok.example.org", "nope", 7]}},
        )

        settings = await OrganizationService(db_session).get_organization_settings(org)

        assert settings.forms.embed_allowed_origins == ["https://ok.example.org"]

    async def test_a_malformed_section_reads_as_empty(self, db_session):
        org = await _org(db_session, {"forms": "not a dict"})

        settings = await OrganizationService(db_session).get_organization_settings(org)

        assert settings.forms.embed_allowed_origins == []
