"""A chosen footer reaches the message only through ``{{footer_html}}``.

The **Closes with** selector on every template, and the Footers tab's "N
templates close with this footer" count, both suggest that picking a footer is
enough. It is not: the closing block is delivered as a context variable, and a
body that does not contain ``{{footer_html}}`` renders with no footer at all —
silently, with nothing on screen to distinguish the two outcomes.

Most shipped bodies do carry the variable. A customised body, or one in a
database seeded before the footers release, may not: re-seeding never touches a
template that already exists by name. In the screenshot demo database 31 of 35
templates omit it.

These tests pin that contract in **both** directions, so the three candidate
fixes recorded in `docs/KNOWN_LIMITATIONS.md` — append when absent, repair
legacy bodies, or mark the template in the UI — each have something deliberate
to change rather than a silent behavioural shift.

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


def test_a_body_that_never_asks_renders_without_a_footer():
    """The gap this file exists for.

    Nothing is appended. If a future change makes the footer unconditional,
    this test is the one that should fail and be deliberately rewritten.
    """
    template = _template("<p>Hello.</p>")

    _subject, html, _text = EmailTemplateService.render_static(
        template, {}, organization=_organization()
    )

    assert html.strip().endswith("</p>") or "</p>" in html
    assert "do not reply" not in html.lower()
    assert "automated message" not in html.lower()


def test_the_footer_variable_is_renderer_injected_not_caller_supplied():
    """Send sites never pass it, so nothing may treat it as a missing variable."""
    from app.services.email_template_service import RENDERER_INJECTED_VARIABLES

    assert "footer_html" in RENDERER_INJECTED_VARIABLES
    assert "footer_text" in RENDERER_INJECTED_VARIABLES
