"""The election rollback and deletion alerts render through their templates.

``_notify_leadership`` used to build its own body, so the ``election_rollback``
and ``election_deleted`` templates an admin could edit were stored and never
sent. These tests pin the switch: the stored template is used when there is
one, the shipped default otherwise, and each carries the stage change, time
and vote count leadership had before.

No database: the three lookups are stubbed in order (members, performer,
organization) and the template lookup is patched.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.election import ElectionStatus
from app.models.email_template import EmailTemplate, EmailTemplateType
from app.services.election_service import ElectionService
from app.services.email_template_service import EmailTemplateService

pytestmark = pytest.mark.unit


def _result(one=None, many=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=one)
    result.scalars.return_value.all.return_value = many or []
    return result


def _user(user_id, first_name, email, slug="president"):
    return SimpleNamespace(
        id=user_id,
        first_name=first_name,
        full_name=f"{first_name} Example",
        email=email,
        roles=[SimpleNamespace(slug=slug)],
    )


def _org():
    return SimpleNamespace(
        id="org-1",
        name="Northfield Volunteer Fire Company",
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
        timezone="America/New_York",
    )


def _election(status=ElectionStatus.OPEN):
    return SimpleNamespace(id="e-1", title="Chief <2027>", status=status)


async def _send(kind, stored_template=None, **kwargs):
    chief = _user("u-1", "Dana", "dana@example.test")
    performer = _user("u-2", "Sam", "sam@example.test")
    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                _result(many=[chief, performer]),
                _result(one=performer),
                _result(one=_org()),
            ]
        )
    )
    sent = []

    class FakeEmailService(SimpleNamespace):
        async def send_email(self, **send_kwargs):
            sent.append(send_kwargs)
            return 1, 0

    def email_service(organization):
        real = __import__(
            "app.services.email_service", fromlist=["EmailService"]
        ).EmailService(organization)
        fake = FakeEmailService()
        fake._render_with_fallback = real._render_with_fallback
        return fake

    with (
        patch("app.services.election_service.EmailService", email_service),
        patch.object(
            EmailTemplateService,
            "get_template",
            AsyncMock(return_value=stored_template),
        ),
    ):
        service = ElectionService(db)
        if kind == "rollback":
            count = await service._notify_leadership_of_rollback(
                _election(),
                "u-2",
                "org-1",
                "open",
                "draft",
                "Ballots went to the wrong roster",
            )
        else:
            count = await service._notify_leadership_of_deletion(
                _election(), "u-2", "org-1", "Created in error", **kwargs
            )
    return count, sent


class TestTheRollbackAlert:
    async def test_it_is_the_shipped_template_with_every_detail(self):
        count, sent = await _send("rollback")
        # The member who rolled it back is not told about their own action.
        assert count == 1
        assert [m["to_emails"] for m in sent] == [["dana@example.test"]]
        message = sent[0]
        assert message["subject"] == "ALERT: Election Rolled Back — Chief <2027>"
        html = message["html_body"]
        assert 'class="tab"' in html
        assert ">Rolled back</td>" in html
        assert "Open → Draft" in html
        assert "Chief &lt;2027&gt;" in html
        assert "Sam Example" in html
        assert "Ballots went to the wrong roster" in html
        assert "{{" not in html.split("<body", 1)[1]
        text = message["text_body"]
        assert "Moved from: Open" in text
        assert "Moved to: Draft" in text
        assert message["template_type"] == "election_rollback"

    async def test_a_department_edit_is_what_gets_sent(self):
        stored = EmailTemplate(
            template_type=EmailTemplateType.ELECTION_ROLLBACK,
            subject="Heads up: {{election_title}}",
            html_body="<p>Custom {{previous_stage}} to {{current_stage}}</p>",
            text_body="Custom",
        )
        _count, sent = await _send("rollback", stored_template=stored)
        assert sent[0]["subject"] == "Heads up: Chief <2027>"
        assert "<p>Custom Open to Draft</p>" in sent[0]["html_body"]


class TestTheDeletionAlert:
    async def test_everyone_in_leadership_is_told_including_who_did_it(self):
        count, sent = await _send("deletion", vote_count=14)
        assert count == 2
        html = sent[0]["html_body"]
        assert sent[0]["subject"] == "CRITICAL: Election Deleted — Chief <2027>"
        assert ">Deleted</td>" in html
        assert ">14</p>" in html
        assert ">Open</p>" in html
        assert "This cannot be undone" in html
        assert "Votes at deletion: 14" in sent[0]["text_body"]
        assert sent[0]["template_type"] == "election_deleted"
