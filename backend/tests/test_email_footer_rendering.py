"""A chosen footer always reaches the message.

The **Closes with** selector on every template, and the Footers tab's "N
templates close with this footer" count, both say that picking a footer is
enough. Until 2026-10-11 it was not: the closing block was delivered only as
the ``{{footer_html}}`` variable, and a body without it — a customised body, or
one seeded before the footers release (31 of 35 in the screenshot demo
database) — rendered with no footer at all.

The owner chose "append when missing": a body that asks for the footer gets it
where it asks, and one that does not gets it at the end (inside the card when
the body ends with the shell's card). These tests pin both halves.

No DB session: ``render_static`` renders without one.
"""

from types import SimpleNamespace

from app.services.email_template_service import EmailTemplateService


def _organization():
    return SimpleNamespace(
        name="Oakville Fire Department",
        logo_url=None,
        email="office@oakvillefd.example.org",
        phone="555-0100",
        website="https://oakvillefd.example.org",
        fax=None,
        description=None,
        organization_type=None,
        county=None,
        founded_year=None,
        tax_id=None,
        fdid=None,
        state_id=None,
        department_id=None,
        identifier_type=None,
        mailing_address_line1=None,
        mailing_address_line2=None,
        mailing_city=None,
        mailing_state=None,
        mailing_zip=None,
        mailing_country=None,
        address_line1=None,
        address_line2=None,
        city=None,
        state=None,
        zip_code=None,
        country=None,
        settings={},
    )


def _template(html_body: str):
    return SimpleNamespace(
        subject="A subject",
        html_body=html_body,
        text_body=None,
        css_styles=None,
        footer_key=None,
        template_type=None,
        available_variables=[],
    )


def test_a_body_asking_for_the_footer_gets_one():
    template = _template("<p>Hello.</p>{{footer_html}}")

    _subject, html, _text = EmailTemplateService.render_static(
        template, {}, organization=_organization()
    )

    assert "{{footer_html}}" not in html, "the variable must be substituted"
    assert "Oakville Fire Department" in html


def _footer_html():
    return EmailTemplateService.build_context({}, _organization())["footer_html"]


def test_a_body_that_never_asks_still_closes_with_the_footer():
    """The owner's decision (2026-10-11): append when missing.

    This test used to pin the opposite — no footer — so the change would be a
    deliberate rewrite rather than a silent shift. The selector now always
    takes effect, which changes the output of customised bodies that closed
    their own way.
    """
    template = _template("<p>Hello.</p>")

    _subject, html, _text = EmailTemplateService.render_static(
        template, {}, organization=_organization()
    )

    footer = _footer_html()
    assert footer.strip()
    assert footer in html
    assert html.index("<p>Hello.</p>") < html.index(footer)


def test_nothing_is_appended_without_a_department_to_name():
    """The footer is written against the department ("an automated message
    from {{organization_name}}"); with no organization it would mail braces."""
    template = _template("<p>Hello.</p>")
    template.text_body = "Hello."

    _subject, html, text = EmailTemplateService.render_static(template, {})

    assert "automated message" not in html.lower()
    assert text == "Hello."


def test_the_footer_is_not_added_twice():
    template = _template("<p>Hello.</p>{{ footer_html }}")

    _subject, html, _text = EmailTemplateService.render_static(
        template, {}, organization=_organization()
    )

    assert html.count(_footer_html()) == 1


def test_a_shell_body_missing_the_variable_gets_it_inside_the_card():
    """A body seeded before the footer library: the shell, minus its
    {{footer_html}} line. The footer goes where that line was, inside the
    card and before Outlook's conditional close."""
    body = (
        '<div class="email-card">\n    <div class="content"><p>Hi.</p></div>\n'
        "</div>\n<!--[if mso]></td></tr></table><![endif]-->"
    )
    _subject, html, _text = EmailTemplateService.render_static(
        _template(body), {}, organization=_organization()
    )

    footer = _footer_html()
    assert html.index("<p>Hi.</p>") < html.index(footer)
    assert html.index(footer) < html.index("<!--[if mso]></td></tr></table>")


def test_a_text_body_without_the_variable_gets_the_text_footer():
    template = _template("<p>Hello.</p>")
    template.text_body = "Hello."

    _subject, _html, text = EmailTemplateService.render_static(
        template, {}, organization=_organization()
    )

    footer_text = EmailTemplateService.build_context({}, _organization())[
        "footer_text"
    ].strip()
    assert text == "Hello.\n\n" + footer_text


def test_the_footer_variable_is_renderer_injected_not_caller_supplied():
    """Send sites never pass it, so nothing may treat it as a missing variable."""
    from app.services.email_template_service import RENDERER_INJECTED_VARIABLES

    assert "footer_html" in RENDERER_INJECTED_VARIABLES
    assert "footer_text" in RENDERER_INJECTED_VARIABLES
