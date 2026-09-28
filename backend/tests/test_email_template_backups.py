"""Restoring a department's wording from a template backup.

A backup holds a template as it stood before ``15c5bc7700aa`` reset it. The
editor's "Previous version" panel loads a restore draft built from it: the
backed-up subject and plain text, and the backed-up title and message placed
inside the current design. These tests pin how that draft is built and that
the list is scoped to the caller's organization.
"""

import pytest

from app.services.email_template_service import EmailTemplateService
from app.services.email_theme import (
    find_element_end,
    page_content,
    title_and_message,
    with_message,
)

_DEFAULTS = {d["type"].value: d for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS}

# The shape a department's edited body had under the previous shell.
_OLD_EDITED = (
    '<div class="container">\n'
    '    <div class="masthead">{{organization_logo_block}}<p>X</p></div>\n'
    '    <div class="header">\n        {{status_line}}\n'
    "        <h1>Welcome to the crew, {{first_name}}</h1>\n    </div>\n"
    '    <div class="{{content_class}}">\n'
    "        <p>Our own words.</p>\n"
    '        <div class="alert"><p>Nested</p></div>\n'
    "    </div>\n    {{footer_html}}\n</div>"
)


@pytest.mark.unit
class TestReadingTheMessageBack:
    def test_the_title_and_message_come_out_of_an_old_shell(self):
        title, message = title_and_message(_OLD_EDITED)
        assert title == "Welcome to the crew, {{first_name}}"
        assert "<p>Our own words.</p>" in message
        # The nested div did not end the content card early.
        assert '<div class="alert"><p>Nested</p></div>' in message
        assert "{{footer_html}}" not in message

    def test_a_literal_content_class_is_recognised(self):
        body = '<div class="header"><h1>T</h1></div><div class="content"><p>m</p></div>'
        assert title_and_message(body) == ("T", "<p>m</p>")

    def test_a_hand_written_body_is_all_message(self):
        body = "<html><head><style>p{}</style></head><body><p>raw</p></body></html>"
        assert title_and_message(body) == ("", "<p>raw</p>")

    def test_page_content_leaves_a_fragment_alone(self):
        assert page_content("<p>x</p>") == "<p>x</p>"

    def test_find_element_end_counts_nesting(self):
        html = "<div>a<div>b</div>c</div>tail"
        assert html[find_element_end(html, 5, "div") :] == "</div>tail"


@pytest.mark.unit
class TestPuttingItIntoTheNewDesign:
    def test_the_wording_goes_into_the_current_shell(self):
        title, message = title_and_message(_OLD_EDITED)
        body = with_message(_DEFAULTS["welcome"]["html"], title, message)
        assert 'class="tab"' in body
        assert '<div class="summary"' in body
        assert "<h1>Welcome to the crew, {{first_name}}</h1>" in body
        assert "<p>Our own words.</p>" in body
        # The old shell's pieces do not come back with it.
        assert 'class="header"' not in body
        assert "{{status_line}}" not in body
        assert body.count("{{footer_html}}") == 1

    def test_the_defaults_callouts_are_dropped(self):
        # Welcome's shipped body stacks a "Change your password" callout; the
        # department's message said what it wanted instead.
        assert "callout-warning" in _DEFAULTS["welcome"]["html"]
        body = with_message(_DEFAULTS["welcome"]["html"], "T", "<p>m</p>")
        assert "callout-" not in body
        assert body.rstrip().endswith("<!--[if mso]></td></tr></table><![endif]-->")

    def test_an_empty_title_keeps_the_shipped_one(self):
        body = with_message(_DEFAULTS["welcome"]["html"], "", "<p>m</p>")
        assert "<h1>Your account is ready</h1>" in body

    def test_a_body_with_no_content_card_is_refused(self):
        with pytest.raises(ValueError, match="no content card"):
            with_message("<p>not a shell</p>", "T", "<p>m</p>")

    @pytest.mark.parametrize(
        "template_type", sorted(_DEFAULTS), ids=lambda value: value
    )
    def test_every_default_can_take_a_message(self, template_type):
        body = with_message(_DEFAULTS[template_type]["html"], "T", "<p>mine</p>")
        assert "<p>mine</p>" in body
        assert body.count('<div class="{{content_class}}">') == 1


@pytest.mark.integration
class TestListingBackups:
    """``list_backups`` against the database: scoping and the restore draft."""

    @pytest.fixture
    async def setup(self, db_session, sample_org_data):
        from app.models.email_template import (
            EmailTemplate,
            EmailTemplateBackup,
            EmailTemplateType,
        )
        from app.models.user import Organization

        org = Organization(**sample_org_data)
        other = Organization(
            **{
                **sample_org_data,
                "id": "other-org-id-0000-0000-000000000000",
                "name": "Other Department",
                "slug": "other-department",
            }
        )
        db_session.add_all([org, other])
        await db_session.flush()

        defn = _DEFAULTS["welcome"]
        template = EmailTemplate(
            organization_id=org.id,
            template_type=EmailTemplateType.WELCOME,
            name="Welcome",
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
        )
        db_session.add(template)
        await db_session.flush()

        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        db_session.add_all(
            [
                EmailTemplateBackup(
                    template_id=template.id,
                    organization_id=org.id,
                    template_type="welcome",
                    subject="Welcome aboard, {{first_name}}",
                    html_body=_OLD_EDITED,
                    text_body="Our own words.",
                    reason="15c5bc7700aa",
                    created_at=now,
                ),
                EmailTemplateBackup(
                    template_id=template.id,
                    organization_id=org.id,
                    template_type="welcome",
                    subject="Older",
                    html_body=_OLD_EDITED,
                    reason="earlier",
                    created_at=now - timedelta(days=1),
                ),
                # Another department's backup pointing at this template id
                # must never be listed, whatever its template_id says.
                EmailTemplateBackup(
                    template_id=template.id,
                    organization_id=other.id,
                    template_type="welcome",
                    subject="Not yours",
                    html_body="<p>x</p>",
                    reason="15c5bc7700aa",
                ),
            ]
        )
        await db_session.flush()
        return org, other, template

    async def test_newest_first_with_a_restore_draft(self, db_session, setup):
        org, _other, template = setup
        entries = await EmailTemplateService(db_session).list_backups(
            template.id, org.id
        )
        assert [e["subject"] for e in entries] == [
            "Welcome aboard, {{first_name}}",
            "Older",
        ]
        latest = entries[0]
        assert latest["restored_subject"] == "Welcome aboard, {{first_name}}"
        assert latest["restored_text_body"] == "Our own words."
        assert "<p>Our own words.</p>" in latest["restored_html_body"]
        assert 'class="tab"' in latest["restored_html_body"]
        assert latest["html_body"] == _OLD_EDITED

    async def test_another_departments_template_is_not_found(self, db_session, setup):
        _org, other, template = setup
        service = EmailTemplateService(db_session)
        assert await service.list_backups(template.id, other.id) is None

    async def test_listing_changes_nothing(self, db_session, setup):
        org, _other, template = setup
        before = (template.subject, template.html_body, template.text_body)
        await EmailTemplateService(db_session).list_backups(template.id, org.id)
        await db_session.refresh(template)
        assert (template.subject, template.html_body, template.text_body) == before
