"""W50-23: a ballot Cc'd to a proxy holder says whose ballot it is.

The delegating member's ballot mail is Cc'd to the member holding their
proxy. Its card read "This link is yours alone … Don't forward this email"
and named no proxy, so the holder was told the link was someone else's
alone. The owner kept the Cc (2026-10-05) and asked for the wording to name
both: the link card is now a variable the sender fills, and
``24f56e4fc320`` carries untouched stored bodies onto it.
"""

import importlib.util
import json
import pathlib
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from app.services.email_service import EmailService
from app.services.email_template_service import EmailTemplateService
from tests.test_election_voting_flow import TestElectionSetup

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"
_SHIPPED = {d["type"].value: d for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS}


def _load(pattern: str):
    (path,) = list(_VERSIONS.glob(pattern))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load("*_24f56e4fc320_*.py")
PREDECESSOR = _load("*_c8266855a348_*.py")


def _service() -> EmailService:
    service = EmailService.__new__(EmailService)
    service.organization = SimpleNamespace(
        id="org-1",
        name="Oakville FD",
        timezone="America/Chicago",
        logo=None,
        phone=None,
        email=None,
        mailing_address=None,
        physical_address=None,
    )
    return service


async def _render(proxy_holder_name=None, template=None):
    return await _service().render_ballot_notification(
        recipient_name="Alice Anderson",
        election_title="Officer Election 2026",
        ballot_url="https://fd.example/ballot#token=abc",
        meeting_date=None,
        start_date=datetime(2026, 10, 1, 13, 0, tzinfo=timezone.utc),
        end_date=datetime(2026, 10, 3, 22, 0, tzinfo=timezone.utc),
        ballot_items_html="<ul><li>Chief</li></ul>",
        ballot_items_text="  - Chief",
        admin_contact_name="Chief Adams",
        admin_contact_email="chief@fd.example",
        template=template,
        proxy_holder_name=proxy_holder_name,
    )


@pytest.mark.unit
class TestTheWording:
    async def test_own_ballot_keeps_yours_alone(self):
        _subject, html, text_body = await _render()
        assert "This link is yours alone" in html
        assert "(This link opens your ballot.)" in text_body
        assert "{{ballot_link_notice" not in html + text_body

    async def test_proxied_ballot_names_both_members(self):
        _subject, html, text_body = await _render(proxy_holder_name="Bob Baker")
        assert "yours alone" not in html
        assert "Bob Baker holds Alice Anderson's proxy" in html
        assert "opens Alice Anderson's ballot" in html
        assert "Bob Baker holds their proxy for this election" in text_body
        assert "opens Alice Anderson's ballot" in text_body

    async def test_names_are_escaped(self):
        _subject, html, _text = await _render(proxy_holder_name="<b>Eve</b>")
        assert "<b>Eve</b>" not in html
        assert "&lt;b&gt;Eve&lt;/b&gt;" in html

    async def test_an_edited_template_without_the_notice_still_names_the_proxy(self):
        old = PREDECESSOR.CARRIED["ballot_notification"]["current"]
        stored = SimpleNamespace(
            subject="Ballot Available: {{election_title}}",
            html_body=old["html"],
            text_body=old["text"],
            css_styles=None,
            footer_key=None,
            header_accent="#4338ca",
            status_chip="Ballot open",
            layout=None,
            template_type="ballot_notification",
            organization_id="org-1",
        )
        _subject, html, text_body = await _render(
            proxy_holder_name="Bob Baker", template=stored
        )
        assert "Bob Baker holds Alice Anderson's proxy" in html
        assert "Bob Baker holds Alice Anderson's proxy" in text_body


@pytest.mark.unit
class TestTheMigration:
    def test_its_bodies_chain_from_the_predecessor_to_what_ships(self):
        assert (
            MIGRATION.BODIES["previous"]
            == PREDECESSOR.CARRIED["ballot_notification"]["current"]
        )
        shipped = _SHIPPED["ballot_notification"]
        assert MIGRATION.BODIES["current"]["html"] == shipped["html"]
        assert MIGRATION.BODIES["current"]["text"] == shipped["text"]
        assert "{{ballot_link_notice_html}}" in shipped["html"]
        assert "{{ballot_link_notice_text}}" in shipped["text"]

    def test_only_an_untouched_row_moves_and_it_comes_back(self):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        engine = sa.create_engine("sqlite://")
        previous = MIGRATION.BODIES["previous"]
        rows = [
            ("untouched", "ballot_notification", previous["html"], None),
            ("upper", "BALLOT_NOTIFICATION", previous["html"], None),
            ("edited", "ballot_notification", previous["html"] + "<!-- ours -->", None),
            ("own-css", "ballot_notification", previous["html"], ".x {}"),
            ("other", "welcome", previous["html"], None),
        ]
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "CREATE TABLE email_templates (id TEXT PRIMARY KEY, "
                    "template_type TEXT, html_body TEXT, text_body TEXT, "
                    "css_styles TEXT)"
                )
            )
            for row_id, template_type, html, css in rows:
                conn.execute(
                    sa.text(
                        "INSERT INTO email_templates VALUES " "(:id, :t, :h, :x, :c)"
                    ),
                    {
                        "id": row_id,
                        "t": template_type,
                        "h": html,
                        "x": previous["text"],
                        "c": css,
                    },
                )

        def run(fn):
            with engine.begin() as conn:
                with Operations.context(MigrationContext.configure(conn)):
                    fn()

        def bodies():
            with engine.connect() as conn:
                result = conn.execute(
                    sa.text("SELECT id, html_body FROM email_templates")
                )
                return {r.id: r.html_body for r in result}

        before = bodies()
        run(MIGRATION.upgrade)
        after = bodies()
        current = MIGRATION.BODIES["current"]["html"]
        assert after["untouched"] == current
        assert after["upper"] == current
        for row_id in ("edited", "own-css", "other"):
            assert after[row_id] == before[row_id], row_id

        run(MIGRATION.upgrade)
        assert bodies() == after

        run(MIGRATION.downgrade)
        assert bodies() == before


@pytest.mark.integration
class TestTheSend(TestElectionSetup):
    async def test_the_cc_and_the_body_name_the_proxy(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await db_session.execute(
            text("UPDATE elections SET proxy_authorizations = :auths WHERE id = :id"),
            {
                "id": data["election_id"],
                "auths": json.dumps(
                    [
                        {
                            "id": str(uuid.uuid4()),
                            "delegating_user_id": data["user1_id"],
                            "proxy_user_id": data["user2_id"],
                            "proxy_type": "single_election",
                            "reason": "Away on deployment",
                            "revoked_at": None,
                        }
                    ]
                ),
            },
        )
        await db_session.flush()
        built: list = []

        async def _accept(batch):
            built.extend(batch)
            return [True] * len(batch)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=_accept),
        ):
            sent, failed, *_rest = await ElectionService(db_session).send_ballot_emails(
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                recipient_user_ids=[uuid.UUID(data["user1_id"])],
                base_ballot_url="https://fd.example/ballot",
            )

        assert (sent, failed) == (1, 0)
        (message,) = built
        rendered = message.html_body + (message.text_body or "")
        assert message.cc_emails, "the proxy holder is no longer copied"
        assert "as their proxy for this election" in rendered
        assert "yours alone" not in rendered
