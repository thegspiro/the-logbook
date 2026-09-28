"""The event reminder leads with a calendar-page date tile.

The tile's month and day are their own variables because ``event_start``
arrives as one formatted string. These tests pin that the sender computes
them in the department's timezone, that the default body uses them, and that
``ba5c348d7045`` moves exactly the untouched rows onto the new body.
"""

import importlib.util
import pathlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa

from app.models.email_template import EmailTemplateType
from app.services.email_service import EmailService
from app.services.email_template_service import (
    SAMPLE_CONTEXT,
    EmailTemplateService,
    get_variables_for_type,
)

pytestmark = pytest.mark.unit

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"
_DEFAULT = next(
    d
    for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
    if d["type"] == EmailTemplateType.EVENT_REMINDER
)


def _load(pattern: str):
    (path,) = list(_VERSIONS.glob(pattern))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load("*_ba5c348d7045_*.py")
PREVIOUS_REVISION = _load("*_15c5bc7700aa_*.py")


def _org(tz="America/Los_Angeles"):
    return SimpleNamespace(
        id="org-1",
        name="Northfield",
        logo="",
        phone="",
        email="",
        website="",
        settings={},
        physical_address_same=True,
        mailing_address_line1="",
        mailing_city="",
        mailing_state="",
        mailing_zip="",
        timezone=tz,
    )


class TestTheTemplate:
    def test_the_default_leads_with_the_tile(self):
        html = _DEFAULT["html"]
        assert 'class="summary-lead"><table class="tile-date"' in html
        assert "{{event_month}}" in html
        assert "{{event_day}}" in html
        assert "{accent}" not in html

    def test_the_variables_are_declared_and_sampled(self):
        names = {v["name"] for v in get_variables_for_type("event_reminder")}
        assert {"event_month", "event_day"} <= names
        assert SAMPLE_CONTEXT["event_reminder"]["event_month"] == "Mar"
        assert SAMPLE_CONTEXT["event_reminder"]["event_day"] == "15"


class TestTheSender:
    async def _context(self, start, tz="America/Los_Angeles"):
        service = EmailService(_org(tz))
        captured = {}

        async def fake_render(**kwargs):
            captured.update(kwargs["context"])
            return "s", "<p>h</p>", "t"

        with (
            patch.object(service, "_render_with_fallback", side_effect=fake_render),
            patch.object(service, "send_email", AsyncMock(return_value=(1, 0))),
        ):
            await service.send_event_reminder(
                to_email="a@example.test",
                recipient_name="A",
                event_title="Drill",
                event_start=start,
                event_end=start,
                event_type="Training",
            )
        return captured

    async def test_the_tile_is_the_departments_date_not_utc(self):
        # 02:00 UTC on Oct 15 is still Oct 14 in Los Angeles.
        start = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)
        context = await self._context(start)
        assert context["event_month"] == "Oct"
        assert context["event_day"] == "14"
        assert "October 14" in context["event_start"]

    async def test_the_day_has_no_leading_zero(self):
        start = datetime(2026, 3, 4, 18, 0, tzinfo=timezone.utc)
        context = await self._context(start, tz="UTC")
        assert context["event_day"] == "4"


def _engine(rows):
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE email_templates (id TEXT PRIMARY KEY, "
                "template_type TEXT, html_body TEXT, css_styles TEXT)"
            )
        )
        for row in rows:
            conn.execute(
                sa.text(
                    "INSERT INTO email_templates VALUES "
                    "(:id, :template_type, :html_body, :css_styles)"
                ),
                {"css_styles": None, **row},
            )
    return engine


def _run(engine, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def _bodies(engine):
    with engine.connect() as conn:
        rows = conn.execute(sa.text("SELECT id, html_body FROM email_templates"))
        return {row.id: row.html_body for row in rows}


class TestTheMigration:
    def test_its_bodies_are_the_previous_and_the_shipped_default(self):
        assert (
            MIGRATION.PREVIOUS_BODY
            == PREVIOUS_REVISION.DEFAULTS["event_reminder"]["html_body"]
        )
        assert MIGRATION.CURRENT_BODY == _DEFAULT["html"]

    def test_only_an_untouched_row_moves_and_it_comes_back(self):
        engine = _engine(
            [
                {
                    "id": "untouched",
                    "template_type": "event_reminder",
                    "html_body": MIGRATION.PREVIOUS_BODY,
                },
                {
                    "id": "edited",
                    "template_type": "event_reminder",
                    "html_body": MIGRATION.PREVIOUS_BODY.replace("Hello", "Hi"),
                },
                {
                    "id": "own-css",
                    "template_type": "event_reminder",
                    "html_body": MIGRATION.PREVIOUS_BODY,
                    "css_styles": ".x {}",
                },
                {
                    "id": "other-type",
                    "template_type": "welcome",
                    "html_body": MIGRATION.PREVIOUS_BODY,
                },
            ]
        )
        before = _bodies(engine)
        _run(engine, MIGRATION.upgrade)
        after = _bodies(engine)
        assert after["untouched"] == MIGRATION.CURRENT_BODY
        for row_id in ("edited", "own-css", "other-type"):
            assert after[row_id] == before[row_id], row_id
        _run(engine, MIGRATION.downgrade)
        assert _bodies(engine) == before
